import { flatSections } from "../../node_modules/@theglitchking/hit-em-with-the-docs/dist/core/links/anchors.js";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The flat-section anchor (hewtd's rules, via its own code) whose text holds the middle of `snippet`; null when none does. Before section results existed this was the only way to say which section a result showed. */
export function anchorOfSnippet(markdown: string, snippet: string): string | null {
  const s = squash(snippet);
  const probe = s.slice(Math.max(0, Math.floor(s.length / 2) - 40), Math.floor(s.length / 2) + 40);
  if (!probe) return null;
  const body = markdown.replace(/^---[\s\S]*?\n---\n/, "");
  return flatSections(body).find((sec) => squash(`${sec.heading}${sec.text}`).includes(probe))?.anchor ?? null;
}

export interface SectionRow { id: string; rank: number | null; anchor: string | null; fromField: boolean; wantAnchor: string; slots: number; bytes: number }

/** Share-style summary of one arm over the `section` tier (anchor correct = right doc and right anchor) and the `fold` tier. */
export function summarize(rows: SectionRow[], tier: (id: string) => string) {
  const sec = rows.filter((r) => tier(r.id) === "section"), fold = rows.filter((r) => tier(r.id) === "fold");
  const hit = (r: SectionRow, k: number) => r.rank !== null && r.rank <= k;
  const ok = (r: SectionRow, k: number) => hit(r, k) && r.anchor === r.wantAnchor;
  return {
    n: sec.length, docAt1: sec.filter((r) => hit(r, 1)).length, docAt3: sec.filter((r) => hit(r, 3)).length,
    anchorAt1: sec.filter((r) => ok(r, 1)).length, anchorAt3: sec.filter((r) => ok(r, 3)).length,
    meanBytes: Math.round(sec.reduce((a, r) => a + r.bytes, 0) / Math.max(1, sec.length)),
    foldN: fold.length, ownerAt3: fold.filter((r) => hit(r, 3)).length, ownerAt1: fold.filter((r) => hit(r, 1)).length, ownerAnchorAt1: fold.filter((r) => ok(r, 1)).length,
    foldSlots: fold.reduce((a, r) => a + r.slots, 0), // copy and pointer docs in the top 3, summed over the fold cases
  };
}
