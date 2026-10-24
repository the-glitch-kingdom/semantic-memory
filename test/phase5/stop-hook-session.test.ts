import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const HOOK = join(ROOT, "hooks", "vault-context.js");

function runHook(cwd: string, input: object) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    cwd,
    env: { ...process.env },
    timeout: 30_000,
  });
  return { stdout: r.stdout, stderr: r.stderr, out: r.stdout ? JSON.parse(r.stdout) : null };
}

async function seedProject() {
  const dir = await mkdtemp(join(tmpdir(), "stop-session-hook-"));
  await mkdir(join(dir, ".claude", ".vault"), { recursive: true });
  return dir;
}

async function writeSession(projectRoot: string, partial: Partial<{
  id: string;
  task: string;
  verifications: any[];
  closed_at: string;
}>) {
  const dir = join(projectRoot, ".claude", ".semantic-memory");
  await mkdir(dir, { recursive: true });
  const state = {
    id: partial.id ?? "ses_test",
    task: partial.task ?? "test-task",
    started_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    verifications: partial.verifications ?? [],
    notes_touched: [],
    ...(partial.closed_at && { closed_at: partial.closed_at }),
  };
  await writeFile(join(dir, "session.json"), JSON.stringify(state), "utf-8");
}

describe("Stop hook: session-active branch (Phase 5)", () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await seedProject();
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("session WITHOUT verifications: prompts the agent to run session_run or waive with reason", async () => {
    await writeSession(projectRoot, { id: "ses_zero", task: "tighten auth", verifications: [] });
    const r = runHook(projectRoot, { hook_event_name: "Stop" });
    const out = r.stdout;
    expect(out).toContain("vault-session-close");
    expect(out).toContain("ses_zero");
    expect(out).toContain("tighten auth");
    expect(out).toContain("session_run");
    expect(out).toContain("session_finish");
    expect(out).toContain("verified: false");
  });

  it("session WITH verifications: prompts the agent to call session_finish, no waiver mention", async () => {
    await writeSession(projectRoot, {
      id: "ses_one",
      task: "auth flow",
      verifications: [
        { cmd: "npm test", exit: 0, signal: null, duration_ms: 1234, tail: "ok", at: new Date().toISOString() },
      ],
    });
    const r = runHook(projectRoot, { hook_event_name: "Stop" });
    expect(r.stdout).toContain("vault-session-close");
    expect(r.stdout).toContain("Recent verifications");
    expect(r.stdout).toContain("npm test");
    expect(r.stdout).toContain("exit=0");
    expect(r.stdout).toContain("session_finish");
    expect(r.stdout).not.toContain("verified: false");
  });

  it("session-aware branch precedes mode-specific capture (vault-first)", async () => {
    // Mode is implicitly vault-first when .claude/.sidekick-mode is absent
    await writeSession(projectRoot, { id: "ses_test", task: "x", verifications: [{ cmd: "echo", exit: 0, signal: null, duration_ms: 10, tail: "", at: new Date().toISOString() }] });
    const r = runHook(projectRoot, { hook_event_name: "Stop" });
    expect(r.stdout).toContain("vault-session-close");
    // Should NOT emit the generic capture-pending block when session is active
    expect(r.stdout).not.toContain("vault-capture-prompt");
  });

  it("CLOSED session (closed_at set) is treated as no session — falls through to default behavior", async () => {
    await writeSession(projectRoot, {
      id: "ses_closed",
      task: "x",
      verifications: [],
      closed_at: new Date().toISOString(),
    });
    const r = runHook(projectRoot, { hook_event_name: "Stop" });
    // Closed session should not trigger the session-close prompt
    expect(r.stdout).not.toContain("vault-session-close");
  });

  it("NO session present: Stop hook output is byte-identical to a project without .claude/.semantic-memory/", async () => {
    const r = runHook(projectRoot, { hook_event_name: "Stop" });
    const out = JSON.parse(r.stdout);
    // Stop hook with no session and no pending captures emits an empty payload.
    // The exact shape: no hookSpecificOutput key, just an empty object,
    // OR a payload without additionalContext. Either way, no session prompt.
    const stringified = JSON.stringify(out);
    expect(stringified).not.toContain("vault-session-close");
  });
});

// Issue #29: capture-pending.json is per project, so a cue typed in one session showed up in a
// different concurrent session's Stop prompt. Items are now keyed by session_id.
describe("Stop hook: capture-pending is per session", () => {
  let projectRoot: string;
  const pendingFile = () => join(projectRoot, ".claude", ".semantic-memory", "capture-pending.json");
  const prompt = (session_id: string, text: string) =>
    runHook(projectRoot, { hook_event_name: "UserPromptSubmit", cwd: projectRoot, session_id, prompt: text });
  const stop = (session_id?: string) =>
    runHook(projectRoot, { hook_event_name: "Stop", cwd: projectRoot, ...(session_id ? { session_id } : {}) }).stdout;

  beforeEach(async () => {
    projectRoot = await seedProject();
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("a cue from session A is asked about only at A's Stop", async () => {
    prompt("sess-A", "the fix was to quote the purpose field in frontmatter");
    expect(stop("sess-B")).not.toContain("vault-capture-prompt");
    const a = stop("sess-A");
    expect(a).toContain("vault-capture-prompt");
    expect(a).toContain("quote the purpose field");
    expect(stop("sess-A")).not.toContain("vault-capture-prompt"); // cleared after asking
  });

  it("another session starting does not clear A's pending items", async () => {
    prompt("sess-A", "we decided to search every notes path");
    runHook(projectRoot, { hook_event_name: "SessionStart", cwd: projectRoot, session_id: "sess-B", source: "startup" });
    expect(stop("sess-A")).toContain("search every notes path");
  });

  it("a legacy item without session_id is handled once, by whichever session stops first", async () => {
    await mkdir(join(projectRoot, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(
      pendingFile(),
      JSON.stringify({ items: [{ ts: new Date().toISOString(), cue: "because", excerpt: "legacy pending item" }] })
    );
    expect(stop("sess-A")).toContain("legacy pending item");
    expect(stop("sess-B")).not.toContain("legacy pending item");
  });

  it("a Stop without session_id still sees every item (old behavior)", async () => {
    prompt("sess-A", "the bug was a shared state file");
    expect(stop()).toContain("a shared state file");
  });

  it("prunes other sessions' items older than a week", async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await mkdir(join(projectRoot, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(
      pendingFile(),
      JSON.stringify({ items: [{ ts: old, cue: "because", excerpt: "dead session item", session_id: "sess-dead" }] })
    );
    prompt("sess-A", "the fix was pruning old items");
    stop("sess-A");
    const left = JSON.parse(await readFile(pendingFile(), "utf8")).items;
    expect(left).toEqual([]);
  });
});
