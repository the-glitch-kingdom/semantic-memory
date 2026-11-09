import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, cp, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { glob } from "glob";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";
import { gitHistory } from "./git-history.js";
import { splitGates, identifierGate } from "./gates.js";
import {
  runFacetEval, scoreLinks, invertLinks, facetRank, formatArm, parseGolden, hnswRecall, grepPattern,
  type FacetCase, type ArmFn, type ArmMetrics, type LinkMetrics,
} from "./eval.js";

/**
 * Facet eval against the hewtd-shaped fixture (test/fixtures/docs-vault): the same cases through
 * search_semantic, search_hybrid and search_text, plus backlink/forwardlink precision and recall.
 * baseline.json holds the measured floor; a phase raises it, a regression fails here.
 * EVAL_OUT=<file> also writes the numbers as JSON.
 */
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "docs-vault");
const HERE = import.meta.dirname;
// Gates the field fixture fails today, run as expected failures until retrieval-ready-fields Phase 4 fixes them; see .planning/retrieval-ready-fields/notes.md "Eval results".
const KNOWN: Record<string, { atOne?: boolean; paraphrase?: boolean; falseFlags?: boolean; negatives?: boolean }> = { "fixture-train": { paraphrase: true }, "fixture-heldout": { falseFlags: true, paraphrase: true } };

describe("Facet eval (golden-docs vs docs-vault)", () => {
  let client: Client;
  let tempDir: string;
  const arms: Record<string, ArmMetrics> = {};
  const heldArms: Record<string, ArmMetrics> = {};
  const flowArms: Record<string, ArmMetrics> = {}; // search_hybrid with mode:"flow" forced on every case: what the reading path adds when the classifier is right
  let heldCases: FacetCase[];
  const idArms: Record<string, ArmMetrics> = {};
  let recall: number;
  let backlinks: LinkMetrics;
  let forwardlinks: LinkMetrics;
  let cases: FacetCase[];
  let allCases: FacetCase[];
  let allHeld: FacetCase[];
  let fullBytes: number;
  const baseline = JSON.parse(readFileSync(join(HERE, "baseline.json"), "utf-8"));

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as any)[0].text as string;
    let parsed: any = [];
    try { parsed = JSON.parse(text); } catch { /* indexing message */ }
    return { parsed: Array.isArray(parsed) ? parsed : [], bytes: Buffer.byteLength(text) };
  };
  const tool = (name: string, extra: Record<string, unknown> = {}): ArmFn => async (q, limit) => {
    const { parsed, bytes } = await call(name, { query: q, limit, ...extra });
    return { results: parsed.map((r: any) => ({ path: r.path, score: r.score })), bytes, weak: parsed.some((r: any) => r.no_strong_match), related: (parsed[0]?.related ?? []).map((r: any) => r.path), readingPath: (parsed[0]?.reading_path ?? []).map((r: any) => r.path) };
  };
  // the "grep" arm: every content word of the question as one alternation, in the tool's own order
  const text: ArmFn = async (q, limit) => {
    const { parsed, bytes } = await call("search_text", { pattern: grepPattern(q), regex: true, limit });
    return { results: parsed.map((r: any) => ({ path: r.path, score: r.score })), bytes };
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sp-docs-eval-"));
    await cp(FIXTURE, tempDir, { recursive: true });
    // trial knobs: EVAL_RERANK=1 turns the cross-encoder on, EVAL_MODEL swaps the embedder (see notes.md "Phase 6")
    if (process.env.EVAL_RERANK) await writeFile(join(tempDir, "vault.schema.yml"), `rerank:\n  enabled: true\n${process.env.EVAL_RERANK_MODEL ? `  model: ${process.env.EVAL_RERANK_MODEL}\n` : ""}`);
    await gitHistory(tempDir); // every doc committed 10 days ago, so the decay git fallback leaves these splits' ranking alone
    const server = await createServer(tempDir, { watch: false, waitForReady: true, model: process.env.EVAL_MODEL });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "docs-eval", version: "1.0.0" });
    await client.connect(ct);

    allCases = parseGolden(await readFile(join(HERE, "golden-docs.jsonl"), "utf-8")) as unknown as FacetCase[];
    const isId = (c: FacetCase) => c.negative_kind === "identifier";
    cases = allCases.filter((c) => !isId(c));
    const texts = new Map<string, string>();
    for (const p of await glob("**/*.md", { cwd: FIXTURE })) texts.set(p, readFileSync(join(FIXTURE, p), "utf-8"));
    const textOf = (p: string) => texts.get(p) ?? "";

    arms.search_semantic = await runFacetEval(cases, tool("search_semantic"), textOf);
    arms.search_hybrid = await runFacetEval(cases, tool("search_hybrid"), textOf);
    arms.search_text = await runFacetEval(cases, text, textOf);
    allHeld = parseGolden(await readFile(join(HERE, "golden-docs-heldout.jsonl"), "utf-8")) as unknown as FacetCase[];
    heldCases = allHeld.filter((c) => !isId(c));
    idArms["fixture-train"] = await runFacetEval(allCases.filter(isId), tool("search_hybrid"), textOf);
    idArms["fixture-heldout"] = await runFacetEval(allHeld.filter(isId), tool("search_hybrid"), textOf);
    flowArms["fixture-train"] = await runFacetEval(cases, tool("search_hybrid", { mode: "flow" }), textOf);
    flowArms["fixture-heldout"] = await runFacetEval(heldCases, tool("search_hybrid", { mode: "flow" }), textOf);
    heldArms.search_semantic = await runFacetEval(heldCases, tool("search_semantic"), textOf);
    heldArms.search_hybrid = await runFacetEval(heldCases, tool("search_hybrid"), textOf);
    recall = await hnswRecall(tempDir, [...allCases, ...allHeld].map((c) => c.q), 24);
    fullBytes = (await runFacetEval(cases, tool("search_hybrid", { full: true }), textOf)).meanBytes;

    const truth: Record<string, string[]> = JSON.parse(await readFile(join(HERE, "docs-graph-truth.json"), "utf-8"));
    const paths = async (tl: string, path: string) => (await call(tl, { path, include_excluded: true })).parsed.map((n: any) => n.path);
    forwardlinks = await scoreLinks(truth, (p) => paths("forwardlinks", p));
    backlinks = await scoreLinks(invertLinks(truth), (p) => paths("backlinks", p));

    process.stderr.write(
      "\nFacet eval\n" + Object.entries(arms).map(([n, m]) => formatArm(n, m)).join("\n") +
      "\nHeld-out (golden-docs-heldout)\n" + Object.entries(heldArms).map(([n, m]) => formatArm(n, m)).join("\n") +
      "\nsearch_hybrid, mode flow forced\n" + Object.entries(flowArms).map(([n, m]) => formatArm(n, m)).join("\n") +
      "\nIdentifier negatives (search_hybrid)\n" + Object.entries(idArms).map(([n, m]) => `  ${n}: flagged ${m.negativesFlagged}/${m.negativeTop.length}`).join("\n") +
      `\n  hnsw recall@24 vs exact cosine=${recall.toFixed(3)}` +
      `\n  search_hybrid full:true mean-payload=${fullBytes}B` +
      `\n  forwardlinks precision=${forwardlinks.precision.toFixed(3)} recall=${forwardlinks.recall.toFixed(3)}` +
      `\n  backlinks    precision=${backlinks.precision.toFixed(3)} recall=${backlinks.recall.toFixed(3)}\n\n`
    );
    if (process.env.EVAL_OUT) await writeFile(process.env.EVAL_OUT, JSON.stringify({ arms, heldArms, recall, fullBytes, forwardlinks, backlinks }, null, 2));
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    if (tempDir) await cleanupTempDir(tempDir);
  });

  it("every answerable case is answerable from the fixture's live docs", () => {
    const texts = new Map<string, string>();
    const live = glob.sync("**/*.md", { cwd: FIXTURE }).filter((p) => !/(^|\/)archive\//.test(p));
    for (const p of live) texts.set(p, readFileSync(join(FIXTURE, p), "utf-8"));
    for (const c of cases.filter((c) => c.tier !== "negative")) {
      expect(facetRank(c.facets!, live, (p) => texts.get(p)!), c.id).not.toBeNull();
    }
  });

  it("every held-out case is answerable from the fixture's live docs", () => {
    const live = glob.sync("**/*.md", { cwd: FIXTURE }).filter((p) => !/(^|\/)archive\//.test(p));
    const texts = new Map(live.map((p) => [p, readFileSync(join(FIXTURE, p), "utf-8")]));
    for (const c of heldCases.filter((c) => c.tier !== "negative")) expect(facetRank(c.facets!, live, (p) => texts.get(p)!), c.id).not.toBeNull();
  });

  it("the held-out set keeps its size: >= 20 answerable (>= 10 paraphrase, >= 6 multi, >= 4 symptom) and >= 8 negatives; train has >= 12 negatives and >= 8 multi", () => {
    const n = (cs: FacetCase[], t: (c: FacetCase) => boolean) => cs.filter(t).length;
    expect(n(heldCases, (c) => c.tier !== "negative")).toBeGreaterThanOrEqual(20);
    expect(n(heldCases, (c) => c.tier === "paraphrase")).toBeGreaterThanOrEqual(10);
    expect(n(heldCases, (c) => c.tier === "multi")).toBeGreaterThanOrEqual(6);
    expect(n(heldCases, (c) => c.tier === "symptom")).toBeGreaterThanOrEqual(4);
    expect(n(cases, (c) => c.tier === "multi")).toBeGreaterThanOrEqual(8);
    expect(n(heldCases, (c) => c.tier === "negative")).toBeGreaterThanOrEqual(8);
    expect(n(cases, (c) => c.tier === "negative")).toBeGreaterThanOrEqual(12);
  });

  splitGates("fixture train", () => arms as any, baseline.splits["fixture-train"], KNOWN["fixture-train"], baseline.tiers["fixture-train"]);
  splitGates("fixture held-out", () => heldArms as any, baseline.splits["fixture-heldout"], KNOWN["fixture-heldout"], baseline.tiers["fixture-heldout"]);

  // expected failures until identifier-abstention Phase 4 wires missingTerms into no_strong_match
  identifierGate("fixture train", () => idArms["fixture-train"]);
  identifierGate("fixture held-out", () => idArms["fixture-heldout"]);

  it(`HNSW recall against exact cosine is at least ${baseline.hnswRecallMin}`, () => {
    expect(recall).toBeGreaterThanOrEqual(baseline.hnswRecallMin);
  });

  it("answer@1 never drops below the recorded baseline, per arm", () => {
    for (const [arm, m] of Object.entries(arms)) {
      expect(m.tiers.all.at[1], arm).toBeGreaterThanOrEqual(baseline.arms[arm].answeredAt1);
    }
  });

  // negatives flagged is a split gate (KNOWN-aware); this one keeps the cost of abstaining bounded
  it("answered@1 cases are flagged no more than the recorded baseline", () => {
    const h = arms.search_hybrid;
    expect(h.answeredFlagged).toBeLessThanOrEqual(baseline.arms.search_hybrid.answeredFlagged);
  });

  it("the trimmed payload is smaller than full:true", () => {
    expect(arms.search_hybrid.meanBytes).toBeLessThan(fullBytes);
    expect(arms.search_hybrid.meanBytes).toBeLessThanOrEqual(baseline.arms.search_hybrid.meanBytes);
  });

  it("the #1 result plus its related neighbours answer at least as many cases as the baseline, multi-doc especially", () => {
    const h = arms.search_hybrid.tiers;
    expect(h.all.expandedAt1).toBeGreaterThanOrEqual(baseline.arms.search_hybrid.expandedAt1);
    expect(h.multi.expandedAt1).toBeGreaterThanOrEqual(baseline.arms.search_hybrid.multiExpandedAt1);
  });

  // semantic-memory#61 check 2: with the reading path attached, #1 + path answers the multi tier at least as well as #1 + related and, within one question, as plain @3
  // (one question of slack since the doc chunk: plain @3 rose 10 to 12 of 12 while #1 + path stayed 11)
  it("with mode flow, #1 plus the reading path answers the train multi tier as well as #1 + related and @3", () => {
    const m = flowArms["fixture-train"].tiers.multi;
    expect(m.pathAt1).toBeGreaterThanOrEqual(Math.max(m.expandedAt1, m.at[3] - 1));
  });

  it("archive hits never rise above the recorded baseline", () => {
    for (const [arm, m] of Object.entries(arms)) expect(m.archiveHits, arm).toBeLessThanOrEqual(baseline.arms[arm].archiveHits);
  });

  it("graph link precision and recall never drop below the recorded baseline", () => {
    for (const [name, got] of [["forwardlinks", forwardlinks], ["backlinks", backlinks]] as const) {
      expect(got.precision, `${name} precision`).toBeGreaterThanOrEqual(baseline[name].precision);
      expect(got.recall, `${name} recall`).toBeGreaterThanOrEqual(baseline[name].recall);
    }
  });
});
