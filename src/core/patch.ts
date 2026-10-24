import { readFile, writeFile, unlink, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import type { UpdateNoteOptions } from "./types.js";
import { NoteCrud } from "./crud.js";
import { loadSchema, validateNote, type LintFinding, type VaultSchema } from "./schema.js";
import { regenIndexesForPaths, type RegenResult } from "./index-regen.js";

export interface PatchCreate {
  path: string;
  content: string;
  frontmatter?: Record<string, unknown>;
}

export interface PatchUpdate {
  path: string;
  content: string;
  mode: UpdateNoteOptions["mode"];
  heading?: string;
}

export interface PatchDelete {
  path: string;
}

export interface PatchMove {
  from: string;
  to: string;
}

export interface ChangeSet {
  creates?: PatchCreate[];
  updates?: PatchUpdate[];
  deletes?: PatchDelete[];
  moves?: PatchMove[];
}

export interface ApplyPatchOptions {
  dryRun?: boolean;
  validate?: boolean;
  allowLintWarnings?: boolean;
  /** Regenerate INDEX.md in directories touched by this patch. Default: true. */
  regenIndexes?: boolean;
}

export interface AppliedOp {
  op: "create" | "update" | "delete" | "move";
  path: string;
  /** secrets masked in this op's content; omitted when none */
  redacted?: number;
}

export interface ApplyPatchResult {
  ok: boolean;
  applied: AppliedOp[];
  rolledBack: AppliedOp[];
  lint: LintFinding[];
  errors: string[];
  /** Index files regenerated as a side-effect. Empty if regenIndexes=false or dry-run. */
  indexes_regenerated?: RegenResult[];
}

interface Snapshot {
  op: "create" | "update" | "delete" | "move";
  path: string;
  absPath: string;
  prevContent?: string; // for update/delete/move(from)
  prevAbsPath?: string; // for move (prev location)
}

/**
 * Atomic multi-note patch with rollback. Applies creates → updates → moves → deletes
 * in that order. If any op fails, all successful ops before it are reverted in reverse.
 *
 * In dry-run mode, nothing is written; the result describes what would have happened,
 * including lint findings on the proposed state.
 */
export async function applyPatch(
  notesPath: string,
  changeset: ChangeSet,
  options: ApplyPatchOptions = {}
): Promise<ApplyPatchResult> {
  const validate = options.validate !== false;
  const dryRun = options.dryRun === true;
  const allowWarn = options.allowLintWarnings !== false;

  const errors: string[] = [];
  const lint: LintFinding[] = [];
  const applied: AppliedOp[] = [];
  const snapshots: Snapshot[] = [];

  const crud = new NoteCrud(notesPath);

  let schema: VaultSchema | null = null;
  if (validate) {
    try {
      schema = await loadSchema(notesPath);
    } catch (e) {
      errors.push(`failed to load schema: ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, applied, rolledBack: [], lint, errors };
    }
  }

  // Pre-check: collisions on creates, missing sources on updates/deletes/moves.
  for (const c of changeset.creates ?? []) {
    if (existsSync(join(notesPath, c.path))) {
      errors.push(`create: already exists: ${c.path}`);
    }
  }
  for (const u of changeset.updates ?? []) {
    if (!existsSync(join(notesPath, u.path))) {
      errors.push(`update: does not exist: ${u.path}`);
    }
  }
  for (const d of changeset.deletes ?? []) {
    if (!existsSync(join(notesPath, d.path))) {
      errors.push(`delete: does not exist: ${d.path}`);
    }
  }
  for (const m of changeset.moves ?? []) {
    if (!existsSync(join(notesPath, m.from))) {
      errors.push(`move: source does not exist: ${m.from}`);
    }
    if (existsSync(join(notesPath, m.to))) {
      errors.push(`move: destination exists: ${m.to}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, applied, rolledBack: [], lint, errors };
  }

  // Lint pre-flight on proposed state. Simulate each create/update and validate.
  if (validate && schema) {
    for (const c of changeset.creates ?? []) {
      const proposed = matter.stringify(c.content, c.frontmatter ?? {});
      lint.push(...validateNote(c.path, proposed, schema));
    }
    for (const u of changeset.updates ?? []) {
      const abs = join(notesPath, u.path);
      let proposed: string;
      try {
        const existing = await readFile(abs, "utf-8");
        proposed = applyUpdateInMemory(existing, u);
      } catch (e) {
        errors.push(`update precheck: ${u.path}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      lint.push(...validateNote(u.path, proposed, schema));
    }

    const schemaErrors = lint.filter((f) => f.rule === "schema_violations" && f.severity === "error");
    if (schemaErrors.length > 0) {
      errors.push(`${schemaErrors.length} schema violation(s) blocked the patch`);
    }
    if (!allowWarn) {
      const warns = lint.filter((f) => f.severity === "warn");
      if (warns.length > 0) errors.push(`${warns.length} lint warning(s) blocked the patch (allowLintWarnings=false)`);
    }
  }

  if (errors.length > 0 || dryRun) {
    return { ok: errors.length === 0, applied, rolledBack: [], lint, errors };
  }

  // Execute — capture snapshots as we go so rollback can reverse.
  try {
    for (const c of changeset.creates ?? []) {
      const abs = join(notesPath, c.path);
      const { redacted } = await crud.create(c.path, c.content, c.frontmatter);
      snapshots.push({ op: "create", path: c.path, absPath: abs });
      applied.push({ op: "create", path: c.path, ...(redacted ? { redacted } : {}) });
    }
    for (const u of changeset.updates ?? []) {
      const abs = join(notesPath, u.path);
      const prev = await readFile(abs, "utf-8");
      const { redacted } = await crud.update(u.path, u.content, { mode: u.mode, heading: u.heading } as UpdateNoteOptions);
      snapshots.push({ op: "update", path: u.path, absPath: abs, prevContent: prev });
      applied.push({ op: "update", path: u.path, ...(redacted ? { redacted } : {}) });
    }
    for (const m of changeset.moves ?? []) {
      await crud.move(m.from, m.to);
      snapshots.push({
        op: "move",
        path: m.to,
        absPath: join(notesPath, m.to),
        prevAbsPath: join(notesPath, m.from),
      });
      applied.push({ op: "move", path: `${m.from} -> ${m.to}` });
    }
    for (const d of changeset.deletes ?? []) {
      const abs = join(notesPath, d.path);
      const prev = await readFile(abs, "utf-8");
      await crud.delete(d.path);
      snapshots.push({ op: "delete", path: d.path, absPath: abs, prevContent: prev });
      applied.push({ op: "delete", path: d.path });
    }
  } catch (e) {
    errors.push(`op failed: ${e instanceof Error ? e.message : String(e)} — rolling back`);
    const rolledBack = await rollback(snapshots);
    return { ok: false, applied, rolledBack, lint, errors };
  }

  let indexes_regenerated: RegenResult[] = [];
  if (options.regenIndexes !== false) {
    const touched = [
      ...(changeset.creates ?? []).map((c) => c.path),
      ...(changeset.deletes ?? []).map((d) => d.path),
      ...(changeset.moves ?? []).flatMap((m) => [m.from, m.to]),
    ];
    try {
      indexes_regenerated = await regenIndexesForPaths(notesPath, touched);
    } catch (e) {
      // Non-fatal: patch succeeded; index regen is a best-effort side effect.
      errors.push(`index regen failed (patch still applied): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: true, applied, rolledBack: [], lint, errors, indexes_regenerated };
}

async function rollback(snapshots: Snapshot[]): Promise<AppliedOp[]> {
  const reverted: AppliedOp[] = [];
  for (const s of snapshots.slice().reverse()) {
    try {
      switch (s.op) {
        case "create":
          if (existsSync(s.absPath)) await unlink(s.absPath);
          reverted.push({ op: "create", path: s.path });
          break;
        case "update":
          if (s.prevContent !== undefined) {
            await writeFile(s.absPath, s.prevContent, "utf-8");
          }
          reverted.push({ op: "update", path: s.path });
          break;
        case "delete":
          if (s.prevContent !== undefined) {
            await mkdir(dirname(s.absPath), { recursive: true });
            await writeFile(s.absPath, s.prevContent, "utf-8");
          }
          reverted.push({ op: "delete", path: s.path });
          break;
        case "move":
          if (s.prevAbsPath && existsSync(s.absPath)) {
            await mkdir(dirname(s.prevAbsPath), { recursive: true });
            await rename(s.absPath, s.prevAbsPath);
          }
          reverted.push({ op: "move", path: s.path });
          break;
      }
    } catch {
      // swallow — best-effort rollback
    }
  }
  return reverted;
}

function applyUpdateInMemory(existing: string, u: PatchUpdate): string {
  switch (u.mode) {
    case "overwrite":
      return u.content;
    case "append":
      return existing + "\n" + u.content;
    case "prepend": {
      const { data, content: body } = matter(existing);
      const newBody = u.content + "\n" + body;
      return Object.keys(data).length > 0 ? matter.stringify(newBody, data) : newBody;
    }
    case "patch-by-heading": {
      if (!u.heading) throw new Error("patch-by-heading requires heading");
      return patchByHeadingInMemory(existing, u.heading, u.content);
    }
  }
}

function patchByHeadingInMemory(content: string, heading: string, newContent: string): string {
  const lines = content.split("\n");
  const re = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  let idx = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      idx = i;
      const m = lines[i].match(/^(#{1,6})\s+/);
      level = m ? m[1].length : 1;
      break;
    }
  }
  if (idx === -1) throw new Error(`Heading not found: ${heading}`);
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, idx + 1), "", newContent, "", ...lines.slice(end)].join("\n");
}
