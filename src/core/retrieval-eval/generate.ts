import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { runClaude, skillLoopModel } from "../claude-run.js";
import { listMarkdown, parseFrontmatter } from "../indexer.js";
import { tokenize } from "../bm25.js";
import { ARCHIVE_RE, type FacetCase } from "./metrics.js";
import { GENERATOR_VERSION, generatePrompt } from "./prompts/generate.js";

export interface GeneratedCase extends FacetCase {
  doc: string;
  doc_sha256: string;
  generator: { version: string; model: string };
  /** Negatives: the terms that no doc contains. */
  absent_terms?: string[];
}

const KIND_TIER = { keyword: "exact", paraphrase: "paraphrase", multi: "multi", negative: "negative" } as const;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** A facet may match at most this share of the docs, else it does not point at the source. */
const MAX_FACET_SHARE = 0.2;

/** Evenly spaced over the sorted list: the same vault gives the same sample. */
export const sampleDocs = <T>(items: T[], n: number): T[] => (n >= items.length ? items : Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]));

/** First markdown link in `text` that resolves to another doc. */
function neighbourOf(path: string, text: string, docs: Map<string, string>): string | undefined {
  for (const m of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
    const target = posix.normalize(posix.join(posix.dirname(path), m[1]));
    if (target !== path && docs.has(target)) return target;
  }
}

/** Why a model-written question is dropped, or undefined when it is kept. */
export function rejectReason(raw: any, source: string, other: string | undefined, docs: Map<string, string>): string | undefined {
  if (!raw || typeof raw.q !== "string" || !raw.q.trim() || !(raw.kind in KIND_TIER)) return "malformed question";
  const texts = [...docs.values()];
  if (raw.kind === "negative") {
    const terms: unknown = raw.absent_terms;
    if (!Array.isArray(terms) || !terms.length || terms.some((t) => typeof t !== "string" || !t.trim())) return "negative without absent_terms";
    for (const t of terms as string[]) if (texts.some((d) => d.toLowerCase().includes(t.toLowerCase()))) return `negative term exists in the docs: ${t}`;
    return;
  }
  if (!Array.isArray(raw.facets) || !raw.facets.length || raw.facets.some((f: unknown) => typeof f !== "string")) return "no facets";
  const sources = [docs.get(source)!, ...(raw.kind === "multi" && other ? [docs.get(other)!] : [])];
  if (raw.kind === "multi" && !other) return "multi without a neighbour";
  const hit = sources.map(() => false);
  for (const f of raw.facets as string[]) {
    let re: RegExp;
    try { re = new RegExp(f, "i"); } catch { return `bad facet regex: ${f}`; }
    const at = sources.findIndex((s) => re.test(s));
    if (at < 0) return `facet does not match the source: ${f}`;
    hit[at] = true;
    if (texts.filter((d) => re.test(d)).length > Math.max(1, MAX_FACET_SHARE * texts.length)) return `facet matches too many docs: ${f}`;
  }
  if (raw.kind === "multi" && !hit.every(Boolean)) return "multi facets do not cover both docs";
  if (raw.kind === "paraphrase") {
    // rare = in at most 10% of docs (never fewer than 2): sharing more than one with the source makes it a keyword question
    const docTerms = new Set(tokenize(docs.get(source)!));
    const df = (t: string) => texts.filter((d) => tokenize(d).includes(t)).length;
    const shared = [...new Set(tokenize(raw.q))].filter((t) => t.length >= 4 && docTerms.has(t) && df(t) <= Math.max(2, 0.1 * texts.length));
    if (shared.length > 1) return `paraphrase shares ${shared.length} rare terms: ${shared.join(", ")}`;
  }
}

function parseQuestions(reply: string): any[] {
  const m = reply.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m ? m[0] : "");
    return Array.isArray(j.questions) ? j.questions : [];
  } catch {
    return [];
  }
}

export interface GenerateOptions {
  docs?: number;
  model?: string;
  env?: NodeJS.ProcessEnv;
}
export interface GenerateResult {
  cases: GeneratedCase[];
  rejected: { doc: string; q?: string; why: string }[];
  costUsd: number;
}

export async function generateCases(notes: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const root = resolve(notes);
  const docs = new Map<string, string>();
  const eligible: string[] = [];
  for (const p of await listMarkdown(root)) {
    const raw = readFileSync(join(root, p), "utf-8");
    docs.set(p, raw);
    if (!ARCHIVE_RE.test(p) && parseFrontmatter(raw, p).data.generated !== true) eligible.push(p);
  }
  const picked = sampleDocs(eligible, opts.docs ?? 20);
  const cwd = mkdtempSync(join(tmpdir(), "sm-eval-gen-"));
  const model = opts.model ?? skillLoopModel(opts.env);
  const cases: GeneratedCase[] = [];
  const rejected: GenerateResult["rejected"] = [];
  let costUsd = 0;
  try {
    // 5 at a time, the machine-wide claude slot limit
    for (let i = 0; i < picked.length; i += 5) {
      await Promise.all(
        picked.slice(i, i + 5).map(async (path) => {
          const other = neighbourOf(path, docs.get(path)!, docs);
          const run = await runClaude({
            prompt: generatePrompt({ path, text: docs.get(path)! }, other ? { path: other, text: docs.get(other)! } : undefined),
            cwd, tools: [], maxTurns: 1, model: opts.model, env: opts.env,
          });
          costUsd += run.costUsd;
          if (!run.ok) return void rejected.push({ doc: path, why: `claude failed: ${run.error}` });
          for (const raw of parseQuestions(run.result)) {
            const why = rejectReason(raw, path, other, docs);
            if (why) { rejected.push({ doc: path, q: raw?.q, why }); continue; }
            const q = raw.q.trim();
            const c: GeneratedCase = {
              id: `gen-${sha(`${path}\0${q}`).slice(0, 10)}`,
              tier: KIND_TIER[raw.kind as keyof typeof KIND_TIER],
              q,
              ...(raw.kind === "negative"
                ? { negative_kind: raw.kind_of_negative === "identifier" ? "identifier" : "topic", absent_terms: raw.absent_terms }
                : { facets: raw.facets, expected: raw.kind === "multi" ? [path, other!] : [path] }),
              split: parseInt(sha(q)[0], 16) % 2 ? "tune" : "heldout",
              doc: path,
              doc_sha256: sha(docs.get(path)!),
              generator: { version: GENERATOR_VERSION, model },
            };
            cases.push(c);
          }
        }),
      );
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  const order = new Map(picked.map((p, i) => [p, i]));
  cases.sort((a, b) => order.get(a.doc)! - order.get(b.doc)! || a.id.localeCompare(b.id));
  return { cases, rejected, costUsd };
}

export function writeGenerated(path: string, cases: GeneratedCase[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
}
