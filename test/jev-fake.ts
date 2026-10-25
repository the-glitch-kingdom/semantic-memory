import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A stand-in for jev-loop's router.py (CI has no jev-loop): answers 0.97 to a question containing "yes",
// 0.02 otherwise (0.5 for "maybe"), logs every call to calls.jsonl; a "mode" file makes it answer yes / no / maybe to
// everything, fail (raise, budget) or hang (sleep).
export const FAKE_ROUTER = `
import json, os, sys
from pathlib import Path
HERE = Path(__file__).parent
LOGS = HERE / "logs"
R = {"max_prompt_chars": 2000, "timeout_seconds": 10}
CALLER = os.environ.get("JEV_CALLER") or Path(sys.argv[0]).stem
def repo_for(cwd, repos):
    return "excluded" if "kentro" in str(cwd) else None
def ask_all(state, items):
    (HERE / "calls.jsonl").open("a").write(json.dumps({"caller": CALLER, "state": state, "items": items, "timeout": R["timeout_seconds"]}) + "\\n")
    mode = (HERE / "mode").read_text().strip() if (HERE / "mode").exists() else "ok"
    if mode == "raise":
        raise RuntimeError("HTTP Error 503")
    if mode == "budget":
        raise RuntimeError("jev budget reached: 5,000,000 of 5,000,000 batch tokens today")
    if mode in ("yes", "no", "maybe"):
        return {k: {"yes": 0.97, "no": 0.02, "maybe": 0.5}[mode] for k, _ in items}, 42
    if mode == "sleep":
        import time; time.sleep(30)
    return {k: (0.97 if "yes" in q else 0.5 if "maybe" in q else 0.02) for k, q in items}, 42
def flush_ledger():
    pass
`;

/** A temp JEV_LOOP_DIR holding the fake router, and an env that points the bridge at it. */
export async function fakeJevLoop(): Promise<{ dir: string; env: NodeJS.ProcessEnv }> {
  const dir = await mkdtemp(join(tmpdir(), "sm-jev-fake-"));
  await writeFile(join(dir, "router.py"), FAKE_ROUTER);
  await mkdir(join(dir, "logs"));
  return { dir, env: { PATH: process.env.PATH, HOME: dir, JEV_LOOP_DIR: dir, TYPESAFE_API_KEY: "fake" } };
}
