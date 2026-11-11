#!/usr/bin/env node
// cold-notice.js — SessionStart: tell the user that long-term memory (hit-em-with-the-docs' cold generations) exists
// and is opt-in. No model load; coldGenerations() hashes each registered generation (about 20 ms per 1,000 files).
// Without a cold folder it prints nothing at all. Never fails the session (SIDEKICK_DEBUG=1 prints errors).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findNotesSources } from "./vault-context.js";

const DEBUG = process.env.SIDEKICK_DEBUG === "1";
const debug = (msg) => DEBUG && process.stderr.write(`[cold-notice] ${msg}\n`);

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const WHY = {
  unregistered: "is on disk but not registered by hit-em-with-the-docs, so it is not searchable",
  "checksum-mismatch": "is registered but its checksum no longer matches the manifest, so it is not searchable",
  "missing-path": "is registered but its folder is missing, so it is not searchable",
  disabled: "is not searchable: federation.cold_storage: false disables long-term memory",
};

export async function main(input = readStdinJson(), env = process.env) {
  if (env.SEMANTIC_MEMORY_REVIEWER === "1") return;
  if (input.source === "clear" || input.source === "compact") return;
  const root = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const { coldGenerations } = await import(new URL("../dist/core/cold.js", import.meta.url).href);
  const notes = findNotesSources(root, { configuredOnly: true }).find((s) => s.readOnly)?.path ?? join(root, ".documentation");
  const state = coldGenerations(root, notes);
  const where = relative(root, state.root) || state.root;
  const problems = [];
  if (state.problem) {
    if (!existsSync(state.root)) return;
    problems.push(`Long-term memory: the cold root ${where} is ${state.problem === "inside-docs" ? "inside the docs root" : "outside the repo"}, so it is ignored and not searchable.`);
  }
  const ok = state.generations.filter((g) => g.status === "registered").map((g) => g.generation);
  for (const g of state.generations) if (g.status !== "registered") problems.push(`Long-term memory: ${where}/${g.generation} ${WHY[g.status]}.`);
  if (!ok.length && !problems.length) return;

  const seenFile = join(root, ".claude", ".semantic-memory", "cold-notified.json");
  let seen = [];
  try { seen = JSON.parse(readFileSync(seenFile, "utf8")); } catch { /* missing or unreadable: show again */ }
  if (!Array.isArray(seen)) seen = [];
  const fresh = ok.filter((g) => !seen.includes(g));
  const lines = [...problems];
  if (fresh.length) {
    lines.unshift(`Long-term memory: ${fresh.length} old docs generation${fresh.length > 1 ? "s" : ""} in ${where}/ (${fresh.join(", ")}). NOT searched by default. To search them, ask 'search long-term memory for …' (or pass sources: ["long-term"] / --source long-term). More: /help long-term-memory.`);
    try {
      mkdirSync(dirname(seenFile), { recursive: true });
      writeFileSync(seenFile, JSON.stringify([...new Set([...seen, ...fresh])]));
    } catch (e) { debug(`state write failed: ${e.message}`); }
  }
  const out = {};
  if (lines.length) out.systemMessage = lines.join("\n");
  out.hookSpecificOutput = {
    hookEventName: "SessionStart",
    additionalContext: `Long-term memory (old docs generations in ${where}/) exists and is opt-in: not searched by default. When the user asks to search it, use sources: ["long-term"].`,
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => debug(e.message));
}
