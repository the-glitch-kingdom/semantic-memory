#!/usr/bin/env node
// Compare the Jev judge with the Claude labels (v1.7 jev mode, Phase 7).
//
//   node scripts/eval-failures/calibrate-jev.mjs [--dir ~/.semantic-memory/eval/failures] [--json]
//
// Reads <dir>/judgments.jsonl (Claude labels) and every <dir>/judge/*.jev.out.jsonl (judge-jev.mjs output) and
// prints, per label class, Jev's picks at >= 0.95 (yes) and <= 0.05 (no), its agreement with Claude and the
// unsure rate. Verdict "jev" only if every pick together is right >= 95% over >= 40 picks with <= 2 wrong.
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { calibrateJudge } = await import(join(ROOT, "dist", "core", "index.js"));
const args = process.argv.slice(2);
const i = args.indexOf("--dir");
const DIR = resolve((i >= 0 ? args[i + 1] : join(homedir(), ".semantic-memory", "eval", "failures")).replace(/^~/, homedir()));
const jsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const labels = jsonl(join(DIR, "judgments.jsonl"));
const jev = readdirSync(join(DIR, "judge")).filter((f) => f.endsWith(".jev.out.jsonl")).flatMap((f) => jsonl(join(DIR, "judge", f)));
const c = calibrateJudge(labels, jev);
if (args.includes("--json")) {
  console.log(JSON.stringify(c, null, 2));
  process.exit(0);
}
const pct = (n) => (n === null ? "-" : `${(n * 100).toFixed(1)}%`);
console.log(`Jev judge vs Claude labels — ${c.pairs} of ${labels.length} labelled pairs answered`);
for (const [name, s] of [["Claude: relevant", c.relevant], ["Claude: not relevant", c.notRelevant]]) {
  console.log(`  ${name.padEnd(22)} ${String(s.pairs).padStart(5)} pairs: Jev yes ${s.yes}, no ${s.no}, unsure ${s.unsure}`);
}
console.log(`  picks ${c.picks}, wrong ${c.wrong}, agreement ${pct(c.agreement)}, unsure ${pct(c.unsureRate)}`);
console.log(`  yes picks ${c.yesPicks}, wrong ${c.yesWrong} (${pct(c.yesPicks ? (c.yesPicks - c.yesWrong) / c.yesPicks : null)} precision)`);
console.log(`  verdict: ${c.verdict === "jev" ? "Jev may judge alone in jev mode" : "hybrid — Jev's confident picks, unsure pairs to Claude"}`);
