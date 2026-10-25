import { readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import matter from "./matter.js";
import { DEFAULT_SCHEMA_YAML } from "./schema-default.js";

export interface VaultSchema {
  version: number;
  provenance_fields: string[];
  status_enum: string[];
  confidence_enum: string[];
  severity_enum: string[];
  types: Record<string, { description?: string; required: string[] }>;
  lint: {
    missing_provenance: { applies_to: string[]; severity: "warn" | "error" };
    stale: { max_age_days: number; severity: "warn" | "error" };
    schema_violations: { severity: "warn" | "error" };
  };
}

export type Severity = "warn" | "error";

export interface LintFinding {
  path: string;
  rule: "missing_provenance" | "stale" | "schema_violations" | "broken_links" | "code_symbols" | "decay_candidates" | "alias_conflicts" | "decoys" | "secrets";
  severity: Severity;
  message: string;
}

export async function loadSchema(vaultPath: string): Promise<VaultSchema> {
  const schemaPath = join(vaultPath, "vault.schema.yml");
  let raw: string;
  try {
    await access(schemaPath, constants.R_OK);
    raw = await readFile(schemaPath, "utf-8");
  } catch {
    raw = DEFAULT_SCHEMA_YAML;
  }
  const parsed = parseYaml(raw) as VaultSchema;
  return parsed;
}

/**
 * Bootstrap the schema file in a vault by writing the default if none exists.
 * Used by the `--install-schema` CLI flag. Returns the path that was (or would be) written.
 */
export async function installDefaultSchema(vaultPath: string, force = false): Promise<{ written: boolean; path: string }> {
  const schemaPath = join(vaultPath, "vault.schema.yml");
  if (!force) {
    try {
      await access(schemaPath, constants.F_OK);
      return { written: false, path: schemaPath };
    } catch {
      // not present → write it
    }
  }
  await writeFile(schemaPath, DEFAULT_SCHEMA_YAML, "utf-8");
  return { written: true, path: schemaPath };
}

/**
 * Validate a single note's frontmatter + content against the schema.
 * Returns findings (possibly empty). Does NOT throw — lint never throws.
 */
export function validateNote(
  relativePath: string,
  rawFileContent: string,
  schema: VaultSchema,
  opts: { todayIso?: string } = {}
): LintFinding[] {
  const findings: LintFinding[] = [];
  const { data: fm } = matter(rawFileContent);

  const typeName = typeof fm.type === "string" ? fm.type : "note";
  const typeDef = schema.types[typeName];

  if (!typeDef) {
    findings.push({
      path: relativePath,
      rule: "schema_violations",
      severity: schema.lint.schema_violations.severity,
      message: `unknown type "${typeName}" — allowed: ${Object.keys(schema.types).join(", ")}`,
    });
    return findings; // can't validate required fields if type is unknown
  }

  // Required field check
  for (const field of typeDef.required) {
    if (fm[field] === undefined || fm[field] === null || fm[field] === "") {
      findings.push({
        path: relativePath,
        rule: "schema_violations",
        severity: schema.lint.schema_violations.severity,
        message: `missing required field "${field}" for type "${typeName}"`,
      });
    }
  }

  // Enum checks
  if (fm.status !== undefined && !schema.status_enum.includes(String(fm.status))) {
    findings.push({
      path: relativePath,
      rule: "schema_violations",
      severity: schema.lint.schema_violations.severity,
      message: `status "${fm.status}" not in enum [${schema.status_enum.join(", ")}]`,
    });
  }
  if (fm.confidence !== undefined && !schema.confidence_enum.includes(String(fm.confidence))) {
    findings.push({
      path: relativePath,
      rule: "schema_violations",
      severity: schema.lint.schema_violations.severity,
      message: `confidence "${fm.confidence}" not in enum [${schema.confidence_enum.join(", ")}]`,
    });
  }
  if (typeName === "gotcha" && fm.severity !== undefined && !schema.severity_enum.includes(String(fm.severity))) {
    findings.push({
      path: relativePath,
      rule: "schema_violations",
      severity: schema.lint.schema_violations.severity,
      message: `severity "${fm.severity}" not in enum [${schema.severity_enum.join(", ")}]`,
    });
  }

  // Missing provenance
  if (schema.lint.missing_provenance.applies_to.includes(typeName)) {
    const hasSources = Array.isArray(fm.sources) ? fm.sources.length > 0 : typeof fm.sources === "string" && fm.sources.length > 0;
    const hasDerived = Array.isArray(fm.derived_from) ? fm.derived_from.length > 0 : typeof fm.derived_from === "string" && fm.derived_from.length > 0;
    if (!hasSources && !hasDerived) {
      findings.push({
        path: relativePath,
        rule: "missing_provenance",
        severity: schema.lint.missing_provenance.severity,
        message: `no sources or derived_from on ${typeName}`,
      });
    }
  }

  // Stale
  if (schema.lint.stale.max_age_days > 0 && fm.last_verified) {
    const today = opts.todayIso ?? new Date().toISOString().slice(0, 10);
    const verified = String(fm.last_verified);
    const ageDays = dayDiff(today, verified);
    if (ageDays !== null && ageDays > schema.lint.stale.max_age_days) {
      findings.push({
        path: relativePath,
        rule: "stale",
        severity: schema.lint.stale.severity,
        message: `last_verified ${verified} is ${ageDays} days old (limit ${schema.lint.stale.max_age_days})`,
      });
    }
  }

  return findings;
}

function dayDiff(todayIso: string, thenIso: string): number | null {
  const a = Date.parse(todayIso);
  const b = Date.parse(thenIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}
