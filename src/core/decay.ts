import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Grounding } from "./types.js";

/**
 * Confidence decay (v1.3).
 *
 * Pure, side-effect-free ranking signal: a note's relevance decays smoothly with
 * the time since it was last *verified* (not merely edited). Load-bearing notes
 * resist decay (longer half-life), source notes never decay, evergreen notes are
 * pinned until their evergreen claim itself expires, and an explicit re-verify
 * resets the clock.
 *
 * The multiplier composes MULTIPLICATIVELY with the existing priority/confidence
 * signals at search time — it never replaces them. Floored so notes down-weight
 * but never disappear.
 */

/** Where the age came from. `fresh` = fail open, `penalty` = no usable date, a flat multiplier. */
export type DecaySource = "last_verified" | "git" | "mtime" | "penalty" | "fresh";
export type MissingLastVerified = "git" | "mtime" | "fresh" | "penalty";
const MISSING_MODES: readonly string[] = ["git", "mtime", "fresh", "penalty"];

export interface DecayConfig {
  enabled: boolean;
  /**
   * What a note with no usable `last_verified` (missing, unparseable, in the future) is aged by: the date of its last git commit,
   * its `mtime` (frontmatter `last_updated` chain, else file mtime), `fresh` (no decay: the pre-1.11 behaviour) or a flat `missing_penalty`.
   * `git` and `mtime` fall back to the penalty when they have no date. `last_validated` is never read: hewtd stamps it for frontmatter checks.
   */
  missing_last_verified: MissingLastVerified;
  missing_penalty: number;
  default_half_life_days: number;
  /** Per-type half-life in days. `null` means "never decays" (e.g. source notes). */
  per_type: Partial<Record<string, number | null>>;
  floor: number;
  hotness_boost: { enabled: boolean; cap: number };
  /** Grounding (code-graph): a damped factor per dead file reference; drift is shown, not ranked, unless `drift_penalty` < 1 (a factor per file changed since the doc was written or verified; 0.97 restores 1.20). */
  code: { enabled: boolean; drift_penalty: number; dead_penalty: number; floor: number; archive_candidate: number };
}

export interface DecayInput {
  type?: string;
  last_verified?: string;
  evergreen?: boolean;
  inbound_link_count?: number;
  config: DecayConfig;
  /** ISO date the config's `git` / `mtime` mode ages a note without a usable `last_verified` by. */
  fallback_date?: string;
  /** Override "now" — used by tests. */
  nowMs?: number;
}

export interface DecayResult {
  multiplier: number;
  age_days: number;
  effective_half_life: number;
  reason: string;
  source: DecaySource;
  evergreen?: boolean;
}

/**
 * Normalize a frontmatter `last_verified` value to an ISO string. YAML parses an
 * unquoted `last_verified: 2019-01-01` into a Date, not a string, so a bare
 * `typeof === "string"` check would silently drop it and disable decay. Accepts
 * string or Date; anything else → undefined (fail open).
 */
export function normalizeVerifiedDate(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return undefined;
}

/** The default decay config, mirrored in the default vault schema YAML. */
export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  enabled: true,
  missing_last_verified: "git",
  missing_penalty: 0.85,
  default_half_life_days: 365,
  per_type: {
    decision: 365,
    note: 365,
    gotcha: 180,
    source: null, // never decays
    proposal: 14,
  },
  floor: 0.1,
  hotness_boost: { enabled: false, cap: 2.0 },
  code: { enabled: true, drift_penalty: 1, dead_penalty: 0.95, floor: 0.8, archive_candidate: 0.85 },
};

const GROUNDING_CAP = 3;
const SHOWN_VERDICTS = new Set(["check", "stale", "archive-candidate", "secret"]);

/** Rank factor of a doc's grounding: dead refs, and drift when `drift_penalty` < 1, count up to 3 each, floored; an `archive-candidate` verdict adds one more factor (other verdicts' causes already count). */
export function groundingMultiplier(g: Grounding | undefined, c: DecayConfig["code"]): number {
  if (!g || !c.enabled) return 1;
  const m = Math.max(c.floor, Math.pow(c.drift_penalty, Math.min(g.code_drift.length, GROUNDING_CAP)) * Math.pow(c.dead_penalty, Math.min(g.dead_refs.length, GROUNDING_CAP)));
  return g.verdict === "archive-candidate" ? m * c.archive_candidate : m;
}

/** What a result shows: only when there is something to report, at most 3 of each list (`more` counts the rest). */
export function groundingBlock(g: Grounding | undefined) {
  if (!g) return undefined;
  const verdict = g.verdict && SHOWN_VERDICTS.has(g.verdict) ? g.verdict : undefined;
  if (!verdict && !g.code_drift.length && !g.dead_refs.length) return undefined;
  const more = Math.max(0, g.code_drift.length - GROUNDING_CAP) + Math.max(0, g.dead_refs.length - GROUNDING_CAP);
  return { source: g.source, ...(verdict && { verdict }), code_drift: g.code_drift.slice(0, GROUNDING_CAP), dead_refs: g.dead_refs.slice(0, GROUNDING_CAP), ...(more && { more }) };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVERGREEN_MAX_AGE_DAYS = 365;

function fresh(reason: string, ageDays = 0, halfLife = 0, evergreen?: boolean, source: DecaySource = "fresh"): DecayResult {
  return { multiplier: 1.0, age_days: ageDays, effective_half_life: halfLife, reason, source, evergreen };
}

/**
 * Compute the decay multiplier for one note. A note with no usable last_verified
 * (missing, unparseable, future) is aged by `config.missing_last_verified`; `fresh`
 * fails open (1.0) as before v1.11. A disabled config always does.
 */
export function computeDecay(input: DecayInput): DecayResult {
  const { config } = input;
  if (!config.enabled) return fresh("decay disabled");

  // Resolve half-life. A `null` per-type entry means this type never decays.
  let halfLife = config.default_half_life_days;
  if (input.type && Object.prototype.hasOwnProperty.call(config.per_type, input.type)) {
    const perType = config.per_type[input.type];
    if (perType === null) {
      return fresh(`type=${input.type} never decays`, ageDaysOf(input), Infinity);
    }
    if (typeof perType === "number" && perType > 0) halfLife = perType;
  }

  // Age since last verification; a missing, unparseable or future date takes the configured fallback.
  const now = input.nowMs ?? Date.now();
  let lastMs = input.last_verified ? Date.parse(input.last_verified) : NaN;
  let ageDays = (now - lastMs) / MS_PER_DAY;
  let source: DecaySource = "last_verified";
  if (!(ageDays > 0)) {
    const why = !input.last_verified ? "no last_verified" : Number.isNaN(lastMs) ? "unparseable last_verified" : "last_verified in the future";
    const mode = config.missing_last_verified;
    if (mode === "fresh") return fresh(`${why} (fail open)`, Number.isNaN(ageDays) ? 0 : ageDays, halfLife);
    const fbMs = mode === "git" || mode === "mtime" ? Date.parse(input.fallback_date ?? "") : NaN;
    if (!(now - fbMs > 0)) {
      return { multiplier: config.missing_penalty, age_days: 0, effective_half_life: halfLife, reason: `${why}, no ${mode} date (penalty)`, source: "penalty" };
    }
    lastMs = fbMs;
    ageDays = (now - fbMs) / MS_PER_DAY;
    source = mode as DecaySource;
  }

  // Evergreen: pinned at 1.0 while its verification is fresh; falls through to
  // normal decay once the evergreen claim is older than a year (forces re-affirmation).
  if (input.evergreen && ageDays < EVERGREEN_MAX_AGE_DAYS) {
    return fresh("evergreen (verified within 365d)", ageDays, halfLife, true, source);
  }

  // Backlink hotness (Phase 7 — feature-flagged off by default): a heavily-linked
  // note is likely load-bearing, so extend its effective half-life.
  let effHalfLife = halfLife;
  if (config.hotness_boost.enabled && input.inbound_link_count && input.inbound_link_count > 0) {
    const boost = Math.min(input.inbound_link_count / 5, config.hotness_boost.cap - 1);
    effHalfLife = halfLife * (1 + Math.max(boost, 0));
  }

  const raw = Math.pow(0.5, ageDays / effHalfLife);
  const multiplier = Math.max(raw, config.floor);
  return {
    multiplier,
    age_days: ageDays,
    effective_half_life: effHalfLife,
    reason: `type=${input.type ?? "default"}`,
    source,
    evergreen: input.evergreen,
  };
}

export interface DecayBlock {
  multiplier: number;
  age_days: number;
  /** what the age came from; `git` / `mtime` / `penalty` mean last_verified was unusable */
  source: DecaySource;
  effective_half_life?: number;
  reason?: string;
}

/**
 * Decay for an indexed doc, shared by the MCP server and the CLI so both rank alike. `block` is what an agent is shown: present when
 * the note is down-weighted or its age came from a fallback (even at 1.0), so healthy results stay clean.
 */
export function decayForDoc(
  doc: { frontmatter?: Record<string, unknown>; gitDate?: string; mtime?: string; grounding?: Grounding },
  config: DecayConfig
): { multiplier: number; block?: DecayBlock; grounding?: ReturnType<typeof groundingBlock> } {
  const fm = doc.frontmatter ?? {};
  const d = computeDecay({
    type: typeof fm.type === "string" ? fm.type : undefined,
    last_verified: normalizeVerifiedDate(fm.last_verified),
    evergreen: fm.evergreen === true,
    config,
    fallback_date: config.missing_last_verified === "git" ? doc.gitDate : doc.mtime,
  });
  // the block reports the age decay alone; the score carries grounding on top
  const multiplier = d.multiplier * groundingMultiplier(doc.grounding, config.code);
  const grounding = groundingBlock(doc.grounding);
  if (d.multiplier >= 1 && d.source !== "git" && d.source !== "mtime" && d.source !== "penalty") return { multiplier, ...(grounding && { grounding }) };
  return {
    multiplier,
    ...(grounding && { grounding }),
    block: {
      multiplier: Math.round(d.multiplier * 1000) / 1000,
      age_days: Math.round(d.age_days),
      source: d.source,
      // a fallback block stays small: with git as the default, every result of a vault without last_verified carries one
      ...(d.source === "last_verified" ? { effective_half_life: d.effective_half_life, reason: d.reason } : {}),
    },
  };
}

function ageDaysOf(input: DecayInput): number {
  if (!input.last_verified) return 0;
  const lastMs = Date.parse(input.last_verified);
  if (Number.isNaN(lastMs)) return 0;
  const now = input.nowMs ?? Date.now();
  return Math.max((now - lastMs) / MS_PER_DAY, 0);
}

/**
 * Load the decay config from a vault's `vault.schema.yml` `decay:` block, merged
 * over the shipped defaults. Missing file / block / parse error → defaults.
 * Synchronous + memoization-friendly (callers cache the result).
 */
export function loadDecayConfig(vaultPath: string): DecayConfig {
  try {
    const schemaPath = join(vaultPath, "vault.schema.yml");
    if (!existsSync(schemaPath)) return DEFAULT_DECAY_CONFIG;
    const parsed = parseYaml(readFileSync(schemaPath, "utf-8")) as { decay?: Partial<Omit<DecayConfig, "code">> & { code?: Partial<DecayConfig["code"]> | false } } | null;
    const d = parsed?.decay;
    if (!d || typeof d !== "object") return DEFAULT_DECAY_CONFIG;
    return {
      missing_last_verified: MISSING_MODES.includes(d.missing_last_verified as string) ? d.missing_last_verified! : DEFAULT_DECAY_CONFIG.missing_last_verified,
      missing_penalty: typeof d.missing_penalty === "number" && d.missing_penalty > 0 && d.missing_penalty <= 1 ? d.missing_penalty : DEFAULT_DECAY_CONFIG.missing_penalty,
      enabled: typeof d.enabled === "boolean" ? d.enabled : DEFAULT_DECAY_CONFIG.enabled,
      default_half_life_days:
        typeof d.default_half_life_days === "number" ? d.default_half_life_days : DEFAULT_DECAY_CONFIG.default_half_life_days,
      per_type: { ...DEFAULT_DECAY_CONFIG.per_type, ...(d.per_type ?? {}) },
      floor: typeof d.floor === "number" ? d.floor : DEFAULT_DECAY_CONFIG.floor,
      hotness_boost: { ...DEFAULT_DECAY_CONFIG.hotness_boost, ...(d.hotness_boost ?? {}) },
      // `code: false` is shorthand for `code: { enabled: false }`
      code: { ...DEFAULT_DECAY_CONFIG.code, ...(d.code === false ? { enabled: false } : (d.code ?? {})) },
    };
  } catch {
    return DEFAULT_DECAY_CONFIG;
  }
}
