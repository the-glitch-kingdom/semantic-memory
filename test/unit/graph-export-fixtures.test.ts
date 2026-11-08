import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { cleanTopK } from "../retrieval-eval/graph-metrics.js";

/** The fixture exports are hewtd graph.json v1 files (schema shipped in its npm package); v2.json is the unknown-version variant and must not validate. */
const FIX = join(import.meta.dirname, "..", "fixtures");
const schema = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "node_modules", "@theglitchking", "hit-em-with-the-docs", "schemas", "graph.v1.schema.json"), "utf-8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const load = (p: string) => JSON.parse(readFileSync(join(FIX, p), "utf-8"));

describe("graph export fixtures", () => {
  it.each(["code-graph-vault/.hewtd/graph.json", "code-graph-exports/real-trimmed.json"])("%s validates against graph.v1.schema.json", (p) => {
    expect(validate(load(p)), JSON.stringify(validate.errors)).toBe(true);
  });
  it("v2.json is rejected by the v1 schema", () => {
    expect(validate(load("code-graph-exports/v2.json"))).toBe(false);
  });
  it("the vault export agrees with truth.json and the files on disk", () => {
    const g = load("code-graph-vault/.hewtd/graph.json"), truth = load("code-graph-vault/truth.json");
    expect(Object.keys(g.docs).sort()).toEqual(Object.keys(truth).sort());
    for (const [doc, e] of Object.entries<any>(g.docs)) {
      const dead = e.refs.filter((r: any) => r.resolved === false).map((r: any) => r.target);
      expect(dead, doc).toEqual(truth[doc].dead);
      for (const r of e.refs.filter((x: any) => x.kind === "file")) expect(existsSync(join(FIX, "code-graph-vault", r.target)), `${doc} ${r.target}`).toBe(r.resolved === true);
      const drift = e.refs.filter((r: any) => r.kind === "file" && r.code_changed && r.code_changed > e.body_changed && r.code_changed > e.last_verified).map((r: any) => r.target);
      expect([...new Set(drift)], doc).toEqual(truth[doc].drift);
    }
  });
});

describe("cleanTopK", () => {
  it("scores the share of the top k without a dead reference, and the questions whose whole top k is clean", () => {
    const dead = new Set(["x.md"]);
    const m = cleanTopK([["a.md", "x.md", "b.md", "x.md"], ["a.md", "b.md", "c.md"]], dead);
    expect(m.share).toBeCloseTo((2 / 3 + 1) / 2);
    expect(m).toMatchObject({ allClean: 1, n: 2 });
  });
});
