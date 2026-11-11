import { createHash } from "node:crypto";
import { chmodSync, readdirSync, readFileSync, lstatSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXTURES = join(import.meta.dirname, "fixtures");
export const GEN_A = "2026-01-15";
export const GEN_B = "2026-03-01-2";
/** Assembled at run time so no credential-shaped literal is ever committed. */
export const FAKE_SECRET = ["sk", "live", "Zq7Xv3Lm9Rt2Kp8Wd4Hn6Yb1Cs5Ga0"].join("_");

/**
 * The checksum definition from the plan (Phase 4): sha256 over the sorted `relpath\0sha256(file)\n` lines of every
 * regular file, symlinks not followed. Written out here so the fixtures do not depend on src/ code that does not exist yet.
 */
export function checksumOf(dir: string): string {
  const lines: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) lines.push(`${r}\0${createHash("sha256").update(readFileSync(join(dir, r))).digest("hex")}\n`);
    }
  };
  walk("");
  return createHash("sha256").update(lines.sort().join("")).digest("hex");
}

export function lockTree(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) lockTree(join(dir, e.name));
    else chmodSync(join(dir, e.name), 0o444);
  }
  chmodSync(dir, 0o555);
}

export function unlockTree(dir: string): void {
  chmodSync(dir, 0o755);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) unlockTree(join(dir, e.name));
    else if (!lstatSync(join(dir, e.name)).isSymbolicLink()) chmodSync(join(dir, e.name), 0o644);
  }
}

export interface Project {
  root: string;
  /** the primary docs tree, a copy of docs-vault */
  docs: string;
  /** an ordinary (non-cold) tree to register as a source, a copy of the `vault` fixture */
  legacy: string;
  coldRoot: string;
  /** primary index dir; opt-in indexes go under `<index>/sources/` */
  index: string;
  cleanup(): Promise<void>;
}

export interface ProjectOptions {
  /** extra lines under `federation:` in the primary's vault.schema.yml */
  federation?: string;
  /** write the cold generations and the manifest (default true) */
  cold?: boolean;
  /** cold root folder, repo-relative (default .documentation-cold) */
  coldRoot?: string;
  /** write the manifest, so the generations on disk are unregistered when false (default true) */
  manifest?: boolean;
  /** generation whose manifest checksum is made wrong */
  badChecksum?: string;
  /** chmod -R a-w the generations, as hit-em-with-the-docs leaves them (default true) */
  lock?: boolean;
}

/** A temp repo: `.documentation` (primary), `legacy-docs`, `.documentation-cold/<gen>` and `.claude/hit-em-with-the-docs.json`. */
export async function makeProject(o: ProjectOptions = {}): Promise<Project> {
  const root = await mkdtemp(join(tmpdir(), "lt-"));
  const docs = join(root, ".documentation");
  const legacy = join(root, "legacy-docs");
  const coldRoot = join(root, o.coldRoot ?? ".documentation-cold");
  await mkdir(join(root, ".git"));
  await cp(join(FIXTURES, "docs-vault"), docs, { recursive: true });
  await cp(join(FIXTURES, "vault"), legacy, { recursive: true });
  await writeFile(join(docs, "vault.schema.yml"), `federation:\n${o.federation ?? "  related_repos: false\n"}`);
  if (o.cold !== false) {
    const cfg = JSON.parse(await readFile(join(FIXTURES, "long-term", "hewtd-config.json"), "utf-8"));
    for (const [src, gen] of [["cold-a", GEN_A], ["cold-b", GEN_B]]) {
      const dest = join(coldRoot, gen);
      await cp(join(FIXTURES, "long-term", src), dest, { recursive: true });
      const secret = join(dest, "operational", "deploy-credentials.md");
      await readFile(secret, "utf-8").then((t) => writeFile(secret, t.replace("__FAKE_SECRET__", FAKE_SECRET)), () => {});
      const e = cfg.cold_storage.find((c: any) => c.generation === gen);
      e.path = `${o.coldRoot ?? ".documentation-cold"}/${gen}`;
      e.checksum = o.badChecksum === gen ? "0".repeat(64) : checksumOf(dest);
      if (o.lock !== false) lockTree(dest);
    }
    if (o.coldRoot) cfg.reconcile.cold_root = o.coldRoot;
    if (o.manifest === false) delete cfg.cold_storage;
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "hit-em-with-the-docs.json"), JSON.stringify(cfg, null, 2));
  }
  return {
    root, docs, legacy, coldRoot, index: join(docs, ".semantic-sidekick-index"),
    async cleanup() {
      await readdir(coldRoot).then(() => unlockTree(coldRoot), () => {});
      const { cleanupTempDir } = await import("./setup.js");
      await cleanupTempDir(root);
    },
  };
}

/** Numbers within 1e-4 (batched ONNX output is not bit-exact across CPUs), everything else exactly equal. */
export function sameJson(got: unknown, want: unknown, at: string): string | undefined {
  if (typeof want === "number" && typeof got === "number") return Math.abs(got - want) < 1e-4 ? undefined : `${at}: ${got} != ${want}`;
  if (Array.isArray(want) || (want && typeof want === "object")) {
    if (!got || typeof got !== "object") return `${at}: not an object`;
    if (JSON.stringify(Object.keys(got)) !== JSON.stringify(Object.keys(want as object))) return `${at}: keys ${Object.keys(got)} != ${Object.keys(want as object)}`;
    for (const k of Object.keys(want as object)) {
      const d = sameJson((got as any)[k], (want as any)[k], `${at}.${k}`);
      if (d) return d;
    }
    return undefined;
  }
  return got === want ? undefined : `${at}: ${got} != ${want}`;
}

/** The text of every file under dir (binary vectors read as latin1), for "the secret is nowhere on disk". */
export function allFileText(dir: string): string {
  let out = "";
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.isFile()) out += readFileSync(join(d, e.name)).toString("latin1");
    }
  };
  try { walk(dir); } catch { /* no dir: no text */ }
  return out;
}

