import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent } from "../../src/core/telemetry.js";
import { loadCitationCounts } from "../../src/core/usage-boost.js";
import { computeGaps, readUsage } from "../../src/core/usage-log.js";

// Phase 9 review (#59): scenario, privacy and no-leak checks on the real hook process.
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const HOOK = join(ROOT, "hooks", "usage-capture.js");
const FIX = join(ROOT, "test", "fixtures", "usage-capture");
const MARKER = "ZZ-MARKER-7731";
// the redactor skips placeholder-looking values (anything containing "example"), so the test key must not
const AKIA = "AKIAQWERTYUIOPASDFGH";

describe("usage-capture review", () => {
  let repo: string;
  const fixture = async (name: string, over: Record<string, unknown> = {}, session = "s1") => ({
    ...JSON.parse((await readFile(join(FIX, `${name}.json`), "utf8")).replaceAll("/home/user/proj", repo)),
    session_id: session,
    ...over,
  });
  const run = (input: object, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, SEMANTIC_MEMORY_USAGE_CAPTURE: "", SEMANTIC_MEMORY_REVIEWER: "", ...env } });
  const logPath = () => join(repo, ".claude", ".semantic-memory", "usage.jsonl");
  const events = () => { try { return readFileSync(logPath(), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } };
  const mcp = (servers: Record<string, string>) =>
    writeFile(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: Object.fromEntries(Object.entries(servers).map(([n, p]) => [n, { command: "node", args: ["x", "--notes", p, "--read-only"] }])) }));

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-usage-review-"));
    await mkdir(join(repo, ".documentation", "operational"), { recursive: true });
    await mcp({ "semantic-docs": "./.documentation" });
  });
  afterEach(() => rm(repo, { recursive: true, force: true }));

  it("a Read of a doc outside the results has rank null", async () => {
    run(await fixture("mcp-search_hybrid"));
    const r = await fixture("Read");
    r.tool_input.file_path = join(repo, ".documentation", "operational", "not-returned.md");
    run(r);
    expect(events()[1]).toMatchObject({ type: "use", path: "operational/not-returned.md", rank: null });
  });

  it("search, Grep, Read X gives a symptoms.user_phrase gap; Grep alone gives a new doc gap", async () => {
    run(await fixture("mcp-search_hybrid"));
    run(await fixture("Grep"));
    expect(computeGaps(readUsage(repo))).toMatchObject([{ query: "rotate api keys", used_doc: null, suggested: "new doc" }]);
    run(await fixture("Read"));
    expect(computeGaps(readUsage(repo))).toMatchObject([{ used_doc: "operational/log-rotation.md", suggested: "symptoms.user_phrase" }]);
  });

  it("nested vaults resolve to the longest source path", async () => {
    await mcp({ "semantic-docs": "./.documentation", "semantic-ops": "./.documentation/operational" });
    const s = await fixture("mcp-search_hybrid");
    run({ ...s, tool_name: "mcp__semantic-ops__search_hybrid" });
    run(await fixture("Read"));
    expect(events()[1]).toMatchObject({ type: "use", server: "semantic-ops", path: "log-rotation.md" });
  });

  it("never logs tool responses, file content or grep patterns; redacts a key in the query", async () => {
    const s = await fixture("mcp-search_hybrid");
    s.tool_input.query = `rotate ${AKIA}`;
    s.tool_response[0].text += MARKER;
    run(s);
    const r = await fixture("Read");
    r.tool_response.file.content = MARKER;
    run(r);
    const g = await fixture("Grep");
    g.tool_input.pattern = MARKER;
    g.tool_response.content = MARKER;
    run(g);
    const raw = await readFile(logPath(), "utf8");
    expect(raw).not.toContain(MARKER);
    expect(raw).not.toContain(AKIA);
    expect(raw).not.toContain("selection");
    expect(events().map((e) => e.type)).toEqual(["search", "use", "fallback"]);
  });

  it("ranking inputs are untouched: selection log and citation counts identical after hook events", async () => {
    const vault = join(repo, ".documentation");
    await appendEvent(vault, { kind: "selection", note_path: "operational/log-rotation.md", via: "read_note" });
    const snap = async () => JSON.stringify([await loadCitationCounts(vault), (await readdir(vault, { recursive: true })).filter((f) => f.endsWith("selection.jsonl")).sort()]);
    const before = await snap();
    for (const f of ["mcp-search_hybrid", "mcp-read_note", "Read", "Grep"]) run(await fixture(f));
    expect(events().length).toBeGreaterThan(2);
    expect(await snap()).toBe(before);
  });

  it("neither the module nor the hook references or spawns hewtd", () => {
    for (const f of [join(ROOT, "src/core/usage-log.ts"), HOOK]) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src).not.toMatch(/hewtd|hit-em-with-the-docs|child_process|spawn|exec/i);
    }
  });
});
