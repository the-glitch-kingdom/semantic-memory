import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGolden } from "./eval.js";
import { classifyQuery } from "../../src/core/query-type.js";

/** Every row of the six golden splits carries a hand-labelled qtype (query-routing Phase 2); the classifier is scored against it. */
const SPLITS = ["golden-docs", "golden-docs-heldout", "real-corpus", "real-corpus-heldout", "golden-code", "golden-code-heldout"];

describe("qtype labels", () => {
  for (const f of SPLITS) {
    it(`${f}.jsonl labels every row identifier | fact | flow`, () => {
      const rows = parseGolden(readFileSync(join(import.meta.dirname, `${f}.jsonl`), "utf-8")) as any[];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(["identifier", "fact", "flow"], r.id).toContain(r.qtype);
    });
  }
});

describe("classifyQuery", () => {
  it.each([
    ["What does `syncCrewRoster` return?", "identifier"],
    ["What is the default for BERTH_ALLOC_LIMIT?", "identifier"],
    ["How do I run scripts/reconcile_manifests.py?", "identifier"],
    ["HarborBacklogHigh fired, what do I do", "identifier"],
    ["Walk me through the whole journey of a sensor reading", "flow"],
    ["Give me the lifecycle of a session, from open to archive", "flow"],
    ["How long is data kept, and which tier holds it long-term?", "fact"],
    ["How do I configure SAML for the billing portal?", "fact"],
  ])("%s -> %s", (q, t) => expect(classifyQuery(q)).toBe(t));
});

/** Accuracy per split, printed by `npm run eval`. The rules were tuned on the train splits only; held-out is reported as measured. */
describe("classifier accuracy", () => {
  const splits: [string, boolean][] = [["golden-docs", true], ["real-corpus", true], ["golden-code", true], ["golden-docs-heldout", false], ["real-corpus-heldout", false], ["golden-code-heldout", false]];
  const lines: string[] = [];
  for (const [f, train] of splits) {
    it(`${f}${train ? " (train, floor 0.8)" : " (held-out, reported)"}`, () => {
      const rows = parseGolden(readFileSync(join(import.meta.dirname, `${f}.jsonl`), "utf-8")) as any[];
      const hit = rows.filter((r) => classifyQuery(r.q) === r.qtype).length;
      lines.push(`  ${f}: ${hit}/${rows.length} = ${(hit / rows.length).toFixed(2)}`);
      if (train) expect(hit / rows.length).toBeGreaterThanOrEqual(0.8);
    });
  }
  afterAll(() => void process.stderr.write("\nQuery-type classifier accuracy\n" + lines.join("\n") + "\n"));
});
