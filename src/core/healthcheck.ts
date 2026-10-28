import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { lintVault } from "./lint.js";
import { deriveProjectRoot } from "./session.js";

export type Tier = "fast" | "slow" | "all";
export type Severity = "ok" | "warn" | "error";

export interface DriftFinding {
  check: string;
  severity: Severity;
  summary: string;
  detail?: string;
  fixable_via?: "skill-link" | "mcp-reconcile" | "regenerate-contract" | "reindex" | "state-migrate" | "none";
}

export interface HealthcheckResult {
  tier_run: Tier;
  ran_at: string;
  duration_ms: number;
  findings: DriftFinding[];
  counts: { ok: number; warn: number; error: number };
  cached?: boolean;
}

export interface HealthcheckOptions {
  projectRoot: string;
  /** Vault path. When omitted, derived from projectRoot's .claude/.vault. */
  vaultPath?: string;
  tier?: Tier;
  /** Cache file path. Default: <projectRoot>/.claude/.semantic-memory/healthcheck-cache.json */
  cachePath?: string;
  /** Force re-run even if cache is <5 minutes old. */
  force?: boolean;
  /** Override "now" — used by tests. */
  nowMs?: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Run the drift-detection healthcheck.
 *
 *  - Fast tier: cheap file-system probes (~ms each). Plugin version, skill manifests,
 *    .mcp.json registration, hook registration, index freshness, session staleness,
 *    AGENTS.md managed-block sha. All independent, run in parallel. Total budget: <100ms
 *    on a representative install.
 *  - Slow tier: full vault lint. Adds tens of seconds on large vaults — invoked by
 *    explicit /healthcheck, never by the SessionStart auto path.
 *  - Cache: when force=false and the cache file is <5min old, return the cached result.
 *
 * Fail-open: any individual check that throws produces a `severity: "warn"` finding
 * with the error message; never propagates.
 */
export async function runHealthcheck(opts: HealthcheckOptions): Promise<HealthcheckResult> {
  const start = (opts.nowMs ?? Date.now());
  const tier: Tier = opts.tier ?? "fast";
  const cachePath = opts.cachePath ?? join(opts.projectRoot, ".claude", ".semantic-memory", "healthcheck-cache.json");

  if (!opts.force && existsSync(cachePath)) {
    try {
      const raw = await readFile(cachePath, "utf-8");
      const cached = JSON.parse(raw) as HealthcheckResult & { ran_at_ms: number };
      if (cached.tier_run === tier && start - cached.ran_at_ms < CACHE_TTL_MS) {
        return { ...cached, cached: true };
      }
    } catch {
      // ignore corrupt cache; will overwrite below
    }
  }

  const findings = tier === "fast" ? await runFastTier(opts) : tier === "slow" ? await runSlowTier(opts) : [...(await runFastTier(opts)), ...(await runSlowTier(opts))];

  const counts = countBySeverity(findings);
  const ranAt = new Date(start).toISOString();
  const result: HealthcheckResult = {
    tier_run: tier,
    ran_at: ranAt,
    duration_ms: Date.now() - start,
    findings,
    counts,
  };

  // Persist cache (best-effort; failure is non-fatal).
  try {
    await mkdir(join(opts.projectRoot, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ ...result, ran_at_ms: start }, null, 2), "utf-8");
  } catch {
    // never let cache write block the result
  }

  return result;
}

/**
 * Surface filter — return findings with severity >= warn. Used by the SessionStart hook
 * to decide whether to emit anything at all.
 */
export function filterToDrift(result: HealthcheckResult): DriftFinding[] {
  return result.findings.filter((f) => f.severity !== "ok");
}

function countBySeverity(findings: DriftFinding[]): { ok: number; warn: number; error: number } {
  const counts = { ok: 0, warn: 0, error: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

async function runFastTier(opts: HealthcheckOptions): Promise<DriftFinding[]> {
  const checks: Promise<DriftFinding | null>[] = [
    checkPluginVersion(opts.projectRoot),
    checkMcpJsonEntry(opts.projectRoot),
    checkHookRegistration(opts.projectRoot),
    checkHookDoubleRegistration(opts.projectRoot),
    checkIndexFreshness(opts.projectRoot, opts.vaultPath),
    checkSessionStaleness(opts.projectRoot),
    checkAgentsContract(opts.projectRoot),
    checkLegacyStateFiles(opts.projectRoot),
    ...(await skillManifestChecks(opts.projectRoot)),
  ];
  const results = await Promise.all(checks.map((p) => p.catch((err) => failOpenWarn(err))));
  return results.filter((r): r is DriftFinding => r !== null);
}

async function runSlowTier(opts: HealthcheckOptions): Promise<DriftFinding[]> {
  const findings: DriftFinding[] = [];
  if (opts.vaultPath && existsSync(opts.vaultPath)) {
    try {
      const report = await lintVault(opts.vaultPath);
      const total = report.findings.length;
      if (total === 0) {
        findings.push({ check: "lint_vault", severity: "ok", summary: `vault lint clean (${report.counts.filesLinted} files)` });
      } else {
        findings.push({
          check: "lint_vault",
          severity: report.counts.errors > 0 ? "error" : "warn",
          summary: `vault lint: ${total} findings (errors=${report.counts.errors}, warnings=${report.counts.warnings})`,
          detail: `Run \`lint_vault\` for the full report. Many lint findings need human review (stale notes, broken wikilinks).`,
        });
      }
    } catch (err: any) {
      findings.push({ check: "lint_vault", severity: "warn", summary: `lint_vault threw: ${err?.message ?? err}` });
    }
  }
  return findings;
}

function failOpenWarn(err: unknown): DriftFinding {
  return {
    check: "internal",
    severity: "warn",
    summary: `healthcheck internal error: ${err instanceof Error ? err.message : String(err)}`,
  };
}

// --- individual checks ---

async function checkPluginVersion(projectRoot: string): Promise<DriftFinding | null> {
  const pkgPaths = [
    join(projectRoot, "node_modules", "@theglitchking", "semantic-memory", "package.json"),
    join(projectRoot, "node_modules", "@theglitchking", "semantic-sidekick", "package.json"),
  ];
  for (const p of pkgPaths) {
    if (!existsSync(p)) continue;
    try {
      const installed = JSON.parse(await readFile(p, "utf-8"));
      if (typeof installed?.version === "string") {
        return { check: "plugin_version", severity: "ok", summary: `installed=${installed.version}` };
      }
    } catch {
      // continue to next candidate
    }
  }
  return null; // no installation present — not a drift event for non-npm dev environments
}

async function checkMcpJsonEntry(projectRoot: string): Promise<DriftFinding | null> {
  const mcpPath = join(projectRoot, ".mcp.json");
  if (!existsSync(mcpPath)) return null; // no .mcp.json — fine for dev
  const data = JSON.parse(await readFile(mcpPath, "utf-8"));
  const servers = data?.mcpServers ?? {};
  // any semantic-* entry with --notes (same rule as hooks/vault-context.js isSemanticServer)
  const hasEntry = Object.entries(servers).some(
    ([k, v]) => /^semantic-/.test(k) && Array.isArray((v as { args?: unknown })?.args) && (v as { args: unknown[] }).args.includes("--notes")
  );
  if (!hasEntry) {
    return {
      check: "mcp_json_entry",
      severity: "warn",
      summary: ".mcp.json present but no semantic-* server entry with --notes",
      fixable_via: "mcp-reconcile",
    };
  }
  return { check: "mcp_json_entry", severity: "ok", summary: ".mcp.json server entry present" };
}

// Events the plugin registers through its own hooks/hooks.json (resolved via
// CLAUDE_PLUGIN_ROOT). On a plugin-style install these live in the plugin, not
// the project's .claude/settings.json, so they must count as registered.
function pluginRegisteredHookEvents(): string[] {
  try {
    const root = process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return [];
    const hooksPath = join(root, "hooks", "hooks.json");
    if (!existsSync(hooksPath)) return [];
    const data = JSON.parse(readFileSync(hooksPath, "utf-8"));
    const hooks = data?.hooks ?? {};
    return Object.keys(hooks).filter((e) => Array.isArray(hooks[e]) && hooks[e].length > 0);
  } catch {
    return [];
  }
}

async function checkHookRegistration(projectRoot: string): Promise<DriftFinding | null> {
  const settings = join(projectRoot, ".claude", "settings.json");
  if (!existsSync(settings)) return null;
  try {
    const data = JSON.parse(await readFile(settings, "utf-8"));
    const hooks = data?.hooks ?? {};
    const required = ["SessionStart", "UserPromptSubmit", "Stop"];
    const pluginEvents = pluginRegisteredHookEvents();
    const missing: string[] = [];
    for (const event of required) {
      const arr = hooks[event];
      const inSettings = Array.isArray(arr) && arr.length > 0;
      if (!inSettings && !pluginEvents.includes(event)) missing.push(event);
    }
    if (missing.length > 0) {
      return {
        check: "hook_registration",
        severity: "warn",
        summary: `missing hook registrations: ${missing.join(", ")}`,
        detail: `Run \`/relink\` or reinstall the plugin to refresh hook registrations.`,
      };
    }
    return { check: "hook_registration", severity: "ok", summary: "all 3 hook events registered" };
  } catch (err: any) {
    return failOpenWarn(err);
  }
}

/**
 * Detect the double-registration that fires every hook twice: the SAME event
 * declared in BOTH the project's .claude/settings.json AND the plugin's own
 * hooks/hooks.json. On a plugin install the plugin already registers its hooks,
 * so a duplicate in settings.json makes vault-context.js (and friends) run twice —
 * e.g. the <vault-context> block injected twice per prompt.
 *
 * Only fires in a plugin context (CLAUDE_PLUGIN_ROOT present). npm-dependency
 * installs legitimately register via settings.json and have no plugin hooks.json,
 * so `pluginRegisteredHookEvents()` is empty and this is a silent no-op for them.
 */
async function checkHookDoubleRegistration(projectRoot: string): Promise<DriftFinding | null> {
  const settings = join(projectRoot, ".claude", "settings.json");
  if (!existsSync(settings)) return null;
  const pluginEvents = pluginRegisteredHookEvents();
  if (pluginEvents.length === 0) return null; // not a plugin install / no plugin hooks to collide with
  try {
    const data = JSON.parse(await readFile(settings, "utf-8"));
    const hooks = data?.hooks ?? {};
    const doubled: string[] = [];
    for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
      const arr = hooks[event];
      const inSettings = Array.isArray(arr) && arr.length > 0;
      if (inSettings && pluginEvents.includes(event)) doubled.push(event);
    }
    if (doubled.length > 0) {
      return {
        check: "hook_double_registration",
        severity: "warn",
        summary: `hook event(s) registered in BOTH settings.json and the plugin — fires twice: ${doubled.join(", ")}`,
        detail:
          `The plugin's hooks/hooks.json already registers ${doubled.join(", ")}, so the duplicate ` +
          `registration in .claude/settings.json makes each hook run twice (e.g. the <vault-context> ` +
          `block injected twice per prompt). Remove the "hooks" block from .claude/settings.json — the ` +
          `plugin's hooks.json is the single source of truth for plugin installs.`,
        fixable_via: "none",
      };
    }
    return { check: "hook_double_registration", severity: "ok", summary: "no double-registered hooks" };
  } catch (err: any) {
    return failOpenWarn(err);
  }
}

async function checkIndexFreshness(projectRoot: string, vaultPath?: string): Promise<DriftFinding | null> {
  const vault = vaultPath ?? defaultVaultPath(projectRoot);
  if (!vault || !existsSync(vault)) return null;
  const indexDir = join(vault, ".semantic-sidekick-index");
  const meta = join(indexDir, "meta.json");
  if (!existsSync(meta)) {
    return {
      check: "index_freshness",
      severity: "warn",
      summary: "no index built yet",
      detail: "Run `reindex` to build the vector index.",
      fixable_via: "reindex",
    };
  }
  try {
    const data = JSON.parse(await readFile(meta, "utf-8"));
    if (typeof data.indexedAt === "string") {
      return { check: "index_freshness", severity: "ok", summary: `last reindex ${data.indexedAt}` };
    }
  } catch {
    // ignore
  }
  return null;
}

async function checkSessionStaleness(projectRoot: string): Promise<DriftFinding | null> {
  const sessionPath = join(projectRoot, ".claude", ".semantic-memory", "session.json");
  if (!existsSync(sessionPath)) return null;
  try {
    const state = JSON.parse(await readFile(sessionPath, "utf-8"));
    if (state?.closed_at) return null;
    const last = state?.last_activity_at;
    if (typeof last !== "string") return null;
    const ageMs = Date.now() - new Date(last).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      return {
        check: "session_staleness",
        severity: "warn",
        summary: `session ${state.id} stale (>${Math.round(ageMs / (60 * 60 * 1000))}h since activity)`,
        detail: `Either resume the session (run session_run / session_finish) or remove .claude/.semantic-memory/session.json to abandon it.`,
      };
    }
    return { check: "session_staleness", severity: "ok", summary: `session ${state.id} active` };
  } catch {
    return null;
  }
}

async function checkLegacyStateFiles(projectRoot: string): Promise<DriftFinding | null> {
  // Detect v1.1-and-earlier state files at .claude/.sidekick-*. v1.2 moved these to
  // .claude/.semantic-memory/. The hook still reads them via fallback for backwards-
  // compat, but they should be migrated explicitly so the legacy paths stop existing.
  const legacy = [
    ".sidekick-mode",
    ".sidekick-fingerprints.json",
    ".sidekick-capture-pending.json",
  ];
  const present: string[] = [];
  for (const name of legacy) {
    if (existsSync(join(projectRoot, ".claude", name))) {
      present.push(name);
    }
  }
  if (present.length === 0) {
    return { check: "legacy_state_files", severity: "ok", summary: "no legacy state files" };
  }
  return {
    check: "legacy_state_files",
    severity: "warn",
    summary: `${present.length} legacy state file${present.length === 1 ? "" : "s"} at .claude/.sidekick-*`,
    detail:
      `Files: ${present.join(", ")}. Run \`bin/semantic-memory migrate-state\` to move them under .claude/.semantic-memory/. ` +
      `These files are still being read for backwards-compat through v1.x; the legacy fallback is removed in v2.0.`,
    fixable_via: "state-migrate",
  };
}

async function checkAgentsContract(projectRoot: string): Promise<DriftFinding | null> {
  const path = join(projectRoot, "AGENTS.md");
  if (!existsSync(path)) return null; // optional artifact
  try {
    const raw = await readFile(path, "utf-8");
    const begin = raw.indexOf("<!-- semantic-memory:begin contract -->");
    const end = raw.indexOf("<!-- semantic-memory:end contract -->");
    if (begin === -1 || end === -1) {
      return {
        check: "agents_contract",
        severity: "warn",
        summary: "AGENTS.md exists but lacks managed-block markers",
        detail: "Either move custom content to a Local Notes section, or delete AGENTS.md and run `regenerate_contract` to bootstrap.",
        fixable_via: "regenerate-contract",
      };
    }
    return { check: "agents_contract", severity: "ok", summary: "AGENTS.md managed block intact" };
  } catch {
    return null;
  }
}

async function skillManifestChecks(projectRoot: string): Promise<Promise<DriftFinding | null>[]> {
  const home = homedir();
  const targets = [
    { agent: "claude", path: join(home, ".claude", "skills") },
    { agent: "codex", path: join(home, ".codex", "skills") },
    { agent: "copilot", path: join(home, ".copilot", "skills") },
    { agent: "pi", path: join(home, ".pi", "agent", "skills") },
    { agent: "claude-local", path: join(projectRoot, ".claude", "skills") },
  ];
  const out: Promise<DriftFinding | null>[] = [];
  for (const t of targets) {
    out.push(checkOneSkillManifest(t.agent, t.path));
  }
  return out;
}

async function checkOneSkillManifest(agentLabel: string, skillsRoot: string): Promise<DriftFinding | null> {
  const manifestPath = join(skillsRoot, ".semantic-memory-skill-manifest.json");
  if (!existsSync(manifestPath)) return null; // not installed for this agent — fine
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    if (typeof manifest?.installed_at !== "string") return null;
    const age = Date.now() - new Date(manifest.installed_at).getTime();
    // Manifest itself is the source of truth; deeper sha-recheck happens via slow tier
    return {
      check: `skill_manifest:${agentLabel}`,
      severity: "ok",
      summary: `${agentLabel} skills installed v${manifest.version} (${Math.round(age / (24 * 60 * 60 * 1000))}d ago)`,
    };
  } catch {
    return null;
  }
}

function defaultVaultPath(projectRoot: string): string {
  return join(projectRoot, ".claude", ".vault");
}

/**
 * Format a drift summary for the SessionStart hook. Returns the text to inject as
 * additionalContext, or an empty string when there's nothing to surface.
 */
export function formatDriftBanner(result: HealthcheckResult): string {
  const drift = filterToDrift(result);
  if (drift.length === 0) return "";
  const lines = [
    `<vault-drift count="${drift.length}">`,
    `⚠️  semantic-memory: ${drift.length} drift issue${drift.length === 1 ? "" : "s"} detected`,
  ];
  for (const f of drift.slice(0, 5)) {
    const sev = f.severity === "error" ? "✗" : "⚠";
    lines.push(`  ${sev} ${f.check}: ${f.summary}`);
  }
  if (drift.length > 5) lines.push(`  …and ${drift.length - 5} more`);
  lines.push(`Run /healthcheck for details, or /healthcheck --fix to auto-fix safe items.`);
  lines.push(`</vault-drift>`);
  return lines.join("\n");
}
