import type { IndexedDocument } from "./types.js";

export interface SectionFields {
  section?: string;
  anchor?: string;
  code?: string[];
  /** the matched chunk without its heading-trail line */
  text: string;
}

/**
 * The section a result's matched chunk answers for (`chunkSection[chunks.indexOf(chunk)]`). `section` is the heading trail
 * with the H1 dropped when it is the doc's title; a field is left out when the section has none (text before the first heading).
 */
export function sectionFields(doc: IndexedDocument | undefined, chunk: string | undefined, title: string): SectionFields {
  const text = chunk ?? "";
  const at = doc && chunk ? doc.chunks.indexOf(chunk) : -1;
  const sec = at >= 0 ? doc!.sections?.[doc!.chunkSection?.[at] ?? -1] : undefined;
  if (!sec) return { text };
  const trail = sec.trail === title ? "" : sec.trail.startsWith(`${title} > `) ? sec.trail.slice(title.length + 3) : sec.trail;
  return {
    text: sec.trail && text.startsWith(`${sec.trail}\n`) ? text.slice(sec.trail.length + 1) : text,
    ...(trail && { section: trail }),
    ...(sec.anchor && { anchor: sec.anchor }),
    ...(sec.code?.length && { code: sec.code }),
  };
}
