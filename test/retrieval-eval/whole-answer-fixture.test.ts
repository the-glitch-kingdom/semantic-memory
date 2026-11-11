import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseGolden, type FacetCase } from "./eval.js";
import { findStale } from "../../src/core/retrieval-eval/suite.js";

// Facet-check of the whole-answer sets (#91): every facet is held only by the docs the question lists as expected, so a miss is a retrieval miss and never a bad label.
const fx = join(__dirname, "../fixtures");
const load = (name: string) => new Map((readdirSync(join(fx, name), { recursive: true }) as string[]).filter((f) => f.endsWith(".md")).map((f) => [`${name}/${f}`, readFileSync(join(fx, name, f), "utf-8")]));
const read = (n: string) => parseGolden(readFileSync(join(__dirname, `${n}.jsonl`), "utf-8")) as unknown as FacetCase[];
const sets = [
  ["identifier-tier", "identifier-tier", 8],
  ["identifier-tier-heldout", "identifier-tier", 8],
  ["whole-answer", "multi-hub", 12],
  ["whole-answer-heldout", "multi-hub", 12],
] as const;

describe.each(sets)("%s", (name, fixture, count) => {
  const cases = read(name);
  const docs = load(fixture);
  it("has no stale case, and the expected number of questions", () => {
    expect(findStale(cases, docs).stale).toEqual([]);
    expect(cases).toHaveLength(count);
  });
  it("every facet is held by expected docs only, and every expected doc holds one", () => {
    for (const c of cases) {
      const holders = new Set<string>();
      for (const f of c.facets ?? []) for (const [p, t] of docs) if (new RegExp(f, "i").test(t)) holders.add(p);
      expect([...holders].sort(), c.id).toEqual([...(c.expected ?? [])].sort());
    }
  });
  it("question text does not contain a facet, except on exact-term questions", () => {
    for (const c of cases.filter((x) => x.tier !== "exact")) for (const f of c.facets ?? []) expect(new RegExp(f, "i").test(c.q), `${c.id}: ${f}`).toBe(false);
  });
});

describe("identifier-tier fixture", () => {
  it("decoys do not contain any script name, and each script is in exactly 3 docs", () => {
    const docs = load("identifier-tier");
    const cases = [...read("identifier-tier"), ...read("identifier-tier-heldout")];
    for (const [p, t] of docs) if (/exit-codes|verification|scripts-exit|return-values/.test(p)) expect(t, p).not.toMatch(/\.(py|sh)\b/);
    for (const c of cases) expect(c.expected, c.id).toHaveLength(3);
  });
});
