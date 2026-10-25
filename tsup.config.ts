import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "core/index": "src/core/index.ts",
    "core/embed-worker": "src/core/embed-worker.ts",
    // standalone so hooks (plain JS) can import them without loading the embedder
    "core/redact": "src/core/redact.ts",
    "core/failure-query": "src/core/failure-query.ts",
    "core/features": "src/core/features.ts",
    "mcp/server": "src/mcp/server.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  splitting: true,
  outDir: "dist",
  external: [
    "onnxruntime-node",
    "onnxruntime-web",
  ],
});
