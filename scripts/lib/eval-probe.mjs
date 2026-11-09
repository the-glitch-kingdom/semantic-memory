#!/usr/bin/env node
// Drives the stdio server exactly as the plugin launches it (`--notes .documentation --read-only`, cwd = the repo) and prints JSON:
// `related` per #1, how many #1 results carry each field, and whether identifier queries get an entity card.
//   node eval-probe.mjs <package-root> <repo-cwd> <questions.jsonl>...
// Used by scripts/eval-against-release.sh; it reads the clone and never writes to it (the index was built before).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [root, cwd, ...sets] = process.argv.slice(2).map((a) => resolve(a));
if (!sets.length) throw new Error("usage: eval-probe.mjs <package-root> <repo-cwd> <questions.jsonl>...");
const IDENTIFIERS = ["resolveDossierForPrompt", "findLocalBin", "runHealthcheck", "scripts/link-skills.js"];
const questions = sets.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l))).filter((c) => c.tier !== "negative").map((c) => c.q);

const client = new Client({ name: "eval-probe", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: [join(root, "dist/cli/index.js"), "--notes", ".documentation", "--read-only"], cwd, stderr: "ignore" }));
const search = async (query) => {
  const res = await client.callTool({ name: "search_hybrid", arguments: { query, limit: 8 } });
  try { const p = JSON.parse(res.content[0].text); return Array.isArray(p) ? p : null; } catch { return null; }
};
while (!(await search("warm up"))) await new Promise((r) => setTimeout(r, 250));

const fields = { section: 0, anchor: 0, code: 0, decay: 0, grounding: 0 };
let related = 0, n = 0;
for (const q of questions) {
  const top = (await search(q))?.[0];
  if (!top) continue;
  n++;
  related += top.related?.length ?? 0;
  for (const f of Object.keys(fields)) if (top[f]) fields[f]++;
}
const cards = {};
for (const id of IDENTIFIERS) cards[id] = !!(await search(id))?.[0]?.entity;
await client.close();
const version = createRequire(import.meta.url)(join(root, "package.json")).version;
console.log(JSON.stringify({ version, questions: n, relatedPerTop: +(related / n).toFixed(2), top1WithField: fields, entityCard: cards }, null, 2));
