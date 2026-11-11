import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GEN_A, GEN_B, checksumOf, makeProject, type Project } from "../long-term-fixture.js";

// #93 Phase 7 acceptance: the SessionStart opt-in notice, run as a process with a temp project root.
// The hook file is hooks/cold-notice.js (beside skill-loop.js); `it.fails` = it does not exist yet.

const HOOK = resolve(import.meta.dirname, "..", "..", "hooks", "cold-notice.js");

function run(p: Project, source = "startup", env: Record<string, string> = {}) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart", source, cwd: p.root }),
    encoding: "utf8",
    cwd: p.root,
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`cold-notice exited ${r.status}: ${r.stderr}`);
  const out = r.stdout.trim() ? JSON.parse(r.stdout) : undefined;
  return { raw: r.stdout, systemMessage: out?.systemMessage as string | undefined, ctx: out?.hookSpecificOutput?.additionalContext as string | undefined, out };
}

let p: Project | undefined;
beforeEach(() => void (p = undefined));
afterEach(() => p?.cleanup());
const mk = async (o: Parameters<typeof makeProject>[0] = {}) => (p = await makeProject(o));
const seen = (pr: Project) => join(pr.root, ".claude", ".semantic-memory", "cold-notified.json");

describe("SessionStart cold-generation notice", () => {
  it.fails("without a cold folder: no output at all, byte-identical to today", async () => {
    const pr = await mk({ cold: false });
    expect(run(pr).raw).toBe("");
  });

  it.fails("with registered generations: systemMessage names them, says NOT searched by default and how to opt in; one additionalContext line", async () => {
    const pr = await mk();
    const r = run(pr);
    expect(r.out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    for (const needle of [GEN_A, GEN_B, ".documentation-cold", "NOT searched by default", "search long-term memory for", 'sources: ["long-term"]', "--source long-term"]) {
      expect(r.systemMessage, needle).toContain(needle);
    }
    expect(r.ctx?.split("\n").length).toBe(1);
    expect(r.ctx).toMatch(/long-term memory/i);
  });

  it.fails("honours reconcile.cold_root", async () => {
    const pr = await mk({ coldRoot: "history/cold" });
    expect(run(pr).systemMessage).toContain(GEN_A);
  });

  it.fails("frequency: systemMessage once per new generation (cold-notified.json); additionalContext on every startup/resume, never on clear/compact", async () => {
    const pr = await mk();
    expect(run(pr).systemMessage).toBeTruthy();
    expect(JSON.parse(readFileSync(seen(pr), "utf-8"))).toBeTruthy();
    const again = run(pr, "resume");
    expect(again.systemMessage).toBeUndefined();
    expect(again.ctx).toMatch(/long-term memory/i);
    expect(run(pr, "clear").raw).toBe("");
    expect(run(pr, "compact").raw).toBe("");
    // a new registered generation is announced once, and only that one
    const cfgPath = join(pr.root, ".claude", "hit-em-with-the-docs.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    const extra = { ...cfg.cold_storage[0], generation: "2026-05-05", path: ".documentation-cold/2026-05-05" };
    await cp(join(pr.coldRoot, GEN_A), join(pr.coldRoot, "2026-05-05"), { recursive: true });
    extra.checksum = checksumOf(join(pr.coldRoot, "2026-05-05"));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, cold_storage: [...cfg.cold_storage, extra] }));
    const next = run(pr);
    expect(next.systemMessage).toContain("2026-05-05");
    expect(next.systemMessage).not.toContain(GEN_B);
  });

  it.fails("an unreadable cold-notified.json shows the notice again and never crashes", async () => {
    const pr = await mk();
    mkdirSync(join(pr.root, ".claude", ".semantic-memory"), { recursive: true });
    writeFileSync(seen(pr), "{ not json");
    expect(run(pr).systemMessage).toContain(GEN_A);
    mkdirSync(seen(pr), { recursive: true }); // a directory where the file should be
    expect(run(pr, "startup").systemMessage).toContain(GEN_A);
  });

  it.fails("a generation on disk that is not in the manifest is NOT searchable, and says why, on every startup", async () => {
    const pr = await mk({ manifest: false });
    for (let i = 0; i < 2; i++) {
      const m = run(pr).systemMessage!;
      expect(m).toContain(GEN_A);
      expect(m).toMatch(/not registered/i);
      expect(m).toMatch(/not searchable/i);
    }
  });

  it.fails("the hewtd config missing while .documentation-cold/ exists: unregistered, not searchable", async () => {
    const pr = await mk();
    const { rm } = await import("node:fs/promises");
    await rm(join(pr.root, ".claude", "hit-em-with-the-docs.json"));
    expect(run(pr).systemMessage).toMatch(/not registered[\s\S]*not searchable|not searchable[\s\S]*not registered/i);
  });

  it.fails("a checksum mismatch names that generation as NOT searchable; the matching one is not flagged", async () => {
    const pr = await mk({ badChecksum: GEN_B });
    const m = run(pr).systemMessage!;
    expect(m).toMatch(new RegExp(`${GEN_B}[^\\n]*(checksum)[^\\n]*not searchable|not searchable[^\\n]*${GEN_B}`, "i"));
    expect(m).not.toMatch(new RegExp(`${GEN_A}[^\\n]*not searchable`, "i"));
  });

  it.fails("federation.cold_storage: false: generations are NOT searchable, and the notice says it is disabled", async () => {
    const pr = await mk({ federation: "  related_repos: false\n  cold_storage: false\n" });
    await writeFile(join(pr.root, ".mcp.json"), JSON.stringify({ mcpServers: { "semantic-memory-docs": { command: "node", args: ["x", "--notes", "./.documentation", "--read-only"] } } }));
    expect(run(pr).systemMessage).toMatch(/disabled|cold_storage: false/i);
  });

  it.fails("a reconcile.cold_root inside the docs root is refused with a notice", async () => {
    const pr = await mk({ coldRoot: ".documentation/cold" });
    expect(run(pr).systemMessage).toMatch(/inside the docs/i);
  });

  it.fails("is silent under SEMANTIC_MEMORY_REVIEWER=1", async () => {
    const pr = await mk();
    expect(run(pr, "startup", { SEMANTIC_MEMORY_REVIEWER: "1" }).raw).toBe("");
  });
});
