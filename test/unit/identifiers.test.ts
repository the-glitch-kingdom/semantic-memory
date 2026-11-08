import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Bm25Index, bm25Fields } from "../../src/core/bm25.js";
import { Indexer } from "../../src/core/indexer.js";
import { identifiers, missingTerms } from "../../src/core/identifiers.js";
import { parseGolden } from "../retrieval-eval/eval.js";

const build = (docs: { path: string; chunks: string[] }[]) => {
  const i = new Bm25Index();
  for (const d of docs) i.addDoc(d.path, d.chunks, bm25Fields(d));
  return { i, paths: docs.map((d) => d.path).join("\n").toLowerCase() };
};
const missing = (q: string, docs: { path: string; chunks: string[] }[]) => {
  const { i, paths } = build(docs);
  return missingTerms(q, i, paths);
};

describe("identifiers", () => {
  it("detects the v1 shapes and leaves prose alone", () => {
    expect(identifiers("What does FOO_BAR do, and fooBar? See `x y` and `baz.qux` in src/a/b.ts (harbor.dlq).")).toEqual(
      ["baz.qux", "FOO_BAR", "fooBar", "src/a/b.ts", "harbor.dlq"],
    );
    for (const q of ["Which SLA applies in v1.12.0, e.g. for TLS?", "the __init__ file", "what is Kubernetes and kebab-case", "see https://x.io/a_b", "TCP/IP, client/server and pass/fail", "the _really_ odd case"]) expect(identifiers(q)).toEqual([]);
    expect(identifiers("set MAX_RETRIES=3 in __init__.py")).toEqual(["MAX_RETRIES", "__init__.py"]);
  });
});

describe("missingTerms", () => {
  const docs = [
    { path: "ops/run_book.md", chunks: ["Set `retry_limit` before the rollout. | cache_ttl | 30 |"] },
    { path: "ops/other.md", chunks: ["Plain words only, with the harbor.dlq topic. The `__init__.py` file and `_helper_fn` stay private."] },
  ];
  it("flags absent identifiers in their original spelling", () => {
    expect(missing("What is FOO_BAR and fooBar and x/y/zz_missing.py?", docs)).toEqual(["FOO_BAR", "fooBar", "x/y/zz_missing.py"]);
  });
  it("does not flag present terms, spans, table cells, file names, or non-names", () => {
    for (const q of ["retry_limit?", "what is CACHE_TTL", "`retry_limit`", "run_book", "docs/ops/run_book.md", "harbor.dlq", "__init__", "__init__.py", "_helper_fn", "v1.12.0", "TCP/IP", "e.g. SLA"]) {
      expect(missing(q, docs), q).toEqual([]);
    }
  });
});

describe("missingTerms on the golden sets (real Bm25Index, no embedder)", () => {
  const R = join(import.meta.dirname, "..");
  const sets: [string, string[]][] = [
    [join(R, "fixtures/docs-vault"), ["golden-docs", "golden-docs-heldout"]],
    [join(R, "..", ".documentation"), ["real-corpus", "real-corpus-heldout"]],
    [join(R, "fixtures/code-vault"), ["golden-code", "golden-code-heldout"]],
    [join(R, "fixtures/decay-vault"), ["golden-decay", "golden-decay-heldout"]],
    [join(R, "fixtures/vault"), ["golden"]],
  ];
  it.each(sets)("%s: no answerable or plain-English negative question gets a missing term", async (dir, files) => {
    const { i, paths } = build(await new Indexer(dir).indexAll().then((ds) => ds.map((d) => ({ path: d.path, chunks: d.chunks, title: d.title, purpose: d.purpose, fieldText: d.fieldText }))));
    for (const f of files) {
      const cases = parseGolden(await readFile(join(R, "retrieval-eval", `${f}.jsonl`), "utf-8")) as any[];
      for (const c of cases.filter((c) => c.negative_kind !== "identifier")) {
        const q = c.q ?? c.utterance;
        expect(missingTerms(q, i, paths), `${f} ${c.id ?? q}`).toEqual([]);
      }
    }
  }, 60000);
});

describe("independence (#57 check 5)", () => {
  it("reads no hit-em-with-the-docs export or gaps file", async () => {
    for (const f of ["src/core/identifiers.ts", "src/core/bm25.ts"]) {
      expect(await readFile(join(import.meta.dirname, "../..", f), "utf-8"), f).not.toMatch(/graph\.json|gaps\.json|\.hewtd/);
    }
  });
});
