import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGolden } from "./eval.js";

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
