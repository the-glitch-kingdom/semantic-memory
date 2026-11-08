import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { listMarkdown } from "../indexer.js";
import { deriveSessionDir } from "../session.js";
import { openEval } from "./runner.js";
import { formatArm, grepPattern, parseGolden, runFacetEval, type ArmFn, type ArmMetrics, type FacetCase } from "./metrics.js";

export const evalDir = (notes: string, dir?: string) => (dir ? resolve(dir) : join(deriveSessionDir(notes), "eval"));

/** `--set` files, or every `*.jsonl` in the eval dir. */
export function loadSets(notes: string, sets: string[] | undefined, dir?: string): FacetCase[] {
  const files = sets?.length ? sets.map((s) => resolve(s)) : existsSync(evalDir(notes, dir)) ? readdirSync(evalDir(notes, dir)).filter((f) => f.endsWith(".jsonl")).sort().map((f) => join(evalDir(notes, dir), f)) : [];
  if (!files.length) throw new Error(`No question sets: pass --set <file.jsonl> or put *.jsonl in ${evalDir(notes, dir)}.`);
  return files.flatMap((f) => parseGolden(readFileSync(f, "utf-8")) as unknown as FacetCase[]);
}

/** Cases that cannot be answered by the live docs: a facet no doc matches, a bad regex, or a missing expected doc. */
export function findStale(cases: FacetCase[], docs: Map<string, string>): { stale: { id: string; why: string }[]; live: FacetCase[] } {
  const stale: { id: string; why: string }[] = [];
  const live = cases.filter((c) => {
    for (const p of c.expected ?? []) if (!docs.has(p)) return stale.push({ id: c.id, why: `expected doc gone: ${p}` }), false;
    for (const f of c.tier === "negative" ? [] : c.facets ?? []) {
      let re: RegExp;
      try { re = new RegExp(f, "i"); } catch { return stale.push({ id: c.id, why: `bad facet regex: ${f}` }), false; }
      if (![...docs.values()].some((t) => re.test(t))) return stale.push({ id: c.id, why: `no doc matches facet: ${f}` }), false;
    }
    return true;
  });
  return { stale, live };
}

export interface ArmReport {
  all: ArmMetrics;
  /** Questions not marked `tune`. */
  clean: ArmMetrics;
  /** Negatives flagged `no_strong_match`, by negative_kind. */
  negatives: Record<string, { n: number; flagged: number }>;
  /** Per question: the first k in 1/3/8 that answers it (0 = none) or, for a negative, 1 when flagged. */
  outcomes: Record<string, number>;
}
export interface EvalReport {
  cases: number;
  /** sha256 of the live question set, and of the doc paths + mtimes: what a baseline was measured on. */
  setHash: string;
  corpus: { docs: number; hash: string };
  stale: { id: string; why: string }[];
  arms: Record<string, ArmReport>;
}

/** Each question hits an arm once; the "clean" and per-kind passes replay the cached response (latency comes from the first pass). */
const memo = (arm: ArmFn): ArmFn => {
  const seen = new Map<string, ReturnType<ArmFn>>();
  return (q, limit) => seen.get(`${limit}\0${q}`) ?? (seen.set(`${limit}\0${q}`, arm(q, limit)), seen.get(`${limit}\0${q}`)!);
};

export async function runSuite(notes: string, cases: FacetCase[]): Promise<EvalReport> {
  const root = resolve(notes);
  const docs = new Map<string, string>();
  const stamp = createHash("sha256");
  for (const p of await listMarkdown(root)) {
    docs.set(p, readFileSync(join(root, p), "utf-8"));
    stamp.update(`${p}\0${statSync(join(root, p)).mtimeMs}\n`);
  }
  const { stale, live } = findStale(cases, docs);
  const textOf = (p: string) => docs.get(p) ?? "";

  const ev = await openEval(root);
  try {
    const grep: ArmFn = async (q, limit) => {
      const { parsed, bytes } = await ev.call("search_text", { pattern: grepPattern(q), regex: true, limit });
      return { results: parsed.map((r: any) => ({ path: r.path, score: r.score })), bytes };
    };
    const armFns: Record<string, ArmFn> = { search_hybrid: ev.tool("search_hybrid"), search_semantic: ev.tool("search_semantic"), search_text: ev.tool("search_text"), grep };
    const arms: Record<string, ArmReport> = {};
    for (const [name, raw] of Object.entries(armFns)) {
      const arm = memo(raw);
      const all = await runFacetEval(live, arm, textOf);
      const clean = await runFacetEval(live.filter((c) => c.split !== "tune"), arm, textOf);
      const negatives: ArmReport["negatives"] = {};
      for (const kind of new Set(live.filter((c) => c.tier === "negative").map((c) => c.negative_kind ?? "unspecified"))) {
        const m = await runFacetEval(live.filter((c) => c.tier === "negative" && (c.negative_kind ?? "unspecified") === kind), arm, textOf);
        negatives[kind] = { n: m.negativeTop.length, flagged: m.negativesFlagged };
      }
      const outcomes: ArmReport["outcomes"] = {};
      for (const c of live) {
        const m = await runFacetEval([c], arm, textOf);
        outcomes[c.id] = c.tier === "negative" ? m.negativesFlagged : [1, 3, 8].find((k) => m.tiers.all.at[k]) ?? 0;
      }
      arms[name] = { all, clean, negatives, outcomes };
    }
    const setHash = createHash("sha256").update(JSON.stringify(live)).digest("hex");
    return { cases: live.length, setHash, corpus: { docs: docs.size, hash: stamp.digest("hex") }, stale, arms };
  } finally {
    await ev.close();
  }
}

export function formatSuite(r: EvalReport): string {
  const lines = [`${r.cases} questions${r.stale.length ? `, ${r.stale.length} stale (skipped)` : ""}`];
  for (const s of r.stale) lines.push(`  stale ${s.id}: ${s.why}`);
  for (const [name, a] of Object.entries(r.arms)) {
    lines.push("", `${name}`, formatArm("all  ", a.all));
    if (a.clean.tiers.all?.n !== a.all.tiers.all?.n) lines.push(formatArm("clean", a.clean));
    if (a.all.expectedN) lines.push(`  found@1/3/8 = ${[1, 3, 8].map((k) => `${a.all.foundAt[k]}/${a.all.expectedN}`).join(" ")}  MRR=${a.all.mrr.toFixed(3)}`);
    lines.push(`  latency p50=${a.all.latencyMs.p50.toFixed(0)}ms p95=${a.all.latencyMs.p95.toFixed(0)}ms`);
    for (const [kind, n] of Object.entries(a.negatives)) lines.push(`  negatives ${kind}: flagged ${n.flagged}/${n.n}`);
  }
  return lines.join("\n");
}

/** The counts a floor holds: answered @1/@3/@8 over the answerable questions, and negatives flagged. */
const counts = (a: ArmReport) => ({ a1: a.all.tiers.all?.at[1] ?? 0, a3: a.all.tiers.all?.at[3] ?? 0, a8: a.all.tiers.all?.at[8] ?? 0, negFlagged: a.all.negativesFlagged });

export interface Baseline {
  version: string;
  setHash: string;
  corpus: { docs: number; hash: string };
  arms: Record<string, ReturnType<typeof counts> & { n: number; negN: number; outcomes: Record<string, number> }>;
}

export const baselinePath = (notes: string, dir?: string) => join(evalDir(notes, dir), "baseline.json");

export function writeBaseline(path: string, r: EvalReport, version: string): void {
  const arms: Baseline["arms"] = {};
  for (const [name, a] of Object.entries(r.arms)) arms[name] = { ...counts(a), n: a.all.tiers.all?.n ?? 0, negN: a.all.negativeTop.length, outcomes: a.outcomes };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version, setHash: r.setHash, corpus: r.corpus, arms } satisfies Baseline, null, 2) + "\n");
}

/** Fails when a count drops by more than `band` questions; a changed corpus or set only warns. */
export function checkBaseline(base: Baseline, r: EvalReport, band = 1): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  if (base.corpus.hash !== r.corpus.hash) lines.push(`warning: corpus changed since the baseline (${base.corpus.docs} -> ${r.corpus.docs} docs, or paths/mtimes differ); counts may move for that reason`);
  if (base.setHash !== r.setHash) lines.push("warning: the question set changed since the baseline");
  let ok = true;
  for (const [name, a] of Object.entries(r.arms)) {
    const b = base.arms[name];
    if (!b) { lines.push(`${name}: not in the baseline`); continue; }
    const cur = counts(a);
    const bad: string[] = [];
    for (const m of ["a1", "a3", "a8", "negFlagged"] as const) {
      const total = m === "negFlagged" ? b.negN : b.n;
      const p = total ? b[m] / total : 0;
      lines.push(`${name} ${m}: ${b[m]} -> ${cur[m]} (binomial SD ${Math.sqrt(total * p * (1 - p)).toFixed(1)})`);
      if (b[m] - cur[m] > band) bad.push(m);
    }
    if (bad.length) {
      ok = false;
      lines.push(`${name}: FAIL, ${bad.join(", ")} dropped by more than ${band}`);
      // flipped = answered (or flagged) in the baseline, ranked worse or not at all now
      for (const [id, o] of Object.entries(b.outcomes)) {
        const now = a.outcomes[id];
        if (o !== 0 && now !== undefined && (now === 0 || now > o)) lines.push(`  flipped ${id}: ${o} -> ${now}`);
      }
    }
  }
  return { ok, lines };
}
