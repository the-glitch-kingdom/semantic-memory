import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { glob } from "glob";
import matter from "./matter.js";
import { redact } from "./redact.js";
import { deriveSessionDir } from "./session.js";
import { extractSection } from "./section.js";

/**
 * Entity dossiers (v1.5 Phase 8) — the organizing unit of the resident expert.
 *
 * A dossier is a living note about one critical component/entity: what it is, how
 * it fails, which knobs to turn, its incident history, and its current state.
 * Knowledge accretes IN PLACE (incidents append to a log section; current-state is
 * revised) instead of spawning a new note per event — so the entity, not the file,
 * is the memory's unit. Canonical storage is markdown under <vault>/dossiers/
 * (type `dossier`); a derived JSON cache under .claude/.semantic-memory/ lets the
 * hot-path hook resolve an utterance to a dossier head for two-hop retrieval.
 */

export const DOSSIER_DIR = "dossiers";
const CACHE_FILE = "dossier-cache.json";

/** The fixed section skeleton every dossier carries (order is meaningful). */
export const DOSSIER_SECTIONS = [
  "Purpose",
  "Failure modes",
  "Knobs & commands",
  "Incident log",
  "Current state",
] as const;

export type DossierSection = (typeof DOSSIER_SECTIONS)[number];

export interface DossierEntry {
  /** The canonical entity name (e.g. "payment-gateway"). */
  entity: string;
  /** The human's phrases for this entity (feed the lexicon compiler). */
  aliases: string[];
  /** Dossier note path relative to vault root. */
  path: string;
  /** First paragraph of the Purpose section — the head injected on two-hop. */
  purpose: string;
  /** The Current state section body — the freshest one-liner about the entity. */
  current_state: string;
}

export function slugifyEntity(entity: string): string {
  return (
    entity
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "entity"
  );
}

export function normalizeEntity(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Body-only text of a section (heading + leading/trailing blank lines stripped). */
function sectionBody(markdown: string, heading: string): string {
  const section = extractSection(markdown, heading);
  if (!section) return "";
  // Drop the heading line, collapse to a trimmed body.
  return section
    .split("\n")
    .slice(1)
    .join("\n")
    .trim();
}

/** First non-empty paragraph of a section body (the "head" for injection). */
function firstParagraph(body: string): string {
  const para = body.split(/\n\s*\n/).map((p) => p.trim()).find(Boolean);
  return para ?? "";
}

/**
 * The dossier template — the fixed skeleton `dossier init` scaffolds and every
 * section edit patches into. Placeholders are intentionally terse prompts, not
 * prose, so an empty dossier is cheap to read and obvious to fill.
 */
export function dossierTemplate(entity: string, opts: { purpose?: string; seeded_from?: string } = {}): string {
  const purpose = opts.purpose?.trim() || `_What ${entity} is and why it exists._`;
  const seedNote = opts.seeded_from ? `\n<!-- seeded from ${opts.seeded_from} -->\n` : "";
  return `# ${entity}
${seedNote}
## Purpose

${purpose}

## Failure modes

_How it breaks, and the tell-tale symptoms._

## Knobs & commands

_The buttons to push: commands, config, flags, dashboards._

## Incident log

_Dated entries append here (newest last). Each: what happened → cause → fix._

## Current state

_The single freshest sentence about where this entity stands right now._
`;
}

/** Read every dossier note into an entry (best-effort; skips unreadable files). */
export async function listDossiers(vaultPath: string): Promise<DossierEntry[]> {
  const files = await glob(`${DOSSIER_DIR}/**/*.md`, { cwd: vaultPath });
  const entries: DossierEntry[] = [];
  for (const rel of files) {
    try {
      const raw = await readFile(join(vaultPath, rel), "utf-8");
      const { data, content } = matter(raw);
      if (data.type !== "dossier") continue;
      const entity = typeof data.entity === "string" && data.entity.trim() ? data.entity.trim() : rel.replace(/^dossiers\//, "").replace(/\.md$/, "");
      const aliases = Array.isArray(data.aliases) ? data.aliases.map(String).map((a) => a.trim()).filter(Boolean) : [];
      entries.push({
        entity,
        aliases,
        path: rel,
        purpose: firstParagraph(sectionBody(content, "Purpose")),
        current_state: sectionBody(content, "Current state"),
      });
    } catch {
      /* skip unreadable dossier */
    }
  }
  return entries.sort((a, b) => a.entity.localeCompare(b.entity));
}

/** Compile all dossiers into the derived cache the hook reads for two-hop routing. */
export async function compileDossiers(vaultPath: string): Promise<DossierEntry[]> {
  const entries = await listDossiers(vaultPath);
  try {
    const dir = deriveSessionDir(vaultPath);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, CACHE_FILE),
      JSON.stringify({ compiledAt: new Date().toISOString(), dossiers: entries }, null, 2),
      "utf-8"
    );
  } catch {
    /* cache write is best-effort */
  }
  return entries;
}

/** Fast read for the hook: use the cache if present, else compile. */
export async function loadDossierCache(vaultPath: string): Promise<DossierEntry[]> {
  const cachePath = join(deriveSessionDir(vaultPath), CACHE_FILE);
  if (existsSync(cachePath)) {
    try {
      const data = JSON.parse(await readFile(cachePath, "utf-8"));
      if (Array.isArray(data?.dossiers)) return data.dossiers as DossierEntry[];
    } catch {
      /* fall through to recompile */
    }
  }
  return compileDossiers(vaultPath);
}

/** Find a dossier by exact entity name or any of its aliases (normalized). */
export function findDossier(entries: DossierEntry[], entityOrAlias: string): DossierEntry | undefined {
  const n = normalizeEntity(entityOrAlias);
  return entries.find(
    (d) => normalizeEntity(d.entity) === n || d.aliases.some((a) => normalizeEntity(a) === n)
  );
}

/**
 * Resolve an utterance to a dossier for two-hop retrieval: the query mentions the
 * entity name or one of its aliases. Returns the best (longest-alias) match so a
 * specific phrase wins over a generic one. Deterministic — no LLM, no embedding.
 */
export function resolveDossierForQuery(entries: DossierEntry[], query: string): DossierEntry | undefined {
  const nq = normalizeEntity(query);
  let best: { entry: DossierEntry; keyLen: number } | undefined;
  for (const d of entries) {
    const keys = [d.entity, ...d.aliases].map(normalizeEntity).filter(Boolean);
    for (const k of keys) {
      // Word-ish containment: the key appears in the query.
      if (nq.includes(k) && (!best || k.length > best.keyLen)) {
        best = { entry: d, keyLen: k.length };
      }
    }
  }
  return best?.entry;
}

async function readDossierRaw(vaultPath: string, rel: string): Promise<{ raw: string; entity: string } | null> {
  const abs = join(vaultPath, rel);
  if (!existsSync(abs)) return null;
  try {
    const raw = await readFile(abs, "utf-8");
    const { data } = matter(raw);
    if (data.type !== "dossier") return null;
    const entity = typeof data.entity === "string" ? data.entity : rel;
    return { raw, entity };
  } catch {
    return null;
  }
}

/** Resolve an entity/alias/path argument to a concrete dossier note path. */
export async function resolveDossierPath(vaultPath: string, entityOrPath: string): Promise<string | null> {
  // Direct path?
  if (entityOrPath.endsWith(".md") && existsSync(join(vaultPath, entityOrPath))) return entityOrPath;
  const entries = await listDossiers(vaultPath);
  const match = findDossier(entries, entityOrPath);
  if (match) return match.path;
  // Fall back to the slug path even if not yet created.
  return null;
}

export interface InitDossierResult {
  path: string;
  created: boolean;
  entity: string;
  redacted?: number;
}

/**
 * Scaffold a dossier for an entity. No-op (created:false) if one already exists for
 * that entity/slug. `seeded_from` records provenance (e.g. a babel-fish project-map
 * entry) without failing when that source is absent — same fail-open posture as the
 * v1.2 code-symbol drift seed.
 */
export async function initDossier(
  vaultPath: string,
  entity: string,
  opts: { aliases?: string[]; purpose?: string; seeded_from?: string } = {}
): Promise<InitDossierResult> {
  const existing = await listDossiers(vaultPath);
  const already = findDossier(existing, entity);
  if (already) return { path: already.path, created: false, entity: already.entity };

  const rel = join(DOSSIER_DIR, `${slugifyEntity(entity)}.md`);
  const abs = join(vaultPath, rel);
  if (existsSync(abs)) return { path: rel, created: false, entity };

  const today = new Date().toISOString().slice(0, 10);
  const purpose = redact(opts.purpose ?? "");
  const fm: Record<string, unknown> = {
    title: entity,
    type: "dossier",
    entity,
    status: "active",
    last_verified: today,
    confidence: "medium",
    ...(opts.aliases && opts.aliases.length > 0 ? { aliases: opts.aliases } : {}),
    ...(opts.seeded_from ? { sources: [opts.seeded_from] } : {}),
  };
  const body = dossierTemplate(entity, { purpose: opts.purpose === undefined ? undefined : purpose.text, seeded_from: opts.seeded_from });
  await mkdir(join(vaultPath, DOSSIER_DIR), { recursive: true });
  await writeFile(abs, matter.stringify(body, fm), "utf-8");
  await compileDossiers(vaultPath);
  return { path: rel, created: true, entity, ...(purpose.count ? { redacted: purpose.count } : {}) };
}

/**
 * Append a dated incident line to a dossier's Incident log (accretion, never a new
 * file). Returns the resolved path, or null if no dossier exists for the entity.
 */
export async function appendIncident(
  vaultPath: string,
  entityOrPath: string,
  incident: string,
  opts: { today?: string } = {}
): Promise<{ path: string; redacted?: number } | null> {
  const rel = await resolveDossierPath(vaultPath, entityOrPath);
  if (!rel) return null;
  const doc = await readDossierRaw(vaultPath, rel);
  if (!doc) return null;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const text = redact(incident.trim());
  const line = `- ${today} — ${text.text}`;
  const patched = appendToSection(doc.raw, "Incident log", line);
  await writeFile(join(vaultPath, rel), patched, "utf-8");
  await compileDossiers(vaultPath);
  return { path: rel, ...(text.count ? { redacted: text.count } : {}) };
}

/**
 * Replace the body of a dossier's Current state section (the freshest one-liner).
 * Returns the resolved path, or null if no dossier exists for the entity.
 */
export async function setCurrentState(
  vaultPath: string,
  entityOrPath: string,
  state: string
): Promise<{ path: string; redacted?: number } | null> {
  const rel = await resolveDossierPath(vaultPath, entityOrPath);
  if (!rel) return null;
  const doc = await readDossierRaw(vaultPath, rel);
  if (!doc) return null;
  const text = redact(state.trim());
  const patched = replaceSectionBody(doc.raw, "Current state", text.text);
  await writeFile(join(vaultPath, rel), patched, "utf-8");
  await compileDossiers(vaultPath);
  return { path: rel, ...(text.count ? { redacted: text.count } : {}) };
}

// --- section-level markdown editing (heading-scoped, format-preserving) ---

/** Split into lines, find a `## <heading>` (case-insensitive), return its bounds. */
function locateSection(markdown: string, heading: string): { start: number; level: number; end: number; lines: string[] } | null {
  const lines = markdown.split("\n");
  const want = heading.trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m && m[2].trim().toLowerCase() === want) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return { start, level, end, lines };
}

/** True if a section body is only the template placeholder (an italic prompt). */
function isPlaceholderBody(body: string): boolean {
  const t = body.trim();
  return t === "" || (/^_.*_$/.test(t) && !t.includes("\n"));
}

/** Append a line to the end of a section's body (before the next heading/EOF). */
export function appendToSection(markdown: string, heading: string, line: string): string {
  const loc = locateSection(markdown, heading);
  if (!loc) {
    // Section absent — append a fresh one at EOF.
    const sep = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${sep}\n## ${heading}\n\n${line}\n`;
  }
  const { lines, start, end } = loc;
  const body = lines.slice(start + 1, end).join("\n");
  // If the body is just the placeholder prompt, replace it with the first real line.
  const bodyStripped = body.trim();
  const replacePlaceholder = isPlaceholderBody(bodyStripped);
  // Find the last non-empty line index within the section body.
  let insertAt = end;
  while (insertAt - 1 > start && lines[insertAt - 1].trim() === "") insertAt--;
  const before = lines.slice(0, replacePlaceholder ? start + 1 : insertAt);
  const after = lines.slice(replacePlaceholder ? end : insertAt);
  const injected = replacePlaceholder ? ["", line] : [line];
  return [...before, ...injected, ...after].join("\n");
}

/** Replace a section's entire body (keeps the heading), preserving surrounding doc. */
export function replaceSectionBody(markdown: string, heading: string, newBody: string): string {
  const loc = locateSection(markdown, heading);
  if (!loc) {
    const sep = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${sep}\n## ${heading}\n\n${newBody}\n`;
  }
  const { lines, start, end } = loc;
  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  return [...before, "", newBody, "", ...after].join("\n").replace(/\n{3,}/g, "\n\n");
}
