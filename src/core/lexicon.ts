import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { glob } from "glob";
import matter from "./matter.js";
import { redactDeep } from "./redact.js";
import { deriveSessionDir } from "./session.js";
import { listDossiers } from "./dossier.js";

/**
 * Lexicon corpus (v1.4 Phase 3) — the learned human→artifact vocabulary.
 *
 * The heart of the human→LLM bridge: maps the human's own phrasing ("the flaky
 * thing", "the deploy dance") to concrete artifacts (paths / code symbols).
 * Canonical storage is markdown notes of type `alias` under <vault>/lexicon/;
 * a derived JSON cache under .claude/.semantic-memory/ is what the hot-path hook
 * reads for deterministic query expansion.
 */

export type Confidence = "low" | "medium" | "high";

export interface AliasEntry {
  /** The concrete target: a note path or a code symbol/path. */
  canonical: string;
  /** The human's actual words that refer to it (verbatim). */
  phrases: string[];
  confidence: Confidence;
  evidence_count: number;
  last_used?: string;
  source: "learned" | "authored";
  /** The lexicon note path this entry came from. */
  path: string;
}

const CACHE_FILE = "lexicon-cache.json";
const LEXICON_DIR = "lexicon";

export function normalizePhrase(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "alias";
}

function confidenceFor(evidenceCount: number): Confidence {
  return evidenceCount >= 3 ? "high" : evidenceCount >= 2 ? "medium" : "low";
}

/** Read every lexicon note into entries and write the derived cache. */
export async function compileLexicon(vaultPath: string): Promise<AliasEntry[]> {
  const files = await glob(`${LEXICON_DIR}/**/*.md`, { cwd: vaultPath });
  const entries: AliasEntry[] = [];
  for (const rel of files) {
    try {
      const { data } = matter(await readFile(join(vaultPath, rel), "utf-8"));
      if (data.type !== "alias" || typeof data.canonical !== "string") continue;
      const phrases = Array.isArray(data.phrases) ? data.phrases.map(String).map((p) => p.trim()).filter(Boolean) : [];
      entries.push({
        canonical: data.canonical,
        phrases,
        confidence: (["low", "medium", "high"] as const).includes(data.confidence) ? data.confidence : confidenceFor(1),
        evidence_count: typeof data.evidence_count === "number" ? data.evidence_count : phrases.length ? 1 : 0,
        last_used: typeof data.last_used === "string" ? data.last_used : undefined,
        source: data.source === "authored" ? "authored" : "learned",
        path: rel,
      });
    } catch {
      /* skip unreadable note */
    }
  }
  // Fold in dossier aliases (v1.5 Phase 8): a dossier's `aliases:` are the human's
  // phrases for that entity, so they become query-expansion bindings pointing at the
  // dossier note. Authored, not learned — the human named the entity deliberately.
  // A lexicon note for the same canonical wins (it carries real evidence_count).
  try {
    const dossiers = await listDossiers(vaultPath);
    for (const d of dossiers) {
      if (d.aliases.length === 0) continue;
      if (entries.some((e) => e.canonical === d.path)) continue;
      entries.push({
        canonical: d.path,
        phrases: d.aliases,
        confidence: "high",
        evidence_count: d.aliases.length,
        source: "authored",
        path: d.path,
      });
    }
  } catch {
    /* dossiers optional — lexicon compiles fine without them */
  }
  try {
    const dir = deriveSessionDir(vaultPath);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, CACHE_FILE), JSON.stringify({ compiledAt: new Date().toISOString(), aliases: entries }, null, 2), "utf-8");
  } catch {
    /* cache write is best-effort */
  }
  return entries;
}

/** Fast read for the hook: use the cache if present, else compile. */
export async function loadLexiconCache(vaultPath: string): Promise<AliasEntry[]> {
  const cachePath = join(deriveSessionDir(vaultPath), CACHE_FILE);
  if (existsSync(cachePath)) {
    try {
      const data = JSON.parse(await readFile(cachePath, "utf-8"));
      if (Array.isArray(data?.aliases)) return data.aliases as AliasEntry[];
    } catch {
      /* fall through to recompile */
    }
  }
  return compileLexicon(vaultPath);
}

export function lookupPhrase(aliases: AliasEntry[], phrase: string): AliasEntry[] {
  const n = normalizePhrase(phrase);
  return aliases.filter((a) => a.phrases.some((p) => normalizePhrase(p) === n));
}

/**
 * Expand a query by appending the canonical targets of any alias phrases that
 * appear in it. Deterministic, no LLM — this is the Tier-1 hook-time expansion.
 */
export function expandQuery(aliases: AliasEntry[], query: string): { expanded: string; matched: AliasEntry[] } {
  const nq = normalizePhrase(query);
  const matched = aliases.filter((a) => a.phrases.some((p) => p && nq.includes(normalizePhrase(p))));
  if (matched.length === 0) return { expanded: query, matched: [] };
  const additions = [...new Set(matched.map((a) => a.canonical))].join(" ");
  return { expanded: `${query} ${additions}`, matched };
}

async function writeAliasNote(vaultPath: string, rel: string, raw: Omit<AliasEntry, "path">): Promise<void> {
  // phrases are captured from user utterances
  const entry = redactDeep(raw, "precise").value;
  const fm = {
    type: "alias",
    canonical: entry.canonical,
    phrases: entry.phrases,
    confidence: entry.confidence,
    evidence_count: entry.evidence_count,
    last_used: entry.last_used,
    source: entry.source,
  };
  const body = `# Alias: ${entry.canonical}\n\nHuman phrases that refer to \`${entry.canonical}\`.\n`;
  const abs = join(vaultPath, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, matter.stringify(body, fm), "utf-8");
}

/**
 * Upsert an alias. New canonical → new note (evidence 1). Existing canonical →
 * merge phrases, bump evidence_count, recompute confidence. Recompiles the cache.
 */
export async function addAlias(
  vaultPath: string,
  input: { canonical: string; phrases: string[]; source?: "learned" | "authored"; today?: string }
): Promise<{ path: string; created: boolean; evidence_count: number; confidence: Confidence }> {
  const existing = await compileLexicon(vaultPath);
  const match = existing.find((a) => a.canonical === input.canonical);
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const cleanPhrases = input.phrases.map((p) => p.trim()).filter(Boolean);

  if (match) {
    const phrases = [...new Set([...match.phrases, ...cleanPhrases])];
    const evidence_count = match.evidence_count + 1;
    const confidence = confidenceFor(evidence_count);
    await writeAliasNote(vaultPath, match.path, { ...match, phrases, evidence_count, confidence, last_used: today });
    await compileLexicon(vaultPath);
    return { path: match.path, created: false, evidence_count, confidence };
  }

  const rel = join(LEXICON_DIR, `${slugify(input.canonical)}.md`);
  const evidence_count = 1;
  const confidence = confidenceFor(evidence_count);
  await writeAliasNote(vaultPath, rel, {
    canonical: input.canonical,
    phrases: cleanPhrases,
    confidence,
    evidence_count,
    last_used: today,
    source: input.source ?? "learned",
  });
  await compileLexicon(vaultPath);
  return { path: rel, created: true, evidence_count, confidence };
}

export interface AliasConflict {
  phrase: string;
  canonicals: string[];
}

/**
 * Find conflicting bindings: the same (normalized) phrase mapping to more than one
 * canonical target. A wrong alias silently misroutes every future query with that
 * phrase, so conflicts are surfaced (never auto-resolved) for a human to fix.
 */
export function findAliasConflicts(aliases: AliasEntry[]): AliasConflict[] {
  const byPhrase = new Map<string, Set<string>>();
  for (const a of aliases) {
    for (const p of a.phrases) {
      const n = normalizePhrase(p);
      if (!n) continue;
      if (!byPhrase.has(n)) byPhrase.set(n, new Set());
      byPhrase.get(n)!.add(a.canonical);
    }
  }
  const conflicts: AliasConflict[] = [];
  for (const [phrase, canonicals] of byPhrase) {
    if (canonicals.size > 1) conflicts.push({ phrase, canonicals: [...canonicals].sort() });
  }
  return conflicts.sort((a, b) => a.phrase.localeCompare(b.phrase));
}

/** Remove an alias note by canonical. Returns whether one was removed. */
export async function removeAlias(vaultPath: string, canonical: string): Promise<boolean> {
  const existing = await compileLexicon(vaultPath);
  const match = existing.find((a) => a.canonical === canonical);
  if (!match) return false;
  try {
    await unlink(join(vaultPath, match.path));
  } catch {
    return false;
  }
  await compileLexicon(vaultPath);
  return true;
}
