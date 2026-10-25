import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, readdir, writeFile, mkdir, symlink, copyFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

// v1.5.3: every write point masks secrets before they reach disk. One test per write point, through
// the real MCP tool, reading the file back. A new write path without redaction fails the final sweep.

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const j = (...p: string[]) => p.join("");
const RANDOM = "Zq9Xw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa98";
const fake = (label: string) => j("np", "m_", label, RANDOM); // distinct npm-shaped token per write point

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesUnder(p)));
    else out.push(p);
  }
  return out;
}

describe("secrets are redacted at every write point", () => {
  let client: Client;
  let vault: string;
  const used: string[] = [];
  const secret = (label: string) => {
    const s = fake(label);
    used.push(s);
    return s;
  };

  async function call(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await client.callTool({ name, arguments: args });
    return (res.content as { text: string }[]).map((c) => c.text).join("\n");
  }
  const read = (rel: string) => readFile(join(vault, rel), "utf-8");

  beforeAll(async () => {
    vault = await createTempVault();
    const server = await createServer(vault, { watch: false, waitForReady: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  }, 180_000);

  afterAll(async () => {
    await client.close();
    await cleanupTempDir(vault);
  });

  it("create_note: body and frontmatter, and the result says so", async () => {
    const a = secret("create"), b = secret("createfm");
    const out = await call("create_note", {
      path: "redact/create.md",
      content: `# Deploy\n\nRun with token ${a} please.`,
      frontmatter: { title: "Deploy", api_key: b },
    });
    expect(out).toContain("2 secrets redacted");
    expect(out).not.toContain(a);
    const file = await read("redact/create.md");
    expect(file).not.toContain(a);
    expect(file).not.toContain(b);
    expect(file).toContain("[REDACTED]");
    expect(file).toContain("Run with token");
  });

  it("update_note: incoming text only; a secret already in the note is left for lint", async () => {
    const pre = secret("preexisting");
    await writeFile(join(vault, "redact/existing.md"), `# Old\n\nlegacy ${pre}\n`, "utf-8");
    const a = secret("update");
    const out = await call("update_note", { path: "redact/existing.md", content: `new line ${a}`, mode: "append" });
    expect(out).toContain("1 secret redacted");
    const file = await read("redact/existing.md");
    expect(file).not.toContain(a);
    expect(file).toContain(pre); // not silently rewritten
    used.splice(used.indexOf(pre), 1);
  });

  it("update_frontmatter", async () => {
    const a = secret("frontmatter");
    const out = await call("update_frontmatter", { path: "redact/create.md", fields: { client_secret: a } });
    expect(out).toContain("1 secret redacted");
    expect(await read("redact/create.md")).not.toContain(a);
  });

  it("apply_patch: creates and updates, with per-op counts", async () => {
    const a = secret("patchcreate"), b = secret("patchupdate");
    await call("create_note", { path: "redact/patch-target.md", content: "# Target\n" });
    const out = await call("apply_patch", {
      creates: [{ path: "redact/patched.md", content: `# P\n\n${a}` }],
      updates: [{ path: "redact/patch-target.md", content: `appended ${b}`, mode: "append" }],
      validate: false, // schema lint is not under test here
    });
    expect(out).not.toContain(a);
    expect(out).toMatch(/"redacted": 1/);
    expect(await read("redact/patched.md")).not.toContain(a);
    expect(await read("redact/patch-target.md")).not.toContain(b);
  });

  it("manage_dossier: purpose, incident and state", async () => {
    const a = secret("purpose"), b = secret("incident"), c = secret("state");
    await call("manage_dossier", { action: "init", entity: "Relay", purpose: `forwards events using ${a}` });
    const inc = await call("manage_dossier", { action: "append_incident", entity: "Relay", incident: `rotated ${b}` });
    expect(inc).toMatch(/"redacted": 1/);
    await call("manage_dossier", { action: "set_state", entity: "Relay", state: `healthy; key ${c}` });
    const dossier = (await filesUnder(join(vault, "dossiers"))).find((f) => f.endsWith(".md"))!;
    const text = await readFile(dossier, "utf-8");
    for (const s of [a, b, c]) expect(text).not.toContain(s);
  });

  it("manage_profile: update_section", async () => {
    const a = secret("profile");
    await call("manage_profile", { action: "update_section", section: "Vocabulary", text: `when I say the key I mean ${a}` });
    const files = await filesUnder(join(vault, "profile"));
    for (const f of files) expect(await readFile(f, "utf-8")).not.toContain(a);
  });

  it("manage_lexicon: alias phrases", async () => {
    const a = secret("alias");
    const out = await call("manage_lexicon", { action: "add", canonical: "src/core/relay.ts", phrases: [`the ${a} thing`], source: "authored" });
    expect(out).toMatch(/"redacted": 1/);
    for (const f of await filesUnder(vault)) {
      if (f.includes("alias") || f.includes("lexicon")) expect(await readFile(f, "utf-8")).not.toContain(a);
    }
  });

  it("log_event: summary and payload in log.md", async () => {
    const a = secret("logsummary"), b = secret("logpayload");
    await call("log_event", { kind: "incident", summary: `leaked ${a}`, payload: { cmd: `deploy --token ${b}`, path: "redact/create.md" } });
    const log = await read("log.md");
    expect(log).not.toContain(a);
    expect(log).not.toContain(b);
    expect(log).toContain("redact/create.md"); // paths survive the precise set
  });

  it("search queries in the selection log", async () => {
    const a = secret("query");
    await call("search_hybrid", { query: `find ${a}` }); // semantic + hybrid searches log their query
    const sel = (await filesUnder(vault)).filter((f) => f.endsWith("selection.jsonl"));
    expect(sel.length).toBeGreaterThan(0);
    for (const f of sel) expect(await readFile(f, "utf-8")).not.toContain(a);
  });

  it("session_start task and session_run command + output tail", async () => {
    const a = secret("task"), b = secret("cmd");
    await call("session_start", { task: `rotate ${a}` });
    await call("session_run", { cmd: `echo ${b}` });
    const state = (await filesUnder(vault)).find((f) => f.endsWith("session.json"))!;
    const text = await readFile(state, "utf-8");
    expect(text).not.toContain(a);
    expect(text).not.toContain(b); // neither in cmd nor in the echoed tail
    await call("session_finish", { summary: "done", verified: false, reason: "test" });
  });

  it("sweep: no fake secret anywhere under the vault after every write point", async () => {
    const hits: string[] = [];
    for (const f of await filesUnder(vault)) {
      const text = await readFile(f, "utf-8").catch(() => "");
      for (const s of used) if (text.includes(s)) hits.push(`${f}: ${s.slice(0, 8)}…`);
    }
    expect(hits).toEqual([]);
  });
});

describe("hook: capture-pending excerpt", () => {
  const HOOK = join(ROOT, "hooks", "vault-context.js");
  const run = (hook: string, project: string, prompt: string) =>
    spawnSync("node", [hook], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: project, session_id: "s1", prompt }),
      encoding: "utf8",
      cwd: project,
      timeout: 60_000,
    });
  const pending = async (project: string) =>
    JSON.parse(await readFile(join(project, ".claude", ".semantic-memory", "capture-pending.json"), "utf-8")).items;

  it("stores the excerpt redacted", async () => {
    const project = await mkdtemp(join(tmpdir(), "redact-hook-"));
    try {
      await mkdir(join(project, ".claude", ".vault"), { recursive: true });
      const s = fake("hook");
      run(HOOK, project, `the fix was to rotate ${s} in the relay`);
      const items = await pending(project);
      expect(items[0].excerpt).toContain("[REDACTED]");
      expect(JSON.stringify(items)).not.toContain(s);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("withholds the excerpt when the redactor cannot be loaded", async () => {
    // a copy of the hook with no ../dist next to it, and a CLI it can still find via node_modules
    const project = await mkdtemp(join(tmpdir(), "redact-hook-nodist-"));
    try {
      await mkdir(join(project, ".claude", ".vault"), { recursive: true });
      await mkdir(join(project, "hooks"));
      await copyFile(HOOK, join(project, "hooks", "vault-context.js"));
      const bin = join(project, "node_modules", "@theglitchking", "semantic-memory", "bin");
      await mkdir(bin, { recursive: true });
      await symlink(join(ROOT, "bin", "semantic-memory"), join(bin, "semantic-memory"));
      const s = fake("nodist");
      run(join(project, "hooks", "vault-context.js"), project, `the fix was to rotate ${s} in the relay`);
      const items = await pending(project);
      expect(items[0].excerpt).toBe("[excerpt withheld: redactor unavailable]");
      expect(JSON.stringify(items)).not.toContain(s);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
