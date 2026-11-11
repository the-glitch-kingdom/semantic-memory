import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { GEN_A, GEN_B, FAKE_SECRET, FIXTURES, allFileText, lockTree, makeProject, unlockTree, type Project } from "../long-term-fixture.js";

// #93 acceptance: opt-in query, lazy index, locked read-only, cold_storage manifest, "long-term" target.
// `it.fails` = not implemented yet (Phase 3-5); each is confirmed to fail for the stated reason when run as plain `it`.

async function connect(dir: string, waitForReady = true): Promise<Client> {
  const server = await createServer(dir, { waitForReady });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "lt-optin", version: "1.0.0" });
  await client.connect(ct);
  return client;
}
const FED = "  related_repos: false\n  sources:\n    - {label: legacy, path: ../legacy-docs, default: false}\n    - {label: frozen, path: ../frozen-docs, default: false, locked: true}\n";

describe("opt-in sources, locked sources and cold generations over MCP", () => {
  let p: Project;
  let client: Client;
  const frozen = () => join(p.root, "frozen-docs");
  const call = async (name: string, args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name, arguments: args });
    const text: string = r.content.map((c: any) => c.text).join("\n");
    let hits: any[] = [];
    try { hits = JSON.parse(r.content[0].text); } catch { /* a plain-text message */ }
    return { r, text, hits: Array.isArray(hits) ? hits : [] };
  };
  /** Ask until the opt-in source has answered (a cold source answers "Indexing in progress" while it builds). */
  const ask = async (name: string, args: Record<string, unknown>) => {
    const deadline = Date.now() + 150_000;
    for (;;) {
      const a = await call(name, args);
      if (a.hits.length || !/Indexing in progress/.test(a.text) || Date.now() > deadline) return a;
      await new Promise((ok) => setTimeout(ok, 400));
    }
  };

  beforeAll(async () => {
    p = await makeProject({ federation: FED });
    await cp(join(FIXTURES, "vault"), frozen(), { recursive: true });
    lockTree(frozen()); // chmod -R a-w, as hit-em-with-the-docs leaves a cold generation
    client = await connect(p.docs);
  }, 240_000);
  afterAll(async () => {
    await client.close();
    unlockTree(frozen());
    await p.cleanup();
  });

  describe("opt-in query", () => {
    it.fails("sources: [legacy] returns only that source's hits, each with `source`", async () => {
      const { hits } = await ask("search_hybrid", { query: "what is the single entry point for client requests", sources: ["legacy"] });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.source === "legacy")).toBe(true);
      expect(hits[0].path).toBe("api-gateway.md");
    }, 180_000);

    it.fails("sources: [primary, legacy] adds it to the default set", async () => {
      const { hits } = await ask("search_hybrid", { query: "how do services communicate and deploy", limit: 10, sources: ["primary", "legacy"] });
      const labels = new Set(hits.map((h) => h.source));
      expect(labels.has("primary") && labels.has("legacy")).toBe(true);
    }, 180_000);

    it.fails("an unknown label gets a clear message, never silently the default set", async () => {
      const { text, hits } = await call("search_hybrid", { query: "gateway", sources: ["nope"] });
      expect(text).toMatch(/unknown.*source.*nope/i);
      expect(hits).toEqual([]);
    });

    it.fails("search_text and search_semantic take `sources` the same way", async () => {
      const t = await ask("search_text", { query: "gateway", sources: ["legacy"] });
      expect(t.hits.length).toBeGreaterThan(0);
      expect(t.hits.every((h) => h.source === "legacy")).toBe(true);
      const s = await ask("search_semantic", { query: "single entry point for client requests", sources: ["legacy"] });
      expect(s.hits.length).toBeGreaterThan(0);
      expect(s.hits.every((h) => h.source === "legacy")).toBe(true);
    }, 180_000);

    it.fails("read_note {source: legacy} works for an opt-in label", async () => {
      await ask("search_hybrid", { query: "gateway", sources: ["legacy"] }); // opens it where opt-in is implemented
      const { text } = await call("read_note", { path: "api-gateway.md", source: "legacy" });
      expect(text).toContain("single entry point");
    }, 180_000);
  });

  describe("locked and read-only", () => {
    // holds today (every source is read-only and indexed under sourceIndexPath), so a regression guard
    it("a locked source in a read-only folder indexes without writing into it; its index lives under sourceIndexPath", async () => {
      await ask("search_hybrid", { query: "gateway", sources: ["frozen"] });
      expect((await readdir(frozen())).includes(".semantic-sidekick-index")).toBe(false);
      expect((await readdir(join(p.index, "sources"))).some((d) => d.startsWith("frozen-"))).toBe(true);
    }, 180_000);

    it.fails("after a file in it changes, the next query answers from the old index and warns; it never rebuilds", async () => {
      await ask("search_text", { query: "gateway", sources: ["frozen"] });
      unlockTree(frozen());
      await writeFile(join(frozen(), "newcomer.md"), "# Newcomer\n\nThe gryphon bridge handles overnight settlement.\n");
      await new Promise((ok) => setTimeout(ok, 1500)); // a live source would have reconciled by now
      const { text, hits } = await call("search_text", { query: "gryphon", sources: ["frozen"] });
      expect(hits.some((h) => h.path === "newcomer.md")).toBe(false);
      expect(text).toMatch(/changed/i);
    }, 180_000);

    it.fails("MCP reindex {source} is the explicit human rebuild: the changed file is found after it", async () => {
      await call("reindex", { source: "frozen" });
      const { hits } = await ask("search_text", { query: "gryphon", sources: ["frozen"] });
      expect(hits.some((h) => h.path === "newcomer.md")).toBe(true);
    }, 180_000);
  });

  describe("cold_storage manifest", () => {
    const cold = (g: string) => `cold-${g}`;

    it.fails("registers each generation as an opt-in source `cold-<generation>`; every hit carries historical", async () => {
      const a = await ask("search_hybrid", { query: "why did we add request coalescing to the Skerry cache", sources: [cold(GEN_A)] });
      expect(a.hits[0]).toMatchObject({
        path: "operational/skerry-cache-stampede.md",
        source: cold(GEN_A),
        historical: { generation: GEN_A, source_commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", rotated_at: "2026-01-15T09:30:00Z" },
      });
      expect(a.hits.every((h) => h.historical?.generation === GEN_A)).toBe(true);
    }, 180_000);

    it.fails("a generation's own archive/ is searchable", async () => {
      const { hits } = await ask("search_text", { query: "pelican sharding abandoned", sources: [cold(GEN_A)] });
      expect(hits.map((h) => h.path)).toContain("archive/pelican-sharding-plan.md");
    }, 180_000);

    it("a plain search never surfaces a cold generation", async () => {
      const { hits } = await call("search_hybrid", { query: "why did we add request coalescing to the Skerry cache", limit: 10 });
      expect(hits.every((h) => !h.historical && !String(h.source ?? "").startsWith("cold-"))).toBe(true);
    });

    it.fails("a file named in secrets_findings is never indexed, embedded or returned, and its text is on no disk file", async () => {
      await ask("search_text", { query: "skerry", sources: [cold(GEN_A)] });
      // the secret itself is never put in a query: the tools echo a query's unknown identifiers back (missing_terms)
      for (const q of ["relay deploy token rotated every quarter", "pelican handoff runs use the token"]) {
        const { text, hits } = await call("search_hybrid", { query: q, sources: [cold(GEN_A)] });
        expect(text).not.toContain(FAKE_SECRET);
        expect(hits.some((h) => h.path === "operational/deploy-credentials.md")).toBe(false);
      }
      const rn = await call("read_note", { path: "operational/deploy-credentials.md", source: cold(GEN_A) });
      expect(rn.text).not.toContain(FAKE_SECRET);
      expect(allFileText(join(p.index, "sources"))).not.toContain(FAKE_SECRET);
      expect(allFileText(join(p.index, "sources"))).toContain("coalescing"); // the generation really was indexed, so the absence means something
    }, 180_000);

    it.fails("get_stats lists the sources with default, locked and, for cold ones, the generation", async () => {
      const { text } = await call("get_stats", {});
      const stats = JSON.parse(text);
      const row = (stats.sources as any[]).find((s) => s.label === cold(GEN_A));
      expect(row).toMatchObject({ default: false, locked: true, generation: GEN_A });
    });
  });

  describe('the "long-term" target', () => {
    it.fails("sources: [long-term] searches every cold generation, merged, each hit labelled with source and generation", async () => {
      const q = "what did we decide about the cache stampede and the billing migration";
      const deadline = Date.now() + 150_000;
      let hits: any[] = [];
      while (Date.now() < deadline) {
        hits = (await call("search_hybrid", { query: q, limit: 10, sources: ["long-term"] })).hits;
        if (new Set(hits.map((h) => h.source)).size >= 2) break;
        await new Promise((ok) => setTimeout(ok, 500));
      }
      expect(new Set(hits.map((h) => h.source))).toEqual(new Set([`cold-${GEN_A}`, `cold-${GEN_B}`]));
      expect(hits.every((h) => h.historical?.generation && `cold-${h.historical.generation}` === h.source)).toBe(true);
      expect(hits.map((h) => h.path)).toEqual(expect.arrayContaining(["operational/skerry-cache-stampede.md", "decisions/quillon-billing-migration.md"]));
    }, 180_000);

    it.fails("a query can name one generation of long-term memory (a `-2` same-day suffix is a valid label)", async () => {
      const { hits } = await ask("search_hybrid", { query: "why did we move invoicing off the nightly batch", sources: [`cold-${GEN_B}`] });
      expect(hits[0]).toMatchObject({ path: "decisions/quillon-billing-migration.md", historical: { generation: GEN_B } });
    }, 180_000);
  });
});

describe("lazy index", () => {
  let p: Project;
  let client: Client;
  beforeAll(async () => {
    p = await makeProject({ federation: FED, cold: false });
    client = await connect(p.docs);
  }, 240_000);
  afterAll(async () => {
    await client.close();
    await p.cleanup();
  });

  it.fails("the first opt-in query on an unbuilt source answers `Indexing in progress`, then real hits once built", async () => {
    const first: any = await client.callTool({ name: "search_hybrid", arguments: { query: "single entry point for client requests", sources: ["legacy"] } });
    expect(first.content.map((c: any) => c.text).join("\n")).toContain("Indexing in progress");
    const deadline = Date.now() + 150_000;
    let hits: any[] = [];
    while (!hits.length && Date.now() < deadline) {
      await new Promise((ok) => setTimeout(ok, 400));
      const r: any = await client.callTool({ name: "search_hybrid", arguments: { query: "single entry point for client requests", sources: ["legacy"] } });
      try { hits = JSON.parse(r.content[0].text); } catch { hits = []; }
    }
    expect(hits[0]).toMatchObject({ source: "legacy", path: "api-gateway.md" });
  }, 180_000);
});

describe("a checksum mismatch refuses that generation only", () => {
  let p: Project;
  let client: Client;
  beforeAll(async () => {
    p = await makeProject({ badChecksum: GEN_B });
    client = await connect(p.docs);
  }, 240_000);
  afterAll(async () => {
    await client.close();
    await p.cleanup();
  });

  it.fails("one-line [federation: source ... skipped] note for it; the other generation still answers", async () => {
    const deadline = Date.now() + 150_000;
    let text = "";
    let hits: any[] = [];
    while (Date.now() < deadline) {
      const r: any = await client.callTool({ name: "search_hybrid", arguments: { query: "request coalescing Skerry cache", limit: 10, sources: ["long-term"] } });
      text = r.content.map((c: any) => c.text).join("\n");
      try { hits = JSON.parse(r.content[0].text); } catch { hits = []; }
      if (hits.length) break;
      await new Promise((ok) => setTimeout(ok, 500));
    }
    expect(hits.some((h) => h.source === `cold-${GEN_A}`)).toBe(true);
    expect(hits.some((h) => h.source === `cold-${GEN_B}`)).toBe(false);
    expect(text).toMatch(new RegExp(`\\[federation: source "cold-${GEN_B}" skipped.*checksum`));
    expect(existsSync(join(p.index, "sources"))).toBe(true);
  }, 180_000);
});
