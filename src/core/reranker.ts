import { AutoTokenizer } from "@huggingface/transformers";
import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CACHE_DIR, downloadFile, resolveOnnxRuntime, type OrtModule, type OrtSession } from "./embedder.js";
import type { SearchResult } from "./types.js";

export const DEFAULT_RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";
/** how many fused results the cross-encoder re-scores */
export const RERANK_TOP = 30;
export const DEFAULT_RERANK_ENABLED = false;

export interface RerankConfig {
  enabled: boolean;
  model: string;
}

/** `rerank` block of vault.schema.yml; a missing file, block or parse error gives the default. */
export function loadRerankConfig(vaultPath: string): RerankConfig {
  const def = { enabled: DEFAULT_RERANK_ENABLED, model: DEFAULT_RERANK_MODEL };
  try {
    const r = (parseYaml(readFileSync(join(vaultPath, "vault.schema.yml"), "utf-8")) as { rerank?: Partial<RerankConfig> } | null)?.rerank;
    return {
      enabled: typeof r?.enabled === "boolean" ? r.enabled : def.enabled,
      model: typeof r?.model === "string" ? r.model : def.model,
    };
  } catch {
    return def;
  }
}
/** Cross-encoder: scores (query, passage) pairs jointly. Loaded on first use; a load failure disables it for the process. */
export class Reranker {
  private session: OrtSession | null = null;
  private tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
  private ort: OrtModule | null = null;
  private failed = false;
  private loading: Promise<boolean> | null = null;

  constructor(private model: string = DEFAULT_RERANK_MODEL) {}

  private load(): Promise<boolean> {
    return (this.loading ??= (async () => {
      try {
        const dir = join(CACHE_DIR, this.model.replace(/\//g, "--"));
        await mkdir(dir, { recursive: true });
        const path = join(dir, "model.onnx");
        if (!existsSync(path)) {
          process.stderr.write(`Downloading rerank model: ${this.model}...\n`);
          await downloadFile(`https://huggingface.co/${this.model}/resolve/main/onnx/model.onnx`, path);
        }
        const { ort, label } = await resolveOnnxRuntime();
        this.ort = ort;
        this.tokenizer = await AutoTokenizer.from_pretrained(this.model, { cache_dir: CACHE_DIR });
        this.session = await ort.InferenceSession.create(path, { executionProviders: [label === "native" ? "cpu" : "wasm"] });
        return true;
      } catch (err) {
        // offline or corrupt cache: keep the fused order, say so once
        this.failed = true;
        process.stderr.write(`Reranker unavailable (${(err as Error).message}); keeping fused order\n`);
        return false;
      }
    })());
  }

  /** Re-order `results` by cross-encoder score (best first), setting `rerankScore`. Unchanged if the model is unavailable. */
  async rerank(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    if (this.failed || results.length === 0 || !(await this.load())) return results;
    const { ort, session, tokenizer } = this as unknown as { ort: OrtModule; session: OrtSession; tokenizer: NonNullable<Reranker["tokenizer"]> };
    const enc = await Promise.all(
      results.map((r) => tokenizer(query, { text_pair: `${r.title}. ${r.matchedChunk ?? r.snippet}`, truncation: true, max_length: 512, padding: false, return_tensor: false }))
    );
    const ids = enc.map((e) => Array.from(e.input_ids as ArrayLike<number>));
    const types = enc.map((e) => (e.token_type_ids ? Array.from(e.token_type_ids as ArrayLike<number>) : null));
    const n = results.length;
    const len = Math.max(...ids.map((i) => i.length));
    const flat = (rows: (number[] | null)[], fill: (row: number[], j: number) => number) => {
      const a = new BigInt64Array(n * len);
      rows.forEach((row, i) => { for (let j = 0; j < ids[i].length; j++) a[i * len + j] = BigInt(row ? fill(row, j) : 0); });
      return a;
    };
    const feeds: Record<string, unknown> = {
      input_ids: new ort.Tensor("int64", flat(ids, (r, j) => r[j]), [n, len]),
      attention_mask: new ort.Tensor("int64", flat(ids, () => 1), [n, len]),
    };
    if (session.inputNames.includes("token_type_ids")) feeds.token_type_ids = new ort.Tensor("int64", flat(types, (r, j) => r[j]), [n, len]);
    const logits = (await session.run(feeds))[session.outputNames[0]].data;
    return results
      .map((r, i) => ({ ...r, rerankScore: logits[i] }))
      .sort((a, b) => b.rerankScore! - a.rerankScore!);
  }
}
