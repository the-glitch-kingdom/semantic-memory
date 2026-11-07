import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { IndexedDocument } from "./types.js";

/**
 * Which frontmatter fields authors write to be found, and how they are indexed (`index_fields` in vault.schema.yml).
 * `lexical` fields join one text every BM25 chunk of the doc is also indexed under; `vector` fields become extra
 * `kind: "meta"` chunks. Of the scalar names in `vector` (purpose, summary, description) the first one a doc has is
 * embedded; `symptoms` embeds every phrase.
 */
export interface IndexFields {
  lexical: string[];
  vector: string[];
  /** keys read from object-form symptoms; `target`, `cites` and `severity` are never indexed */
  symptom_keys: string[];
  /** doc vector score = max(best body cosine, meta_weight x best meta cosine) */
  meta_weight: number;
}

export const DEFAULT_INDEX_FIELDS: IndexFields = {
  lexical: ["title", "purpose", "summary", "description", "keywords", "tags", "symptoms"],
  vector: ["purpose", "summary", "description", "symptoms"],
  symptom_keys: ["user_phrase", "error_pattern", "alert_name"],
  meta_weight: 0.8,
};

/** Regex text embeds as noise: BM25 only (embedding it changed no train answer, notes.md "Phase 3"). */
const LEXICAL_ONLY_KEYS = new Set(["error_pattern"]);

export function loadIndexFields(vaultPath: string): IndexFields {
  try {
    const parsed = parseYaml(readFileSync(join(vaultPath, "vault.schema.yml"), "utf-8")) as { index_fields?: Partial<IndexFields> } | null;
    const f = parsed?.index_fields;
    if (!f || typeof f !== "object") return DEFAULT_INDEX_FIELDS;
    const list = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : d);
    return {
      lexical: list(f.lexical, DEFAULT_INDEX_FIELDS.lexical),
      vector: list(f.vector, DEFAULT_INDEX_FIELDS.vector),
      symptom_keys: list(f.symptom_keys, DEFAULT_INDEX_FIELDS.symptom_keys),
      meta_weight: typeof f.meta_weight === "number" && f.meta_weight > 0 ? f.meta_weight : DEFAULT_INDEX_FIELDS.meta_weight,
    };
  } catch {
    return DEFAULT_INDEX_FIELDS;
  }
}

const strings = (v: unknown): string[] =>
  typeof v === "string" ? (v.trim() ? [v.trim()] : []) : Array.isArray(v) ? v.flatMap(strings) : [];

/** String symptoms and, from object symptoms, the values of `symptom_keys` (a string or a list each). */
function symptomPhrases(v: unknown, cfg: IndexFields): { key?: string; text: string }[] {
  if (!Array.isArray(v)) return strings(v).map((text) => ({ text }));
  return v.flatMap((item) =>
    item && typeof item === "object"
      ? cfg.symptom_keys.flatMap((key) => strings((item as Record<string, unknown>)[key]).map((text) => ({ key, text })))
      : strings(item).map((text) => ({ text }))
  );
}

const fieldValues = (fm: Record<string, unknown>, name: string, cfg: IndexFields): string[] =>
  name === "symptoms" ? symptomPhrases(fm.symptoms, cfg).map((p) => p.text) : strings(fm[name]);

export interface MetaChunk {
  field: string;
  text: string;
}

/** The doc's field text for BM25 and its metadata chunks for the vector index. `title` is the resolved title. */
export function buildFields(fm: Record<string, unknown>, title: string, cfg: IndexFields): { lexical: string; meta: MetaChunk[] } {
  const lexical = cfg.lexical.flatMap((n) => (n === "title" ? [title] : fieldValues(fm, n, cfg))).join(" ");
  const meta: MetaChunk[] = [];
  let scalar = false; // purpose first; summary / description only stand in for it
  for (const name of cfg.vector) {
    if (name === "symptoms") {
      for (const p of symptomPhrases(fm.symptoms, cfg)) if (!LEXICAL_ONLY_KEYS.has(p.key ?? "")) meta.push({ field: name, text: p.text });
    } else if (!scalar) {
      const values = strings(fm[name]);
      for (const text of values) meta.push({ field: name, text });
      scalar = values.length > 0;
    }
  }
  const seen = new Set<string>();
  return { lexical, meta: meta.filter((m) => !seen.has(m.text) && !!seen.add(m.text)) };
}

/** Share of searchable docs (those with chunks) carrying each lexical field. */
export function fieldCoverage(docs: IndexedDocument[], cfg: IndexFields): { docs: number; fields: Record<string, number> } {
  const live = docs.filter((d) => d.chunks.length > 0);
  const fields: Record<string, number> = {};
  for (const name of cfg.lexical) {
    const n = live.filter((d) => fieldValues(d.frontmatter, name, cfg).length > 0).length;
    fields[name] = live.length ? Math.round((n / live.length) * 100) / 100 : 0;
  }
  return { docs: live.length, fields };
}
