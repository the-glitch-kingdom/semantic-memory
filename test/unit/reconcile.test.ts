import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Runs hooks/session-start.js the way Claude Code's SessionStart does, in a temp project with a
// fake local install. HOME is a temp dir so the user's real settings never enable hewtd here.
// The default-name cases are it.fails until Phase 3 of default-server-names flips the defaults.
const HOOK = resolve(__dirname, "../../hooks/session-start.js");
const BIN = "./node_modules/@theglitchking/semantic-memory/bin/semantic-memory";
const ours = (notes: string, extra: string[] = []) => ({ type: "stdio", command: "node", args: [BIN, "--notes", notes, ...extra] });
const VAULT = "./.claude/.vault";
const DOCS = "./.documentation";

describe("SessionStart reconcile: .mcp.json entries", () => {
  let proj: string;
  let home: string;

  beforeEach(async () => {
    proj = await mkdtemp(join(tmpdir(), "rc-proj-"));
    home = await mkdtemp(join(tmpdir(), "rc-home-"));
    await mkdir(join(proj, "node_modules/@theglitchking/semantic-memory/bin"), { recursive: true });
    await writeFile(join(proj, "node_modules/@theglitchking/semantic-memory/bin/semantic-memory"), "");
  });
  afterEach(async () => {
    await rm(proj, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  async function enableHewtd() {
    await mkdir(join(proj, ".documentation"), { recursive: true });
    await mkdir(join(proj, ".claude"), { recursive: true });
    await writeFile(join(proj, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "hit-em-with-the-docs@m": true } }));
  }
  const writeMcp = (servers: Record<string, unknown>) =>
    writeFile(join(proj, ".mcp.json"), JSON.stringify({ mcpServers: servers }, null, 2) + "\n");
  const run = () =>
    spawnSync("node", [HOOK], { env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: proj }, encoding: "utf8", timeout: 30000 });
  const mcp = async () => JSON.parse(await readFile(join(proj, ".mcp.json"), "utf8")).mcpServers as Record<string, any>;

  it.fails("fresh project with hewtd enabled gets semantic-memory + semantic-memory-docs", async () => {
    await enableHewtd();
    run();
    const s = await mcp();
    expect(Object.keys(s).sort()).toEqual(["semantic-memory", "semantic-memory-docs"]);
    expect(s["semantic-memory"]).toEqual(ours(VAULT));
    expect(s["semantic-memory-docs"]).toEqual(ours(DOCS, ["--read-only"]));
  });

  it("existing semantic-vault entry is left alone and no semantic-memory is added", async () => {
    await writeMcp({ "semantic-vault": ours(VAULT) });
    const before = await readFile(join(proj, ".mcp.json"), "utf8");
    run();
    expect(await readFile(join(proj, ".mcp.json"), "utf8")).toBe(before);
    expect(existsSync(join(proj, ".mcp.json.bak"))).toBe(false);
  });

  it("existing legacy vault + docs entries are left alone, no semantic-memory-docs added", async () => {
    await enableHewtd();
    await writeMcp({ "semantic-vault": ours(VAULT), "semantic-sidekick": ours(DOCS, ["--read-only"]) });
    const before = await readFile(join(proj, ".mcp.json"), "utf8");
    run();
    expect(await readFile(join(proj, ".mcp.json"), "utf8")).toBe(before);
  });

  it.fails.each(["my-vault", "semantic-memory"])("an entry named %s already serving the vault gets no second vault entry", async (name) => {
    await writeMcp({ [name]: ours(VAULT) });
    run();
    expect(Object.keys(await mcp())).toEqual([name]);
  });

  it.fails("a differently named entry already serving ./.documentation gets no second docs entry", async () => {
    await enableHewtd();
    await writeMcp({ "my-vault": ours(VAULT), "my-docs": ours(DOCS, ["--read-only"]) });
    run();
    expect(Object.keys(await mcp()).sort()).toEqual(["my-docs", "my-vault"]);
  });

  it("hewtd off removes our semantic-sidekick docs entry", async () => {
    await writeMcp({ "semantic-vault": ours(VAULT), "semantic-sidekick": ours(DOCS, ["--read-only"]) });
    run();
    expect(Object.keys(await mcp())).toEqual(["semantic-vault"]);
  });

  it.fails("hewtd off removes our semantic-memory-docs docs entry", async () => {
    await writeMcp({ "semantic-memory": ours(VAULT), "semantic-memory-docs": ours(DOCS, ["--read-only"]) });
    run();
    expect(Object.keys(await mcp())).toEqual(["semantic-memory"]);
  });

  it("hewtd off keeps a hand-written docs entry under either name", async () => {
    const hand = { type: "stdio", command: "my-server", args: ["--notes", DOCS] };
    await writeMcp({ "semantic-vault": ours(VAULT), "semantic-sidekick": hand, "semantic-memory-docs": hand });
    run();
    expect(Object.keys(await mcp()).sort()).toEqual(["semantic-memory-docs", "semantic-sidekick", "semantic-vault"]);
  });

  it("writes .mcp.json.bak when it changes an existing file", async () => {
    await writeMcp({ other: { command: "x" } });
    const before = await readFile(join(proj, ".mcp.json"), "utf8");
    run();
    expect(await readFile(join(proj, ".mcp.json.bak"), "utf8")).toBe(before);
    expect(Object.keys(await mcp())).toContain("other");
  });

  it("an unparseable .mcp.json is left untouched with a stderr note", async () => {
    await writeFile(join(proj, ".mcp.json"), "{ not json");
    const r = run();
    expect(await readFile(join(proj, ".mcp.json"), "utf8")).toBe("{ not json");
    expect(r.stderr).toContain("could not parse");
  });
});
