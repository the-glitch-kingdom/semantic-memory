#!/usr/bin/env node
// usage-capture.js — PostToolUse (Read|Grep|Glob|Bash|mcp semantic-* search/read_note): record what an agent did
// after a docs search (v1.15, #59). Appends to .claude/.semantic-memory/usage.jsonl; feeds `semantic-memory gaps`.
// Never touches the server's selection log or ranking. Off: SEMANTIC_MEMORY_USAGE_CAPTURE=0, `usage_capture: off` in
// .claude/.semantic-memory/config, or `telemetry.enabled: false` in the searched vault's schema.
//
// Fires on every Read/Grep/Glob/Bash, so it leaves early (env, config, .mcp.json, tool shape) before reading the
// log or loading anything from dist/. Fails open: any error is swallowed and nothing is printed.

import { readFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const OFF = /^(0|off|false|no)$/i;
const SEARCH_TOOL = /^(search_hybrid|search_semantic|search_text)$/;
const dist = (m) => new URL(`../dist/core/${m}.js`, import.meta.url).href;

function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function captureOff(root, env) {
  if (env.SEMANTIC_MEMORY_REVIEWER === "1" || OFF.test(String(env.SEMANTIC_MEMORY_USAGE_CAPTURE ?? "").trim())) return true;
  try {
    const cfg = readFileSync(join(root, ".claude", ".semantic-memory", "config"), "utf8");
    const m = cfg.match(/^usage_capture:\s*["']?(\w+)/m);
    return !!m && OFF.test(m[1]);
  } catch {
    return false;
  }
}

/** Vault-relative path when `abs` is inside `src` ("" for the folder itself), else null. */
function inside(src, abs) {
  const rel = relative(src.path, abs);
  return !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : null;
}

/** The source whose folder holds `abs` (longest source path wins) and the vault-relative path. */
function sourceOf(sources, abs) {
  const hits = sources.filter((s) => inside(s, abs) !== null).sort((a, b) => b.path.length - a.path.length);
  return hits[0] ? { source: hits[0], path: inside(hits[0], abs) } : null;
}

/** Decide what to record for this call. Returns { kind, ... } or null (nothing to do). */
export async function classify(input, root, sources) {
  const name = String(input.tool_name || "");
  const ti = input.tool_input || {};
  const cwd = input.cwd || root;
  const mcp = name.match(/^mcp__(.+)__([^_].*)$/);
  if (mcp) {
    const [, server, tool] = mcp;
    const source = sources.find((s) => server === s.name || server.endsWith(s.name));
    if (!source) return null;
    if (SEARCH_TOOL.test(tool)) return { kind: "search", source, tool, query: ti.query };
    if (tool === "read_note" && typeof ti.path === "string") return { kind: "use", source, path: ti.path, via: "read_note" };
    return null;
  }
  if (name === "Read") {
    const f = ti.file_path;
    if (typeof f !== "string" || !f.endsWith(".md")) return null;
    const hit = sourceOf(sources, resolve(cwd, f));
    return hit && { kind: "use", source: hit.source, path: hit.path, via: "Read" };
  }
  let args;
  if (name === "Grep" || name === "Glob") args = [ti.path ?? cwd];
  else if (name === "Bash" && /\b(grep|rg|ag|ack)\b/.test(ti.command || "")) {
    const { bashSearchArgs } = await import("./doc-search-redirect.js");
    args = bashSearchArgs(ti.command);
    if (!args.length) args = [cwd];
  } else return null;
  const inVault = args.some((a) => typeof a === "string" && sourceOf(sources, resolve(cwd, a.split(/[*?[{]/)[0] || ".")));
  return { kind: "fallback", via: name === "Bash" ? "grep" : name, scope: inVault ? "vault" : "repo" };
}

export async function capture(input, env = process.env) {
  const root = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  if (captureOff(root, env)) return false;
  // tool-shape exits that need no source lookup
  if (input.tool_name === "Bash" && !/\b(grep|rg|ag|ack)\b/.test(input.tool_input?.command || "")) return false;
  if (input.tool_name === "Read" && !String(input.tool_input?.file_path).endsWith(".md")) return false;
  const { findNotesSources } = await import("./vault-context.js");
  const sources = findNotesSources(root, { configuredOnly: true });
  if (!sources.length) return false;
  const c = await classify(input, root, sources);
  if (!c) return false;
  const { telemetryEnabled } = await import(dist("telemetry"));
  if (c.source && !telemetryEnabled(c.source.path)) return false;
  const log = await import(dist("usage-log"));
  const session = String(input.session_id || "");
  const ts = new Date().toISOString();
  if (c.kind === "search") {
    if (typeof c.query !== "string" || !c.query) return false;
    const id = randomBytes(6).toString("hex");
    return log.appendUsage(root, { type: "search", ts, session, id, server: c.source.name, tool: c.tool, query: c.query, results: log.parseSearchResponse(input.tool_response) });
  }
  const m = log.matchSearch(log.readUsage(root, 256 * 1024), { session, path: c.path, server: c.source?.name });
  if (!m) return false;
  if (c.kind === "use") return log.appendUsage(root, { type: "use", ts, session, search: m.search.id, server: c.source.name, path: c.path, rank: m.rank, via: c.via });
  return log.appendUsage(root, { type: "fallback", ts, session, search: m.search.id, via: c.via, scope: c.scope });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await capture(readStdinJson());
  } catch {}
}
