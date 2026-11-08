import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCases, rejectReason, sampleDocs } from "../../src/core/retrieval-eval/generate.js";
import { parseGolden } from "../../src/core/retrieval-eval/metrics.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "..", "bin", "claude");
const CLI = join(HERE, "..", "..", "dist", "cli", "index.js");

const docs = new Map([
  ["a.md", "# Alpha\nThe harbor.dlq queue receives dead letters. See [beta](b.md).\n"],
  ["b.md", "# Beta\nThe zephyr scheduler retries jobs nightly.\n"],
  ["c.md", "# Gamma\nPlain notes about lunch.\n"],
  ["d.md", "# Delta\nMore plain notes about lunch.\n"],
  ["e.md", "# Epsilon\nNotes about lunch again.\n"],
  ["f.md", "# Zeta\nlunch lunch lunch.\n"],
]);

describe("rejectReason", () => {
  const ok = { kind: "keyword", q: "harbor dlq", facets: ["harbor\\.dlq"] };
  it("keeps a valid keyword question", () => expect(rejectReason(ok, "a.md", "b.md", docs)).toBeUndefined());
  it("rejects a bad regex, a facet missing from the source, and one matching too many docs", () => {
    expect(rejectReason({ ...ok, facets: ["("] }, "a.md", undefined, docs)).toMatch(/bad facet/);
    expect(rejectReason({ ...ok, facets: ["zephyr"] }, "a.md", undefined, docs)).toMatch(/does not match the source/);
    expect(rejectReason({ ...ok, facets: ["lunch"] }, "c.md", undefined, docs)).toMatch(/too many docs/);
  });
  it("rejects a negative whose term exists (any case) and keeps one whose term is absent", () => {
    expect(rejectReason({ kind: "negative", q: "x", absent_terms: ["ZEPHYR"] }, "a.md", undefined, docs)).toMatch(/exists/);
    expect(rejectReason({ kind: "negative", q: "x" }, "a.md", undefined, docs)).toMatch(/absent_terms/);
    expect(rejectReason({ kind: "negative", q: "x", absent_terms: ["quasar"] }, "a.md", undefined, docs)).toBeUndefined();
  });
  it("needs a multi question to cover both docs, and a paraphrase to share at most one rare term", () => {
    expect(rejectReason({ kind: "multi", q: "q", facets: ["harbor"] }, "a.md", "b.md", docs)).toMatch(/both/);
    expect(rejectReason({ kind: "multi", q: "q", facets: ["harbor", "zephyr"] }, "a.md", "b.md", docs)).toBeUndefined();
    expect(rejectReason({ kind: "paraphrase", q: "harbor queue dead letters", facets: ["harbor"] }, "a.md", undefined, docs)).toMatch(/rare terms/);
    expect(rejectReason({ kind: "paraphrase", q: "where do failed messages go", facets: ["harbor"] }, "a.md", undefined, docs)).toBeUndefined();
  });
});

describe("generateCases", () => {
  let dir = "";
  afterAll(async () => dir && (await rm(dir, { recursive: true, force: true })));

  it("samples evenly and deterministically", () => expect(sampleDocs([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]));

  it("keeps validated cases with provenance, drops the rest, and reproduces on a re-run", async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-eval-gen-"));
    for (const [p, t] of docs) await writeFile(join(dir, p), t);
    await mkdir(join(dir, "gen"));
    await writeFile(join(dir, "gen", "g.md"), "---\ngenerated: true\n---\n# Generated\nauto output\n");
    const rules = join(dir, "rules.json");
    const reply = (questions: unknown[]) => JSON.stringify({ questions });
    await writeFile(rules, JSON.stringify([
      { match: 'path="a.md"', result: reply([
        { kind: "keyword", q: "harbor dlq", facets: ["harbor\\.dlq"] },
        { kind: "keyword", q: "bad regex", facets: ["("] },
        { kind: "multi", q: "dlq and retries", facets: ["harbor", "zephyr"] },
        { kind: "negative", q: "quasar protocol", absent_terms: ["quasar"], kind_of_negative: "identifier" },
        { kind: "negative", q: "zephyr?", absent_terms: ["zephyr"] },
      ]) },
      { match: "*", result: reply([]) },
    ]));
    const env = { ...process.env, SEMANTIC_MEMORY_CLAUDE_BIN: FAKE, FAKE_CLAUDE_RULES: rules, SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(dir, "slots") };
    const first = await generateCases(dir, { docs: 10, env });
    expect(first.cases.map((c) => c.tier).sort()).toEqual(["exact", "multi", "negative"]);
    expect(first.cases.map((c) => c.q).sort()).toEqual(["dlq and retries", "harbor dlq", "quasar protocol"]);
    expect(first.rejected.map((r) => r.why).join("\n")).toMatch(/bad facet[\s\S]*exists in the docs/);
    for (const c of first.cases) {
      expect(c.doc).toBe("a.md");
      expect(c.doc_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(c.generator.version).toBeTruthy();
      expect(["tune", "heldout"]).toContain(c.split);
    }
    expect(first.cases.find((c) => c.tier === "negative")!.negative_kind).toBe("identifier");
    expect(first.cases.find((c) => c.tier === "multi")!.expected).toEqual(["a.md", "b.md"]);
    expect((await generateCases(dir, { docs: 10, env })).cases).toEqual(first.cases);

    // CLI: writes generated.jsonl that the eval loader reads back
    const out = join(dir, "evaldir");
    const r = spawnSync("node", [CLI, "eval", "generate", "--notes", dir, "--dir", out, "--docs", "10"], { encoding: "utf-8", env });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(out, "generated.jsonl"))).toBe(true);
    expect(parseGolden(readFileSync(join(out, "generated.jsonl"), "utf-8"))).toHaveLength(3);
  }, 60_000);
});
