import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";
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
  source: "export" | "export+live" | "code-spans";
  verdict?: string;
  /** export+live only: the refs' files re-checked against the live tree because they changed since the export */
  patched?: string[];
  bodyChanged?: number;
  lastVerified?: number;
  refs: CodeRef[];
  /** export only: this doc's sections that copy another doc's section (`section` is the owner's anchor, as hewtd ships it) */
  duplicates?: { section: string; owner: string; ownerAnchor: string }[];
  /** export only: vault paths this doc points to (hewtd records only the target, never which section points) */
  pointsTo?: string[];
}
export interface SymbolInfo { file?: string; fileKind?: "definition" | "reference"; citedBy: string[] }
/** `files`: tracked repo files (from git), for locating an identifier no doc cites */
export interface CodeData {
  docs: Map<string, DocCode>; symbols: Map<string, SymbolInfo>; files?: string[];
  /** the loaded export's commit (null: made outside git), commits it is behind HEAD, files changed since it (both null when git cannot tell) */
  export?: { commit: string | null; behind: number | null; changed: number | null };
}

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
const LOC = /(?<=\.[A-Za-z0-9]+)(?::[\w$.-]+)+$|#L\d+(?:-L?\d+)?$/; // `context.ts:208`, `a.ts:10-20`, `a.js:handlePrompt`, `a.ts#L5`
/** A file ref worth checking: no space, `(` or `=`, and a `/` or an extension; member chains like `import.meta.env` are code, not paths. */
const pathShaped = (t: string) => !/[\s(=]/.test(t) && !/^(?:import\.meta|process|window|globalThis|document)\./.test(t) && (t.includes("/") || /\.[A-Za-z0-9]+$/.test(t));
/** Drops a bare name when the list holds the same file by its full path, so both count once. */
const dedupe = (xs: string[]) => [...new Set(xs)].filter((x) => x.includes("/") || !xs.some((y) => y.endsWith("/" + x)));
const GLOB = /[*?[\]{}<>]/;

/** Which of `paths` git ignores, from one `git check-ignore --stdin` (none when there is nothing to ask or git fails). */
async function gitIgnored(root: string, paths: string[]): Promise<Set<string>> {
  if (!paths.length) return new Set();
  const parse = (o: unknown) => new Set(String(o ?? "").split("\0").filter(Boolean));
  let out: Set<string>;
  try {
    const p = run("git", ["-C", root, "check-ignore", "--no-index", "-z", "--stdin"], { maxBuffer: 1 << 24, timeout: 60_000 });
    p.child.stdin?.end(paths.flatMap((x) => [x, `${x}/`]).join("\0") + "\0"); // `dir/` too: a missing folder only matches a `dir/` rule that way
    out = parse((await p).stdout);
  } catch (e) {
    out = parse((e as { stdout?: unknown }).stdout); // exit 1 = nothing ignored
  }
  return new Set(paths.filter((x) => out.has(x) || out.has(`${x}/`)));
}

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
    key = key.replace(/#.*$/, "");
    const p = posix.normalize(relative(vaultDir, join(gitRoot, root, key)).split(sep).join("/"));
    return vaultPaths.has(p) ? p : undefined;
  };
  const out: CodeData = { docs: new Map(), symbols: new Map(), export: { commit: str(g.source_commit) ?? null, behind: 0, changed: 0 } };

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
        if (!target || (r.kind === "file" && (clean(target) === "." || !pathShaped(target)))) continue; // the real export has a dead `./` ref, and refs like `import.meta.env`: prose, not files
        refs.push({
          kind: r.kind, target: r.kind === "file" ? clean(target) : target, file: str(r.file), repo: str(r.repo),
          resolved: typeof r.resolved === "boolean" ? r.resolved : null, changed: day(r.code_changed),
        });
      }
      const dups = (Array.isArray(d.duplicates) ? d.duplicates : []).flatMap((x) => {
        const o = isObj(x) && typeof x.owner === "string" ? toVault(x.owner) : undefined;
        return o && isObj(x) && typeof x.section === "string" ? [{ section: x.section.replace(/^#/, ""), owner: o, ownerAnchor: (x.owner as string).split("#")[1] ?? "" }] : [];
      });
      const to = (Array.isArray(d.points_to) ? d.points_to : []).flatMap((x) => (isObj(x) && typeof x.to === "string" ? toVault(x.to) ?? [] : []));
      out.docs.set(path, {
        source: "export", refs, ...(dups.length && { duplicates: dups }), ...(to.length && { pointsTo: to }), bodyChanged: day(d.body_changed), lastVerified: day(d.last_verified),
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

/** How far back the fallback looks for a file's last change. */
export const CODE_DATE_WINDOW_DAYS = 365;

/**
 * Last commit time (ms) of each of `files` changed in the last CODE_DATE_WINDOW_DAYS, from ONE `git log --since --name-only`
 * with no pathspec: its cost follows recent history, not the number of files asked about (a path-limited log walks the whole history
 * per batch: 3 s for 3.8k files on a 3.9k-commit repo, 80 ms this way).
 * shortcut: a file untouched for longer is left undated, so it never counts as drifted; widen the window to date older files.
 */
export async function gitLastChanged(root: string, files: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!files.length) return out;
  const want = new Set(files);
  let stdout: string;
  try {
    ({ stdout } = await run("git", ["-C", root, "-c", "core.quotepath=off", "log", `--since=${CODE_DATE_WINDOW_DAYS}.days`, "--name-only", "--no-renames", "--format=%x01%ct"], { maxBuffer: 1 << 28, timeout: 60_000 }));
  } catch {
    return out;
  }
  let ms = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("\x01")) ms = Number(line.slice(1)) * 1000;
    else if (want.has(line) && !out.has(line)) out.set(line, ms); // newest commit first: the first sighting is the last change
  }
  return out;
}

/**
 * Code refs of `docs` (their raw `codeRefs`) without an export (`:line` / `#L` suffixes and a trailing `/` are dropped; globs and
 * `<placeholders>` are skipped): a span or link target matches a file or folder by exact repo path, or by basename
 * when that name is unique; a symbol-like span (snake_case or camelCase, no `/` or `.`) becomes a symbol with no file. A ref is dead
 * only when it has a `/`, matches nothing, its top-level folder exists and git does not ignore it (a link that leaves the vault
 * with `../` is resolved to the repo first); anything else unmatched is prose and dropped.
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
    (byBase.get(b) ?? byBase.set(b, []).get(b)!).push(f);
  }
  const vaultRel = relative(gitRoot, vaultDir).split(sep).join("/");

  const refs = new Map<string, CodeRef | undefined>(); // classified once per raw ref, shared by all docs
  const classify = (span: string): CodeRef | undefined => {
    if (GLOB.test(span)) return undefined; // `src/*.ts`, `<name>/SKILL.md`: cannot be checked
    const raw = span.replace(LOC, "").replace(/\/+$/, "");
    if (!raw) return undefined;
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

  for (const d of todo) for (const raw of d.codeRefs!) if (!refs.has(raw)) refs.set(raw, classify(raw));
  // a missing path git ignores is runtime state (`.claude/.semantic-memory/mode`, `.planning/`), not a dead reference
  const ignored = await gitIgnored(gitRoot, [...new Set([...refs.values()].filter((r) => r?.resolved === false).map((r) => r!.target))]);
  for (const [raw, r] of refs) if (r?.resolved === false && ignored.has(r.target)) refs.set(raw, undefined);

  const perDoc = new Map<string, CodeRef[]>();
  for (const d of todo) {
    const list: CodeRef[] = [];
    for (const raw of d.codeRefs!) {
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

/** A healthcheck warns when the export is more than this many commits behind HEAD (hewtd's incremental export costs ~1-2 s, so a few dozen commits is already worth a refresh). */
export const CODE_GRAPH_STALE_COMMITS = 20;

/** Files differing from `commit` in the working tree (committed, staged and unstaged), from ONE `git diff`; null when git cannot tell. */
async function changedSince(root: string, commit: string): Promise<Set<string> | null> {
  try {
    const { stdout } = await run("git", ["-C", root, "-c", "core.quotepath=off", "diff", "--name-only", "--no-renames", "-z", commit, "--"], { maxBuffer: 1 << 28, timeout: 60_000 });
    return new Set(stdout.split("\0").filter(Boolean));
  } catch {
    return null;
  }
}

/**
 * An export is a snapshot of `source_commit`: re-checks the file refs of files changed since it (all of them when git does not know the
 * commit) and every ref it recorded dead, against the live tree. Other refs keep the export's data, so an export at HEAD is untouched.
 * shortcut: the symbol table is not re-derived; refresh the export with `npx hewtd index` for that.
 */
async function patchStale(root: string, exp: CodeData): Promise<void> {
  const info = exp.export!;
  const commit = info.commit && /^[0-9a-f]{4,64}$/i.test(info.commit) ? info.commit : null; // never an option
  const changed = commit ? await changedSince(root, commit) : null;
  info.changed = changed ? changed.size : null;
  if (commit) {
    try { info.behind = Number((await run("git", ["-C", root, "rev-list", "--count", `${commit}..HEAD`], { timeout: 60_000 })).stdout.trim()); } catch { info.behind = null; }
    if (!Number.isFinite(info.behind)) info.behind = null;
  } else info.behind = null;

  const fileOf = (r: CodeRef) => (r.kind === "file" ? clean(r.file ?? r.target) : undefined);
  const dirty = (r: CodeRef) => { const f = fileOf(r); return !!f && (!changed || changed.has(f) || r.resolved === false); };
  const todo = [...exp.docs.values()].flatMap((d) => d.refs.filter(dirty));
  if (!todo.length) return;
  const dates = await gitLastChanged(root, [...new Set(todo.map(fileOf).filter((f): f is string => !!f && (!changed || changed.has(f))))]);
  for (const d of exp.docs.values()) {
    const patched: string[] = [];
    for (const r of d.refs) {
      if (!dirty(r)) continue;
      const f = fileOf(r)!;
      if (f.startsWith("..") || isAbsolute(f)) continue; // never check outside the repo
      const was = r.resolved;
      r.resolved = existsSync(join(root, f));
      if (!changed || changed.has(f)) {
        r.changed = r.resolved ? dates.get(f) ?? r.changed : undefined;
        patched.push(f);
      } else if (was !== r.resolved) patched.push(f);
    }
    if (patched.length) { d.source = "export+live"; d.patched = patched; }
  }
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
  if (!exp) return Object.assign(rest, { files: await gitFiles(root) });
  exp.files = await gitFiles(root);
  await patchStale(root, exp);
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
      const own = (t: string) => t === d.path || t.endsWith("/" + d.path); // a doc never counts itself
      const refs = c.refs.filter((r) => !own(r.file ?? r.target));
      const drift = isNaN(from) ? [] : refs.filter((r) => r.changed !== undefined && r.changed > from).map((r) => r.file ?? r.target);
      const dead = refs.filter((r) => r.kind === "file" && r.resolved === false).map((r) => r.target);
      const verdict = c.verdict && c.verdict !== "unreviewed" ? c.verdict : undefined;
      if (drift.length || dead.length || verdict) g = { source: c.source, ...(verdict && { verdict }), code_drift: dedupe(drift), dead_refs: dedupe(dead), ...(c.patched && { stale: true as const }) };
    }
    if (JSON.stringify(g) !== JSON.stringify(d.grounding)) {
      changed = true;
      if (g) d.grounding = g;
      else delete d.grounding;
    }
  }
  return changed;
}

/** Tracked files an identifier names: a repo path (exact or by suffix), or a file name with or without its extension. */
function locateFiles(term: string, files: string[] = [], loose = false): string[] {
  const t = term.replace(/^\.\//, "");
  if (t.includes("/")) return files.filter((f) => f === t || f.endsWith("/" + t));
  const flat = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
  return files.filter((f) => {
    const b = posix.basename(f);
    const base = b.replace(/\.[^.]*$/, "");
    return b === t || base === t || (loose && flat(base) === flat(t));
  });
}

/** Whether the code graph knows a name: a symbol some doc cites, or a tracked file's name (with or without its extension). */
export const knownToCode = (code: CodeData | null) => (term: string): boolean => !!code && (code.symbols.has(term) || locateFiles(term, code.files).length > 0);

const STALE_VERDICTS = new Set(["check", "stale", "archive-candidate"]);
export interface EntityCard {
  entity: string;
  kind: "symbol" | "file";
  path?: string;
  /** "defined in" only when hewtd marks the symbol's file a definition; otherwise it is the first file containing the name */
  location: "defined in" | "found in";
  cited_by: { path: string; title?: string; stale: boolean }[];
}

/**
 * The card for the first identifier of `query` that names a symbol or a unique file in the code, with up to 5 citing docs
 * (fresh first, then by search score). Reuses #57's identifiers(), so a card and `missing_terms` read the same tokens.
 */
export function entityCard(
  query: string, code: CodeData | null, docs: Map<string, { title?: string; grounding?: Grounding }>, score: (path: string) => number,
): EntityCard | undefined {
  if (!code) return undefined;
  for (const term of identifiers(query, knownToCode(code))) {
    let card: Omit<EntityCard, "cited_by"> | undefined;
    let citers: string[] = [];
    const sym = code.symbols.get(term);
    if (sym) {
      card = { entity: term, kind: "symbol", path: sym.file, location: sym.fileKind === "definition" ? "defined in" : "found in" };
      citers = sym.citedBy;
    } else {
      const hit = locateFiles(term, code.files);
      if (hit.length !== 1) continue;
      card = { entity: term, kind: "file", path: hit[0], location: "found in" };
      citers = [...code.docs].filter(([, d]) => d.refs.some((r) => r.file === hit[0] || r.target === hit[0])).map(([p]) => p);
    }
    const stale = (p: string) => {
      const g = docs.get(p)?.grounding;
      return !!g && (g.dead_refs.length > 0 || STALE_VERDICTS.has(g.verdict ?? ""));
    };
    const cited_by = citers.filter((p) => docs.has(p))
      .sort((a, b) => Number(stale(a)) - Number(stale(b)) || score(b) - score(a) || a.localeCompare(b))
      .slice(0, 5).map((path) => ({ path, title: docs.get(path)?.title, stale: stale(path) }));
    return { ...card, cited_by };
  }
  return undefined;
}

/** Splits `missing` (identifiers no doc contains): those that exist in the code are undocumented, the rest stay missing. */
export function splitUndocumented(missing: string[], code: CodeData | null): { missing: string[]; undocumented: { entity: string; path: string }[] } {
  const undocumented: { entity: string; path: string }[] = [];
  const still = missing.filter((term) => {
    const path = locateFiles(term, code?.files, true)[0]; // a spelling variant of a file name is still that file
    if (!path) return true;
    undocumented.push({ entity: term, path });
    return false;
  });
  return { missing: still, undocumented };
}
