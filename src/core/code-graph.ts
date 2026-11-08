import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { promisify } from "node:util";
import { normalizeVerifiedDate } from "./decay.js";
import { identifiers } from "./identifiers.js";
import { repoRoot } from "./skill-evidence.js";
import type { Grounding } from "./types.js";

const run = promisify(execFile);

/** One code reference of a doc. `file` is a repo path (or a symbol's file); `changed` is the file's last commit in ms. */
export interface CodeRef {
  kind: "file" | "symbol";
  target: string;
  file?: string;
  repo?: string;
  /** null = could not be checked; only `false` is dead */
  resolved: boolean | null;
  changed?: number;
}
export interface DocCode {
  source: "export" | "code-spans";
  verdict?: string;
  bodyChanged?: number;
  lastVerified?: number;
  refs: CodeRef[];
}
export interface SymbolInfo { file?: string; fileKind?: "definition" | "reference"; citedBy: string[] }
export interface CodeData { docs: Map<string, DocCode>; symbols: Map<string, SymbolInfo> }

const warned = new Set<string>();
const warnOnce = (msg: string) => {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.error(`[semantic-memory] ${msg}`);
};

const MAX_EXPORT_BYTES = 64 << 20;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERDICTS = new Set(["verified", "fields-only", "check", "stale", "archive-candidate", "secret", "unreviewed"]);
const day = (v: unknown): number | undefined => (typeof v === "string" && DATE.test(v) && !isNaN(Date.parse(v)) ? Date.parse(v) : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const clean = (p: string) => posix.normalize(p.replace(/^\.\//, ""));

/** hewtd's docs folder (repo-relative): the export's own `docs_root`, else its config (`docs_root` since 3.0.0, `docs_path` before), else `.documentation`. */
function docsRoot(gitRoot: string, exported: Record<string, unknown>): string {
  let v = str(exported.docs_root);
  if (!v) {
    try {
      const cfg = JSON.parse(readFileSync(join(gitRoot, ".claude", "hit-em-with-the-docs.json"), "utf-8"));
      v = isObj(cfg) ? str(cfg.docs_root) ?? str(cfg.docs_path) : undefined;
    } catch { /* no config: default */ }
  }
  return clean(v ?? ".documentation").replace(/\/$/, "");
}

/**
 * `<gitRoot>/.hewtd/graph.json` (hewtd graph export v1), or null when absent or unusable. It comes from another tool, so nothing in it
 * is trusted: bad JSON or a version other than 1 warns once and is ignored, unknown fields are skipped, malformed entries dropped, and a
 * `resolved` that is not a boolean becomes null (never dead). Doc keys are docs-relative and are mapped to vault paths (`vaultPaths`
 * are relative to `vaultDir`); with fewer than half of them known, the docs table is ignored (symbols are kept, mapped the same way).
 */
export function loadExport(gitRoot: string, vaultDir: string, vaultPaths: Set<string>): CodeData | null {
  const file = join(gitRoot, ".hewtd", "graph.json");
  let g: unknown;
  try {
    if (statSync(file).size > MAX_EXPORT_BYTES) return warnOnce(`${file} is over ${MAX_EXPORT_BYTES >> 20} MB, ignored`), null;
    g = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") warnOnce(`${file} is not readable JSON, ignored`);
    return null;
  }
  if (!isObj(g) || g.version !== 1) return warnOnce(`${file} has version ${isObj(g) ? JSON.stringify(g.version) : "?"}, only 1 is read; ignored`), null;

  const root = docsRoot(gitRoot, g);
  const toVault = (key: string): string | undefined => {
    const p = posix.normalize(relative(vaultDir, join(gitRoot, root, key)).split(sep).join("/"));
    return vaultPaths.has(p) ? p : undefined;
  };
  const out: CodeData = { docs: new Map(), symbols: new Map() };

  const docs = isObj(g.docs) ? Object.entries(g.docs) : [];
  const mapped = docs.map(([k, v]) => [toVault(k), v] as const);
  if (mapped.length && mapped.filter(([p]) => p).length * 2 < mapped.length) {
    warnOnce(`${file}: fewer than half of its ${mapped.length} doc keys match this vault (docs root "${root}"); its docs table is ignored`);
  } else {
    for (const [path, d] of mapped) {
      if (!path || !isObj(d)) continue;
      const refs: CodeRef[] = [];
      for (const r of Array.isArray(d.refs) ? d.refs : []) {
        if (!isObj(r) || (r.kind !== "file" && r.kind !== "symbol")) continue; // env, command, table, column, doc refs are not code
        const target = str(r.target);
        if (!target) continue;
        refs.push({
          kind: r.kind, target: r.kind === "file" ? clean(target) : target, file: str(r.file), repo: str(r.repo),
          resolved: typeof r.resolved === "boolean" ? r.resolved : null, changed: day(r.code_changed),
        });
      }
      out.docs.set(path, {
        source: "export", refs, bodyChanged: day(d.body_changed), lastVerified: day(d.last_verified),
        verdict: typeof d.verdict === "string" && VERDICTS.has(d.verdict) ? d.verdict : undefined,
      });
    }
  }

  for (const [name, s] of isObj(g.symbols) ? Object.entries(g.symbols) : []) {
    if (!isObj(s)) continue;
    const citedBy = (Array.isArray(s.cited_by) ? s.cited_by : []).map((k) => (typeof k === "string" ? toVault(k) : undefined)).filter((p): p is string => !!p);
    out.symbols.set(name, { file: str(s.file) && clean(str(s.file)!), fileKind: s.file_kind === "definition" || s.file_kind === "reference" ? s.file_kind : undefined, citedBy });
  }
  return out;
}

/** Tracked files of the repo, from ONE `git ls-files -z`. Empty outside a repo or when git fails. */
export async function gitFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await run("git", ["-C", root, "-c", "core.quotepath=off", "ls-files", "-z"], { maxBuffer: 1 << 28, timeout: 60_000 });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Last commit time (ms) of each of `files`, from one `git log --name-only` per 500 pathspecs (one for any normal build).
 * shortcut: a shallow clone dates old files at its boundary commit, like git-dates.ts.
 */
export async function gitLastChanged(root: string, files: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < files.length; i += 500) {
    const batch = files.slice(i, i + 500);
    let stdout: string;
    try {
      ({ stdout } = await run("git", ["-C", root, "-c", "core.quotepath=off", "log", "--name-only", "--no-renames", "--format=%x01%ct", "--", ...batch.map((f) => `:(literal)${f}`)], { maxBuffer: 1 << 28, timeout: 60_000 }));
    } catch {
      continue;
    }
    let ms = 0;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("\x01")) ms = Number(line.slice(1)) * 1000;
      else if (line && !out.has(line)) out.set(line, ms); // newest commit first: the first sighting is the last change
    }
  }
  return out;
}

/**
 * Code refs of `docs` (their raw `codeRefs`) without an export: a span or link target matches a file by exact repo path, or by basename
 * when that name is unique; a symbol-like span (snake_case or camelCase, no `/` or `.`) becomes a symbol with no file. A ref is dead
 * only when it has a `/`, matches nothing and its top-level folder exists (a link that leaves the vault with `../` is resolved
 * to the repo first); anything else unmatched is prose and dropped.
 * shortcut: a link to a missing file inside the vault is not reported dead, since a raw span cannot be told from a link.
 */
export async function fallbackCode(gitRoot: string, vaultDir: string, docs: { path: string; codeRefs?: string[] }[]): Promise<CodeData> {
  const out: CodeData = { docs: new Map(), symbols: new Map() };
  const todo = docs.filter((d) => d.codeRefs?.length);
  if (!todo.length) return out;
  const files = await gitFiles(gitRoot);
  const fileSet = new Set(files);
  const dirs = new Set<string>();
  const tops = new Set<string>();
  const byBase = new Map<string, string[]>();
  for (const f of files) {
    tops.add(f.split("/")[0]);
    for (let d = dirname(f); d !== "."; d = dirname(d)) dirs.add(d);
    const b = posix.basename(f);
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  const vaultRel = relative(gitRoot, vaultDir).split(sep).join("/");

  const refs = new Map<string, CodeRef | undefined>(); // classified once per raw ref, shared by all docs
  const classify = (raw: string): CodeRef | undefined => {
    const t = clean(raw);
    const viaVault = raw.startsWith("../") ? clean(posix.join(vaultRel, raw)) : undefined;
    for (const c of [t, viaVault]) if (c && !c.startsWith("..") && (fileSet.has(c) || dirs.has(c))) return { kind: "file", target: c, file: c, resolved: true };
    const base = byBase.get(t);
    if (base?.length === 1 && !t.includes("/")) return { kind: "file", target: t, file: base[0], resolved: true };
    const c = viaVault ?? t;
    if (c.includes("/") && !c.startsWith("..") && tops.has(c.split("/")[0])) return { kind: "file", target: c, resolved: false };
    if (!raw.includes("/") && !raw.includes(".") && !/^[A-Z0-9_]+$/.test(raw) && identifiers(raw).length) return { kind: "symbol", target: raw, resolved: null };
    return undefined;
  };

  const perDoc = new Map<string, CodeRef[]>();
  for (const d of todo) {
    const list: CodeRef[] = [];
    for (const raw of d.codeRefs!) {
      if (!refs.has(raw)) refs.set(raw, classify(raw));
      const r = refs.get(raw);
      if (r) list.push({ ...r });
    }
    perDoc.set(d.path, list);
  }
  const dates = await gitLastChanged(gitRoot, [...new Set([...refs.values()].filter((r): r is CodeRef => !!r && !!r.file && fileSet.has(r.file)).map((r) => r.file!))]);
  for (const [path, list] of perDoc) {
    for (const r of list) {
      if (r.file) r.changed = dates.get(r.file);
      if (r.kind === "symbol") {
        const s = out.symbols.get(r.target) ?? out.symbols.set(r.target, { citedBy: [] }).get(r.target)!;
        s.citedBy.push(path);
      }
    }
    if (list.length) out.docs.set(path, { source: "code-spans", refs: list });
  }
  return out;
}

/**
 * Code data for a vault: the export's docs where it covers them, the span/link fallback for the rest. Null outside a git repo, so the
 * graph stays doc-only. `docs` are the vault's indexed documents (path relative to `vaultDir`).
 */
export async function loadCodeData(vaultDir: string, docs: { path: string; codeRefs?: string[] }[]): Promise<CodeData | null> {
  const root = repoRoot(vaultDir);
  if (!existsSync(join(root, ".git"))) return null;
  const exp = loadExport(root, vaultDir, new Set(docs.map((d) => d.path)));
  const rest = await fallbackCode(root, vaultDir, exp ? docs.filter((d) => !exp.docs.has(d.path)) : docs);
  if (!exp) return rest;
  for (const [p, d] of rest.docs) exp.docs.set(p, d);
  for (const [n, s] of rest.symbols) {
    const e = exp.symbols.get(n);
    if (e) e.citedBy.push(...s.citedBy.filter((p) => !e.citedBy.includes(p)));
    else exp.symbols.set(n, s);
  }
  return exp;
}

/**
 * Sets `grounding` on each doc from its code data (cleared when there is none or nothing to report); true when anything changed.
 * Drift = a ref whose file changed after max(body date, last_verified): the export's body_changed, else the git body date, and a real
 * verification clears it. No usable date means no drift claim. Only file refs can be dead (symbol refs are prose-noisy).
 */
export function groundDocs(docs: { path: string; frontmatter?: Record<string, unknown>; gitDate?: string; grounding?: Grounding }[], code: CodeData | null): boolean {
  let changed = false;
  for (const d of docs) {
    const c = code?.docs.get(d.path);
    let g: Grounding | undefined;
    if (c) {
      const verified = Date.parse(normalizeVerifiedDate(d.frontmatter?.last_verified) ?? "");
      const dates = [c.bodyChanged ?? Date.parse(d.gitDate ?? ""), c.lastVerified ?? NaN, verified <= Date.now() ? verified : NaN].filter((n) => !isNaN(n));
      const from = dates.length ? Math.max(...dates) : NaN;
      const drift = isNaN(from) ? [] : c.refs.filter((r) => r.changed !== undefined && r.changed > from).map((r) => r.file ?? r.target);
      const dead = c.refs.filter((r) => r.kind === "file" && r.resolved === false).map((r) => r.target);
      const verdict = c.verdict && c.verdict !== "unreviewed" ? c.verdict : undefined;
      if (drift.length || dead.length || verdict) g = { source: c.source, ...(verdict && { verdict }), code_drift: [...new Set(drift)], dead_refs: [...new Set(dead)] };
    }
    if (JSON.stringify(g) !== JSON.stringify(d.grounding)) {
      changed = true;
      if (g) d.grounding = g;
      else delete d.grounding;
    }
  }
  return changed;
}
