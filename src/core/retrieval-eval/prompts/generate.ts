/** Bump when the prompt or the validation rules change: stored on every generated case. */
export const GENERATOR_VERSION = "1";

const MAX_CHARS = 8000;

/** One document in, a JSON list of search questions out. The doc path is quoted so the fake claude can match on it. */
export const generatePrompt = (doc: { path: string; text: string }, neighbour?: { path: string; text: string }) =>
  `You write test questions for a search engine over a folder of markdown notes. Read the document below and write questions a user would type to find it.

Write, as JSON objects:
- 2 "keyword" questions: short, using the document's own distinctive terms.
- 2 "paraphrase" questions: the same need in different words. Use at most ONE distinctive word from the document.
- 1 "negative" question: something a user might ask that this folder does NOT answer. Give "absent_terms": 1-3 words or identifiers in the question that appear in no note, and "kind_of_negative": "identifier" (a made-up name, flag or code symbol) or "topic" (a subject the notes do not cover).${neighbour ? `\n- 1 "multi" question that needs BOTH the document and its linked neighbour.` : ""}

For every question except "negative", give "facets": 1-3 regular expressions (case-insensitive, JavaScript syntax) for distinctive text that must appear in the document${neighbour ? " (for \"multi\": at least one from each document)" : ""}. A facet must be specific: it should match few other notes.

Answer with only JSON: {"questions":[{"kind":"keyword|paraphrase|negative|multi","q":"...","facets":["..."],"absent_terms":["..."],"kind_of_negative":"identifier|topic"}]}
(Use "kind_of_negative" only on negatives; omit unused fields.)

<doc path="${doc.path}">
${doc.text.slice(0, MAX_CHARS)}
</doc>${neighbour ? `\n\n<neighbour path="${neighbour.path}">\n${neighbour.text.slice(0, MAX_CHARS)}\n</neighbour>` : ""}`;
