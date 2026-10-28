import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runHealthcheck, formatDriftBanner, filterToDrift } from "../../src/core/healthcheck.js";

async function seedProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "healthcheck-"));
}

describe("runHealthcheck — fast tier", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await seedProject();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("clean install (nothing in place) produces no drift findings", async () => {
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    expect(r.tier_run).toBe("fast");
    expect(filterToDrift(r)).toEqual([]);
    expect(r.counts.warn).toBe(0);
    expect(r.counts.error).toBe(0);
  });

  it("budget: fast tier completes in <500ms even with most checks present", async () => {
    // Seed many present-but-clean files
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ command: "echo" }] }],
        UserPromptSubmit: [{ hooks: [{ command: "echo" }] }],
        Stop: [{ hooks: [{ command: "echo" }] }],
      },
    }), "utf-8");
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({
      mcpServers: { "semantic-vault": { command: "node", args: [] } },
    }), "utf-8");
    await writeFile(join(dir, "AGENTS.md"), "<!-- semantic-memory:begin contract -->\n<!-- semantic-memory:end contract -->\n", "utf-8");

    const start = Date.now();
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(r.tier_run).toBe("fast");
    expect(filterToDrift(r)).toEqual([]);
  });

  it("flags missing semantic-* entry in .mcp.json as warn", async () => {
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({
      mcpServers: { "some-other-server": { command: "node", args: [] } },
    }), "utf-8");
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    const drift = filterToDrift(r);
    expect(drift.some((d) => d.check === "mcp_json_entry" && d.severity === "warn")).toBe(true);
    expect(drift.find((d) => d.check === "mcp_json_entry")?.fixable_via).toBe("mcp-reconcile");
  });

  it("accepts any semantic-* server name, e.g. semantic-memory-docs (v1.7.2)", async () => {
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({
      mcpServers: { "semantic-memory-docs": { command: "node", args: ["x.mjs", "--notes", "./.documentation", "--read-only"] } },
    }), "utf-8");
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    expect(filterToDrift(r).some((d) => d.check === "mcp_json_entry")).toBe(false);
  });

  it("flags hook registration missing one or more required events", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "settings.json"), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ command: "x" }] }] }, // missing UserPromptSubmit + Stop
    }), "utf-8");
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    const drift = filterToDrift(r);
    const fnd = drift.find((d) => d.check === "hook_registration");
    expect(fnd?.severity).toBe("warn");
    expect(fnd?.summary).toMatch(/UserPromptSubmit/);
    expect(fnd?.summary).toMatch(/Stop/);
  });

  it("flags AGENTS.md present but without managed-block markers", async () => {
    await writeFile(join(dir, "AGENTS.md"), "# Hand-rolled, no markers\n", "utf-8");
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    const drift = filterToDrift(r);
    expect(drift.some((d) => d.check === "agents_contract")).toBe(true);
  });

  it("flags stale session (last_activity_at > 24h ago)", async () => {
    const sessDir = join(dir, ".claude", ".semantic-memory");
    await mkdir(sessDir, { recursive: true });
    const oldTime = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    await writeFile(join(sessDir, "session.json"), JSON.stringify({
      id: "ses_old", task: "x", started_at: oldTime, last_activity_at: oldTime,
      verifications: [], notes_touched: [],
    }), "utf-8");
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    const drift = filterToDrift(r);
    expect(drift.some((d) => d.check === "session_staleness")).toBe(true);
  });

  it("does not flag a closed session", async () => {
    const sessDir = join(dir, ".claude", ".semantic-memory");
    await mkdir(sessDir, { recursive: true });
    const oldTime = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    await writeFile(join(sessDir, "session.json"), JSON.stringify({
      id: "ses_closed", task: "x", started_at: oldTime, last_activity_at: oldTime,
      verifications: [], notes_touched: [], closed_at: oldTime,
    }), "utf-8");
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    const drift = filterToDrift(r);
    expect(drift.some((d) => d.check === "session_staleness")).toBe(false);
  });

  it("flags no-index-built when vaultPath has no index/meta.json", async () => {
    const vault = join(dir, ".claude", ".vault");
    await mkdir(vault, { recursive: true });
    const r = await runHealthcheck({ projectRoot: dir, vaultPath: vault, tier: "fast", force: true });
    const drift = filterToDrift(r);
    expect(drift.some((d) => d.check === "index_freshness")).toBe(true);
    expect(drift.find((d) => d.check === "index_freshness")?.fixable_via).toBe("reindex");
  });

  it("does NOT flag legacy_state_files on a clean install", async () => {
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    const legacy = r.findings.find((f) => f.check === "legacy_state_files");
    expect(legacy?.severity).toBe("ok");
  });

  it("flags legacy_state_files when .claude/.sidekick-* exist", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", ".sidekick-mode"), "research", "utf-8");
    await writeFile(join(dir, ".claude", ".sidekick-fingerprints.json"), '{"recent":[]}', "utf-8");
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    const drift = filterToDrift(r);
    const fnd = drift.find((d) => d.check === "legacy_state_files");
    expect(fnd?.severity).toBe("warn");
    expect(fnd?.summary).toMatch(/2 legacy state files/);
    expect(fnd?.detail).toMatch(/migrate-state/);
  });
});

describe("runHealthcheck — caching", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await seedProject();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns cached result when within TTL and tier matches", async () => {
    const a = await runHealthcheck({ projectRoot: dir, tier: "fast", force: false });
    expect(a.cached).toBeUndefined();
    const b = await runHealthcheck({ projectRoot: dir, tier: "fast", force: false });
    expect(b.cached).toBe(true);
    expect(b.findings).toEqual(a.findings);
  });

  it("force=true bypasses the cache", async () => {
    await runHealthcheck({ projectRoot: dir, tier: "fast", force: false });
    const r = await runHealthcheck({ projectRoot: dir, tier: "fast", force: true });
    expect(r.cached).toBeUndefined();
  });
});

describe("formatDriftBanner", () => {
  it("returns empty string when no drift", () => {
    const banner = formatDriftBanner({
      tier_run: "fast",
      ran_at: new Date().toISOString(),
      duration_ms: 5,
      findings: [{ check: "mcp_json_entry", severity: "ok", summary: "ok" }],
      counts: { ok: 1, warn: 0, error: 0 },
    });
    expect(banner).toBe("");
  });

  it("renders a vault-drift block when drift findings exist", () => {
    const banner = formatDriftBanner({
      tier_run: "fast",
      ran_at: new Date().toISOString(),
      duration_ms: 5,
      findings: [
        { check: "mcp_json_entry", severity: "warn", summary: "missing entry" },
        { check: "hook_registration", severity: "warn", summary: "missing Stop" },
      ],
      counts: { ok: 0, warn: 2, error: 0 },
    });
    expect(banner).toContain("vault-drift");
    expect(banner).toContain("mcp_json_entry");
    expect(banner).toContain("hook_registration");
    expect(banner).toContain("/healthcheck");
  });
});
