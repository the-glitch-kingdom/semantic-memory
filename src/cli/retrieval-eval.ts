import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadSets, runSuite, formatSuite, baselinePath, writeBaseline, checkBaseline, type Baseline } from "../core/retrieval-eval/suite.js";

export function registerEvalCommand(program: Command): void {
  program
    .command("eval")
    .description("Measure retrieval on this vault through the live search path (reads the index; never changes it or the logs)")
    .requiredOption("--notes <path>", "Path to markdown notes directory")
    .option("--set <files...>", "JSONL question sets ({id, tier, q, facets}); default: *.jsonl in the eval dir")
    .option("--dir <path>", "Eval dir (default <project>/.claude/.semantic-memory/eval)")
    .option("--baseline", "Write the measured counts to <eval dir>/baseline.json as the floor")
    .option("--check", "Exit 1 when a count drops below the baseline by more than --band questions")
    .option("--band <n>", "Noise band for --check, in questions", "1")
    .option("--json", "Print the report as JSON")
    .action(async (opts) => {
      try {
        const report = await runSuite(opts.notes, loadSets(opts.notes, opts.set, opts.dir));
        console.log(opts.json ? JSON.stringify(report, null, 2) : formatSuite(report));
        const file = baselinePath(opts.notes, opts.dir);
        if (opts.baseline) {
          writeBaseline(file, report, (createRequire(import.meta.url)("../../package.json") as { version: string }).version);
          console.error(`baseline written: ${file}`);
        }
        if (opts.check) {
          if (!existsSync(file)) throw new Error(`no baseline at ${file}: run eval --baseline first`);
          const { ok, lines } = checkBaseline(JSON.parse(readFileSync(file, "utf-8")) as Baseline, report, Number(opts.band));
          console.error(lines.join("\n"));
          process.exit(ok ? 0 : 1);
        }
        process.exit(0);
      } catch (err: any) {
        console.error(`eval failed: ${err.message}`);
        process.exit(1);
      }
    });
}
