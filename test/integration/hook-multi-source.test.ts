import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logEvent } from "../../src/core/log.js";

// Issue #29 bug 3: the prompt hook searched only the first semantic-* notes path in .mcp.json.
// With the standard setup that is an empty vault, so the docs were never searched.

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const HOOK = join(ROOT, "hooks", "vault-context.js");
const CLI = join(ROOT, "dist", "cli", "index.js");

const DOC_TEXT =
  "# Rotating the zephyr signing key\n\nTo rotate the zephyr signing key, run the zephyr rotate command and restart the relay.\n";
// each test asks differently: the hook suppresses a prompt fingerprint it has just answered
const PROMPT = "how do we rotate the zephyr signing key?";

function runHook(cwd: string, input: object, env: Record<string, string> = {}) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    cwd,
    // a low gate keeps the test about which corpora are searched, not about score tuning
    env: { ...process.env, SEMANTIC_MEMORY_INJECT_MIN_SCORE: "0.01", ...env },
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  return (JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext ?? "") as string;
}

function reindex(dir: string) {
  const r = spawnSync("node", [CLI, "--notes", dir, "--reindex"], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`reindex failed: ${r.stderr}`);
}

async function writeMcp(project: string, servers: Record<string, string[]>) {
  const mcpServers = Object.fromEntries(
    Object.entries(servers).map(([name, args]) => [name, { command: "node", args: [CLI, ...args] }])
  );
  await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers }), "utf-8");
}

describe("prompt + SessionStart hooks search every semantic-* notes path", () => {
  let project: string;
  let vault: string;
  let docs: string;

  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), "sm-multi-source-"));
    vault = join(project, ".claude", ".vault");
    docs = join(project, ".documentation");
    await mkdir(vault, { recursive: true });
    await mkdir(join(docs, "runbooks"), { recursive: true });
    await writeFile(join(vault, "README.md"), "# Vault\n\nNothing about keys here.\n", "utf-8");
    await writeFile(join(docs, "runbooks", "rotate-zephyr-key.md"), DOC_TEXT, "utf-8");
    await writeFile(join(docs, "README.md"), "# Docs\n\nIndex of runbooks.\n", "utf-8");
    reindex(vault);
    reindex(docs);
  }, 300_000);

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it("injects a docs hit, labelled by server, when the vault has nothing", async () => {
    await writeMcp(project, {
      "semantic-vault": ["--notes", "./.claude/.vault"],
      "semantic-sidekick": ["--notes", "./.documentation", "--read-only"],
    });
    const ctx = runHook(project, { hook_event_name: "UserPromptSubmit", cwd: project, prompt: PROMPT });
    expect(ctx).toContain("runbooks/rotate-zephyr-key.md");
    expect(ctx).toMatch(/rotate-zephyr-key\.md` \(semantic-sidekick, score: /);
  }, 120_000);

  it("keeps the single-corpus format unchanged (no source label)", async () => {
    await writeMcp(project, { "semantic-sidekick": ["--notes", "./.documentation", "--read-only"] });
    const ctx = runHook(project, { hook_event_name: "UserPromptSubmit", cwd: project, prompt: `${PROMPT} (single)` });
    expect(ctx).toMatch(/rotate-zephyr-key\.md` \(score: /);
    expect(ctx).not.toContain("semantic-sidekick");
  }, 120_000);

  it("skips an entry whose --notes folder does not exist", async () => {
    await writeMcp(project, {
      "semantic-memory": ["--notes", "./missing-folder"],
      "semantic-vault": ["--notes", "./.claude/.vault"],
      "semantic-sidekick": ["--notes", "./.documentation", "--read-only"],
    });
    const ctx = runHook(project, { hook_event_name: "UserPromptSubmit", cwd: project, prompt: `${PROMPT} (missing)` });
    expect(ctx).toContain("runbooks/rotate-zephyr-key.md");
    expect(ctx).not.toContain("missing-folder");
  }, 120_000);

  it("SIDEKICK_VAULT_PATH still means one path only", async () => {
    await writeMcp(project, {
      "semantic-vault": ["--notes", "./.claude/.vault"],
      "semantic-sidekick": ["--notes", "./.documentation", "--read-only"],
    });
    const ctx = runHook(
      project,
      { hook_event_name: "UserPromptSubmit", cwd: project, prompt: `${PROMPT} (override)` },
      { SIDEKICK_VAULT_PATH: vault }
    );
    expect(ctx).not.toContain("rotate-zephyr-key.md");
  }, 120_000);

  it("SessionStart searches the docs too, but reads state from the writable vault", async () => {
    // docs server listed first: the hook must still treat the non-read-only vault as the vault
    await writeMcp(project, {
      "semantic-sidekick": ["--notes", "./.documentation", "--read-only"],
      "semantic-vault": ["--notes", "./.claude/.vault"],
    });
    await logEvent(vault, { kind: "ingest", summary: "vault-only marker event", ts: new Date().toISOString() });
    const ctx = runHook(project, { hook_event_name: "SessionStart", cwd: project, source: "startup" });
    expect(ctx).toContain("vault-only marker event");
    expect(ctx).toContain('<vault-context source="sessionstart"');
    expect(ctx).toMatch(/\.md` \(semantic-(sidekick|vault), score: /);
  }, 120_000);
});
