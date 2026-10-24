#!/usr/bin/env node
// vault-context.js — Phase 1 activation hook for semantic-sidekick.
//
// Dual-mode hook:
//   SessionStart      → hybrid search seeded from cwd/branch, injected once at session boot
//   UserPromptSubmit  → text search seeded from prompt, fingerprinted to suppress re-firing
//
// Output contract (Claude Code hook protocol):
//   { "hookSpecificOutput": { "hookEventName": "<event>", "additionalContext": "<text>" } }
//
// Fails open: any error logs to stderr and emits an empty additionalContext.

import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const DEBUG = process.env.SIDEKICK_DEBUG === "1";
function debug(msg) {
  if (DEBUG) process.stderr.write(`[vault-context] ${msg}\n`);
}

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    debug(`stdin parse failed: ${e.message}`);
    return {};
  }
}

function emit(eventName, additionalContext) {
  const out = { hookSpecificOutput: { hookEventName: eventName } };
  if (additionalContext && additionalContext.trim()) {
    out.hookSpecificOutput.additionalContext = additionalContext;
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}

// Every notes path the hook searches: [{ name, path, readOnly }], in .mcp.json order.
// The standard setup has two (semantic-vault → .claude/.vault, semantic-sidekick → .documentation --read-only).
function findNotesSources(projectRoot) {
  // 1. Explicit env override (useful for tests) — a single path, replaces the lookup
  if (process.env.SIDEKICK_VAULT_PATH) {
    const p = resolve(process.env.SIDEKICK_VAULT_PATH);
    return existsSync(p) ? [{ name: "vault", path: p, readOnly: false }] : [];
  }
  // 2. Read .mcp.json → mcpServers.semantic-{vault,sidekick,memory}.args[--notes ...]
  const sources = [];
  const mcpPath = join(projectRoot, ".mcp.json");
  if (existsSync(mcpPath)) {
    try {
      const data = JSON.parse(readFileSync(mcpPath, "utf8"));
      const entries = data?.mcpServers || {};
      for (const [name, entry] of Object.entries(entries)) {
        if (!entry || typeof entry !== "object") continue;
        if (name !== "semantic-vault" && name !== "semantic-sidekick" && name !== "semantic-memory") continue;
        const args = Array.isArray(entry.args) ? entry.args : [];
        const i = args.indexOf("--notes");
        if (i >= 0 && i + 1 < args.length) {
          const p = resolve(projectRoot, args[i + 1]);
          if (existsSync(p) && !sources.some((s) => s.path === p)) {
            sources.push({ name, path: p, readOnly: args.includes("--read-only") });
          }
        }
      }
    } catch (e) {
      debug(`.mcp.json parse failed: ${e.message}`);
    }
  }
  if (sources.length > 0) return sources;
  // 3. Default
  const def = join(projectRoot, ".claude", ".vault");
  return existsSync(def) ? [{ name: "vault", path: def, readOnly: false }] : [];
}

// The one path the hook writes to (log events, dossiers, digests, profile): never a read-only docs server
function pickVaultPath(sources) {
  return (sources.find((s) => !s.readOnly) ?? sources[0])?.path ?? null;
}

function findCliBin(projectRoot) {
  // Prefer local installed bin. Try the rebranded package first; fall back to the
  // legacy semantic-sidekick path for machines mid-migration.
  const candidates = [
    join(projectRoot, "node_modules", "@theglitchking", "semantic-memory", "bin", "semantic-memory"),
    join(projectRoot, "node_modules", "@theglitchking", "semantic-sidekick", "bin", "semantic-sidekick"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Dev fallback: this hook lives in <repo>/hooks/, the built CLI is at <repo>/dist/cli/index.js
  const dev = resolve(new URL("../dist/cli/index.js", import.meta.url).pathname);
  if (existsSync(dev)) return dev;
  return null;
}

async function runSearchCli(cliBin, args, timeoutMs) {
  try {
    const { stdout } = await execFileAsync("node", [cliBin, "search", ...args], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (e) {
    debug(`search failed: ${e.stderr?.toString().trim() || e.message}`);
    return null;
  }
}

// Search every source in parallel (one CLI spawn each) and merge by score. Hits carry
// `source` only when more than one corpus was searched, so single-corpus output is unchanged.
async function searchSources(cliBin, sources, limit, query) {
  const results = await Promise.all(
    sources.map((s) => runSearchCli(cliBin, ["--notes", s.path, "--limit", String(limit), query], 30_000))
  );
  const multi = sources.length > 1;
  return results
    .flatMap((hits, i) => (Array.isArray(hits) ? hits : []).map((h) => (multi ? { ...h, source: sources[i].name } : h)))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// Fire-and-forget structured log event via CLI. Hooks don't import core modules;
// the CLI is the shared log-writing surface so both MCP and hook code land in
// the same log.md with the same format.
function logEventViaCli(cliBin, vaultPath, kind, summary, payload) {
  try {
    const args = [cliBin, "log-event", "--notes", vaultPath, "--kind", kind, "--summary", summary];
    if (payload) args.push("--payload", JSON.stringify(payload));
    const r = spawnSync("node", args, { stdio: ["ignore", "ignore", "pipe"], timeout: 10_000 });
    if (r.status !== 0) debug(`log-event exit ${r.status}: ${r.stderr?.toString().trim()}`);
  } catch (e) {
    debug(`log-event spawn failed: ${e.message}`);
  }
}

function queryRecentLogViaCli(cliBin, vaultPath, sinceIso, limit = 20) {
  try {
    const args = [cliBin, "log-query", "--notes", vaultPath, "--after", sinceIso, "--limit", String(limit)];
    const r = spawnSync("node", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
    if (r.status !== 0) {
      debug(`log-query exit ${r.status}: ${r.stderr?.toString().trim()}`);
      return [];
    }
    return JSON.parse(r.stdout.toString());
  } catch (e) {
    debug(`log-query failed: ${e.message}`);
    return [];
  }
}

// Injection hygiene (v1.4 Phase 2). The <vault-context> block is per-prompt
// overhead, so it earns its tokens or stays out:
//  - score gate: if the best hit is weak, inject nothing (a "thanks"/"proceed"
//    prompt shouldn't drag six 0.2-score hits into context). Tunable via
//    SEMANTIC_MEMORY_INJECT_MIN_SCORE.
//  - dedup by basename: collapse archive/x.md + archive/pre-restructure/x.md to
//    one slot (keep the highest-scored), so retired-doc twins stop burning slots.
//  - top-3, not top-6.
//  - one compact instructions line — the full cite-or-deflect rule lives once in
//    CLAUDE.md and the vault-first skill, not repeated in full every prompt.
const INJECT_MIN_SCORE = Number(process.env.SEMANTIC_MEMORY_INJECT_MIN_SCORE) || 0.35;

function dedupeByBasename(hits) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    // per corpus: the same basename in the vault and in the docs is two different notes
    const base = `${h.source ?? ""}:${String(h.path || "").split("/").pop()}`;
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(h);
  }
  return out;
}

export function formatContextBlock(source, query, hits) {
  if (!hits || hits.length === 0) return "";
  // Score gate: skip injection entirely when nothing is strongly relevant.
  const topScore = Math.max(...hits.map((h) => (typeof h.score === "number" ? h.score : 0)));
  if (topScore < INJECT_MIN_SCORE) return "";

  const shown = dedupeByBasename(hits).slice(0, 3);
  const lines = [];
  lines.push(`<vault-context source="${source}" query="${escapeAttr(query)}">`);
  lines.push(`The vault (semantic-memory) was proactively searched. Top hits:`);
  lines.push("");
  for (const h of shown) {
    const score = typeof h.score === "number" ? h.score.toFixed(2) : "";
    const meta = [h.source, score ? `score: ${score}` : ""].filter(Boolean).join(", ");
    lines.push(`- \`${h.path}\`${meta ? ` (${meta})` : ""}`);
    if (h.snippet) {
      const snip = h.snippet.replace(/\s+/g, " ").slice(0, 240);
      lines.push(`  > ${snip}`);
    }
  }
  lines.push("");
  lines.push(`Instructions: Apply cite-or-deflect ONLY to project prose lookups (how/why/where does X work here) — cite the hit paths, or say "not in vault". For meta/tool/debug/status/directive/conversational prompts, ignore this block silently. Do NOT narrate "X unrelated" or "not in vault" on those.`);
  lines.push(`</vault-context>`);
  return lines.join("\n");
}

// --- Tier-1 lexicon query expansion (v1.4 Phase 6, deterministic) ---
// Before embedding a user utterance, substitute/augment it with the canonical
// targets of any learned alias phrases it contains, so "is the flaky thing fixed?"
// searches as "...the flaky thing... src/core/indexer.ts". Pure string/table
// lookup — no LLM, no spawn, reads the derived lexicon-cache.json only.

function normalizePhrase(s) {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function readLexiconAliases(projectRoot) {
  try {
    const cachePath = join(projectRoot, ".claude", ".semantic-memory", "lexicon-cache.json");
    if (!existsSync(cachePath)) return [];
    const data = JSON.parse(readFileSync(cachePath, "utf8"));
    return Array.isArray(data?.aliases) ? data.aliases : [];
  } catch {
    return [];
  }
}

export function expandQueryViaLexicon(projectRoot, query) {
  const aliases = readLexiconAliases(projectRoot);
  if (aliases.length === 0) return query;
  const nq = normalizePhrase(query);
  const canonicals = [];
  for (const a of aliases) {
    const phrases = Array.isArray(a.phrases) ? a.phrases : [];
    if (phrases.some((p) => p && nq.includes(normalizePhrase(p)))) {
      if (a.canonical && !canonicals.includes(a.canonical)) canonicals.push(a.canonical);
    }
  }
  return canonicals.length ? `${query} ${canonicals.join(" ")}` : query;
}

// --- Two-hop retrieval (v1.5 Phase 8): utterance → entity → dossier ---
// When the prompt names a dossier entity (or one of its aliases), inject the
// dossier head — Purpose + Current state — FIRST, ahead of semantic hits. This is
// the "resident expert pulls the component's file" move: entity-first, not file-first.
// Deterministic table lookup against the derived dossier-cache.json — no LLM, no spawn.

function readDossierCache(projectRoot) {
  try {
    const cachePath = join(projectRoot, ".claude", ".semantic-memory", "dossier-cache.json");
    if (!existsSync(cachePath)) return [];
    const data = JSON.parse(readFileSync(cachePath, "utf8"));
    return Array.isArray(data?.dossiers) ? data.dossiers : [];
  } catch {
    return [];
  }
}

export function resolveDossierForPrompt(projectRoot, query) {
  const dossiers = readDossierCache(projectRoot);
  if (dossiers.length === 0) return null;
  const nq = normalizePhrase(query);
  let best = null;
  let bestLen = 0;
  for (const d of dossiers) {
    const keys = [d.entity, ...(Array.isArray(d.aliases) ? d.aliases : [])]
      .map(normalizePhrase)
      .filter(Boolean);
    for (const k of keys) {
      if (nq.includes(k) && k.length > bestLen) {
        best = d;
        bestLen = k.length;
      }
    }
  }
  return best;
}

export function formatDossierHead(dossier) {
  if (!dossier || !dossier.path) return "";
  const lines = [];
  lines.push(`<vault-dossier entity="${escapeAttr(dossier.entity || "")}" path="${escapeAttr(dossier.path)}">`);
  lines.push(`This utterance names a tracked entity. Its dossier is the first place to look:`);
  if (dossier.purpose) lines.push(`- purpose: ${String(dossier.purpose).replace(/\s+/g, " ").slice(0, 240)}`);
  if (dossier.current_state) lines.push(`- current state: ${String(dossier.current_state).replace(/\s+/g, " ").slice(0, 240)}`);
  lines.push(`Read \`${dossier.path}\` (its Incident log is the fix history) before answering about ${dossier.entity}.`);
  lines.push(`</vault-dossier>`);
  return lines.join("\n");
}

// --- Session paging (v1.5 Phase 10): memory as the context window's swap space ---
// SessionStart pages IN a curated digest — latest session digest, active task,
// dossier current-states, mode — instead of a broad whole-vault semantic sweep.
// Fewer tokens, more signal. Falls back to search when there's nothing to page in.

/** Newest sessions/*.md digest note: its title + first content paragraph. */
function readLatestSessionDigest(vaultPath) {
  try {
    const dir = join(vaultPath, "sessions");
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    if (files.length === 0) return null;
    let newest = null;
    let newestMs = -1;
    for (const f of files) {
      const p = join(dir, f);
      try {
        const ms = statSync(p).mtimeMs;
        if (ms > newestMs) { newestMs = ms; newest = p; }
      } catch { /* skip */ }
    }
    if (!newest) return null;
    const raw = readFileSync(newest, "utf8");
    const body = raw.replace(/^---[\s\S]*?---\s*/, ""); // strip frontmatter
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : basename(newest).replace(/\.md$/, "");
    const para = body
      .replace(/^#.*$/m, "")
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#"));
    return {
      path: `sessions/${basename(newest)}`,
      title,
      head: para ? para.replace(/\s+/g, " ").slice(0, 300) : "",
    };
  } catch {
    return null;
  }
}

/** Dossier current-state one-liners from the derived cache (capped). */
function readDossierStates(projectRoot, cap = 6) {
  const dossiers = readDossierCache(projectRoot);
  return dossiers
    .filter((d) => d && d.current_state)
    .slice(0, cap)
    .map((d) => ({ entity: d.entity, path: d.path, state: String(d.current_state).replace(/\s+/g, " ").slice(0, 160) }));
}

/**
 * Build the SessionStart curated digest block. Returns "" when there's nothing
 * durable to page in (no digest note, no dossier states, no active task) — the
 * caller then falls back to the broad semantic search.
 */
function buildSessionStartDigest(projectRoot, vaultPath) {
  const digest = readLatestSessionDigest(vaultPath);
  const states = readDossierStates(projectRoot);
  const session = readActiveSession(projectRoot);
  const mode = readMode(projectRoot);
  if (!digest && states.length === 0 && !session) return "";

  const lines = [`<vault-session-digest mode="${escapeAttr(mode)}">`];
  lines.push(`Paged in from the vault (curated — not a broad search):`);
  if (session) {
    lines.push(`- active task: ${String(session.task || "(unnamed)").slice(0, 160)} (session ${session.id})`);
  }
  if (digest) {
    lines.push(`- last session digest \`${digest.path}\`: ${digest.head || digest.title}`);
  }
  if (states.length > 0) {
    lines.push(`- tracked entities (current state):`);
    for (const s of states) lines.push(`    · ${s.entity} — ${s.state}  \`${s.path}\``);
  }
  lines.push(`Read the digest or a dossier before re-deriving prior context.`);
  lines.push(`</vault-session-digest>`);
  return lines.join("\n");
}

// --- Speaker profile (v1.5 Phase 11): the model of THIS human ---
// Read profile/speaker.md and inject a capped, placeholder-stripped head at
// SessionStart, so every session starts knowing how this person communicates.

function readSpeakerProfileBlock(vaultPath, maxLines = 24) {
  try {
    const abs = join(vaultPath, "profile", "speaker.md");
    if (!existsSync(abs)) return "";
    const raw = readFileSync(abs, "utf8");
    const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
    const kept = [];
    for (const line of body.split("\n")) {
      if (/^#{1,6}\s/.test(line)) { kept.push(line.replace(/^#+\s*/, "").trim() + ":"); continue; }
      const t = line.trim();
      if (t === "" || /^_.*_$/.test(t)) continue; // drop placeholder prompts
      kept.push(t);
    }
    // Drop trailing section labels with no content under them.
    while (kept.length && kept[kept.length - 1].endsWith(":")) kept.pop();
    if (kept.length === 0) return "";
    const lines = [`<vault-speaker-profile path="profile/speaker.md">`];
    lines.push(`How this human communicates (learned — apply, don't recite):`);
    for (const l of kept.slice(0, maxLines)) lines.push(`  ${l}`);
    lines.push(`</vault-speaker-profile>`);
    return lines.join("\n");
  } catch {
    return "";
  }
}

/**
 * Stop-time session-digest instruction: draft a durable digest of this session's
 * decisions/resolutions/task-state as a PROPOSAL (decision Q10 — automatic draft,
 * human-reviewable, graduated via synthesize_promote). Appended to the session-close
 * prompt so a formal session boundary always offers to file its memory.
 */
function formatSessionDigestPrompt(session) {
  return [
    "",
    `After finishing, page this session's durable state to the vault: call \`mcp__semantic-vault__synthesize_note\` with \`from_session: true\`, \`proposal: true\`, \`proposal_subdir: "sessions"\`, and \`suggested_path: "sessions/${session.id}.md"\` — capturing decisions made, resolutions (symptom→cause→fix), and remaining task state. It files as a reviewable proposal; \`synthesize_promote\` graduates it if worth keeping. This is memory paging, not busywork: next session pages it back in instead of re-deriving.`,
  ].join("\n");
}

function escapeAttr(s) {
  return String(s).replace(/["<>&]/g, (c) => ({ '"': "&quot;", "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
}

function sessionSeedQuery(projectRoot) {
  const parts = [];
  parts.push(basename(projectRoot));
  try {
    const r = spawnSync("git", ["-C", projectRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
    if (r.status === 0) {
      const branch = r.stdout.toString().trim();
      if (branch && branch !== "HEAD") parts.push(branch.replace(/[-_/]/g, " "));
    }
  } catch {}
  return parts.join(" ");
}

// State file path resolution (Phase 1, v1.2):
//
// Each transient state file has TWO paths during the v1.x deprecation window:
//   - new path (canonical, written by all v1.2+ writers): .claude/.semantic-memory/<file>
//   - old path (legacy, still readable for backwards compat): .claude/.sidekick-<file>
//
// Reads check the new path first; if absent, fall back to old. Writes always go to
// the new path. This means: as soon as ANY write happens for a given state file, the
// new path takes over and the old path becomes a relic. The explicit
// `bin/semantic-memory migrate-state` command does the move in one shot for users
// who want the legacy files cleaned up immediately.
//
// In v2.0, the legacy fallback read is removed. Users have all of v1.x to migrate.
const STATE_FILES = {
  mode: { new: [".semantic-memory", "mode"], old: [".sidekick-mode"] },
  fingerprints: { new: [".semantic-memory", "fingerprints.json"], old: [".sidekick-fingerprints.json"] },
  "capture-pending": { new: [".semantic-memory", "capture-pending.json"], old: [".sidekick-capture-pending.json"] },
};

/**
 * Resolve the read and write paths for a named state file.
 * Returns { newPath, oldPath, resolvedRead, writePath }.
 *  - resolvedRead is newPath if it exists, else oldPath (for backwards-compat reads)
 *  - writePath is always newPath (writes always go to the new location)
 */
function statePath(projectRoot, name) {
  const entry = STATE_FILES[name];
  if (!entry) throw new Error(`unknown state file: ${name}`);
  const newPath = join(projectRoot, ".claude", ...entry.new);
  const oldPath = join(projectRoot, ".claude", ...entry.old);
  return {
    newPath,
    oldPath,
    resolvedRead: existsSync(newPath) ? newPath : oldPath,
    writePath: newPath,
  };
}

function ensureStateDir(writePath) {
  try { mkdirSync(dirname(writePath), { recursive: true }); } catch {}
}

function fingerprintPath(projectRoot) {
  // Returns the canonical write path (Phase 2, v1.2). Read sites that need the
  // legacy-aware path use `statePath(projectRoot, "fingerprints").resolvedRead`.
  const { writePath } = statePath(projectRoot, "fingerprints");
  ensureStateDir(writePath);
  return writePath;
}

function capturePendingPath(projectRoot) {
  // Returns the canonical write path. Read sites that need legacy-aware reads use
  // `statePath(projectRoot, "capture-pending").resolvedRead`.
  const { writePath } = statePath(projectRoot, "capture-pending");
  ensureStateDir(writePath);
  return writePath;
}

const VALID_MODES = new Set(["vault-first", "research", "outage-silence"]);

function modePath(projectRoot) {
  // Returns the canonical write path. Read sites use the legacy-aware resolver.
  return statePath(projectRoot, "mode").writePath;
}

function readMode(projectRoot) {
  try {
    const m = readFileSync(statePath(projectRoot, "mode").resolvedRead, "utf8").trim();
    if (VALID_MODES.has(m)) return m;
  } catch {}
  return "vault-first";
}

function writeMode(projectRoot, mode) {
  if (!VALID_MODES.has(mode)) return;
  try {
    const { writePath } = statePath(projectRoot, "mode");
    ensureStateDir(writePath);
    writeFileSync(writePath, mode);
  } catch (e) {
    debug(`mode write failed: ${e.message}`);
  }
}

function logMaybeModeChange(cliBin, vaultPath, from, to) {
  if (!cliBin || !vaultPath) return;
  if (from === to) return;
  logEventViaCli(cliBin, vaultPath, "mode_change", `${from} → ${to}`, { from, to });
}

// Keywords that suggest the user is relaying new knowledge worth capturing as a note.
const CAPTURE_CUES = [
  /\bbecause\b/i,
  /\bdecided\b|\bwe chose\b|\bthe decision\b/i,
  /\bturned out to be\b|\bthe bug was\b|\bthe fix was\b/i,
  // "gotcha" is also a common acknowledgment ("Gotcha, ok…") — require noun-context
  // (a/the gotcha, gotcha:, gotchas, gotcha is/was/here/with) so bare filler doesn't misfire.
  /\b(?:a|the|one|another)\s+gotcha\b|\bgotcha[:s]\b|\bgotcha (?:is|was|here|with)\b|\bworkaround\b|\bhack\b/i,
  /\bnew convention\b|\bfrom now on\b|\bgoing forward\b/i,
  // Speaker-calibration corrections (v1.5 Phase 11): the user telling you how THEY
  // talk — "no, when I say X I mean Y", "what I mean by X is", "I actually meant".
  /\bwhen i say\b[\s\S]{0,40}\bi mean\b|\bwhat i mean by\b|\bi actually meant\b|\bwhen i said\b[\s\S]{0,40}\bi meant\b/i,
];

// Cue detection must scan the user's own prose, NOT quoted machinery. Pasting
// tool output back into the prompt — especially this hook's own <vault-*> blocks,
// which literally contain the words "gotcha"/"workaround"/"hack" and the cue
// regexes themselves — would otherwise re-prime capture-pending in a self-
// referential loop. Strip self-emitted blocks, fenced code, and inline-code spans
// before matching. (Unterminated blocks/fences from truncated pastes strip to EOL.)
function stripQuotedMachinery(prompt) {
  return prompt
    .replace(/<vault-[a-z-]+[\s\S]*?(?:<\/vault-[a-z-]+>|$)/gi, " ")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`]*`/g, " ");
}

function detectCaptureCue(prompt) {
  const prose = stripQuotedMachinery(prompt);
  for (const re of CAPTURE_CUES) {
    if (re.test(prose)) return re.source;
  }
  return null;
}

// The pending file is per project, but items are keyed by session_id so concurrent sessions
// never see (or clear) each other's cues. An item without one (pre-1.5.2 file) belongs to
// whichever session reads it first; a hook input without session_id sees everything, as before.
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ownsPendingItem = (item, sessionId) => !sessionId || !item.session_id || item.session_id === sessionId;

function readAllCapturePending(projectRoot) {
  try {
    const path = statePath(projectRoot, "capture-pending").resolvedRead;
    const state = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(state.items) ? state.items : [];
  } catch {
    return [];
  }
}

function addCapturePending(projectRoot, prompt, cueSource, sessionId) {
  try {
    const { writePath } = statePath(projectRoot, "capture-pending");
    ensureStateDir(writePath);
    const items = readAllCapturePending(projectRoot);
    items.push({
      ts: new Date().toISOString(),
      cue: cueSource,
      excerpt: prompt.slice(0, 200),
      ...(sessionId ? { session_id: sessionId } : {}),
    });
    writeFileSync(writePath, JSON.stringify({ items }));
  } catch (e) {
    debug(`capture pending write failed: ${e.message}`);
  }
}

// Clears this session's items; other sessions' items stay unless older than a week (a session
// that died without a Stop never clears its own).
function resetCapturePending(projectRoot, sessionId) {
  try {
    const { writePath } = statePath(projectRoot, "capture-pending");
    ensureStateDir(writePath);
    const now = Date.now();
    const items = readAllCapturePending(projectRoot).filter(
      (i) => !ownsPendingItem(i, sessionId) && now - Date.parse(i.ts) < PENDING_MAX_AGE_MS
    );
    writeFileSync(writePath, JSON.stringify({ items }));
  } catch {}
}

function readCapturePending(projectRoot, sessionId) {
  return readAllCapturePending(projectRoot).filter((i) => ownsPendingItem(i, sessionId));
}

function normalizeFingerprint(prompt) {
  return createHash("sha1")
    .update(prompt.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 16);
}

function loadFingerprints(projectRoot) {
  try {
    const path = statePath(projectRoot, "fingerprints").resolvedRead;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { recent: [] };
  }
}

function saveFingerprints(projectRoot, state) {
  try {
    const { writePath } = statePath(projectRoot, "fingerprints");
    ensureStateDir(writePath);
    writeFileSync(writePath, JSON.stringify(state));
  } catch (e) {
    debug(`fingerprint save failed: ${e.message}`);
  }
}

async function handleSessionStart(projectRoot, vaultPath, cliBin, sources, sessionId) {
  // Capture the previous mode (if any) before we reset — so future-Claude
  // can tell, from log.md, that we rolled back from research/outage without
  // being shown the postmortem prompt (which is the lossy case).
  const priorMode = readMode(projectRoot);
  resetCapturePending(projectRoot, sessionId);
  writeMode(projectRoot, "vault-first");
  if (priorMode !== "vault-first") {
    logMaybeModeChange(cliBin, vaultPath, priorMode, "vault-first");
  }

  // Phase 10: prefer a curated digest (last session digest + active task + dossier
  // current-states) over a broad whole-vault semantic sweep. Fewer tokens, more
  // signal. Only fall back to the seeded search when there's nothing to page in.
  const digestBlock = buildSessionStartDigest(projectRoot, vaultPath);
  let searchBlock = "";
  if (!digestBlock) {
    const query = sessionSeedQuery(projectRoot);
    debug(`sessionstart seed query: "${query}"`);
    const hits = await searchSources(cliBin, sources, 6, query);
    searchBlock = hits.length > 0 ? formatContextBlock("sessionstart", query, hits) : "";
  } else {
    debug("sessionstart: paging in curated digest (skipping broad search)");
  }

  // State-delta preload — 14-day window per Phase 4.5 design.
  const sinceMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();
  const recentEntries = queryRecentLogViaCli(cliBin, vaultPath, sinceIso, 30);

  const stateBlock = formatStateDeltaBlock(sinceIso, recentEntries);

  // Phase 8 (drift detection): inline fast-tier check. Hard requirements: <100ms total,
  // fail open, silent on healthy installs. Caching via mtime stat is light enough that
  // we don't need a separate cache file for the JS-side path.
  const driftBlock = await fastDriftCheck(projectRoot).catch((err) => {
    debug(`drift check failed: ${err?.message || err}`);
    return "";
  });

  const profileBlock = readSpeakerProfileBlock(vaultPath);

  const parts = [driftBlock, profileBlock, stateBlock, digestBlock, searchBlock].filter(Boolean);
  emit("SessionStart", parts.join("\n\n"));
}

/**
 * Fast-tier drift check for the SessionStart hook. Pure JS for zero spawn cost.
 * Surfaces a one-block warning ONLY when at least one drift signal fires; healthy
 * installs return "" and the hook stays silent.
 *
 * Checks:
 *   - .mcp.json server entry presence
 *   - hook registration in .claude/settings.json (SessionStart, UserPromptSubmit, Stop)
 *   - skill manifests across global + local agent dirs (presence + version)
 *   - AGENTS.md managed-block markers (if file exists)
 *   - session staleness (>24h since last_activity_at on an open session)
 *
 * Heavy work (full vault lint, code-symbol drift) is reserved for the manual
 * `/healthcheck` command; this auto path stays cheap.
 */

// Events the plugin registers through its own hooks/hooks.json (resolved via
// CLAUDE_PLUGIN_ROOT). On a plugin-style install these live in the plugin, not
// the project's .claude/settings.json, so they must count as registered.
function pluginRegisteredHookEvents() {
  try {
    const root = process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return [];
    const hooksPath = join(root, "hooks", "hooks.json");
    if (!existsSync(hooksPath)) return [];
    const data = JSON.parse(readFileSync(hooksPath, "utf8"));
    const hooks = (data && data.hooks) || {};
    return Object.keys(hooks).filter((e) => Array.isArray(hooks[e]) && hooks[e].length > 0);
  } catch (e) {
    debug(`pluginRegisteredHookEvents threw: ${e.message}`);
    return [];
  }
}

async function fastDriftCheck(projectRoot) {
  const findings = [];
  // .mcp.json
  try {
    const mcpPath = join(projectRoot, ".mcp.json");
    if (existsSync(mcpPath)) {
      const data = JSON.parse(readFileSync(mcpPath, "utf8"));
      const servers = (data && data.mcpServers) || {};
      const hasEntry = Object.keys(servers).some((k) => k === "semantic-vault" || k === "semantic-sidekick" || k === "semantic-memory");
      if (!hasEntry) findings.push({ check: "mcp_json_entry", summary: ".mcp.json has no semantic-* server entry" });
    }
  } catch (e) { debug(`mcp check threw: ${e.message}`); }

  // hook registration
  try {
    const settings = join(projectRoot, ".claude", "settings.json");
    if (existsSync(settings)) {
      const data = JSON.parse(readFileSync(settings, "utf8"));
      const hooks = (data && data.hooks) || {};
      const required = ["SessionStart", "UserPromptSubmit", "Stop"];
      // Plugin-style installs register these via the plugin's own hooks/hooks.json
      // (resolved through CLAUDE_PLUGIN_ROOT), not the project settings.json. Count
      // those as registered so the check doesn't false-positive on plugin installs.
      const pluginEvents = pluginRegisteredHookEvents();
      const missing = required.filter(
        (e) => (!Array.isArray(hooks[e]) || hooks[e].length === 0) && !pluginEvents.includes(e)
      );
      if (missing.length > 0) findings.push({ check: "hook_registration", summary: `missing hook events: ${missing.join(", ")}` });
    }
  } catch (e) { debug(`hook check threw: ${e.message}`); }

  // AGENTS.md managed-block (warn only when file exists but markers are absent)
  try {
    const agents = join(projectRoot, "AGENTS.md");
    if (existsSync(agents)) {
      const raw = readFileSync(agents, "utf8");
      if (!raw.includes("<!-- semantic-memory:begin contract -->") || !raw.includes("<!-- semantic-memory:end contract -->")) {
        findings.push({ check: "agents_contract", summary: "AGENTS.md exists but lacks managed-block markers" });
      }
    }
  } catch (e) { debug(`agents check threw: ${e.message}`); }

  // session staleness
  try {
    const sessPath = join(projectRoot, ".claude", ".semantic-memory", "session.json");
    if (existsSync(sessPath)) {
      const state = JSON.parse(readFileSync(sessPath, "utf8"));
      if (state && !state.closed_at && typeof state.last_activity_at === "string") {
        const ageMs = Date.now() - new Date(state.last_activity_at).getTime();
        if (ageMs > 24 * 60 * 60 * 1000) {
          findings.push({ check: "session_staleness", summary: `session ${state.id} stale (>${Math.round(ageMs / (60 * 60 * 1000))}h)` });
        }
      }
    }
  } catch (e) { debug(`session check threw: ${e.message}`); }

  if (findings.length === 0) return "";

  const lines = [
    `<vault-drift count="${findings.length}">`,
    `⚠️  semantic-memory: ${findings.length} drift issue${findings.length === 1 ? "" : "s"} detected`,
  ];
  for (const f of findings.slice(0, 5)) {
    lines.push(`  ⚠ ${f.check}: ${f.summary}`);
  }
  if (findings.length > 5) lines.push(`  …and ${findings.length - 5} more`);
  lines.push(`Run /healthcheck for details, or /healthcheck --fix to auto-fix safe items.`);
  lines.push(`</vault-drift>`);
  return lines.join("\n");
}

function formatStateDeltaBlock(sinceIso, entries) {
  if (!entries || entries.length === 0) {
    return `<vault-state-since date="${sinceIso}">\nNo logged activity in the last 14 days.\n</vault-state-since>`;
  }
  const byKind = new Map();
  for (const e of entries) byKind.set(e.kind, (byKind.get(e.kind) || 0) + 1);
  const kindSummary = [...byKind.entries()].map(([k, n]) => `${k}=${n}`).join(", ");

  const lines = [`<vault-state-since date="${sinceIso}">`];
  lines.push(`Totals: ${kindSummary}`);
  lines.push("");
  lines.push(`Most recent ${Math.min(entries.length, 6)}:`);
  for (const e of entries.slice(-6)) {
    lines.push(`- ${e.ts} · ${e.kind}: ${e.summary}`);
  }
  lines.push(`</vault-state-since>`);
  return lines.join("\n");
}

function emitStop(additionalContext, block) {
  // Claude Code's Stop hook schema does NOT accept hookSpecificOutput — unlike
  // SessionStart / UserPromptSubmit / PostToolUse. Stop-mode fields are all
  // top-level: decision, reason, continue, stopReason, suppressOutput.
  // (Emitting hookSpecificOutput.hookEventName="Stop" fails schema validation.)
  const out = {};
  if (block) {
    out.decision = "block";
    out.reason = additionalContext || "capture pending";
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}

function readActiveSession(projectRoot) {
  const sessionPath = join(projectRoot, ".claude", ".semantic-memory", "session.json");
  if (!existsSync(sessionPath)) return null;
  try {
    const state = JSON.parse(readFileSync(sessionPath, "utf8"));
    if (state && typeof state.id === "string" && !state.closed_at) return state;
    return null;
  } catch (e) {
    debug(`session.json parse failed: ${e.message}`);
    return null;
  }
}

async function handleStop(projectRoot, sessionId) {
  const stopHookActive = process.env.CLAUDE_STOP_HOOK_ACTIVE === "1";
  if (stopHookActive) {
    // Already blocking — Claude is mid-response to our nudge. Clear and yield.
    resetCapturePending(projectRoot, sessionId);
    emitStop("", false);
    return;
  }

  // Session-aware branch (Phase 5). When a session is open at Stop time, prompt the
  // agent to close it via session_finish (with or without verification waiver). This
  // takes precedence over mode-specific capture prompts because a session represents
  // a verification-gated work boundary that must be explicitly closed.
  const session = readActiveSession(projectRoot);
  if (session) {
    const verifs = Array.isArray(session.verifications) ? session.verifications : [];
    const lines = [
      `<vault-session-close id="${session.id}" task="${session.task}" verifications="${verifs.length}">`,
      `Session ${session.id} is still open: task=${JSON.stringify(session.task)}, verifications=${verifs.length}.`,
      "",
    ];
    if (verifs.length > 0) {
      lines.push("Recent verifications:");
      for (const v of verifs.slice(-3)) {
        lines.push(`- \`${v.cmd}\` → exit=${v.exit ?? "(killed)"} in ${v.duration_ms}ms`);
      }
      lines.push("");
      lines.push(`Before ending: call \`mcp__semantic-vault__session_finish\` with a one-line summary. Verification recorded — finish will succeed without a waiver.`);
    } else {
      lines.push(`Before ending: either run \`mcp__semantic-vault__session_run\` with at least one verification command (tests/lint), or call \`mcp__semantic-vault__session_finish\` with \`verified: false\` and a \`reason\` waiving verification (e.g. doc-only edits). session_finish refuses without one of these paths.`);
    }
    lines.push(formatSessionDigestPrompt(session));
    lines.push(`</vault-session-close>`);
    resetCapturePending(projectRoot, sessionId);
    emitStop(lines.join("\n"), true);
    return;
  }

  const pending = readCapturePending(projectRoot, sessionId);
  const mode = readMode(projectRoot);

  // Mode-specific transition-capture. research-mode and outage-silence each
  // demand a structured synthesis on session end; vault-first reuses the
  // Phase 2 generic capture prompt.
  if (mode === "research" && pending.length > 0) {
    const lines = [
      `<vault-transition-capture mode="research" count="${pending.length}">`,
      `Research session ending. ${pending.length} potential finding${pending.length === 1 ? "" : "s"} accumulated:`,
      "",
    ];
    for (const item of pending.slice(0, 8)) {
      lines.push(`- "${item.excerpt.replace(/\n/g, " ")}"`);
    }
    lines.push("");
    lines.push(`Mandatory before Stop: call \`mcp__semantic-vault__synthesize_note\` with dry_run=true to preview a research-synthesis note (derived_from the session's filed sources). Review with the user, then apply. A research session that ends without synthesis is lost work.`);
    lines.push(`</vault-transition-capture>`);
    resetCapturePending(projectRoot, sessionId);
    emitStop(lines.join("\n"), true);
    return;
  }

  if (mode === "outage-silence") {
    const lines = [
      `<vault-transition-capture mode="outage-silence">`,
      `Outage session ending. Before closing: draft a postmortem via \`mcp__semantic-vault__synthesize_note\` with \`type: gotcha\` (or \`decision\` if architectural). Include timeline, root cause, fix, preventive actions. Dry-run first, confirm with the user, then apply.`,
      `</vault-transition-capture>`,
    ];
    resetCapturePending(projectRoot, sessionId);
    emitStop(lines.join("\n"), true);
    return;
  }

  // vault-first default: existing capture-pending behavior.
  if (pending.length === 0) {
    emitStop("", false);
    return;
  }
  const lines = [
    `<vault-capture-prompt count="${pending.length}">`,
    `This session surfaced ${pending.length} capture-worthy moment${pending.length === 1 ? "" : "s"} (user prompts contained decision/gotcha/fix cues):`,
    "",
  ];
  for (const item of pending.slice(0, 5)) {
    lines.push(`- cue \`${item.cue}\`: "${item.excerpt.replace(/\n/g, " ")}"`);
  }
  lines.push("");
  lines.push(`Before ending: for each still-unsynthesized item above, either call \`mcp__semantic-vault__synthesize_note\` to file it with provenance, or explicitly acknowledge that it was already captured / not worth capturing.`);
  lines.push(`If a cue is a speaker correction (how the user talks — "when I say X I mean Y"), update the speaker profile via \`mcp__semantic-vault__manage_profile\` (action:update_section) instead of synthesize_note.`);
  lines.push(`</vault-capture-prompt>`);
  resetCapturePending(projectRoot, sessionId);
  emitStop(lines.join("\n"), true);
}

async function handlePrompt(projectRoot, sources, cliBin, input) {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!prompt || prompt.length < 8) {
    emit("UserPromptSubmit", "");
    return;
  }
  // Outage-silence suppresses auto-vault activity. Skill describes the contract;
  // hook enforces it at the injection layer so even a misrouted turn stays quiet.
  const mode = readMode(projectRoot);
  if (mode === "outage-silence") {
    debug("outage-silence mode — suppressing auto-vault context");
    emit("UserPromptSubmit", "");
    return;
  }
  const state = loadFingerprints(projectRoot);
  const fp = normalizeFingerprint(prompt);
  const recent = Array.isArray(state.recent) ? state.recent : [];
  if (recent.includes(fp)) {
    debug(`fingerprint ${fp} recently fired — suppressing`);
    emit("UserPromptSubmit", "");
    return;
  }
  // Tier-1 lexicon expansion: search with the alias-expanded query, but keep the
  // original prompt for display in the block.
  const searchQuery = expandQueryViaLexicon(projectRoot, prompt);
  const hits = await searchSources(cliBin, sources, 8, searchQuery);
  state.recent = [fp, ...recent].slice(0, 10);
  saveFingerprints(projectRoot, state);
  const cue = detectCaptureCue(prompt);
  if (cue) {
    addCapturePending(projectRoot, prompt, cue, typeof input.session_id === "string" ? input.session_id : undefined);
  }
  // Two-hop: if the utterance names a tracked entity, lead with its dossier head.
  const dossier = resolveDossierForPrompt(projectRoot, prompt);
  const dossierHead = dossier ? formatDossierHead(dossier) : "";
  if (hits.length === 0) {
    // Even with no semantic hits, a resolved dossier is worth injecting.
    emit("UserPromptSubmit", dossierHead);
    return;
  }
  const searchBlock = formatContextBlock("prompt", prompt.slice(0, 120), hits);
  const block = [dossierHead, searchBlock].filter(Boolean).join("\n");
  emit("UserPromptSubmit", block);
}

async function main() {
  const input = readStdinJson();
  const eventName = input.hook_event_name || process.env.CLAUDE_HOOK_EVENT || "SessionStart";
  const projectRoot = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionId = typeof input.session_id === "string" ? input.session_id : undefined;
  debug(`event=${eventName} projectRoot=${projectRoot}`);

  const sources = findNotesSources(projectRoot);
  const vaultPath = pickVaultPath(sources);
  if (!vaultPath) {
    debug(`no vault found under ${projectRoot}`);
    emitNoop(eventName);
    return;
  }
  const cliBin = findCliBin(projectRoot);
  if (!cliBin) {
    debug(`no CLI bin found`);
    emitNoop(eventName);
    return;
  }
  debug(`vault=${vaultPath} search=${sources.map((s) => s.path).join(",")} bin=${cliBin}`);

  try {
    if (eventName === "UserPromptSubmit") {
      await handlePrompt(projectRoot, sources, cliBin, input);
    } else if (eventName === "Stop") {
      await handleStop(projectRoot, sessionId);
    } else {
      await handleSessionStart(projectRoot, vaultPath, cliBin, sources, sessionId);
    }
  } catch (e) {
    debug(`handler failed: ${e.message}`);
    // Record the crash so future-Claude can see that the hook failed here,
    // not just that nothing happened. Swallow log errors — never mask the real
    // failure surface (which is the empty emit below).
    if (cliBin && vaultPath) {
      logEventViaCli(cliBin, vaultPath, "error", `hook crash (${eventName}): ${e.message}`, {
        tool: "vault-context-hook",
        event: eventName,
        stack: (e.stack || "").split("\n").slice(0, 6).join(" | "),
      });
    }
    emitNoop(eventName);
  }
}

// Shape-aware no-op emit. Stop's schema rejects hookSpecificOutput; every other
// event accepts the SessionStart-style envelope with empty additionalContext.
function emitNoop(eventName) {
  if (eventName === "Stop") {
    process.stdout.write("{}\n");
  } else {
    emit(eventName, "");
  }
}

// Only run when invoked as a script — guards against test-time imports
// triggering stdin reads / spawnSync side effects.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
