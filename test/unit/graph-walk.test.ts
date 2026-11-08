import { describe, it, expect } from "vitest";
import { GraphBuilder } from "../../src/core/graph.js";

function build(nodes: string[], edges: [string, string][], code: string[] = []): GraphBuilder {
  const b = new GraphBuilder();
  const g = b.getGraph();
  for (const n of nodes) g.addNode(n, { title: n, tags: [] });
  for (const n of code) g.addNode(n, { kind: "code", title: n, tags: [] });
  for (const [a, c] of edges) g.addEdgeWithKey(`${a}>${c}`, a, c, { type: "link", weight: 1 });
  return b;
}

describe("GraphBuilder.walk (PPR)", () => {
  // chain a - b - c - d (links point one way; the walk goes both)
  const chain = () => build(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["d", "c"]]);

  it("ranks by closeness to the seed, and matches a hand-solved 2-node graph", () => {
    const r = chain().walk(new Map([["a", 1]]), { maxSteps: 100 });
    expect(r.map((x) => x.path)).toEqual(["b", "a", "c", "d"]); // b: a's only neighbour, so it collects a's whole walk
    // x - y, seed x, alpha .15: px = .15 + .85 py, py = .85 px  =>  px = .15 / (1 - .7225)
    const two = build(["x", "y"], [["x", "y"]]).walk(new Map([["x", 1]]), { maxSteps: 200 });
    expect(two[0].score).toBeCloseTo(0.15 / (1 - 0.7225), 4);
    expect(two[0].score + two[1].score).toBeCloseTo(1, 4);
  });

  it("is deterministic and bounded by maxNodes and maxDegree", () => {
    const b = chain();
    expect(b.walk(new Map([["a", 1]]))).toEqual(b.walk(new Map([["a", 1]])));
    expect(b.walk(new Map([["a", 1]]), { maxNodes: 2 })).toHaveLength(2);
    const hub = build(["s", "h", "t", "o1", "o2", "o3"], [["s", "h"], ["h", "o1"], ["h", "o2"], ["h", "o3"], ["s", "t"]]);
    const paths = hub.walk(new Map([["s", 1]]), { maxDegree: 3 }).map((x) => x.path);
    expect(paths).not.toContain("h");
    expect(paths).toContain("t");
  });

  it("honours skip and ignores unknown seeds", () => {
    expect(chain().walk(new Map([["a", 1]]), { skip: (p) => p === "b" }).map((x) => x.path)).toEqual(["a"]);
    expect(chain().walk(new Map([["nope", 1]]))).toEqual([]);
  });

  it("walks through code nodes but never returns them", () => {
    const b = build(["a", "z"], [["a", "code:f.ts"], ["z", "code:f.ts"]], ["code:f.ts"]);
    const r = b.walk(new Map([["a", 1]]));
    expect(r.map((x) => x.path).sort()).toEqual(["a", "z"]);
  });

  it("walks a synthetic 5k-node / 50k-edge graph in under 10 ms", () => {
    const names = Array.from({ length: 5000 }, (_, i) => `n${i}`);
    const edges: [string, string][] = [];
    let x = 12345;
    const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x / 0x7fffffff);
    for (let i = 0; i < 50000; i++) edges.push([names[Math.floor(rnd() * 5000)], names[Math.floor(rnd() * 5000)]]);
    const b = new GraphBuilder();
    const g = b.getGraph();
    names.forEach((n) => g.addNode(n, { title: n, tags: [] }));
    edges.forEach(([a, c], i) => a !== c && !g.hasEdge(a, c) && g.addEdgeWithKey(`e${i}`, a, c, { type: "link", weight: 1 }));
    const seeds = new Map([["n1", 1], ["n2", 0.5], ["n3", 0.2]]);
    b.walk(seeds); // warm up
    const t = performance.now();
    for (let i = 0; i < 5; i++) b.walk(seeds);
    expect((performance.now() - t) / 5).toBeLessThan(10);
  });
});
