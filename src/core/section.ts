import { flatSections } from "./sections.js";

/**
 * Section-targeted read (v1.4 Phase 7). Extract one heading's section from a
 * markdown document so pulling a dossier's *Knobs* section doesn't cost the whole
 * file. Matches a heading by text (case-insensitive), returns from that heading
 * through to the next heading of the same or higher level.
 */
export function extractSection(markdown: string, heading: string): string | null {
  // a heading that is itself named "#1 priority" is not found as an anchor: fall through to the name lookup
  if (heading.startsWith("#") && !/^#{1,6}\s/.test(heading)) {
    const byAnchor = extractByAnchor(markdown, heading.slice(1));
    if (byAnchor !== null) return byAnchor;
  }
  const target = heading.trim().toLowerCase();
  const lines = markdown.split("\n");
  let startIdx = -1;
  let startLevel = 0;

  const headingAt = (line: string): { level: number; text: string } | null => {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    return m ? { level: m[1].length, text: m[2].trim().toLowerCase() } : null;
  };

  for (let i = 0; i < lines.length; i++) {
    const h = headingAt(lines[i]);
    if (h && h.text === target) {
      startIdx = i;
      startLevel = h.level;
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const h = headingAt(lines[i]);
    if (h && h.level <= startLevel) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n").trimEnd();
}

/** The section with this anchor (hewtd's rules, as search results give it) through the next heading of the same or higher level. */
function extractByAnchor(markdown: string, anchor: string): string | null {
  const flat = flatSections(markdown);
  const at = flat.findIndex((s) => s.level > 0 && s.anchor === anchor);
  if (at < 0) return null;
  const end = flat.findIndex((s, i) => i > at && s.level <= flat[at].level);
  return flat
    .slice(at, end < 0 ? undefined : end)
    .map((s) => (s.level ? `${"#".repeat(s.level)} ${s.heading}\n` : "") + s.body)
    .join("\n")
    .trimEnd();
}
