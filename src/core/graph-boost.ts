import type { GraphBuilder } from "./graph.js";

export const GRAPH_BOOST = 1.0;
export const GRAPH_BOOST_SEEDS = 5;

/**
 * Hybrid graph boost, shared by the MCP `search_hybrid` and the CLI `search` so the two cannot drift.
 * Seeds are the top semantic hits (results arrive best first, one per doc); their 1-hop link,
 * wikilink and related neighbours, in either direction, get the boost. The query string is never
 * matched against the graph.
 */
export function applyGraphBoost<T extends { path: string; score: number }>(results: T[], graph: GraphBuilder): T[] {
  const boosted = new Set<string>();
  for (const seed of results.slice(0, GRAPH_BOOST_SEEDS)) {
    for (const n of [...graph.forwardlinks(seed.path), ...graph.backlinks(seed.path)]) boosted.add(n.path);
  }
  return results.map((r) => (boosted.has(r.path) ? { ...r, score: r.score * GRAPH_BOOST } : r));
}
