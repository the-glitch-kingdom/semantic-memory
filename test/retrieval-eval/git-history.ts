import { execFileSync } from "node:child_process";
import { utimesSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glob } from "glob";

const DAY_MS = 86_400_000;

/**
 * Give a temp vault (never this repo) a git history with backdated commits, so the decay `git` mode can be measured: one commit per
 * distinct age, dated `age` days ago via GIT_AUTHOR_DATE/GIT_COMMITTER_DATE. Files missing from `ages` get `defaultAge`, which keeps the
 * existing splits' ranking unchanged when decay falls back to git. File mtimes are set to the same age (the `mtime` mode).
 */
export async function gitHistory(dir: string, ages: Record<string, number> = {}, defaultAge = 10): Promise<void> {
  const files = await glob("**/*.md", { cwd: dir });
  const byAge = new Map<number, string[]>();
  for (const f of files) byAge.set(ages[f] ?? defaultAge, [...(byAge.get(ages[f] ?? defaultAge) ?? []), f]);
  const git = (args: string[], date?: string) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
  git(["init", "-q"]);
  git(["config", "user.email", "eval@example.invalid"]);
  git(["config", "user.name", "eval"]);
  // oldest first, so the log reads like a real history
  for (const [age, fs] of [...byAge].sort((a, b) => b[0] - a[0])) {
    const when = new Date(Date.now() - age * DAY_MS);
    for (const f of fs) utimesSync(join(dir, f), when, when);
    git(["add", "--", ...fs]);
    git(["commit", "-q", "-m", `docs ${age}d ago`], when.toISOString());
  }
}

/** Replace `{{ago:N}}` tokens in every fixture file with the ISO date N days ago, so relative `last_verified` values never drift. */
export async function stampDates(dir: string): Promise<void> {
  for (const f of await glob("**/*.md", { cwd: dir })) {
    const p = join(dir, f);
    const s = readFileSync(p, "utf-8");
    const out = s.replace(/\{\{ago:(\d+)\}\}/g, (_, n) => new Date(Date.now() - Number(n) * DAY_MS).toISOString().slice(0, 10));
    if (out !== s) writeFileSync(p, out);
  }
}
