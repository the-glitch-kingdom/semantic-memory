#!/usr/bin/env node
// Build the local failure→fact labelled set for the v1.6 failure-lookup eval.
//
//   node scripts/eval-failures/build-set.mjs [--out ~/.semantic-memory/eval/failures] [--window-hours 6]
//
// Reads failed tool calls from jev-loop (sets/usage/episodes.jsonl + logs/tools-*.jsonl) and the
// knowledge-base facts of each repo they came from (with the fact's first-commit time), and writes:
//   failures.jsonl  {id, repo, t, cmd, err}            redacted (broad), home paths → ~
//   facts.jsonl     {repo, path, title, claim, t}      redacted (precise)
//   pairs-a.jsonl   {pair, failure, repo, fact}        fact first committed within the window after the failure
//
// The output is private data from other repos: it stays outside every repo and is never committed.
// Records mentioning an excluded repo anywhere (repo, cwd, command, error) are dropped.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { redact } = await import(join(ROOT, "dist", "core", "redact.js"));

const HOME = homedir();
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = resolve(opt("--out", join(HOME, ".semantic-memory", "eval", "failures")).replace(/^~/, HOME));
const WINDOW_H = Number(opt("--window-hours", "6"));
const JEV = join(HOME, ".claude", "jev-loop");
const WORKSPACE = join(HOME, "workspace");
// FAA/FedRAMP boundary (Claude-only, never leaves) and personal financial data
const EXCLUDE = ["kentro", "wealth-management"];

const excluded = (record) => {
  const text = JSON.stringify(record).toLowerCase();
  return EXCLUDE.some((e) => text.includes(e));
};
const clean = (text, mode, max) =>
  redact(String(text ?? ""), mode).text.replaceAll(HOME, "~").slice(0, max);
// jev-loop writes naive local times; git writes offsets
const epoch = (s) => new Date(s).getTime() / 1000;

const readJsonl = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// --- failures ---
const failures = new Map();
for (const d of readJsonl(join(JEV, "sets", "usage", "episodes.jsonl"))) {
  if (d.ok || excluded(d)) continue;
  failures.set(d.id, { id: d.id, repo: d.repo || "", t: epoch(d.time), cmd: d.command, err: d.error });
}
for (const f of readdirSync(join(JEV, "logs")).filter((n) => /^tools-.*\.jsonl$/.test(n))) {
  for (const d of readJsonl(join(JEV, "logs", f))) {
    if (d.event !== "failure" || excluded(d) || failures.has(d.tool_use_id)) continue;
    failures.set(d.tool_use_id, { id: d.tool_use_id, repo: d.repo || "", t: epoch(d.time), cmd: d.command, err: d.error });
  }
}

// --- facts, with first-commit time ---
const facts = [];
for (const repo of new Set([...failures.values()].map((f) => f.repo).filter(Boolean))) {
  const root = join(WORKSPACE, repo);
  const rel = ".documentation/knowledge-base/facts";
  if (excluded({ repo }) || !existsSync(join(root, rel))) continue;
  const log = execFileSync("git", ["-C", root, "log", "--diff-filter=A", "--format=%x00%aI", "--name-only", "--", rel], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const first = new Map();
  for (const block of log.split("\0").slice(1)) {
    const [when, ...paths] = block.trim().split("\n");
    for (const p of paths) {
      if (!p.endsWith(".md") || p.endsWith("INDEX.md")) continue;
      const t = epoch(when);
      if (!first.has(p) || t < first.get(p)) first.set(p, t);
    }
  }
  for (const [path, t] of first) {
    const abs = join(root, path);
    if (!existsSync(abs)) continue; // added then moved/archived
    let fm = {}, body = "";
    try {
      ({ data: fm, content: body } = matter(readFileSync(abs, "utf8")));
    } catch {
      body = readFileSync(abs, "utf8");
    }
    const claim = (body.split(/^## /m).find((s) => /^Claim/.test(s)) ?? body).replace(/^Claim\s*/, "");
    facts.push({
      repo,
      path: path.replace(/^\.documentation\//, ""),
      title: clean(fm.title ?? path, "precise", 300),
      claim: clean(claim.trim(), "precise", 900),
      t,
    });
  }
}

// --- origin pairs (set A): fact first committed within the window after the failure ---
const pairs = [];
for (const f of failures.values()) {
  for (const fact of facts) {
    const dt = fact.t - f.t;
    if (fact.repo === f.repo && dt > 0 && dt <= WINDOW_H * 3600) {
      pairs.push({ pair: `${f.id}::${fact.repo}::${fact.path}`, failure: f.id, repo: f.repo, fact: fact.path });
    }
  }
}

mkdirSync(OUT, { recursive: true });
const write = (name, rows) => writeFileSync(join(OUT, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
write(
  "failures.jsonl",
  [...failures.values()].map((f) => ({ ...f, cmd: clean(f.cmd, "broad", 600), err: clean(f.err, "broad", 1500) }))
);
write("facts.jsonl", facts);
write("pairs-a.jsonl", pairs);
console.log(
  `${failures.size} failures, ${facts.length} facts, ${pairs.length} origin pairs (${WINDOW_H}h window) → ${OUT}`
);
