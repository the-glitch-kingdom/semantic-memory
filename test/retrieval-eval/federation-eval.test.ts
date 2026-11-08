import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { gitHistory } from "./git-history.js";
import { parseGolden } from "./eval.js";
import { cleanupTempDir } from "../setup.js";

/**
 * Federated eval (federated-search Phase 5): test/fixtures/docs-vault as the primary plus test/fixtures/vault as the
 * source "vault", against each index alone. A case is found@k when one of its expected (source, path) pairs is in the
 * first k results. Alone arms are tagged with the source they stand for. Gates: federated found@3 beats either index
 * alone on the joint set, and on each source's own questions federated @1 is at most one case below that source alone.
 * Real-corpus-style slack: HNSW is random per build, so the floors sit one case under the measured values.
 */
const FIX = join(import.meta.dirname, "..", "fixtures");
interface Case { id: string; q: string; own: "primary" | "vault" | "both"; expected: { source: string; path: string }[] }
type Hit = { source: string; path: string };

const rank = (c: Case, hits: Hit[]) => {
  const i = hits.findIndex((h) => c.expected.some((e) => e.source === h.source && e.path === h.path));
  return i < 0 ? Infinity : i + 1;
};
const found = (cs: Case[], hits: Map<string, Hit[]>, k: number) => cs.filter((c) => rank(c, hits.get(c.id)!) <= k).length;

describe("Federated eval (docs-vault + vault)", () => {
  const dirs: string[] = [];
  const sets: Record<string, Case[]> = {};
  const arms: Record<string, Record<string, Map<string, Hit[]>>> = {}; // split -> arm -> case id -> hits
  let closers: (() => Promise<void>)[] = [];

  const run = async (cs: Case[], call: (q: string) => Promise<Hit[]>) => new Map(await Promise.all(cs.map(async (c) => [c.id, await call(c.q)] as const)));
  const searcher = (e: Awaited<ReturnType<typeof startEval>>, tag?: string) => async (q: string): Promise<Hit[]> => {
    const res: any = await e.client.callTool({ name: "search_hybrid", arguments: { query: q, limit: 8 } });
    return (JSON.parse(res.content[0].text) as any[]).map((r) => ({ source: tag ?? r.source, path: r.path }));
  };

  beforeAll(async () => {
    const docs = await startEval(join(FIX, "docs-vault"), "fed-eval-docs-", gitHistory);
    const vault = await startEval(join(FIX, "vault"), "fed-eval-vault-");
    // the federated primary is its own copy of docs-vault with the vault copy as the source
    const fed = await startEval(join(FIX, "docs-vault"), "fed-eval-p-", async (dir) => {
      await gitHistory(dir);
      await writeFile(join(dir, "vault.schema.yml"), `federation:\n  related_repos: false\n  sources:\n    - {label: vault, path: ${vault.dir}}\n`);
    });
    dirs.push(docs.dir, vault.dir, fed.dir);
    closers = [docs, vault, fed].map((e) => () => e.client.close());

    // the source builds in the background: wait until a vault-only question is answered from it
    const probe = searcher(fed);
    for (const end = Date.now() + 120_000; Date.now() < end; await new Promise((ok) => setTimeout(ok, 300))) {
      if ((await probe("what is the single entry point for client requests")).some((h) => h.source === "vault")) break;
    }

    for (const [split, file] of [["train", "golden-federation.jsonl"], ["heldout", "golden-federation-heldout.jsonl"]] as const) {
      const cs = parseGolden(await readFile(join(import.meta.dirname, file), "utf-8")) as unknown as Case[];
      sets[split] = cs;
      arms[split] = { federated: await run(cs, probe), docs: await run(cs, searcher(docs, "primary")), vault: await run(cs, searcher(vault, "vault")) };
    }

    const line = (split: string) => {
      const cs = sets[split];
      const f = (arm: string, own?: string) => { const sub = own ? cs.filter((c) => c.own === own) : cs; const h = arms[split][arm]; return `@1 ${found(sub, h, 1)} @3 ${found(sub, h, 3)} /${sub.length}`; };
      return `  ${split}: joint federated ${f("federated")} | docs alone ${f("docs")} | vault alone ${f("vault")}\n` +
        `    own primary: federated ${f("federated", "primary")} | docs alone ${f("docs", "primary")}\n    own vault: federated ${f("federated", "vault")} | vault alone ${f("vault", "vault")}`;
    };
    process.stderr.write(`\nFederated eval (found@k, source-qualified)\n${line("train")}\n${line("heldout")}\n\n`);
  }, 360_000);

  afterAll(async () => {
    await Promise.all(closers.map((c) => c()));
    await Promise.all(dirs.map(cleanupTempDir));
  });

  it("has the planned shape: >= 20 train and >= 20 held-out cases, each side's own questions in both", () => {
    for (const cs of Object.values(sets)) {
      expect(cs.length).toBeGreaterThanOrEqual(20);
      expect(cs.filter((c) => c.own === "primary").length).toBeGreaterThanOrEqual(10);
      expect(cs.filter((c) => c.own === "vault").length).toBeGreaterThanOrEqual(6);
    }
  });

  for (const split of ["train", "heldout"]) {
    it(`${split}: federated found@3 on the joint set is above either index alone`, () => {
      const a = arms[split];
      const fed = found(sets[split], a.federated, 3);
      expect(fed).toBeGreaterThan(found(sets[split], a.docs, 3));
      expect(fed).toBeGreaterThan(found(sets[split], a.vault, 3));
    });

    for (const [own, alone] of [["primary", "docs"], ["vault", "vault"]] as const) {
      it(`${split}: on ${own}'s own questions federated @1 is at most one case below ${alone} alone`, () => {
        const cs = sets[split].filter((c) => c.own === own);
        expect(found(cs, arms[split].federated, 1)).toBeGreaterThanOrEqual(found(cs, arms[split][alone], 1) - 1);
      });
    }
  }
});
