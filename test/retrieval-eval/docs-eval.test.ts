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
import {
  runFacetEval, scoreLinks, invertLinks, facetRank, formatArm, parseGolden,
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
const STOP = new Set("the a an of to for and or in on is are do does how what which when where who with from that this it we our can i my be".split(" "));

describe("Facet eval (golden-docs vs docs-vault)", () => {
  let client: Client;
  let tempDir: string;
  const arms: Record<string, ArmMetrics> = {};
  let backlinks: LinkMetrics;
  let forwardlinks: LinkMetrics;
  let cases: FacetCase[];
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
    return { results: parsed.map((r: any) => ({ path: r.path, score: r.score })), bytes, weak: parsed.some((r: any) => r.no_strong_match) };
  };
  // the "grep" arm: every content word of the question as one alternation, in the tool's own order
  const text: ArmFn = async (q, limit) => {
    const words = q.toLowerCase().match(/[a-z0-9_]+/g)!.filter((w) => w.length > 2 && !STOP.has(w));
    const { parsed, bytes } = await call("search_text", { pattern: words.join("|"), regex: true, limit });
    return { results: parsed.map((r: any) => ({ path: r.path, score: r.score })), bytes };
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sp-docs-eval-"));
    await cp(FIXTURE, tempDir, { recursive: true });
    // trial knobs: EVAL_RERANK=1 turns the cross-encoder on, EVAL_MODEL swaps the embedder (see notes.md "Phase 6")
    if (process.env.EVAL_RERANK) await writeFile(join(tempDir, "vault.schema.yml"), `rerank:\n  enabled: true\n${process.env.EVAL_RERANK_MODEL ? `  model: ${process.env.EVAL_RERANK_MODEL}\n` : ""}`);
    const server = await createServer(tempDir, { watch: false, waitForReady: true, model: process.env.EVAL_MODEL });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "docs-eval", version: "1.0.0" });
    await client.connect(ct);

    cases = parseGolden(await readFile(join(HERE, "golden-docs.jsonl"), "utf-8")) as unknown as FacetCase[];
    const texts = new Map<string, string>();
    for (const p of await glob("**/*.md", { cwd: FIXTURE })) texts.set(p, readFileSync(join(FIXTURE, p), "utf-8"));
    const textOf = (p: string) => texts.get(p) ?? "";

    arms.search_semantic = await runFacetEval(cases, tool("search_semantic"), textOf);
    arms.search_hybrid = await runFacetEval(cases, tool("search_hybrid"), textOf);
    arms.search_text = await runFacetEval(cases, text, textOf);
    fullBytes = (await runFacetEval(cases, tool("search_hybrid", { full: true }), textOf)).meanBytes;

    const truth: Record<string, string[]> = JSON.parse(await readFile(join(HERE, "docs-graph-truth.json"), "utf-8"));
    const paths = async (tl: string, path: string) => (await call(tl, { path })).parsed.map((n: any) => n.path);
    forwardlinks = await scoreLinks(truth, (p) => paths("forwardlinks", p));
    backlinks = await scoreLinks(invertLinks(truth), (p) => paths("backlinks", p));

    process.stderr.write(
      "\nFacet eval\n" + Object.entries(arms).map(([n, m]) => formatArm(n, m)).join("\n") +
      `\n  search_hybrid full:true mean-payload=${fullBytes}B` +
      `\n  forwardlinks precision=${forwardlinks.precision.toFixed(3)} recall=${forwardlinks.recall.toFixed(3)}` +
      `\n  backlinks    precision=${backlinks.precision.toFixed(3)} recall=${backlinks.recall.toFixed(3)}\n\n`
    );
    if (process.env.EVAL_OUT) await writeFile(process.env.EVAL_OUT, JSON.stringify({ arms, fullBytes, forwardlinks, backlinks }, null, 2));
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

  it("answer@1 never drops below the recorded baseline, per arm", () => {
    for (const [arm, m] of Object.entries(arms)) {
      expect(m.tiers.all.at[1], arm).toBeGreaterThanOrEqual(baseline.arms[arm].answeredAt1);
    }
  });

  it("every negative reports no_strong_match and answered@1 cases are flagged no more than the recorded baseline", () => {
    const h = arms.search_hybrid;
    expect(h.negativesFlagged).toBe(h.negativeTop.length);
    expect(h.answeredFlagged).toBeLessThanOrEqual(baseline.arms.search_hybrid.answeredFlagged);
  });

  it("the trimmed payload is smaller than full:true", () => {
    expect(arms.search_hybrid.meanBytes).toBeLessThan(fullBytes);
    expect(arms.search_hybrid.meanBytes).toBeLessThanOrEqual(baseline.arms.search_hybrid.meanBytes);
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
