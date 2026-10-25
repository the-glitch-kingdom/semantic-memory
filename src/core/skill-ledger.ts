/**
 * The skill loop's ledger (v1.7): every change the loop or a person makes to a learned skill — land, patch,
 * stale, archive, restore, promote, merge, reject — as one line with who, why, and each file's bytes before
 * and after (stored once by sha256 in skill-ledger-blobs/). That is what makes a single change reversible:
 * `rollback <id>` puts every file it touched back exactly as it was. Nothing is lost: a file the loop removes
 * (an archive moves a skill out of .claude/skills/) keeps its bytes in the blob store first.
 */
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stateDir } from "./skill-evidence.js";

export type LedgerAction = "land" | "patch" | "stale" | "archive" | "restore" | "promote" | "merge" | "reject" | "rollback";

export interface FileChange {
  path: string;
  /** sha256 of the bytes before (null: the file did not exist) */
  before: string | null;
  after: string | null;
}

export interface LedgerEntry {
  id: string;
  ts: string;
  action: LedgerAction;
  actor: "user" | "curator" | "reviewer";
  skill: string;
  why: string;
  files: FileChange[];
  /** rollback: the entry it reversed */
  reverts?: string;
}

export const ledgerPath = (repo: string) => join(stateDir(repo), "skill-ledger.jsonl");
const blobDir = (repo: string) => join(stateDir(repo), "skill-ledger-blobs");
export const archiveDir = (repo: string) => join(stateDir(repo), "skills-archive");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function putBlob(repo: string, bytes: Buffer): string {
  const h = sha256(bytes);
  const p = join(blobDir(repo), h);
  if (!existsSync(p)) {
    mkdirSync(blobDir(repo), { recursive: true });
    writeFileSync(p, bytes);
  }
  return h;
}

const snapshot = (repo: string, path: string): string | null => (existsSync(path) ? putBlob(repo, readFileSync(path)) : null);

/**
 * Apply file writes and removals as one ledgered change. `ops`: write `content` to `path`; null content removes
 * the file (its bytes are in the blob store already, so rollback restores them) and its folder if now empty.
 */
export function applyChange(
  repo: string,
  meta: { action: LedgerAction; actor: LedgerEntry["actor"]; skill: string; why: string; reverts?: string },
  ops: { path: string; content: string | Buffer | null }[],
): LedgerEntry {
  const files: FileChange[] = [];
  for (const op of ops) {
    const before = snapshot(repo, op.path);
    if (op.content === null) {
      if (before) {
        unlinkSync(op.path);
        try {
          rmdirSync(dirname(op.path)); // only when empty: a skill folder with nothing left would still be listed
        } catch {}
      }
    } else {
      mkdirSync(dirname(op.path), { recursive: true });
      writeFileSync(op.path, op.content);
    }
    files.push({ path: op.path, before, after: snapshot(repo, op.path) });
  }
  const entry: LedgerEntry = { id: `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, ts: new Date().toISOString(), ...meta, files };
  mkdirSync(stateDir(repo), { recursive: true });
  appendFileSync(ledgerPath(repo), JSON.stringify(entry) + "\n");
  return entry;
}

export function readLedger(repo: string): LedgerEntry[] {
  try {
    return readFileSync(ledgerPath(repo), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Undo one entry: every file it touched goes back to its exact bytes before (or aside, if it did not exist). */
export function rollback(repo: string, id: string): LedgerEntry {
  const entry = readLedger(repo).find((e) => e.id === id);
  if (!entry) throw new Error(`no ledger entry ${id}`);
  for (const f of entry.files) {
    const now = existsSync(f.path) ? sha256(readFileSync(f.path)) : null;
    if (now !== f.after) throw new Error(`${f.path} changed since ${id}: roll back the later change first`);
  }
  const ops = entry.files.map((f) => ({ path: f.path, content: f.before ? readFileSync(join(blobDir(repo), f.before)) : null }));
  return applyChange(repo, { action: "rollback", actor: "user", skill: entry.skill, why: `rollback of ${entry.action} ${id}`, reverts: id }, ops);
}
