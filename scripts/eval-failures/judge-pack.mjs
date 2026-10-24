#!/usr/bin/env node
// Pack unjudged top hits (from `eval-failures --unjudged-out`) into judge batches for set B.
//
//   node scripts/eval-failures/judge-pack.mjs --min-score 0.35 --batches 6 --prefix b1 unjudged-raw.jsonl unjudged-normalized.jsonl
//
// Each item: the failure (redacted error + command), the normalized query, and the hit doc's title plus
// the chunk that best overlaps the query (redacted). Writes <dir>/judge/<prefix>-batch-N.json; the judge
// writes <prefix>-batch-N.out.jsonl lines {case, path, relevant}, which make-cases.mjs picks up.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { redact } = await import(join(ROOT, "dist", "core", "redact.js"));
const { failureQuery } = await import(join(ROOT, "dist", "core", "index.js"));

const HOME = homedir();
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : def;
};
const DIR = resolve(opt("--dir", join(HOME, ".semantic-memory", "eval", "failures")).replace(/^~/, HOME));
const MIN = Number(opt("--min-score", "0.35"));
const BATCHES = Number(opt("--batches", "6"));
const PREFIX = opt("--prefix", "b1");
const inputs = argv.map((p) => resolve(DIR, p));

const readJsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const cases = new Map(readJsonl(join(DIR, "cases.jsonl")).map((c) => [c.id, c]));
const judged = new Set(
  existsSync(join(DIR, "judgments.jsonl")) ? readJsonl(join(DIR, "judgments.jsonl")).map((j) => `${j.case}\0${j.path}`) : []
);

const pairs = new Map();
for (const file of inputs) {
  for (const u of readJsonl(file)) {
    const k = `${u.case}\0${u.path}`;
    if (u.score >= MIN && !judged.has(k)) pairs.set(k, u);
  }
}

const docsCache = new Map();
const docsFor = (notes) => {
  if (!docsCache.has(notes)) {
    const docs = JSON.parse(readFileSync(join(notes, ".semantic-sidekick-index", "docs.cache.json"), "utf8"));
    docsCache.set(notes, new Map(docs.map((d) => [d.path, d])));
  }
  return docsCache.get(notes);
};
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? []);

const items = [];
for (const u of pairs.values()) {
  const c = cases.get(u.case);
  if (!c) continue;
  const doc = docsFor(c.notes).get(u.path);
  if (!doc) continue;
  const query = failureQuery(c.error, c.command);
  const q = words(`${query} ${c.command}`);
  const best = [...(doc.chunks ?? [doc.content])].sort(
    (a, b) => [...words(b)].filter((w) => q.has(w)).length - [...words(a)].filter((w) => q.has(w)).length
  )[0] ?? "";
  items.push({
    case: u.case,
    path: u.path,
    command: c.command,
    error: c.error.slice(0, 1200),
    doc_title: redact(String(doc.title ?? u.path)).text,
    doc_excerpt: redact(best.slice(0, 1500)).text.replaceAll(HOME, "~"),
  });
}

mkdirSync(join(DIR, "judge"), { recursive: true });
const size = Math.ceil(items.length / BATCHES);
for (let i = 0; i < BATCHES; i++) {
  const chunk = items.slice(i * size, (i + 1) * size);
  if (chunk.length === 0) continue;
  writeFileSync(join(DIR, "judge", `${PREFIX}-batch-${i + 1}.json`), JSON.stringify(chunk, null, 1));
  console.log(`${PREFIX}-batch-${i + 1}.json: ${chunk.length} pairs`);
}
console.log(`${items.length} pairs (score >= ${MIN}, not yet judged)`);
