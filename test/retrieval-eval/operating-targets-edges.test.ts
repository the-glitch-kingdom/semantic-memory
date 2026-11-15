// #96 Phase 10: edge cases and failure paths of the targets table, diagnosis, --gaps-out and `eval init`.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/mcp/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "docs-vault");
const CLI = join(HERE, "..", "..", "dist", "cli", "index.js");
const golden = (await readFile(join(HERE, "golden-docs.jsonl"), "utf-8")).split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const jsonl = (rows: unknown[], eol = "\n") => rows.map((r) => JSON.stringify(r)).join(eol) + eol;
const answerable = golden.filter((c) => c.tier !== "negative");
const negatives = golden.filter((c) => c.tier === "negative");

let dir = "";
const run = (evalDir: string, setFile: string, ...a: string[]) =>
  spawnSync("node", [CLI, "eval", "--notes", dir, "--set", setFile, "--dir", evalDir, ...a], { encoding: "utf-8" });
const json = (evalDir: string, setFile: string, ...a: string[]) => {
  const r = run(evalDir, setFile, "--json", ...a);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};
const set = async (name: string, body: string) => { const f = join(dir, name); await writeFile(f, body); return f; };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sp-edges-"));
  await cp(FIXTURE, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
  await createServer(dir, { watch: false, waitForReady: true });
}, 120_000);
afterAll(async () => dir && (await rm(dir, { recursive: true, force: true })));

describe("sets of unusual shape", () => {
  it("0 answerable cases: every case stale, no division by zero, no noise line", async () => {
    const f = await set("none.jsonl", jsonl([{ id: "s", tier: "exact", q: "nothing here", facets: ["zzqqxx-none"] }]));
    const out = json(join(dir, "e-none"), f);
    expect(out.cases).toBe(0);
    expect(out.targets.noise).toBeNull();
    const text = run(join(dir, "e-none"), f).stdout;
    expect(text).toMatch(/Targets/);
    expect(text).not.toMatch(/noise:/);
    expect(text.slice(text.indexOf("Targets"))).not.toMatch(/NaN|Infinity/); // the arm blocks above print mean-payload=NaNB on an empty run (predates #96)
  });

  it("all cases blind: judged, and every answerable value matches the blind value", async () => {
    const f = await set("allblind.jsonl", jsonl(answerable.slice(0, 8).map((c) => ({ ...c, blind: true }))));
    const out = json(join(dir, "e-ab"), f);
    expect(out.targets.validated).toBe(true);
    expect(out.targets.blindCases).toBe(8);
    for (const r of out.targets.rows.filter((x: any) => x.metric !== "p95_ms")) expect(r.valueBlind, r.metric).toBe(r.value);
  });

  it("a negative-only set: negatives are judged, answerable rates are shown but not judged", async () => {
    const f = await set("neg.jsonl", jsonl(negatives.slice(0, 4).map((c) => ({ ...c, blind: true }))));
    const out = json(join(dir, "e-neg"), f);
    const row = (m: string) => out.targets.rows.find((r: any) => r.metric === m);
    expect(typeof row("negatives_flagged").met).toBe("boolean");
    expect(row("hybrid_at1").met).toBeNull();
    expect(out.diagnosis.cases).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/NaN|Infinity/);
  });

  it("CRLF line endings in a set read like LF", async () => {
    const rows = answerable.slice(0, 5).map((c) => ({ ...c, blind: true }));
    const lf = json(join(dir, "e-lf"), await set("lf.jsonl", jsonl(rows)));
    const crlf = json(join(dir, "e-crlf"), await set("crlf.jsonl", jsonl(rows, "\r\n")));
    expect(crlf.cases).toBe(lf.cases);
    const counts = (o: any) => o.targets.rows.filter((r: any) => r.metric !== "p95_ms").map((r: any) => r.value);
    expect(counts(crlf)).toEqual(counts(lf));
  });

  it("a blind case with `expected` and no facets is judged and diagnosed without throwing", async () => {
    const f = await set("nofacet.jsonl", jsonl([{ id: "nf", tier: "exact", q: "How do I back up the gateway?", expected: ["operational/backup-schedule.md"], blind: true }]));
    const out = json(join(dir, "e-nf"), f);
    expect(out.cases).toBe(1);
    expect(out.diagnosis).toBeDefined();
  });

  it("--gaps-out with no coverage misses writes an empty gaps.v1", async () => {
    const f = await set("clean.jsonl", jsonl(answerable.slice(0, 3)));
    const g = join(dir, "empty-gaps.json");
    json(join(dir, "e-gaps"), f, "--gaps-out", g);
    const doc = JSON.parse(await readFile(g, "utf-8"));
    expect(doc.version).toBe(1);
    expect(doc.gaps).toEqual([]);
  });
});

describe("targets.json edge cases", () => {
  const withTargets = async (name: string, body: unknown) => {
    const d = join(dir, name);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "targets.json"), JSON.stringify(body));
    return d;
  };
  const blindSet = () => set("tb.jsonl", jsonl(answerable.slice(0, 6).map((c) => ({ ...c, blind: true }))));

  it("unknown keys are warned about and ignored", async () => {
    const d = await withTargets("t-unk", { made_up: { value: 1, why: "x" } });
    const r = run(d, await blindSet());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/unknown targets: made_up/);
    expect(r.stdout).not.toMatch(/made_up/);
  });

  it("a null target is shown and not judged", async () => {
    const d = await withTargets("t-null", { hybrid_at1: { value: null, why: "off" } });
    const row = json(d, await blindSet()).targets.rows.find((r: any) => r.metric === "hybrid_at1");
    expect(row).toMatchObject({ target: null, met: null });
    expect(row.value).not.toBeNull();
  });
});

describe("--via mcp", () => {
  it("carries the same Targets and Diagnosis as the CLI run", async () => {
    const f = await set("via.jsonl", jsonl([...answerable.slice(0, 6).map((c) => ({ ...c, blind: true })), { id: "cov", tier: "exact", q: "a blind question about nothing", facets: ["zzqqxx-none"], blind: true }]));
    const cli = json(join(dir, "e-via-cli"), f);
    const r = run(join(dir, "e-via-mcp"), f, "--json", "--via", "mcp", "--wait-for-ready");
    expect(r.status, r.stderr).toBe(0);
    const mcp = JSON.parse(r.stdout);
    expect(mcp.targets.validated).toBe(true);
    expect(mcp.targets.rows.map((x: any) => x.metric)).toEqual(cli.targets.rows.map((x: any) => x.metric));
    expect(mcp.diagnosis.counts).toEqual(cli.diagnosis.counts);
    expect(mcp.diagnosis.cases.map((c: any) => c.id)).toEqual(cli.diagnosis.cases.map((c: any) => c.id));
  }, 120_000);
});

describe("failure paths", () => {
  it("eval init on an eval dir that cannot be created fails cleanly", async () => {
    const file = await set("a-file", "x");
    const r = spawnSync("node", [CLI, "eval", "init", "--notes", dir, "--dir", join(file, "sub")], { encoding: "utf-8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/eval init failed/);
  });

  it("eval init on a read-only eval dir fails cleanly", async () => {
    if (process.getuid?.() === 0) return; // root ignores modes
    const d = join(dir, "ro");
    await mkdir(d);
    chmodSync(d, 0o500);
    try {
      const r = spawnSync("node", [CLI, "eval", "init", "--notes", dir, "--dir", d], { encoding: "utf-8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/eval init failed/);
    } finally { chmodSync(d, 0o700); }
  });

  it("a set file that does not exist or is a directory fails with a message, not a stack", async () => {
    for (const bad of [join(dir, "missing.jsonl"), dir]) {
      const r = run(join(dir, "e-fail"), bad);
      expect(r.status).toBe(1);
      expect(r.stderr).not.toMatch(/\n\s+at /);
      expect(r.stderr.length).toBeGreaterThan(0);
    }
  });
});

describe("noise and side effects", () => {
  it("a validated run's noise step is 1 over the blind answerable cases", async () => {
    const f = await set("noise.jsonl", jsonl([...answerable.slice(0, 6), ...answerable.slice(6, 8).map((c) => ({ ...c, blind: true }))]));
    expect(json(join(dir, "e-noise"), f).targets.noise).toBe(0.5);
  });

  it("a run with no question sets leaves no targets.json behind", () => {
    const d = join(dir, "e-nosets");
    const r = spawnSync("node", [CLI, "eval", "--notes", dir, "--dir", d], { encoding: "utf-8" });
    expect(r.status).toBe(1);
    expect(spawnSync("ls", [d], { encoding: "utf-8" }).stdout).not.toMatch(/targets\.json/);
  });
});
