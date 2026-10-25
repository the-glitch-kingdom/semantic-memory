import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { glob } from "glob";
import matter from "./matter.js";
import { loadSchema, validateNote, type LintFinding, type VaultSchema } from "./schema.js";
import { deriveProjectRoot } from "./session.js";
import { computeDecay, loadDecayConfig, normalizeVerifiedDate } from "./decay.js";
import { readSelectionLog } from "./telemetry.js";
import { compileLexicon, findAliasConflicts } from "./lexicon.js";
import { findSecrets } from "./redact.js";

export interface LintReport {
  schemaPath: string;
  findings: LintFinding[];
  byRule: {
    schema_violations: LintFinding[];
    missing_provenance: LintFinding[];
    stale: LintFinding[];
    broken_links: LintFinding[];
    code_symbols: LintFinding[];
    decay_candidates: LintFinding[];
    alias_conflicts: LintFinding[];
    decoys: LintFinding[];
    /** only present when the opt-in secrets check ran */
    secrets?: LintFinding[];
    /** only present when the opt-in skills check ran */
    skills?: LintFinding[];
  };
  counts: {
    errors: number;
    warnings: number;
    filesLinted: number;
  };
}

export async function lintVault(
  notesPath: string,
  opts: {
    pathGlob?: string;
    schemaOverride?: VaultSchema;
    todayIso?: string;
    /**
     * When true, run the code-symbol drift check: flag inline-code file-path
     * references in notes that no longer exist under the project root. Opt-in
     * (off by default) so the standard report and the healthcheck slow tier stay
     * quiet and byte-stable. Fails open when the project root is not a code repo.
     */
    checkCodeSymbols?: boolean;
    /** Override the project root for code-symbol resolution (default: derived from notesPath). */
    projectRoot?: string;
    /**
     * When true, run the decay-candidates check: cross-reference the selection
     * log (notes that appeared in recent search results) against each note's
     * current decay multiplier, and flag notes that are frequently retrieved yet
     * heavily decayed ("relevant but going stale — verify or revise"). Opt-in;
     * a silent no-op when no selection log exists.
     */
    checkDecayCandidates?: boolean;
    /**
     * When true, run the alias-conflict check: flag lexicon phrases that map to
     * more than one canonical target (a wrong binding misroutes queries). Opt-in;
     * no-op when the vault has no lexicon.
     */
    checkAliasConflicts?: boolean;
    /**
     * When true, run the decoys check: flag notes that were retrieved often (per
     * the selection log) but NEVER cited in an answer. Surfaced for a human to
     * judge — a decoy might be genuine noise OR a note the answers were wrong to
     * skip; usage-feedback ranking (v1.5) never auto-down-ranks on this ambiguous
     * signal (decision Q5). Opt-in; a no-op with no selection log.
     */
    checkDecoys?: boolean;
    /**
     * When true, run the secrets check (v1.5.3): flag notes that contain a secret
     * (API key, token, password, private key — the redactor's precise set). Reports
     * path, line and kind, never the value; nothing is rewritten. Opt-in, so the
     * default report stays byte-stable. A real secret must be rotated: it is in
     * git history if the note was ever committed.
     */
    checkSecrets?: boolean;
    /** When true, lint the skill loop's learned skills this repo loads (v1.7): format, evidence, cites, clashes. Opt-in. */
    checkSkills?: boolean;
  } = {}
): Promise<LintReport> {
  const schema = opts.schemaOverride ?? (await loadSchema(notesPath));
  const files = await glob(opts.pathGlob ?? "**/*.md", {
    cwd: notesPath,
    ignore: ["node_modules/**", ".semantic-sidekick-index/**", "vault.schema.yml"],
  });

  const findings: LintFinding[] = [];
  // Build known-note set first, to make broken-link detection O(1) per link.
  const knownNames = new Set<string>();
  const rawByPath = new Map<string, string>();
  for (const rel of files) {
    try {
      const raw = await readFile(join(notesPath, rel), "utf-8");
      rawByPath.set(rel, raw);
      // Wikilink names match on basename-without-ext (obsidian-style)
      knownNames.add(basename(rel).replace(/\.md$/, ""));
    } catch {
      /* skip */
    }
  }

  // Code-symbol drift is opt-in and only meaningful against a real code repo.
  const codeRoot = opts.checkCodeSymbols
    ? resolveCodeRoot(opts.projectRoot ?? deriveProjectRoot(notesPath))
    : null;

  for (const [rel, raw] of rawByPath) {
    findings.push(...validateNote(rel, raw, schema, { todayIso: opts.todayIso }));
    findings.push(...findBrokenLinks(rel, raw, knownNames));
    if (codeRoot) findings.push(...findCodeSymbolDrift(rel, raw, codeRoot));
    if (opts.checkSecrets) {
      for (const s of findSecrets(raw)) {
        findings.push({
          path: rel,
          rule: "secrets",
          severity: "error",
          message: `line ${s.line}: ${s.kind} — rotate it if it is real, then remove it from the note (redaction does not rewrite git history)`,
        });
      }
    }
  }

  if (opts.checkDecayCandidates) {
    findings.push(...(await findDecayCandidates(notesPath, rawByPath, opts.todayIso)));
  }

  if (opts.checkAliasConflicts) {
    for (const c of findAliasConflicts(await compileLexicon(notesPath))) {
      findings.push({
        path: "lexicon",
        rule: "alias_conflicts",
        severity: "warn",
        message: `phrase "${c.phrase}" maps to ${c.canonicals.length} targets: ${c.canonicals.join(", ")} — pick one`,
      });
    }
  }

  if (opts.checkDecoys) {
    findings.push(...(await findDecoys(notesPath, rawByPath)));
  }

  if (opts.checkSkills) {
    const { lintSkills } = await import("./skill-schema.js");
    // .claude/.vault → the repo; a docs corpus (.documentation) sits at the repo root too
    const derived = deriveProjectRoot(notesPath);
    const root = opts.projectRoot ?? (basename(derived) === ".documentation" ? dirname(derived) : derived);
    for (const f of lintSkills(root).findings) {
      findings.push({ path: relative(root, f.path), rule: "skills", severity: f.severity, message: `${f.rule}: ${f.message}` });
    }
  }

  const byRule = {
    schema_violations: findings.filter((f) => f.rule === "schema_violations"),
    missing_provenance: findings.filter((f) => f.rule === "missing_provenance"),
    stale: findings.filter((f) => f.rule === "stale"),
    broken_links: findings.filter((f) => f.rule === "broken_links"),
    code_symbols: findings.filter((f) => f.rule === "code_symbols"),
    decay_candidates: findings.filter((f) => f.rule === "decay_candidates"),
    alias_conflicts: findings.filter((f) => f.rule === "alias_conflicts"),
    decoys: findings.filter((f) => f.rule === "decoys"),
    ...(opts.checkSecrets ? { secrets: findings.filter((f) => f.rule === "secrets") } : {}),
    ...(opts.checkSkills ? { skills: findings.filter((f) => f.rule === "skills") } : {}),
  };
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warn").length;

  return {
    schemaPath: join(notesPath, "vault.schema.yml"),
    findings,
    byRule,
    counts: { errors, warnings, filesLinted: files.length },
  };
}

function findBrokenLinks(
  relPath: string,
  rawFileContent: string,
  knownNames: Set<string>
): LintFinding[] {
  const { content } = matter(rawFileContent);
  const findings: LintFinding[] = [];
  // Match [[target]] and [[target|alias]] — skip fenced code and inline code.
  const stripped = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "");
  const re = /\[\[([^\]\|]+)(?:\|[^\]]+)?\]\]/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const target = m[1].trim().split("#")[0].split("/").pop()!.replace(/\.md$/, "");
    if (seen.has(target)) continue;
    seen.add(target);
    if (!knownNames.has(target)) {
      findings.push({
        path: relPath,
        rule: "broken_links",
        severity: "warn",
        message: `wikilink [[${target}]] has no matching note`,
      });
    }
  }
  return findings;
}

/** File extensions we treat as "this looks like a source/doc file reference". */
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "php", "swift", "scala", "sh", "bash", "sql",
  "json", "yaml", "yml", "toml", "css", "scss", "html", "vue", "svelte", "md",
]);

/**
 * Decide whether `root` is a real code repository worth checking paths against.
 * Fails open (returns null) for non-code roots so the check is a silent no-op
 * outside a project — e.g. a standalone vault, or when babel-fish isn't present.
 */
function resolveCodeRoot(root: string): string | null {
  if (!root || !existsSync(root)) return null;
  const markers = ["package.json", ".git", "src", "lib", "pyproject.toml", "go.mod", "Cargo.toml"];
  return markers.some((m) => existsSync(join(root, m))) ? root : null;
}

/**
 * Code-symbol drift: scan a note's inline-code spans for repo-relative file-path
 * references and flag ones whose first path segment IS a real directory in the repo
 * but whose full path no longer exists — i.e. a stale reference to a moved/deleted
 * file. Anchoring on an existing first segment keeps false positives low: paths
 * belonging to other repos (whose top-level dir isn't present here) are skipped.
 *
 * Scope note: this validates *path* references. Fine-grained symbol-name checking
 * (function/class identifiers) needs a real symbol index and is planned for the
 * v1.4 lexicon arc, which will extend this same `code_symbols` rule.
 */
function findCodeSymbolDrift(relPath: string, rawFileContent: string, codeRoot: string): LintFinding[] {
  const { content } = matter(rawFileContent);
  // Inline-code spans only (single backtick). Fenced blocks are illustrative and
  // over-match. Strip fenced blocks first so their backticks don't confuse the span regex.
  const withoutFences = content.replace(/```[\s\S]*?```/g, "");
  const findings: LintFinding[] = [];
  const seen = new Set<string>();
  const re = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutFences)) !== null) {
    let token = m[1].trim();
    if (!looksLikeRepoPath(token)) continue;
    token = token.replace(/^\.\//, "");
    if (seen.has(token)) continue;
    seen.add(token);
    const firstSeg = token.split("/")[0];
    // Only judge paths anchored in a directory that actually exists in this repo.
    if (!existsSync(join(codeRoot, firstSeg))) continue;
    if (!existsSync(join(codeRoot, token))) {
      findings.push({
        path: relPath,
        rule: "code_symbols",
        severity: "warn",
        message: `inline code path \`${token}\` does not exist under the project root (stale reference?)`,
      });
    }
  }
  return findings;
}

function looksLikeRepoPath(token: string): boolean {
  if (!token.includes("/")) return false;
  if (/\s/.test(token)) return false; // commands, prose
  if (token.includes("://")) return false; // URLs
  if (/[*?\[\]{}()<>|]/.test(token)) return false; // globs / shell / placeholders
  if (token.startsWith("/") || token.startsWith("~")) return false; // absolute / home
  const normalized = token.replace(/^\.\//, "");
  if (normalized.startsWith("..")) return false; // escapes the repo
  const last = normalized.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return false; // no extension → likely a dir or a symbol like a/b
  const ext = last.slice(dot + 1).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

/** Multiplier at or below which a frequently-retrieved note is worth surfacing. */
const DECAY_CANDIDATE_THRESHOLD = 0.5;

/**
 * Decay-candidates: notes that keep showing up in search results but have decayed.
 * Reads the selection log (search events record the paths each query returned),
 * computes each retrieved note's current decay multiplier from its frontmatter,
 * and flags those at/below the threshold — "this keeps being relevant but is
 * going stale; verify or revise." Index-free (no embedder); a no-op when there's
 * no selection log yet.
 */
async function findDecayCandidates(
  notesPath: string,
  rawByPath: Map<string, string>,
  todayIso?: string
): Promise<LintFinding[]> {
  const events = await readSelectionLog(notesPath);
  if (events.length === 0) return [];

  // Count how often each path was retrieved (appeared in a search's results).
  const retrieved = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "search") {
      for (const r of e.results) retrieved.set(r.path, (retrieved.get(r.path) ?? 0) + 1);
    }
  }
  if (retrieved.size === 0) return [];

  const config = loadDecayConfig(notesPath);
  if (!config.enabled) return [];
  const nowMs = todayIso ? Date.parse(todayIso) : undefined;

  const findings: LintFinding[] = [];
  for (const [rel, count] of retrieved) {
    const raw = rawByPath.get(rel);
    if (!raw) continue; // retrieved path no longer in the vault — skip
    const { data: fm } = matter(raw);
    const decay = computeDecay({
      type: typeof fm.type === "string" ? fm.type : undefined,
      last_verified: normalizeVerifiedDate(fm.last_verified),
      evergreen: fm.evergreen === true,
      config,
      nowMs,
    });
    if (decay.multiplier <= DECAY_CANDIDATE_THRESHOLD) {
      findings.push({
        path: rel,
        rule: "decay_candidates",
        severity: "warn",
        message: `retrieved ${count}× recently but decayed to ${decay.multiplier.toFixed(2)} (age ${Math.round(decay.age_days)}d) — verify_note or revise`,
      });
    }
  }
  // Most-retrieved first — the ones worth re-verifying soonest.
  findings.sort((a, b) => (retrieved.get(b.path) ?? 0) - (retrieved.get(a.path) ?? 0));
  return findings;
}

/** A note must be retrieved at least this many times before "never cited" is signal. */
const DECOY_MIN_RETRIEVALS = 3;

/**
 * Decoys (v1.5 Phase 9): notes retrieved ≥ DECOY_MIN_RETRIEVALS times that were
 * NEVER cited. Surfaced only — usage-feedback ranking never auto-down-ranks on
 * this ambiguous signal (a decoy might be genuine noise, or a note the answers
 * were wrong to skip). A human decides; the lint just points.
 */
async function findDecoys(notesPath: string, rawByPath: Map<string, string>): Promise<LintFinding[]> {
  const events = await readSelectionLog(notesPath);
  if (events.length === 0) return [];

  const retrieved = new Map<string, number>();
  const cited = new Set<string>();
  for (const e of events) {
    if (e.kind === "search") {
      for (const r of e.results) retrieved.set(r.path, (retrieved.get(r.path) ?? 0) + 1);
    } else if (e.kind === "selection") {
      cited.add(e.note_path);
    }
  }

  const findings: LintFinding[] = [];
  for (const [rel, count] of retrieved) {
    if (count < DECOY_MIN_RETRIEVALS) continue;
    if (cited.has(rel)) continue;
    if (!rawByPath.has(rel)) continue; // retrieved path no longer in the vault — skip
    findings.push({
      path: rel,
      rule: "decoys",
      severity: "warn",
      message: `retrieved ${count}× but never cited — decoy noise, or a note answers wrongly skip? (surfaced, not auto-down-ranked)`,
    });
  }
  findings.sort((a, b) => (retrieved.get(b.path) ?? 0) - (retrieved.get(a.path) ?? 0));
  return findings;
}

export function formatLintReport(report: LintReport, opts: { rule?: keyof LintReport["byRule"] } = {}): string {
  const target = (opts.rule ? report.byRule[opts.rule] : report.findings) ?? [];
  if (target.length === 0) {
    return `clean: 0 findings across ${report.counts.filesLinted} files`;
  }
  const lines = [
    `${target.length} finding${target.length === 1 ? "" : "s"} (errors=${report.counts.errors}, warnings=${report.counts.warnings}, files=${report.counts.filesLinted})`,
    "",
  ];
  for (const f of target) {
    lines.push(`[${f.severity}] ${f.rule}: ${f.path} — ${f.message}`);
  }
  return lines.join("\n");
}
