import type { GraphBuilder } from "./graph.js";
import type { IndexedDocument } from "./types.js";
import { sectionFields } from "./section-fields.js";

/** Walk seeds and path length. Fixed from the issue's shape, not tuned on a question set. */
export const PATH_SEEDS = 5;
export const PATH_MAX = 5;

export interface ReadingStep {
  path: string;
  title: string;
  section?: { anchor?: string; trail?: string };
  /** "hit" for a search result, else the seed or member it is linked to */
  via?: string;
}

interface Hit { path: string; score: number; confidence: number }

/**
 * The ordered reading path for a flow question (semantic-memory#61): a personalized-PageRank walk from the top hits on
 * the doc graph, up to PATH_MAX docs by walk mass x (1 + hybrid score). A `kind: overview` member goes first and the
 * rest follow its link order; with no overview the order is the walk's. `hits` is the folded list, so a copy that
 * `fold` merged away (`dropped`) is never a member. The caller supplies the best chunk per doc.
 */
export function readingPath(
  graph: GraphBuilder,
  hits: Hit[],
  docByPath: Map<string, IndexedDocument>,
  { dropped, minConfidence, skip, bestChunk }: { dropped: Set<string>; minConfidence: number; skip: (p: string) => boolean; bestChunk: (path: string) => string | undefined },
): ReadingStep[] {
  const seeds = new Map(hits.filter((h) => h.confidence >= minConfidence).slice(0, PATH_SEEDS).map((h) => [h.path, h.score]));
  if (!seeds.size) return [];
  const score = new Map(hits.map((h) => [h.path, h.score]));
  const ranked = graph
    .walk(seeds, { skip: (p) => skip(p) || dropped.has(p) })
    .map((r) => ({ path: r.path, rank: r.score * (1 + Math.max(0, score.get(r.path) ?? 0)) }))
    .sort((a, b) => b.rank - a.rank || (a.path < b.path ? -1 : 1))
    .map((r) => r.path);
  const isOverview = (p: string) => docByPath.get(p)?.frontmatter?.kind === "overview";
  const near = (p: string) => new Set([...graph.forwardlinks(p), ...graph.backlinks(p)].map((n) => n.path));
  let members = ranked.slice(0, PATH_MAX);
  if (!members.some(isOverview)) {
    // an overview next to a seed is worth a slot even when the walk ranked it lower
    const adjacent = ranked.find((p) => isOverview(p) && [...seeds.keys()].some((s) => near(s).has(p)));
    if (adjacent) members = [...members.slice(0, PATH_MAX - 1), adjacent];
  }
  const head = members.find(isOverview);
  if (head) {
    const order = docByPath.get(head)?.mdLinks ?? [];
    const at = (p: string) => (order.includes(p) ? order.indexOf(p) : Infinity); // unlinked members keep walk order (stable sort)
    members = [head, ...members.filter((p) => p !== head).sort((a, b) => at(a) - at(b))];
  }
  return members.map((p) => {
    const doc = docByPath.get(p);
    const title = doc?.title ?? p;
    const sec = sectionFields(doc, bestChunk(p), title);
    const nb = near(p);
    const via = seeds.has(p) ? "hit" : [...seeds.keys()].find((s) => nb.has(s)) ?? members.find((m) => nb.has(m));
    return { path: p, title, ...((sec.anchor || sec.section) && { section: { ...(sec.anchor && { anchor: sec.anchor }), ...(sec.section && { trail: sec.section }) } }), ...(via && { via }) };
  });
}
