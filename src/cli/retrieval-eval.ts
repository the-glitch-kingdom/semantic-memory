import type { Command } from "commander";
import { loadSets, runSuite, formatSuite } from "../core/retrieval-eval/suite.js";

export function registerEvalCommand(program: Command): void {
  program
    .command("eval")
    .description("Measure retrieval on this vault through the live search path (reads the index; never changes it or the logs)")
    .requiredOption("--notes <path>", "Path to markdown notes directory")
    .option("--set <files...>", "JSONL question sets ({id, tier, q, facets}); default: *.jsonl in the eval dir")
    .option("--dir <path>", "Eval dir (default <project>/.claude/.semantic-memory/eval)")
    .option("--json", "Print the report as JSON")
    .action(async (opts) => {
      try {
        const report = await runSuite(opts.notes, loadSets(opts.notes, opts.set, opts.dir));
        console.log(opts.json ? JSON.stringify(report, null, 2) : formatSuite(report));
        process.exit(0);
      } catch (err: any) {
        console.error(`eval failed: ${err.message}`);
        process.exit(1);
      }
    });
}
