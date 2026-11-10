import { defineConfig } from "vitest/config";

// Runs repeat.test.ts only (the default config includes test/** alone). Usage from the repo root:
//   npx vitest run --config .planning/decay-day-clock/vitest.measure.config.ts
export default defineConfig({
  test: { globals: true, include: [".planning/decay-day-clock/repeat.test.ts"], globalSetup: ["./test/global-setup.ts"], setupFiles: ["./test/clean-env.ts"], testTimeout: 900_000 },
});
