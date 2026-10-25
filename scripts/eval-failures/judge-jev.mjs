#!/usr/bin/env node
// Judge failure → document pairs with Jev (v1.7 jev mode), through jev-loop (hooks/jev-bridge.py → router.ask).
//
//   node scripts/eval-failures/judge-jev.mjs [--max-tokens 700000] [--concurrency 4] <batch.json>...
//
// Reads judge batches in either format — set A ([{failure, repo, command, error, candidates: [{fact, title, claim}]}])
// or set B ([{case, path, command, error, doc_title, doc_excerpt}]) — and asks one yes/no per pair, all pairs of one
// failure in one call (state = its command + error). Writes <batch>.jev.out.jsonl next to each batch, one line per
// pair: {case, path, p, relevant} with relevant true at p >= 0.95, false at p <= 0.05, null (unsure) between.
// Pairs already in the output are skipped, so a run stopped by --max-tokens or the jev-loop budget resumes.
// Prints Jev tokens spent (from jev-loop's ledger, caller semantic-memory-judge).
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { askJev, jevSpendToday, jevVerdict, relevanceQuestion, failureState } = await import(join(ROOT, "dist", "core", "jev.js"));
const { jevLoopDir } = await import(join(ROOT, "dist", "core", "features.js"));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const MAX_TOKENS = Number(opt("--max-tokens", "700000"));
const CONCURRENCY = Number(opt("--concurrency", "4"));
const files = args;
if (!files.length) {
  console.error("usage: judge-jev.mjs [--max-tokens N] [--concurrency N] <batch.json>...");
  process.exit(2);
}

// one group per failure: {case, cwd, state, pairs: [{path, title, excerpt}]}
function groups(batch) {
  const out = new Map();
  for (const item of batch) {
    if (Array.isArray(item.candidates)) {
      out.set(item.failure, {
        case: item.failure,
        repo: item.repo,
        state: failureState(item.command ?? "", item.error ?? ""),
        pairs: item.candidates.map((c) => ({ path: c.fact, title: c.title ?? "", excerpt: c.claim ?? "" })),
      });
    } else {
      const g = out.get(item.case) ?? { case: item.case, state: failureState(item.command ?? "", item.error ?? ""), pairs: [] };
      g.pairs.push({ path: item.path, title: item.doc_title ?? "", excerpt: item.doc_excerpt ?? "" });
      out.set(item.case, g);
    }
  }
  return [...out.values()];
}

const before = Object.values(jevSpendToday(jevLoopDir())).reduce((a, b) => a + b, 0);
let spent = 0;
let stopped = "";
const counts = { pairs: 0, yes: 0, no: 0, unsure: 0, errors: 0 };

for (const file of files) {
  const outPath = file.replace(/\.json$/, "") + ".jev.out.jsonl";
  const done = new Set(
    existsSync(outPath) ? readFileSync(outPath, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.case}\0${r.path}`; }) : [],
  );
  const todo = groups(JSON.parse(readFileSync(file, "utf8")))
    .map((g) => ({ ...g, pairs: g.pairs.filter((p) => !done.has(`${g.case}\0${p.path}`)) }))
    .filter((g) => g.pairs.length);
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !stopped) {
      if (spent >= MAX_TOKENS) {
        stopped = `--max-tokens ${MAX_TOKENS} reached`;
        break;
      }
      const g = todo[next++];
      const cwd = g.repo ? join(homedir(), "workspace", g.repo) : process.cwd();
      const a = await askJev(
        // shortcut: a failure with more than 150 candidates is judged on its first 150 (A/B batches have <= 8)
        { cwd, caller: "semantic-memory-judge", state: g.state, questions: g.pairs.slice(0, 150).map((p, i) => ({ key: String(i), instructions: relevanceQuestion(p.title, p.excerpt) })) },
        { timeoutMs: 120_000 },
      );
      if (a.error) {
        counts.errors++;
        if (/budget|run limit|ceiling/i.test(a.error)) stopped = a.error;
        else console.error(`  ${g.case}: ${a.error}`);
        continue;
      }
      spent += a.tokens ?? 0;
      const lines = g.pairs.slice(0, 150).map((p, i) => {
        const prob = a.scores[String(i)];
        const relevant = jevVerdict(prob);
        counts.pairs++;
        counts[relevant === true ? "yes" : relevant === false ? "no" : "unsure"]++;
        return JSON.stringify({ case: g.case, path: p.path, p: prob ?? null, relevant });
      });
      appendFileSync(outPath, lines.join("\n") + "\n");
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  console.log(`${file}: ${todo.length} failures to judge → ${outPath}`);
  if (stopped) break;
}

const after = Object.values(jevSpendToday(jevLoopDir())).reduce((a, b) => a + b, 0);
console.log(`judged ${counts.pairs} pairs: ${counts.yes} yes, ${counts.no} no, ${counts.unsure} unsure; ${counts.errors} failed calls`);
console.log(`Jev tokens this run: ${spent.toLocaleString()} (ledger, semantic-memory callers today: ${before.toLocaleString()} → ${after.toLocaleString()})`);
if (stopped) console.log(`stopped: ${stopped} — re-run the same command to resume`);
