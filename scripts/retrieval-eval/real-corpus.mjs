#!/usr/bin/env node
// Real-corpus benchmark through the production launch (`node dist/cli/index.js --notes <dir>` over stdio).
//
//   node scripts/retrieval-eval/real-corpus.mjs <package-root> <notes-dir> [--questions file]
//
// Copies <notes-dir> to a temp dir (the index is written there), runs test/retrieval-eval/real-corpus.jsonl through
// search_semantic and search_hybrid, and prints JSON: answered@1/3/8 per tier, negatives flagged, archive hits, payload bytes,
// and cold / warm time from spawn to first answer. <package-root> may be an older checkout built with `npm run build`.
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [root, notes] = [resolve(process.argv[2] ?? ""), resolve(process.argv[3] ?? "")];
const qi = process.argv.indexOf("--questions");
const qfile = qi >= 0 ? process.argv[qi + 1] : new URL("../../test/retrieval-eval/real-corpus.jsonl", import.meta.url).pathname;
if (!process.argv[3]) throw new Error("usage: real-corpus.mjs <package-root> <notes-dir>");

const cases = readFileSync(qfile, "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const dir = mkdtempSync(join(tmpdir(), "sp-real-"));
cpSync(notes, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name.startsWith(".") ? [] : walk(join(d, e.name))) : e.name.endsWith(".md") ? [join(d, e.name)] : []));
const texts = new Map(walk(dir).map((f) => [f.slice(dir.length + 1), readFileSync(f, "utf8")]));
const ARCHIVE = /(^|\/)archive\//;

async function launch() {
  const t0 = performance.now();
  const client = new Client({ name: "real-corpus", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: "node", args: [join(root, "dist/cli/index.js"), "--notes", dir] }));
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    try { return { parsed: JSON.parse(text), bytes: Buffer.byteLength(text) }; } catch { return { parsed: null, text, bytes: 0 }; }
  };
  for (;;) {
    const r = await call("search_semantic", { query: "warm up", limit: 1 });
    if (Array.isArray(r.parsed)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { client, call, firstAnswerMs: Math.round(performance.now() - t0) };
}

const cold = await launch();
await new Promise((r) => setTimeout(r, 3000)); // the server saves on a 2 s debounce
await cold.client.close();
const warm = await launch();

const rank = (facets, paths) => {
  const res = facets.map((f) => new RegExp(f, "i"));
  for (let k = 1; k <= paths.length; k++) {
    const live = paths.slice(0, k).filter((p) => !ARCHIVE.test(p));
    if (res.every((re) => live.some((p) => re.test(texts.get(p) ?? "")))) return k;
  }
  return null;
};

const out = { questions: cases.length, coldFirstAnswerMs: cold.firstAnswerMs, warmFirstAnswerMs: warm.firstAnswerMs, arms: {} };
for (const tool of ["search_semantic", "search_hybrid"]) {
  const tiers = {}, negTop = [];
  let archiveHits = 0, bytes = 0, flagged = 0, answeredFlagged = 0;
  for (const c of cases) {
    const { parsed, bytes: b } = await warm.call(tool, { query: c.q, limit: 8 });
    bytes += b;
    const res = parsed ?? [];
    archiveHits += res.filter((r) => ARCHIVE.test(r.path)).length;
    if (c.tier === "negative") {
      negTop.push(Number((res[0]?.confidence ?? res[0]?.score ?? 0).toFixed(2)));
      if (res.some((r) => r.no_strong_match)) flagged++;
      continue;
    }
    const k = rank(c.facets, res.map((r) => r.path));
    (out.misses ??= {})[tool] ??= [];
    if (k !== 1) out.misses[tool].push(`${c.id}: rank ${k} top ${res.slice(0, 2).map((r) => r.path).join(", ")}`);
    for (const key of [c.tier, "all"]) {
      const t = (tiers[key] ??= { n: 0, at1: 0, at3: 0, at8: 0 });
      t.n++;
      if (k === 1) t.at1++;
      if (k && k <= 3) t.at3++;
      if (k && k <= 8) t.at8++;
    }
    if (k === 1 && res.some((r) => r.no_strong_match)) answeredFlagged++;
  }
  out.arms[tool] = { tiers, negativesFlagged: flagged, negativeTop: negTop, answeredFlagged, archiveHits, meanBytes: Math.round(bytes / cases.length) };
}
await warm.client.close();
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 2));
process.exit(0);
