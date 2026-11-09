import { tokenize, type Bm25Index } from "./bm25.js";
import { COMMON_WORDS } from "./common-words.js";

const DOTTED = /^\p{L}[\p{L}\p{N}_-]+(\.\p{L}[\p{L}\p{N}_-]+)+$/u; // every part starts with a letter and has 2+ chars: `v1.12.0`, `e.g.` are not names
const CAMEL = /^[a-z]+[A-Z]\w*$/;
const PASCAL = /^(?=.*[a-z])(?:[A-Z][a-z0-9]*){2,}$/; // 2+ capitals: `TaskResponse`; prose (`SessionEnd`, `SAML`) unless `known`
const EDGE = /^[^\p{L}\p{N}/_]+|[^\p{L}\p{N}/_]+$/gu; // keeps `_`: the index tokens of `__init__.py` and `_helper` carry theirs
const UNDERSCORES = /^_+|_+$/g; // `__init__`, `_italic_`: decided without them, so prose emphasis is not a name
const COMMON = new Set(COMMON_WORDS.split(/\s+/));
const inflected = (w: string) => [w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ies$/, "y"), w.replace(/(ing|ed)$/, ""), w.replace(/(ing|ed)$/, "e"), w.replace(/(ly|er)$/, "")];
// two levels: the list keeps one form per family, so `supposedly` reaches `supposed` and then `suppose`
const isCommon = (w: string, depth = 2): boolean => COMMON.has(w) || (depth > 0 && inflected(w).some((x) => x !== w && isCommon(x, depth - 1)));
// name-shaped part of a word: `Hotjar` (not sentence-initial), `FullStory`, `tRPC`, `k8s`, but not `SLA`, `v2`, `3rd`
const CAPITALIZED = /^[A-Z][a-z]+$/;
const MIXED = /[a-z][A-Z]|^[A-Z][a-z]+[A-Z]/;
const DIGITED = /^(?=.*\d)(?=.*\p{L})(?!v?\d)/u;

/**
 * Identifier-shaped terms of a query, in their original spelling: snake_case, lower camelCase, paths, dotted names and
 * backticked spans without whitespace. Not in v1: bare acronyms (SLA, TLS), kebab-case (too many product names and prose words).
 * PascalCase (2+ capitals) counts only when `known` says the code has that name; `() => true` lists the candidates.
 * `names` adds product and tool names, for `missingTerms` only: each part of a hyphenated word that is capitalized (unless it
 * opens a sentence), mixed case, has a digit, or is lowercase and not an English word. Not for query typing or entity cards.
 */
export function identifiers(query: string, known?: (term: string) => boolean, names = false): string[] {
  const out = new Set<string>();
  for (const m of query.matchAll(/`([^`\s]+)`/g)) out.add(m[1].replace(EDGE, ""));
  let initial = true;
  for (const w of query.replace(/`[^`]*`/g, " ").split(/[\s=]+/)) {
    const raw = w.replace(EDGE, "");
    const opens = initial;
    initial = /[.?!:]$/.test(w);
    const t = raw.replace(UNDERSCORES, "");
    if (raw.includes("://")) continue;
    // a path has an extension or 2+ slashes: `TCP/IP`, `client/server`, `pass/fail` are prose
    if (t.includes("_") || (t.includes("/") && (t.includes(".") || t.split("/").length > 2)) || CAMEL.test(t) || DOTTED.test(t) || (known && PASCAL.test(t) && known(t))) out.add(raw);
    else if (names && !/[/._]|:\/\//.test(raw)) {
      raw.split("-").forEach((p, i) => {
        if (p.length < 2 || (opens && i === 0 && CAPITALIZED.test(p))) return;
        if (CAPITALIZED.test(p) || MIXED.test(p) || DIGITED.test(p) || (/^\p{Ll}+$/u.test(p) && !isCommon(p))) out.add(p);
      });
    }
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
export function missingTerms(query: string, index: Bm25Index, paths: string, known?: (term: string) => boolean): string[] {
  return identifiers(query, known, true).filter((term) =>
    tokenize(term.slice(term.lastIndexOf("/") + 1)).some((t) => !index.has(t) && !paths.includes(t)),
  );
}
