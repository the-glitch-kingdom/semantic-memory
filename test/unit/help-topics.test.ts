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
