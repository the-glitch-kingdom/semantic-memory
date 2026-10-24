#!/usr/bin/env node
// Turn the local labelled set into the generic inputs of `semantic-memory eval-failures`:
//
//   node scripts/eval-failures/make-cases.mjs [--dir ~/.semantic-memory/eval/failures]
//
// Reads <dir>/failures.jsonl, <dir>/corpora/<repo with / → _>/ (indexed copies of each repo's
// .documentation), set A judge output (judge/a-batch-N.json + .out.jsonl) and set B judge output
// (judge/b-*.out.jsonl, lines {case, path, relevant}); writes <dir>/cases.jsonl and <dir>/judgments.jsonl.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HOME = homedir();
const i = process.argv.indexOf("--dir");
const DIR = resolve((i >= 0 ? process.argv[i + 1] : join(HOME, ".semantic-memory", "eval", "failures")).replace(/^~/, HOME));
const JUDGE = join(DIR, "judge");
const readJsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const corpus = (repo) => join(DIR, "corpora", repo.replaceAll("/", "_"));

const cases = readJsonl(join(DIR, "failures.jsonl"))
  .filter((f) => f.repo && existsSync(join(corpus(f.repo), ".semantic-sidekick-index")))
  .map((f) => ({ id: f.id, notes: corpus(f.repo), error: f.err, command: f.cmd }));

const judgments = [];
const files = existsSync(JUDGE) ? readdirSync(JUDGE) : [];
for (const name of files.filter((n) => /^a-batch-\d+\.json$/.test(n))) {
  const out = join(JUDGE, name.replace(/\.json$/, ".out.jsonl"));
  if (!existsSync(out)) continue;
  const verdicts = new Map(readJsonl(out).map((o) => [o.failure, new Set(o.matches)]));
  for (const item of JSON.parse(readFileSync(join(JUDGE, name), "utf8"))) {
    const matches = verdicts.get(item.failure);
    if (!matches) continue;
    for (const c of item.candidates) judgments.push({ case: item.failure, path: c.fact, relevant: matches.has(c.fact) });
  }
}
for (const name of files.filter((n) => /^b-.*\.out\.jsonl$/.test(n))) {
  for (const j of readJsonl(join(JUDGE, name))) judgments.push({ case: j.case, path: j.path, relevant: j.relevant === true });
}

const write = (name, rows) => writeFileSync(join(DIR, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
write("cases.jsonl", cases);
write("judgments.jsonl", judgments);
console.log(
  `${cases.length} cases, ${judgments.length} judgments (${judgments.filter((j) => j.relevant).length} relevant) → ${DIR}`
);
