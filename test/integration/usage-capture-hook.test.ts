import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// v1.15: the real PostToolUse hook process on the live-captured payloads (test/fixtures/usage-capture).
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const HOOK = join(ROOT, "hooks", "usage-capture.js");
const FIX = join(ROOT, "test", "fixtures", "usage-capture");

describe("usage-capture hook process", () => {
  let repo: string;
  const fixture = async (name: string, session = "s1") =>
    JSON.parse((await readFile(join(FIX, `${name}.json`), "utf8")).replaceAll("/home/user/proj", repo)) as any & { session_id: string } && {
      ...JSON.parse((await readFile(join(FIX, `${name}.json`), "utf8")).replaceAll("/home/user/proj", repo)),
      session_id: session,
    };
  const run = (input: object, env: Record<string, string> = {}) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, SEMANTIC_MEMORY_USAGE_CAPTURE: "", SEMANTIC_MEMORY_REVIEWER: "", ...env } });
    return { status: r.status, out: r.stdout, ms: Date.now() - t0 };
  };
  const events = async () => {
    try {
      return (await readFile(join(repo, ".claude", ".semantic-memory", "usage.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-usage-hook-"));
    await mkdir(join(repo, ".documentation", "operational"), { recursive: true });
    await writeFile(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { "semantic-docs": { command: "node", args: ["x", "--notes", "./.documentation", "--read-only"] } } }));
  });
  afterEach(() => rm(repo, { recursive: true, force: true }));

  it("records a search, then the read_note and the fallback grep that follow it", async () => {
    expect(run(await fixture("mcp-search_hybrid")).status).toBe(0);
    expect(run(await fixture("mcp-read_note")).status).toBe(0);
    expect(run(await fixture("Bash")).status).toBe(0);
    const [search, use, fall] = await events();
    expect(search).toMatchObject({ type: "search", server: "semantic-docs", tool: "search_hybrid", query: "rotate api keys" });
    expect(search.results[0]).toBe("operational/rotating-api-keys.md");
    expect(use).toMatchObject({ type: "use", search: search.id, path: "operational/rotating-api-keys.md", rank: 1, via: "read_note" });
    expect(fall).toMatchObject({ type: "fallback", search: search.id, via: "grep", scope: "vault" });
  });

  it("maps a Read of a vault .md to a vault-relative path, rank null when not in results", async () => {
    run(await fixture("mcp-search_hybrid"));
    run(await fixture("Read"));
    expect((await events())[1]).toMatchObject({ type: "use", path: "operational/log-rotation.md", via: "Read", server: "semantic-docs" });
  });

  it("records nothing without a prior search, in another session, or when switched off", async () => {
    run(await fixture("mcp-read_note"));
    run(await fixture("mcp-search_hybrid", "s1"));
    run(await fixture("mcp-read_note", "other"));
    expect((await events()).map((e) => e.type)).toEqual(["search"]);
    expect(run(await fixture("mcp-search_hybrid"), { SEMANTIC_MEMORY_USAGE_CAPTURE: "0" }).out).toBe("");
    expect(run(await fixture("mcp-search_hybrid"), { SEMANTIC_MEMORY_REVIEWER: "1" }).status).toBe(0);
    await mkdir(join(repo, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(join(repo, ".claude", ".semantic-memory", "config"), "usage_capture: off\n");
    run(await fixture("mcp-search_hybrid"));
    expect(await events()).toHaveLength(1);
  });

  it("respects telemetry.enabled: false and fails open on bad input", async () => {
    await writeFile(join(repo, ".documentation", "vault.schema.yml"), "telemetry:\n  enabled: false\n");
    run(await fixture("mcp-search_hybrid"));
    expect(await events()).toEqual([]);
    for (const bad of ["not json", "{}", '{"tool_name":"Bash","tool_input":null}']) {
      const r = spawnSync(process.execPath, [HOOK], { input: bad, encoding: "utf8" });
      expect(r).toMatchObject({ status: 0, stdout: "" });
    }
  });

  it("a Bash call that is not a grep exits fast and writes nothing", async () => {
    const call = { ...(await fixture("Bash")), tool_input: { command: "ls -la" } };
    const r = run(call);
    expect(r.ms).toBeLessThan(1000);
    expect(await events()).toEqual([]);
  });
});
