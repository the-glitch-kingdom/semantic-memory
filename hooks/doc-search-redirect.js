#!/usr/bin/env node
// doc-search-redirect.js — PreToolUse (Grep|Bash): steer a search of an indexed docs folder to the MCP search (v1.7.2).
//
// A Grep, or a Bash grep/rg/ag/ack/git grep, whose path is a folder inside a corpus that an .mcp.json semantic-*
// server indexes, is denied once with a reason naming that server's search_hybrid / search_text. The identical call
// retried in the same session goes through: semantic search cannot prove a string is absent, so an exhaustive grep
// must stay possible. Never blocks Read, Glob, find, a single named file, outage-silence mode, or a repo with no
// server. Off: SEMANTIC_MEMORY_DOC_SEARCH_REDIRECT=0, or `doc_search_redirect: off` in .claude/.semantic-memory/config.
//
// Fires on every Grep and Bash call, so it leaves early and never loads the embedder. Fails open.

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { findNotesSources, readMode } from "./vault-context.js";

const OFF = /^(0|off|false|no)$/i;
const SEARCH_CMD = /^(grep|egrep|fgrep|rg|ag|ack)$/;

function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function redirectOff(projectRoot, env) {
  if (OFF.test(String(env.SEMANTIC_MEMORY_DOC_SEARCH_REDIRECT ?? "").trim())) return true;
  try {
    const cfg = readFileSync(join(projectRoot, ".claude", ".semantic-memory", "config"), "utf8");
    const m = cfg.match(/^doc_search_redirect:\s*["']?(\w+)/m);
    return !!m && OFF.test(m[1]);
  } catch {
    return false;
  }
}

const unquote = (t) => t.replace(/^(['"])(.*)\1$/, "$2");

/** The path arguments of each grep/rg/ag/ack/git grep in a shell command (flags and the pattern included; harmless). */
export function bashSearchArgs(command) {
  const args = [];
  for (const segment of String(command).split(/\|\||&&|[|;&\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean).map(unquote);
    while (words.length && /^\w+=/.test(words[0])) words.shift(); // FOO=bar grep …
    if (words[0] === "git" && words[1] === "grep") words.splice(0, 2);
    else if (SEARCH_CMD.test(words[0] ?? "")) words.shift();
    else continue;
    args.push(...words.filter((w) => !w.startsWith("-")));
  }
  return args;
}

// A folder (not one named file) at or under root. Globs count from their fixed prefix: .documentation/**/*.md
function inCorpusFolder(arg, cwd, root) {
  const fixed = arg.split(/[*?[{]/)[0];
  if (!fixed) return false;
  const p = resolve(cwd, fixed);
  const rel = relative(root, p);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  if (fixed !== arg) return true;
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The corpus a tool call searches, or null. */
export function searchedCorpus(input, sources) {
  const cwd = input.cwd || process.cwd();
  const ti = input.tool_input || {};
  let args;
  if (input.tool_name === "Grep") args = [ti.path ?? ti.glob].filter((a) => typeof a === "string");
  else if (input.tool_name === "Bash") args = /\b(grep|rg|ag|ack)\b/.test(ti.command || "") ? bashSearchArgs(ti.command) : [];
  else return null;
  for (const a of args) {
    const hit = sources.find((s) => inCorpusFolder(a, cwd, s.path));
    if (hit) return hit;
  }
  return null;
}

/** Deny once per identical call per session; true when this call was already denied (let it through). */
function seenBefore(projectRoot, sessionId, input) {
  const file = join(projectRoot, ".claude", ".semantic-memory", "doc-search-redirect.json");
  const key = sessionId || "_";
  const id = createHash("sha1").update(JSON.stringify([input.tool_name, input.tool_input])).digest("hex").slice(0, 16);
  let seen = [];
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(data[key])) seen = data[key];
  } catch {}
  if (seen.includes(id)) return true;
  try {
    mkdirSync(join(projectRoot, ".claude", ".semantic-memory"), { recursive: true });
    writeFileSync(file, JSON.stringify({ [key]: [...seen, id] })); // only the current session's list
  } catch {}
  return false;
}

export function reasonFor(source, projectRoot) {
  const where = relative(projectRoot, source.path) || source.path;
  const tool = (t) => `mcp__${source.name}__${t}`;
  return (
    `${where} is indexed by semantic-memory. Search it with ${tool("search_hybrid")} (by meaning) or ` +
    `${tool("search_text")} (exact text), then read the hits. If you need this exact search (every literal match), ` +
    `run the same command again and it will go through.`
  );
}

export function decide(input, env = process.env) {
  if (env.SEMANTIC_MEMORY_REVIEWER === "1") return null;
  if (input.tool_name !== "Grep" && input.tool_name !== "Bash") return null;
  if (input.tool_name === "Bash" && !/\b(grep|rg|ag|ack)\b/.test(input.tool_input?.command || "")) return null;
  const projectRoot = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  if (redirectOff(projectRoot, env) || readMode(projectRoot) === "outage-silence") return null;
  if (!existsSync(join(projectRoot, ".mcp.json"))) return null;
  const source = searchedCorpus({ ...input, cwd: input.cwd || projectRoot }, findNotesSources(projectRoot, { configuredOnly: true }));
  if (!source || seenBefore(projectRoot, input.session_id, input)) return null;
  return reasonFor(source, projectRoot);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let reason = null;
  try {
    reason = decide(readStdinJson());
  } catch {}
  if (reason) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }) + "\n"
    );
  }
}
