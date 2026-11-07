#!/usr/bin/env node
// Mine candidate eval cases from the selection log: a search followed by a read_note of one of its results
// is an implicit label (query -> the note that was used).
//
//   node scripts/retrieval-eval/mine-selection.mjs [selection.jsonl] > candidates.jsonl
//
// Default log: .claude/.semantic-memory/selection.jsonl. Output is for hand review only; nothing here is
// merged into golden-docs.jsonl automatically, and a reviewer must write the `facets` themselves.
import { readFileSync } from "node:fs";

const log = process.argv[2] ?? ".claude/.semantic-memory/selection.jsonl";
const events = readFileSync(log, "utf8").split("\n").filter(Boolean).flatMap((l) => {
  try { return [JSON.parse(l)]; } catch { return []; }
});

const seen = new Set();
let lastSearch = null;
for (const e of events) {
  if (e.kind === "search") { lastSearch = e; continue; }
  if (e.kind !== "selection" || !lastSearch) continue;
  const rank = lastSearch.results.findIndex((r) => r.path === e.note_path) + 1;
  if (!rank) continue; // read something the search did not return: no label
  const key = `${lastSearch.query}\0${e.note_path}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(JSON.stringify({ q: lastSearch.query, selected: e.note_path, rankReturned: rank, tool: lastSearch.tool, ts: e.ts }));
}
