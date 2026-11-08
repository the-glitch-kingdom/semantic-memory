/** search_hybrid calls whose output the single-source snapshot pins (test/fixtures/federation/single-source-snapshot.json, taken from v1.18.0). */
export const SNAP_QUERIES: Record<string, unknown>[] = [
  { query: "What does the harbor.dlq topic receive?", limit: 5 },
  { query: "What is the default value of TIDEWATCH_FLUSH_MS?", limit: 5 },
  { query: "How long is the Beacon cooldown before an alert can fire again?", limit: 3 },
  { query: "Where do poison items wind up after repeated unsuccessful handling attempts?", limit: 5 },
  { query: "Undo a faulty software release on the ships", limit: 5, full: true },
  { query: "How do I pause erasure because of a lawsuit?", limit: 4, granularity: "doc" },
  { query: "How does a telemetry message travel from the agent to cold storage?", limit: 6, mode: "flow" },
  { query: "What does the nonexistent_function_xyz helper return?", limit: 3 },
  { query: "how do I rotate API keys", limit: 3, domain: "security" },
  { query: "what is the weather on mars", limit: 3 },
];
