import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Pooling = "mean" | "cls";

export interface EmbedSettings {
  pooling: Pooling;
  /** prepended to queries only, never to documents */
  queryPrompt: string;
}

/** Files fetched next to the model: sentence-transformers declares pooling and the query prompt there. */
export const MODEL_CONFIG_FILES = ["1_Pooling/config.json", "config_sentence_transformers.json"];

const readJson = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null; // missing or unreadable: the default (mean, no prompt)
  }
};

/**
 * Pooling and query prompt for a model dir: the model's own config, then overrides (CLI > vault.schema.yml).
 * shortcut: only cls and mean are supported; max / last-token pooling falls back to mean, add them when a model needs one.
 */
export function resolveEmbedSettings(modelDir: string, overrides: Partial<EmbedSettings> = {}): EmbedSettings {
  const pool = readJson(join(modelDir, "1_Pooling", "config.json"));
  const st = readJson(join(modelDir, "config_sentence_transformers.json"));
  return {
    pooling: overrides.pooling ?? (pool?.pooling_mode_cls_token === true ? "cls" : "mean"),
    queryPrompt: overrides.queryPrompt ?? (typeof st?.prompts?.query === "string" ? st.prompts.query : ""),
  };
}

/**
 * Pool and L2-normalize the output of a batched forward pass.
 * outputData: flat [batchSize, seqLen, hiddenSize]; maskData: flat [batchSize, seqLen]. CLS is token 0.
 * The mean branch is the arithmetic every vector built before v1.12 used: do not reorder it.
 */
export function poolAndNormalizeMany(
  outputData: Float32Array,
  maskData: number[],
  batchSize: number,
  seqLen: number,
  hiddenSize: number,
  pooling: Pooling = "mean"
): Float32Array[] {
  const results: Float32Array[] = [];
  for (let b = 0; b < batchSize; b++) {
    const result = new Float32Array(hiddenSize);
    if (pooling === "cls") {
      const offset = b * seqLen * hiddenSize;
      for (let d = 0; d < hiddenSize; d++) result[d] = outputData[offset + d];
    } else {
      let maskSum = 0;
      for (let t = 0; t < seqLen; t++) {
        const mask = maskData[b * seqLen + t];
        maskSum += mask;
        const offset = (b * seqLen + t) * hiddenSize;
        for (let d = 0; d < hiddenSize; d++) {
          result[d] += outputData[offset + d] * mask;
        }
      }
      if (maskSum > 0) {
        for (let d = 0; d < hiddenSize; d++) result[d] /= maskSum;
      }
    }
    let norm = 0;
    for (let d = 0; d < hiddenSize; d++) norm += result[d] * result[d];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let d = 0; d < hiddenSize; d++) result[d] /= norm;
    }
    results.push(result);
  }
  return results;
}
