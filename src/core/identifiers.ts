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
    initial = /[?!]$/.test(w) || (w.endsWith(".") && !w.slice(0, -1).includes(".")); // not `:` ("which tool: Hotjar") nor `e.g.`
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
 * after the identifier would otherwise count as missing. A token written in the docs under another spelling (`auto-fill`, `retry_budget`) is present too. `paths` is the lowercased, joined doc paths.
 * shortcut: parts are checked, not their adjacency; upgrade to a literal check over doc content if the eval shows misses.
 */
export function missingTerms(query: string, index: Bm25Index, paths: string, known?: (term: string) => boolean): string[] {
  return identifiers(query, known, true).filter((term) =>
    tokenize(term.slice(term.lastIndexOf("/") + 1)).some((t) => !index.has(t) && !paths.includes(t) && !index.hasJoined(t.replace(/_/g, ""))),
  );
}

/** A name in at most this many docs and in none of the top results is only mentioned in passing. Train is flat from 1 to 30 (one catch, no false flag), so the smallest: notes.md "Eval results: Phase 4". */
export const PASSING_MAX_DOCS = 1;

/**
 * Names the docs have but only in passing: a candidate (as `missingTerms` lists them) that is not missing, is in no doc path,
 * is in at most `maxDocs` docs and in none of `top` (the top results' paths). Reported in `passing_terms`, apart from `missing_terms`; it also marks `no_strong_match`.
 */
export function passingTerms(query: string, index: Bm25Index, paths: string, top: string[], known?: (term: string) => boolean, maxDocs = PASSING_MAX_DOCS): string[] {
  return identifiers(query, known, true).filter((term) => {
    const toks = tokenize(term.slice(term.lastIndexOf("/") + 1));
    return toks.length > 0 && toks.every((t) => index.has(t) && !paths.includes(t) && index.docFreq(t) <= maxDocs) && !top.some((p) => toks.every((t) => index.docHas(p, t)));
  });
}

/** A name's last path segment, less a short file extension when the stem is still name-shaped (`gate-release.sh` -> `gate-release`, `check_widgets.py` -> `check_widgets`; `index.ts` stays). */
const stemOf = (id: string): string => {
  const seg = id.slice(id.lastIndexOf("/") + 1);
  const stem = seg.replace(/\.[A-Za-z0-9]{1,4}$/, "");
  return stem !== seg && /[-_.]|[a-z][A-Z]/.test(stem) ? stem : seg;
};

/**
 * #91 part 1: stable partition of fused candidates by how many of the query's identifiers they hold, most first.
 * Only identifiers present in the corpus count (every token of the name has df > 0, or another spelling of it does), so a name in no doc, or a query
 * without one, changes nothing. A doc holds a name when its text or path has it literally (`Bm25Index.docContains`):
 * matching its tokens one by one credited any doc with "gate", "release" and "sh" for `gate-release.sh`.
 * shortcut: identifiers outside the candidate pool are not pulled in; upgrade with a wider pool (#87).
 */
export function identifierTier<T extends { path: string }>(results: T[], query: string, index: Bm25Index, known?: (term: string) => boolean): T[] {
  const present = identifiers(query, known)
    .map(stemOf)
    .filter((name) => tokenize(name).length > 0 && tokenize(name).every((t) => index.has(t) || index.hasJoined(t.replace(/_/g, ""))));
  if (!present.length) return results;
  const held = (r: T) => present.filter((name) => index.docContains(r.path, name)).length;
  return results.map((r) => ({ r, n: held(r) })).sort((a, b) => b.n - a.n).map((x) => x.r);
}
