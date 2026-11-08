/**
 * Flat sections of a markdown body with hit-em-with-the-docs' anchor rules (copied from its v2.21.0 `links/anchors.ts`,
 * no dependency): `{#id}` first, GitHub slugs, `-1`/`-2` for repeats, ATX (also in blockquotes) and setext headings, fences skipped.
 */
export interface FlatSection {
  /** "" for the text before the first heading */
  anchor: string;
  level: number;
  /** heading text from the source (inline code kept), without `#`s and `{#id}` */
  heading: string;
  /** markdown after the heading line up to the next heading of any level */
  body: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*~]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

export function flatSections(markdown: string): FlatSection[] {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) for (let i = 0; i <= end; i++) lines[i] = "";
  }
  const heads: { level: number; line: number; span: number; anchor: string; heading: string }[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = line.match(/^(?: {0,3}>\s?)* {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    const under = lines[i + 1]?.match(/^ {0,3}(=+|-+)\s*$/);
    const setext = !h && under && line.trim() !== "" && !/^ {0,3}([-*+>|#]|\d+[.)])(\s|$)/.test(line) && (i === 0 || lines[i - 1].trim() === "" || /^ {0,3}#/.test(lines[i - 1]));
    if (!h && !setext) return;
    let text = h ? h[2] : line.trim();
    let custom: string | undefined;
    const c = text.match(/\s*\{#([^}\s]+)\}\s*$/);
    if (c) { custom = c[1]; text = text.slice(0, c.index); }
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    heads.push({ level: h ? h[1].length : under![1][0] === "=" ? 1 : 2, line: i, span: h ? 1 : 2, anchor: custom ?? (n === 0 ? base : `${base}-${n}`), heading: text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*~]+/g, "").replace(/`/g, "").trim() });
  });
  const out: FlatSection[] = [{ anchor: "", level: 0, heading: "", body: lines.slice(0, heads[0]?.line ?? lines.length).join("\n") }];
  heads.forEach((h, i) => out.push({ anchor: h.anchor, level: h.level, heading: h.heading, body: lines.slice(h.line + h.span, heads[i + 1]?.line ?? lines.length).join("\n") }));
  return out;
}
