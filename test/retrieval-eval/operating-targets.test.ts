// #96 Phase 2: acceptance for operating targets, blind sets and the per-miss diagnosis, written before the code.
// `it.fails` cases become plain `it` in the phase that implements them (3: targets and `eval init`, 4: report and diagnosis).
// The JSON shapes named here (`targets`, `diagnosis`) are the contract Phases 3-4 build to.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/mcp/server.js";
import { loadSets } from "../../src/core/retrieval-eval/suite.js";
import { writeGenerated } from "../../src/core/retrieval-eval/generate.js";
import { toGapsV1 } from "../../src/core/usage-log.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "docs-vault");
const CLI = join(HERE, "..", "..", "dist", "cli", "index.js");
const FAKE = join(HERE, "..", "bin", "claude");

const golden = readFileSync(join(HERE, "golden-docs.jsonl"), "utf-8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const STALE_NB = { id: "stale-nb", tier: "exact", q: "a question about nothing", facets: ["zzqqxx-no-such-term"] };
const COV_BLIND = { id: "cov-blind", tier: "exact", q: "a blind question about nothing", facets: ["zzqqxx-no-such-term"], blind: true };

let dir = "";
let sets = { plain: "", blind: "" };
const run = (evalDir: string, setFile: string | null, ...a: string[]) =>
  spawnSync("node", [CLI, "eval", "--notes", dir, ...(setFile ? ["--set", setFile] : []), "--dir", evalDir, ...a], { encoding: "utf-8" });
const json = (evalDir: string, setFile: string, ...a: string[]) => {
  const r = run(evalDir, setFile, "--json", ...a);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};
const rowOf = (out: any, metric: string) => out.targets.rows.find((x: any) => x.metric === metric);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sp-targets-"));
  await cp(FIXTURE, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
  await createServer(dir, { watch: false, waitForReady: true });
  sets.plain = join(dir, "plain.jsonl");
  sets.blind = join(dir, "blind.jsonl");
  await writeFile(sets.plain, jsonl([...golden.slice(0, 12), STALE_NB]));
  await writeFile(sets.blind, jsonl([...golden.slice(12, 20).map((c) => ({ ...c, blind: true })), COV_BLIND]));
}, 120_000);
afterAll(async () => dir && (await rm(dir, { recursive: true, force: true })));

describe("eval init", () => {
  const init = (evalDir: string, ...a: string[]) => spawnSync("node", [CLI, "eval", "init", "--notes", dir, "--dir", evalDir, ...a], { encoding: "utf-8" });

  it("writes targets.json (each target has value and why), the template and BLIND-SETS.md", () => {
    const d = join(dir, "init-a");
    const r = init(d);
    expect(r.status, r.stderr).toBe(0);
    for (const f of ["targets.json", "questions.template.jsonl.example", "BLIND-SETS.md"]) expect(existsSync(join(d, f)), f).toBe(true);
    const targets = JSON.parse(readFileSync(join(d, "targets.json"), "utf-8"));
    expect(Object.keys(targets).length).toBeGreaterThanOrEqual(10);
    for (const t of Object.values(targets) as any[]) {
      expect(t).toHaveProperty("value");
      expect(typeof t.why).toBe("string");
      expect(t.why.length).toBeGreaterThan(0);
    }
  });

  it("a second run leaves edited files untouched and says so; --force rewrites", async () => {
    const d = join(dir, "init-b");
    expect(init(d).status).toBe(0);
    await writeFile(join(d, "targets.json"), '{"hybrid_at1":{"value":0.5,"why":"mine"}}');
    const again = init(d);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout + again.stderr).toMatch(/untouched|already exists|left as is/i);
    expect(readFileSync(join(d, "targets.json"), "utf-8")).toContain("mine");
    expect(init(d, "--force").status).toBe(0);
    expect(readFileSync(join(d, "targets.json"), "utf-8")).not.toContain("mine");
  });

  // Guard: the template must not be read as a question set; `.example` is not `.jsonl`.
  it("loadSets ignores a questions.template.jsonl.example next to the sets", async () => {
    const d = join(dir, "init-c");
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "questions.template.jsonl.example"), jsonl([{ id: "t", tier: "exact", q: "q", facets: ["x"], blind: true }]));
    await writeFile(join(d, "real.jsonl"), jsonl([{ id: "r", tier: "exact", q: "q", facets: ["y"] }]));
    expect(loadSets(dir, undefined, d).map((c) => c.id)).toEqual(["r"]);
  });
});

describe("eval report: targets", () => {
  it("with no targets.json it writes the defaults and prints one line saying where", () => {
    const d = join(dir, "ev-defaults");
    const r = run(d, sets.plain);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(d, "targets.json"))).toBe(true);
    expect((r.stdout + r.stderr).split("\n").filter((l) => l.includes("targets.json"))).toHaveLength(1);
  });

  it.fails("prints a Targets table (metric, value all, value blind, target, met) and the noise threshold; --json carries it as `targets`", () => {
    const d = join(dir, "ev-table");
    const text = run(d, sets.plain).stdout;
    expect(text).toMatch(/Targets/);
    expect(text).toMatch(/noise: 1\/n = /);
    const out = json(d, sets.plain);
    const metrics = out.targets.rows.map((x: any) => x.metric);
    expect(metrics).toEqual(["hybrid_at1", "hybrid_at3", "exact_at1", "paraphrase_at1", "related_at1", "verified_top3", "no_missing_refs_top3", "negatives_flagged", "false_flags", "p95_ms"]);
    expect(rowOf(out, "hybrid_at1").target).toBe(0.75);
    expect(rowOf(out, "hybrid_at3").target).toBe(0.95);
    expect(rowOf(out, "p95_ms").target).toBe(100);
    for (const row of out.targets.rows) for (const k of ["value", "valueBlind", "target", "met"]) expect(row, `${row.metric}.${k}`).toHaveProperty(k);
    expect(out.targets.noise).toBeCloseTo(1 / out.arms.search_hybrid.all.tiers.all.n, 6);
  });

  it.fails("an edited targets.json value changes the met column", async () => {
    const d = join(dir, "ev-edit");
    expect(run(d, sets.blind).status).toBe(0); // writes the defaults
    const edit = async (v: number) => {
      const t = JSON.parse(readFileSync(join(d, "targets.json"), "utf-8"));
      t.hybrid_at1.value = v;
      await writeFile(join(d, "targets.json"), JSON.stringify(t));
      return rowOf(json(d, sets.blind), "hybrid_at1").met;
    };
    expect(await edit(0)).toBe(true);
    expect(await edit(1.01)).toBe(false);
  });

  it("a malformed targets.json fails naming the file, and never falls back to the defaults", async () => {
    const d = join(dir, "ev-bad");
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "targets.json"), "{not json");
    const r = run(d, sets.plain);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/targets\.json/);
    expect(readFileSync(join(d, "targets.json"), "utf-8")).toBe("{not json");
  });

  it.fails("no blind case: every met cell reads `not validated` and a loud line says why", () => {
    const d = join(dir, "ev-nb");
    const text = run(d, sets.plain).stdout;
    expect(text).toContain("not validated: no blind set (mark a set blind: true, see BLIND-SETS.md)");
    const out = json(d, sets.plain);
    expect(out.targets.validated).toBe(false);
    for (const row of out.targets.rows) expect(row.met, row.metric).toBe("not validated");
  });

  it.fails("with blind cases met is judged on the blind subset", () => {
    const out = json(join(dir, "ev-b"), sets.blind);
    expect(out.targets.validated).toBe(true);
    for (const row of out.targets.rows) expect(typeof row.met, row.metric).toBe("boolean");
    expect(JSON.stringify(out.targets.rows)).not.toContain("not validated");
  });
});

describe("eval report: diagnosis", () => {
  it.fails("labels every miss (id, label, why) and counts per label; a blind case whose facet matches no doc is a coverage miss, not stale", () => {
    const out = json(join(dir, "ev-diag"), sets.blind);
    const labels = ["coverage", "ranking", "grounding"];
    for (const c of out.diagnosis.cases) {
      expect(labels).toContain(c.label);
      expect(c.id).toBeTruthy();
      expect(c.why.length).toBeGreaterThan(0);
    }
    expect(out.diagnosis.cases.find((c: any) => c.id === "cov-blind").label).toBe("coverage");
    expect(out.stale.map((s: any) => s.id)).not.toContain("cov-blind");
    for (const l of labels) expect(out.diagnosis.counts[l]).toBe(out.diagnosis.cases.filter((c: any) => c.label === l).length);
    expect(readFileSync(join(dir, "blind.jsonl"), "utf-8")).toContain("cov-blind"); // the set itself is not rewritten
  });

  it.fails("a ranking miss says whether the grep arm answered it at 8", () => {
    const out = json(join(dir, "ev-diag2"), sets.blind);
    for (const c of out.diagnosis.cases.filter((x: any) => x.label === "ranking")) expect(typeof c.grepAt8).toBe("boolean");
    expect(out.diagnosis.grep).toHaveProperty("at1");
    expect(out.diagnosis.grep).toHaveProperty("at3");
  });

  // Guard: a non-blind case with an unmatched facet keeps today's `stale` behaviour and report lines.
  it("non-blind cases keep the stale behaviour", () => {
    const d = join(dir, "ev-stale");
    const out = json(d, sets.plain);
    expect(out.stale.map((s: any) => s.id)).toEqual(["stale-nb"]);
    expect(run(d, sets.plain).stdout).toMatch(/12 questions, 1 stale \(skipped\)\nsettings: .*\n {2}stale stale-nb: /);
  });

  it.fails("--no-oracle gives no diagnosis section", () => {
    const d = join(dir, "ev-noor");
    const off = json(d, sets.blind, "--no-oracle");
    expect(off.diagnosis).toBeUndefined();
    expect(run(d, sets.blind, "--no-oracle").stdout).not.toMatch(/Diagnosis/);
    expect(run(d, sets.blind).stdout).toMatch(/Diagnosis/);
  });

  it.fails("--gaps-out writes the coverage misses as gaps.v1 (the shape toGapsV1 emits), question as query, no used_doc", () => {
    const f = join(dir, "gaps-out.json");
    const out = json(join(dir, "ev-gaps"), sets.blind, "--gaps-out", f);
    expect(existsSync(f)).toBe(true);
    const doc = JSON.parse(readFileSync(f, "utf-8"));
    const ref = toGapsV1([{ query: "q", used_doc: null, suggested: "new doc", count: 1, last_seen: "2026-11-14", signals: [] } as any], "x");
    expect(Object.keys(doc).sort()).toEqual(Object.keys(ref).sort());
    expect(doc.version).toBe(1);
    expect(doc.source).toMatch(/^semantic-memory /);
    expect(doc.gaps.length).toBe(out.diagnosis.counts.coverage);
    const gap = doc.gaps.find((g: any) => g.query === COV_BLIND.q);
    expect(gap).toBeTruthy();
    expect(Object.keys(gap).sort()).toEqual(Object.keys(ref.gaps[0]).sort());
    expect(gap.used_doc ?? null).toBeNull();
  });
});

describe("eval generate", () => {
  const rules = (evalDir: string) => ({ ...process.env, SEMANTIC_MEMORY_CLAUDE_BIN: FAKE, FAKE_CLAUDE_RULES: evalDir, SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(evalDir, "..", "slots") });

  it.fails("writeGenerated writes blind: false on every row", async () => {
    const f = join(dir, "gen-out", "generated.jsonl");
    writeGenerated(f, [{ id: "g1", tier: "exact", q: "q", facets: ["x"] } as any, { id: "g2", tier: "negative", q: "q2" } as any]);
    const rows = (await readFile(f, "utf-8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(rows.map((r) => r.blind)).toEqual([false, false]);
  });

  it.fails("the summary says the generated set is not blind", async () => {
    const d = join(dir, "gen-cli");
    await mkdir(join(d, "docs"), { recursive: true });
    await writeFile(join(d, "docs", "a.md"), "# Alpha\nThe harbor.dlq queue receives dead letters.\n");
    const rulesFile = join(d, "rules.json");
    await writeFile(rulesFile, JSON.stringify([{ match: "*", result: JSON.stringify({ questions: [{ kind: "keyword", q: "harbor dlq", facets: ["harbor\\.dlq"] }] }) }]));
    const env = { ...rules(d), FAKE_CLAUDE_RULES: rulesFile };
    const r = spawnSync("node", [CLI, "eval", "generate", "--notes", join(d, "docs"), "--dir", join(d, "ev"), "--docs", "5"], { encoding: "utf-8", env });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/not blind/i);
    expect(readdirSync(join(d, "ev"))).toContain("generated.jsonl");
  });
});

// Guards: today's report fields and gate-script inputs survive Phases 3-4 (the new sections are added after, never instead).
describe("existing eval output is kept", () => {
  it("--json keeps every field the gate scripts and baseline read", () => {
    const out = json(join(dir, "ev-guard"), sets.plain);
    for (const k of ["cases", "setHash", "corpus", "stale", "settings", "arms"]) expect(out, k).toHaveProperty(k);
    expect(Object.keys(out.arms)).toEqual(["search_hybrid", "search_semantic", "search_text", "grep"]);
    const a = out.arms.search_hybrid.all;
    for (const k of ["tiers", "negativesFlagged", "answerableFlagged", "latencyMs", "cov", "dominance"]) expect(a, k).toHaveProperty(k);
    expect(a.tiers.all.at).toHaveProperty("1");
    expect(a.latencyMs.p95).toBeGreaterThan(0);
  });

  it("--baseline then --check pass, and the first lines of the text report are unchanged", () => {
    const d = join(dir, "ev-base");
    expect(run(d, sets.plain, "--baseline").status).toBe(0);
    expect(existsSync(join(d, "baseline.json"))).toBe(true);
    expect(run(d, sets.plain, "--check").status).toBe(0);
    expect(run(d, sets.plain).stdout).toMatch(/^12 questions, 1 stale \(skipped\)\nsettings: granularity=\w+ decay=(on|off) decay\.code=(on|off)\n {2}stale stale-nb: .*\n\nsearch_hybrid\n/);
  });

  it("gate-release.sh and eval-against-release.sh read only fields the report keeps", () => {
    const gate = readFileSync(join(HERE, "..", "..", "scripts", "gate-release.sh"), "utf-8");
    const out = json(join(dir, "ev-guard2"), sets.plain);
    // the gate reads these arm fields and nothing under `targets`/`diagnosis`
    expect(gate).not.toMatch(/\.targets|\.diagnosis/);
    for (const k of ["tiers", "cov", "dominance", "negativesFlagged", "answerableFlagged"]) {
      expect(gate).toContain(k);
      expect(out.arms.search_hybrid.all, k).toHaveProperty(k);
    }
  });
});
