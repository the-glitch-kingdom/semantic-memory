import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { generateCases, writeGenerated } from "../core/retrieval-eval/generate.js";
import { evalDir, loadSets, runSuite, formatSuite, baselinePath, writeBaseline, checkBaseline, type Baseline } from "../core/retrieval-eval/suite.js";

export function registerEvalCommand(program: Command): void {
  // `eval generate --notes` must reach the subcommand: commander lets a parent that knows --notes take it otherwise
  program.enablePositionalOptions();
  const evalCmd = program
    .command("eval")
    .enablePositionalOptions()
    .description("Measure retrieval on this vault through the live search path (never re-embeds the index or writes search logs; notes changed since the last index are indexed first, as on a server start)")
    .option("--notes <path>", "Path to markdown notes directory")
    .option("--set <files...>", "JSONL question sets ({id, tier, q, facets}); default: *.jsonl in the eval dir")
    .option("--dir <path>", "Eval dir (default <project>/.claude/.semantic-memory/eval)")
    .option("--baseline", "Write the measured counts to <eval dir>/baseline.json as the floor")
    .option("--check", "Exit 1 when a count drops below the baseline by more than --band questions")
    .option("--band <n>", "Noise band for --check, in questions", "1")
    .option("--via <path>", "Measure through the stdio server, as the plugin launches it, instead of in-process: `mcp` (queries start as soon as the server answers)")
    .option("--cwd <path>", "With --via mcp: the server's working directory (the repo; --notes is resolved from it)")
    .option("--server <cli>", "With --via mcp: the CLI entry the server is launched from (default: this one), to measure another build or release with this driver")
    .option("--wait-for-ready", "With --via mcp: start the server with --wait-for-ready (the plugin does not)")
    .option("--json", "Print the report as JSON")
    .action(async (opts) => {
      try {
        // not requiredOption: commander would demand it on `eval generate` too, before the subcommand's own --notes
        if (!opts.notes) throw new Error("required option --notes <path> not specified");
        // --baseline would overwrite the floor before --check read it, so the check could never fail
        if (opts.baseline && opts.check) throw new Error("--baseline and --check are separate runs");
        if (opts.via && opts.via !== "mcp") throw new Error("--via takes `mcp`");
        const via = opts.via && { cli: opts.server ?? process.argv[1], cwd: opts.cwd ?? process.cwd(), waitForReady: !!opts.waitForReady };
        const report = await runSuite(opts.notes, loadSets(opts.notes, opts.set, opts.dir), via);
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

  evalCmd
    .command("generate")
    .description("Write blind questions for this vault with the host agent (claude): keyword, paraphrase, multi-doc and negative")
    .requiredOption("--notes <path>", "Path to markdown notes directory")
    .option("--docs <n>", "Documents to sample", "20")
    .option("--model <name>", "Model for the generator (default: the skill loop model)")
    .option("--dir <path>", "Eval dir (default <project>/.claude/.semantic-memory/eval)")
    .action(async (opts) => {
      try {
        const { cases, rejected, costUsd } = await generateCases(opts.notes, { docs: Number(opts.docs), model: opts.model });
        const file = join(evalDir(opts.notes, opts.dir), "generated.jsonl");
        if (cases.length) writeGenerated(file, cases);
        for (const r of rejected) console.error(`rejected ${r.doc}${r.q ? ` "${r.q}"` : ""}: ${r.why}`);
        console.log(`${cases.length} questions kept, ${rejected.length} rejected, $${costUsd.toFixed(3)}${cases.length ? ` -> ${file}` : ""}`);
        process.exit(cases.length ? 0 : 1);
      } catch (err: any) {
        console.error(`eval generate failed: ${err.message}`);
        process.exit(1);
      }
    });
}
