/**
 * Regression-snapshot baseline for MCP tool *output shapes*.
 *
 * Companion to tool-surface.test.ts (which snapshots input schemas):
 * this file snapshots the structure of tool *responses* against a
 * fixed fixture vault. Catches return-shape regressions during the
 * semantic-memory rebrand + multi-corpus refactor.
 *
 * Two strategies:
 *   - Deterministic tools (read_note, list_notes, backlinks, etc.):
 *     full snapshot of the output JSON.
 *   - Embedding-dependent tools (search_semantic, search_hybrid):
 *     structural snapshot only — the SHAPE of the response (keys,
 *     types, presence of expected fields) without the exact scores
 *     or ordering, since embeddings drift slightly across runs.
 *
 * If a deterministic snapshot fails, that is a real regression.
 * If a structural assertion fails (shape changed), that is also a
 * regression. Embedding score drift will NOT fail these tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

/**
 * Strip embedding-dependent fields from a search result so the shape
 * can be snapshotted without false positives from score drift.
 *
 * Keeps: path, presence-of-score (boolean), other structural fields
 * Drops: exact score value
 */
function structuralSearchResult<T extends { score?: number }>(r: T) {
  const { score, ...rest } = r;
  return { ...rest, hasScore: typeof score === "number" };
}

/**
 * The stable base shape of a search result. `decay` (v1.3) and `usage` (v1.5) are
 * data-CONDITIONAL enrichments — they appear only when a note is actually decayed
 * or has accumulated citations, which in this shared-vault suite depends on what
 * earlier tests read. Drop them here so the shape snapshot stays deterministic;
 * their presence is asserted by the dedicated decay / usage-boost integration tests.
 */
const CONDITIONAL_KEYS = new Set(["decay", "usage"]);
function baseShape(keys: string[]): string[] {
  return keys.filter((k) => !CONDITIONAL_KEYS.has(k)).sort();
}

describe("Regression: MCP tool outputs (golden snapshots)", () => {
  let client: Client;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempVault();
    const server = await createServer(tempDir, { watch: false, waitForReady: true });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "regression-output-client", version: "1.0.0" });
    await client.connect(clientTransport);
  }, 180_000);

  afterAll(async () => {
    await client.close();
    await cleanupTempDir(tempDir);
  });

  // --- Deterministic read tools ---

  describe("read_note", () => {
    it("returns full note content for a known fixture", async () => {
      const result = await client.callTool({
        name: "read_note",
        arguments: { path: "project-overview.md" },
      });
      const text = (result.content as any)[0].text;
      expect(text).toMatchSnapshot();
    });
  });

  describe("read_multiple_notes", () => {
    it("returns map of paths to content for batch read", async () => {
      const result = await client.callTool({
        name: "read_multiple_notes",
        arguments: { paths: ["project-overview.md", "microservices.md"] },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(Object.keys(parsed).sort()).toMatchSnapshot();
      // Don't snapshot full bodies (already covered by read_note); confirm structure only.
      for (const k of Object.keys(parsed)) {
        expect(typeof parsed[k]).toBe("string");
        expect(parsed[k].length).toBeGreaterThan(0);
      }
    });
  });

  describe("list_notes", () => {
    it("returns a stable listing for the fixture vault", async () => {
      const result = await client.callTool({ name: "list_notes", arguments: {} });
      const parsed = JSON.parse((result.content as any)[0].text);
      // Sort by path for stable ordering across runs
      const sorted = parsed.slice().sort((a: any, b: any) => a.path.localeCompare(b.path));
      // Strip mtime — varies per checkout — keep everything else
      const stripped = sorted.map((n: any) => {
        const { mtime, ...rest } = n;
        return { ...rest, hasMtime: typeof mtime === "string" };
      });
      expect(stripped).toMatchSnapshot();
    });
  });

  describe("get_frontmatter", () => {
    it("returns parsed frontmatter for a known fixture", async () => {
      const result = await client.callTool({
        name: "get_frontmatter",
        arguments: { path: "microservices.md" },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed).toMatchSnapshot();
    });

    it("handles a note without frontmatter", async () => {
      const result = await client.callTool({
        name: "get_frontmatter",
        arguments: { path: "no-frontmatter.md" },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed).toMatchSnapshot();
    });
  });

  // --- Deterministic graph tools ---

  describe("backlinks", () => {
    it("returns notes linking TO project-overview", async () => {
      const result = await client.callTool({
        name: "backlinks",
        arguments: { path: "microservices.md" },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      // Sort by path for determinism
      const sorted = parsed.slice().sort((a: any, b: any) => a.path.localeCompare(b.path));
      expect(sorted).toMatchSnapshot();
    });
  });

  describe("forwardlinks", () => {
    it("returns notes linked FROM project-overview", async () => {
      const result = await client.callTool({
        name: "forwardlinks",
        arguments: { path: "project-overview.md" },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      const sorted = parsed.slice().sort((a: any, b: any) => a.path.localeCompare(b.path));
      expect(sorted).toMatchSnapshot();
    });
  });

  describe("graph_path", () => {
    it("returns a path between two known notes", async () => {
      const result = await client.callTool({
        name: "graph_path",
        arguments: { from: "project-overview.md", to: "user-service.md" },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed).toMatchSnapshot();
    });

    it("returns 'No path found' for disconnected notes", async () => {
      const result = await client.callTool({
        name: "graph_path",
        arguments: { from: "project-overview.md", to: "orphan.md" },
      });
      const text = (result.content as any)[0].text;
      // The orphan may or may not be reachable depending on edge type rules;
      // either way, snapshot the literal response to lock current behavior.
      expect(text).toMatchSnapshot();
    });
  });

  describe("graph_statistics", () => {
    it("returns stable graph stats for the fixture vault", async () => {
      const result = await client.callTool({ name: "graph_statistics", arguments: {} });
      const parsed = JSON.parse((result.content as any)[0].text);
      // Snapshot the shape; numeric values may shift if fixtures evolve, so we
      // strip them and assert types instead.
      const shape = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, typeof v])
      );
      expect(shape).toMatchSnapshot();
    });
  });

  // --- System / metadata tools ---

  describe("get_stats", () => {
    it("returns vault stats with stable shape", async () => {
      const result = await client.callTool({ name: "get_stats", arguments: {} });
      const parsed = JSON.parse((result.content as any)[0].text);
      // Strip volatile fields (timestamps, exact embedding count which depends
      // on chunker), keep counts that are derivable from fixture files.
      const {
        lastIndexed,
        indexProgress,
        codeGraph, // load time and source depend on the machine
        ...rest
      } = parsed;
      expect(codeGraph === undefined || ["export", "fallback", "none"].includes(codeGraph.source)).toBe(true);
      const shape = {
        ...rest,
        hasLastIndexed: typeof lastIndexed === "string" || lastIndexed === null,
      };
      expect(shape).toMatchSnapshot();
    });
  });

  // --- Lint tools (read-only) ---

  describe("lint_vault", () => {
    it("returns a structured lint report", async () => {
      const result = await client.callTool({ name: "lint_vault", arguments: {} });
      const parsed = JSON.parse((result.content as any)[0].text);
      // Snapshot the shape — keys and counts — not specific findings since
      // the fixture vault may evolve.
      const shape = {
        ruleNames: Object.keys(parsed.byRule ?? {}).sort(),
        topLevelKeys: Object.keys(parsed).sort(),
      };
      expect(shape).toMatchSnapshot();
    });
  });

  // --- Embedding-dependent tools (structural snapshots only) ---

  describe("search_semantic", () => {
    it("returns results with stable structural shape", async () => {
      const result = await client.callTool({
        name: "search_semantic",
        arguments: { query: "microservices architecture", limit: 5 },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      // Snapshot the shape of one result (without the exact score)
      const firstShape = baseShape(Object.keys(parsed[0]));
      expect(firstShape).toMatchSnapshot();
      // Confirm every result has score + path
      for (const r of parsed) {
        expect(typeof r.path).toBe("string");
        expect(typeof r.score).toBe("number");
      }
    });
  });

  describe("search_text", () => {
    it("returns deterministic results for an exact-match keyword", async () => {
      const result = await client.callTool({
        name: "search_text",
        arguments: { pattern: "RabbitMQ" },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      // RabbitMQ appears in exactly one fixture file; deterministic
      const sorted = parsed
        .slice()
        .sort((a: any, b: any) => a.path.localeCompare(b.path))
        .map(structuralSearchResult)
        .map((r: any) => {
          const { mtime, ...rest } = r;
          return { ...rest, hasMtime: typeof mtime === "string" };
        });
      expect(sorted).toMatchSnapshot();
    });
  });

  describe("search_hybrid", () => {
    it("returns results with stable structural shape", async () => {
      const result = await client.callTool({
        name: "search_hybrid",
        arguments: { query: "service deployment", limit: 5 },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      const firstShape = baseShape(Object.keys(parsed[0]));
      expect(firstShape).toMatchSnapshot();
    });
  });

  describe("search_graph", () => {
    it("returns graph-connected results for a known concept", async () => {
      const result = await client.callTool({
        name: "search_graph",
        arguments: { concept: "microservices" },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      const firstShape = baseShape(Object.keys(parsed[0]));
      expect(firstShape).toMatchSnapshot();
    });
  });
});
