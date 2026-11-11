import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { GROUPS, TOPICS, findTopics, renderHelp, renderTopic } from "../../src/core/help/topics.js";

describe("help topics", () => {
  it("has unique ids and aliases, known groups, and real doc files", () => {
    const names = TOPICS.flatMap((t) => [t.id, ...t.aliases]);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOPICS) {
      expect(GROUPS).toContain(t.group);
      expect(existsSync(t.doc), t.doc).toBe(true);
    }
  });
  it("matches by id, alias and title words", () => {
    expect(findTopics("federated-search")[0].id).toBe("federated-search");
    expect(findTopics("air-gapped")[0].id).toBe("offline-install");
    expect(findTopics("how do I add another index")[0].id).toBe("add-index");
    expect(findTopics("measure search on my docs").map((t) => t.id)).toEqual(["eval"]);
    expect(findTopics("zzzz")).toEqual([]);
  });
  it("renders the index grouped, a topic in both formats, and the no-match case", () => {
    const idx = renderHelp(undefined, "text");
    for (const g of GROUPS) expect(idx).toContain(g);
    const t = TOPICS[0];
    expect(renderTopic(t, "markdown")).toContain(`# ${t.title}`);
    expect(renderTopic(t, "text")).toContain("STEPS");
    expect(renderHelp("zzzz", "text")).toContain("No help topic matches");
  });
});

describe("task phrases from the plan", () => {
  it.each([
    ["search across another repo's docs", "federated-search"],
    ["add another index", "add-index"],
    ["see what my docs fail to answer", "gaps"],
    ["use a different embedder", "embedder"],
    ["make decay use git", "decay"],
    ["check the install", "healthcheck"],
  ])("%s", (q, id) => expect(findTopics(q).map((t) => t.id)).toContain(id));
});

describe("help surfaces", () => {
  it("CLI and MCP tool render the same topic source", async () => {
    const { execFileSync } = await import("node:child_process");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createServer } = await import("../../src/mcp/server.js");
    const { createTempVault, cleanupTempDir } = await import("../setup.js");
    const dir = await createTempVault();
    try {
      const server = await createServer(dir, { watch: false, waitForReady: false });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const client = new Client({ name: "help", version: "1.0.0" });
      await client.connect(ct);
      const r: any = await client.callTool({ name: "help", arguments: { topic: "federated search" } });
      expect(r.content[0].text).toBe(renderHelp("federated search", "markdown"));
      await client.close();
      const out = execFileSync("node", ["bin/semantic-memory", "help", "federated", "search"], { encoding: "utf8" });
      expect(out.trim()).toBe(renderHelp("federated search", "text").trim());
    } finally {
      await cleanupTempDir(dir);
    }
  }, 60_000);
});

// #93: the long-term-memory topic. `it.fails` = the topic does not exist yet (Phase 12).
describe("long-term-memory topic", () => {
  it.fails.each(["long-term memory", "cold storage", "opt-in", "documentation-cold"])("`help %s` resolves to it", (words) => {
    expect(findTopics(words).map((t) => t.id)).toEqual(["long-term-memory"]); // what `help <words>` renders
  });

  it.fails("is in the group \"Search more\", says it is opt-in, and the no-topic index lists it there", () => {
    const t = TOPICS.find((x) => x.id === "long-term-memory")!;
    expect(t.group).toBe("Search more");
    expect(renderTopic(t, "text")).toMatch(/opt-in/i);
    const idx = renderHelp(undefined, "text");
    const section = idx.slice(idx.indexOf("Search more"));
    expect(section.slice(0, section.indexOf("\n\n") > 0 ? section.indexOf("\n\n") : undefined)).toContain("long-term-memory");
  });

  it.fails("the MCP `help {topic: \"long-term-memory\"}` serves the same text", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createServer } = await import("../../src/mcp/server.js");
    const { createTempVault, cleanupTempDir } = await import("../setup.js");
    const dir = await createTempVault();
    try {
      const server = await createServer(dir, { watch: false, waitForReady: false });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const client = new Client({ name: "help", version: "1.0.0" });
      await client.connect(ct);
      const r: any = await client.callTool({ name: "help", arguments: { topic: "long-term-memory" } });
      expect(r.content[0].text).toBe(renderHelp("long-term-memory", "markdown"));
      expect(r.content[0].text).toContain("Search long-term memory");
      await client.close();
    } finally {
      await cleanupTempDir(dir);
    }
  }, 60_000);
});
