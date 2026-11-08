import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { cleanTopK } from "../retrieval-eval/graph-metrics.js";
import { anchorOfSnippet } from "../retrieval-eval/section-metrics.js";
import { headingAnchors } from "../../node_modules/@theglitchking/hit-em-with-the-docs/dist/core/links/anchors.js";
import { parseGolden } from "../retrieval-eval/eval.js";

/** The fixture exports are hewtd graph.json v1 files (schema shipped in its npm package); v2.json is the unknown-version variant and must not validate. */
const FIX = join(import.meta.dirname, "..", "fixtures");
const schema = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "node_modules", "@theglitchking", "hit-em-with-the-docs", "schemas", "graph.v1.schema.json"), "utf-8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const load = (p: string) => JSON.parse(readFileSync(join(FIX, p), "utf-8"));

describe("graph export fixtures", () => {
  it.each(["code-graph-vault/.hewtd/graph.json", "code-graph-exports/real-trimmed.json", "section-vault/.hewtd/graph.json"])("%s validates against graph.v1.schema.json", (p) => {
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

/** The section-vault export respects the data as hewtd 2.21.0 ships it: points_to.from is null, duplicates.section is the owner's anchor, and every anchor exists. */
describe("section-vault export", () => {
  const g = load("section-vault/.hewtd/graph.json");
  const DOCS = join(FIX, "section-vault", ".documentation");
  const anchorsOf = (p: string) => headingAnchors(readFileSync(join(DOCS, p), "utf-8").replace(/^---[\s\S]*?\n---\n/, ""));
  it("lists every doc on disk, and each owner_of, duplicates and points_to names a section that exists", () => {
    const onDisk = readdirSync(DOCS, { recursive: true }).map(String).filter((f) => f.endsWith(".md")).sort();
    expect(Object.keys(g.docs).sort()).toEqual(onDisk);
    const owners = new Map<string, string>();
    for (const [doc, e] of Object.entries<any>(g.docs)) {
      for (const o of e.owner_of) { const [p, a] = o.split("#"); expect(anchorsOf(p).has(a), o).toBe(true); owners.set(o, doc); }
      for (const d of e.duplicates) { const [p, a] = d.owner.split("#"); expect(d.section, doc).toBe(`#${a}`); expect(anchorsOf(p).has(a), d.owner).toBe(true); }
      for (const t of e.points_to) { expect(t.from, doc).toBeNull(); expect(anchorsOf(t.to.split("#")[0]).has(t.to.split("#")[1]), t.to).toBe(true); }
    }
    for (const e of Object.values<any>(g.docs)) for (const x of [...e.duplicates.map((d: any) => d.owner), ...e.points_to.map((t: any) => t.to)]) expect(owners.has(x), x).toBe(true);
  });
  it("the golden anchors exist in their answer docs", () => {
    for (const f of ["golden-section.jsonl", "golden-section-heldout.jsonl"]) {
      for (const c of parseGolden(readFileSync(join(import.meta.dirname, "..", "retrieval-eval", f), "utf-8")) as any[]) expect(anchorsOf(c.answer).has(c.anchor), c.id).toBe(true);
    }
  });
});

describe("anchorOfSnippet", () => {
  const md = "---\ntitle: t\n---\n# T\n\n## One\n\nAlpha beta gamma delta epsilon zeta eta theta iota kappa.\n\n## One\n\nLambda mu nu xi omicron pi rho sigma tau upsilon phi chi.\n";
  it("finds the section a snippet lies in, repeats included, and null when none holds it", () => {
    expect(anchorOfSnippet(md, "…Alpha beta gamma delta epsilon zeta eta theta iota kappa.")).toBe("one");
    expect(anchorOfSnippet(md, "Lambda mu nu xi omicron pi rho sigma tau upsilon phi chi.")).toBe("one-1");
    expect(anchorOfSnippet(md, "nothing like it anywhere in the text at all")).toBeNull();
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
