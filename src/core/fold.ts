import type { CodeData } from "./code-graph.js";
import type { IndexedDocument } from "./types.js";

/**
 * Below this many characters a section is pointer-sized (a link and a sentence); at or above it, two sections with the same
 * normalized-text hash are one passage. Fixed from the shape of pointers and copies, not tuned on a question set.
 */
export const FOLD_MIN_CHARS = 300;

interface Ranked { path: string; score: number; matchedChunk?: string; snippet?: string }

/**
 * Folds copies and pointers into the section that owns the text (semantic-memory#60), on the ranked list after rerank and before the limit.
 * A result folds into an owner only when that owner is itself in the list, so a fold never drops an answer: the owner takes the best position
 * and score of the group and lists the others in `also_in: ["b.md#setup"]`. Three ways to find the owner, in order:
 *  - export `duplicates`: the result's best section is the one named by the copy's `section` (hewtd ships the owner's anchor there) or has the owner section's text;
 *  - export `points_to` (hewtd records no `from`): the result's best section is pointer-sized and the doc links to the target;
 *  - no export needed: identical normalized-text hash, at least FOLD_MIN_CHARS long; the higher-ranked result owns it.
 */
export function fold<T extends Ranked>(ranked: T[], docByPath: Map<string, IndexedDocument>, code: CodeData | null): (T & { also_in?: string[] })[] {
  const at = new Map(ranked.map((r, i) => [r.path, i]));
  const best = (r: Ranked) => {
    const doc = docByPath.get(r.path), chunk = r.matchedChunk ?? r.snippet ?? "";
    const i = doc ? doc.chunks.indexOf(chunk) : -1;
    return { doc, len: chunk.length, sec: doc?.sections?.[doc.chunkSection?.[i] ?? -1] };
  };

  const hashOwner = new Map<string, string>();
  const ownerOf = new Map<string, string>();
  for (const r of ranked) {
    const { doc, len, sec } = best(r), exp = code?.docs.get(r.path);
    let owner: string | undefined;
    for (const d of exp?.duplicates ?? []) {
      const ownerHash = docByPath.get(d.owner)?.sections?.find((s) => s.anchor === d.ownerAnchor)?.hash;
      if (at.has(d.owner) && sec && (sec.anchor === d.section || sec.hash === ownerHash)) owner = d.owner;
    }
    if (!owner && len < FOLD_MIN_CHARS) owner = exp?.pointsTo?.find((t) => at.has(t) && doc?.mdLinks?.includes(t));
    if (!owner && sec && len >= FOLD_MIN_CHARS) {
      const first = hashOwner.get(sec.hash);
      if (first === undefined) hashOwner.set(sec.hash, r.path);
      else if (first !== r.path) owner = first;
    }
    if (owner && owner !== r.path) ownerOf.set(r.path, owner);
  }
  for (const [p, o] of ownerOf) if (ownerOf.has(o)) ownerOf.delete(p); // an owner that is itself folded: keep both rather than chase a chain

  const group = new Map<string, { at: number; score: number; also: string[] }>();
  for (const [p, o] of ownerOf) {
    const i = at.get(p)!, r = ranked[i], g = group.get(o) ?? { at: at.get(o)!, score: ranked[at.get(o)!].score, also: [] };
    const anchor = best(r).sec?.anchor;
    group.set(o, { at: Math.min(g.at, i), score: Math.max(g.score, r.score), also: [...g.also, anchor ? `${p}#${anchor}` : p] });
  }
  return ranked
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !ownerOf.has(r.path))
    .map(({ r, i }) => {
      const g = group.get(r.path);
      return { r: g ? { ...r, score: g.score, also_in: g.also } : r, i: g ? g.at : i };
    })
    .sort((a, b) => a.i - b.i)
    .map(({ r }) => r);
}
