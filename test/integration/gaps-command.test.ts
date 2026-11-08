import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { runHealthcheck } from "../../src/core/healthcheck.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js").default ?? require("ajv/dist/2020.js");
const schema = JSON.parse(readFileSync("node_modules/@theglitchking/hit-em-with-the-docs/schemas/gaps.v1.schema.json", "utf8"));
const cli = join(process.cwd(), "dist/cli/index.js");
const gaps = (root: string, ...args: string[]) => execFileSync("node", [cli, "gaps", "--root", root, ...args], { encoding: "utf8" });

let root: string;
const line = (o: object) => JSON.stringify({ v: 1, session: "s", ts: "2026-11-07T10:00:00.000Z", ...o });
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gaps-"));
  mkdirSync(join(root, ".claude", ".semantic-memory"), { recursive: true });
  writeFileSync(join(root, ".claude", ".semantic-memory", "usage.jsonl"), [
    line({ type: "search", id: "a", server: "semantic-docs", tool: "search_hybrid", query: "tls cert expired", results: [] }),
    line({ type: "use", search: "a", server: "semantic-docs", path: "tls.md", rank: null, via: "read_note" }),
    line({ type: "search", id: "b", server: "semantic-docs", tool: "search_hybrid", query: "redis memory limit", results: ["r.md"] }),
    line({ type: "fallback", search: "b", via: "Grep", scope: "vault" }),
  ].join("\n") + "\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("semantic-memory gaps", () => {
  it("--json is exactly gaps.v1 and validates against hewtd's schema", () => {
    const out = JSON.parse(gaps(root, "--json"));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(out), JSON.stringify(validate.errors)).toBe(true);
    expect(out.source).toMatch(/^semantic-memory \d/);
    expect(out.gaps).toEqual(expect.arrayContaining([
      { query: "tls cert expired", used_doc: "tls.md", suggested: "symptoms.user_phrase", count: 1, last_seen: "2026-11-07" },
      { query: "redis memory limit", used_doc: null, suggested: "new doc", count: 1, last_seen: "2026-11-07" },
    ]));
    for (const g of out.gaps) expect(Object.keys(g).sort()).toEqual(["count", "last_seen", "query", "suggested", "used_doc"]);
    expect(validate({ version: 2, gaps: [] })).toBe(false);
  });
  it("text report shows signals; a missing log prints gaps: []", () => {
    expect(gaps(root)).toMatch(/grep fallback/);
    const empty = mkdtempSync(join(tmpdir(), "gaps-empty-"));
    expect(gaps(empty).trim()).toBe("gaps: []");
    expect(JSON.parse(gaps(empty, "--json")).gaps).toEqual([]);
    rmSync(empty, { recursive: true, force: true });
  });
  it("--include-repo-grep counts a repo grep that came before the read", () => {
    writeFileSync(join(root, ".claude", ".semantic-memory", "usage.jsonl"), [
      line({ type: "search", id: "c", server: "semantic-docs", tool: "search_text", query: "kafka lag", results: ["k.md"] }),
      line({ type: "fallback", ts: "2026-11-07T10:00:01.000Z", search: "c", via: "Grep", scope: "repo" }),
      line({ type: "use", ts: "2026-11-07T10:00:02.000Z", search: "c", server: "semantic-docs", path: "k.md", rank: 1, via: "read_note" }),
    ].join("\n") + "\n");
    expect(JSON.parse(gaps(root, "--json")).gaps).toEqual([]);
    expect(JSON.parse(gaps(root, "--json", "--include-repo-grep")).gaps).toHaveLength(1);
  });
});

describe("healthcheck: usage log gitignore", () => {
  it("warns when usage.jsonl is not ignored, and not when it is", async () => {
    const r = mkdtempSync(join(tmpdir(), "hc-ign-"));
    execFileSync("git", ["init", "-q"], { cwd: r });
    mkdirSync(join(r, ".claude", ".semantic-memory"), { recursive: true });
    writeFileSync(join(r, ".claude", ".semantic-memory", "usage.jsonl"), "");
    const find = async () => (await runHealthcheck({ projectRoot: r, tier: "fast", force: true })).findings.find((f) => f.check === "usage_log_ignored");
    expect((await find())?.severity).toBe("warn");
    writeFileSync(join(r, ".gitignore"), ".claude/.semantic-memory/\n");
    expect(await find()).toBeUndefined();
    rmSync(r, { recursive: true, force: true });
  });
});

describe("semantic-memory usage-set", () => {
  it("writes eval question-set lines for searches that ended in a used doc", () => {
    const r = mkdtempSync(join(tmpdir(), "uset-"));
    mkdirSync(join(r, ".claude", ".semantic-memory"), { recursive: true });
    writeFileSync(join(r, ".claude", ".semantic-memory", "usage.jsonl"), [
      line({ type: "search", id: "a", server: "semantic-docs", tool: "search_hybrid", query: "tls cert expired", results: [] }),
      line({ type: "use", search: "a", server: "semantic-docs", path: "tls.md", rank: null, via: "read_note" }),
      line({ type: "search", id: "b", server: "semantic-docs", tool: "search_hybrid", query: "redis memory limit", results: ["r.md"] }),
      line({ type: "fallback", search: "b", via: "Grep", scope: "vault" }),
    ].join("\n") + "\n");
    execFileSync("node", [cli, "usage-set", "--root", r], { encoding: "utf8" });
    const cases = readFileSync(join(r, ".claude", ".semantic-memory", "eval", "usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(cases).toHaveLength(1); // the fallback-only search has no used doc
    expect(cases[0]).toMatchObject({ q: "tls cert expired", expected: ["tls.md"], tier: "paraphrase" });
    expect(["tune", "heldout"]).toContain(cases[0].split);
    rmSync(r, { recursive: true, force: true });
  });
});
