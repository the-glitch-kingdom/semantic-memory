import { tokenize, type Bm25Index } from "./bm25.js";

const DOTTED = /^\p{L}[\p{L}\p{N}_-]+(\.\p{L}[\p{L}\p{N}_-]+)+$/u; // every part starts with a letter and has 2+ chars: `v1.12.0`, `e.g.` are not names
const CAMEL = /^[a-z]+[A-Z]\w*$/;
const EDGE = /^[^\p{L}\p{N}/_]+|[^\p{L}\p{N}/_]+$/gu; // keeps `_`: the index tokens of `__init__.py` and `_helper` carry theirs
const UNDERSCORES = /^_+|_+$/g; // `__init__`, `_italic_`: decided without them, so prose emphasis is not a name

/**
 * Identifier-shaped terms of a query, in their original spelling: snake_case, lower camelCase, paths, dotted names and
 * backticked spans without whitespace. Not in v1: bare acronyms (SLA, TLS), PascalCase, kebab-case (too many product names and prose words).
 */
export function identifiers(query: string): string[] {
  const out = new Set<string>();
  for (const m of query.matchAll(/`([^`\s]+)`/g)) out.add(m[1].replace(EDGE, ""));
  for (const w of query.replace(/`[^`]*`/g, " ").split(/[\s=]+/)) {
    const raw = w.replace(EDGE, "");
    const t = raw.replace(UNDERSCORES, "");
    if (raw.includes("://")) continue;
    // a path has an extension or 2+ slashes: `TCP/IP`, `client/server`, `pass/fail` are prose
    if (t.includes("_") || (t.includes("/") && (t.includes(".") || t.split("/").length > 2)) || CAMEL.test(t) || DOTTED.test(t)) out.add(raw);
  }
  out.delete("");
  return [...out];
}

/**
 * Identifiers of the query that the docs do not contain: some token of the term (a path checks only its last segment)
 * has df 0 in the BM25 index and is not in `paths`, since BM25 path words replace `_` with a space and a file named
 * after the identifier would otherwise count as missing. `paths` is the lowercased, joined doc paths.
 * shortcut: parts are checked, not their adjacency; upgrade to a literal check over doc content if the eval shows misses.
 */
export function missingTerms(query: string, index: Bm25Index, paths: string): string[] {
  return identifiers(query).filter((term) =>
    tokenize(term.slice(term.lastIndexOf("/") + 1)).some((t) => !index.has(t) && !paths.includes(t)),
  );
}
