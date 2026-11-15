import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { generateCases, writeGenerated } from "../core/retrieval-eval/generate.js";
import { isCodeLineFacet } from "../core/retrieval-eval/metrics.js";
import { toGapsV1 } from "../core/usage-log.js";
import { loadTargets, writeDefaults, TARGETS_FILE } from "../core/retrieval-eval/targets.js";
import { evalDir, loadSets, runSuite, formatSuite, baselinePath, writeBaseline, checkBaseline, type Baseline } from "../core/retrieval-eval/suite.js";

export function registerEvalCommand(program: Command): void {
  // `eval generate --notes` must reach the subcommand: commander lets a parent that knows --notes take it otherwise
  program.enablePositionalOptions();
  const evalCmd = program
    .command("eval")
    .enablePositionalOptions()
    .description("Measure retrieval on this vault through the live search path (never re-embeds the index or writes search logs; notes changed since the last index are indexed first, as on a server start)")
    .option("--notes <path>", "Markdown notes folder (required), e.g. .documentation")
    .option("--set <files...>", "JSONL question sets ({id, tier, q, facets}); default: *.jsonl in the eval dir")
    .option("--dir <path>", "Eval dir (default <project>/.claude/.semantic-memory/eval)")
    .option("--baseline", "Write the measured counts to <eval dir>/baseline.json as the floor")
    .option("--check", "Exit 1 when a count drops below the baseline by more than --band questions")
    .option("--band <n>", "Noise band for --check, in questions", "1")
    .option("--via <path>", "Measure through the stdio server, as the plugin launches it, instead of in-process: `mcp` (queries start as soon as the server answers)")
    .option("--cwd <path>", "With --via mcp: the server's working directory (the repo; --notes is resolved from it)")
    .option("--server <cli>", "With --via mcp: the CLI entry the server is launched from (default: this one), to measure another build or release with this driver")
    .option("--settle", "With --via mcp: retry answers marked stale, so the run scores the settled state (default: score the first answers as an agent gets them)")
    .option("--wait-for-ready", "With --via mcp: start the server with --wait-for-ready (the plugin does not)")
    .option("--no-oracle", "Skip the per-miss diagnosis section (coverage / ranking / grounding, and the grep oracle's line)")
    .option("--gaps-out <file>", "Write the coverage misses as gaps.v1 plus id, tier, facets, missing_facets and nearest_doc, for `hewtd reconcile --gaps <file>`")
    .option("--json", "Print the report as JSON")
    .action(async (opts) => {
      try {
        // not requiredOption: commander would demand it on `eval generate` too, before the subcommand's own --notes
        if (!opts.notes) throw new Error("required option --notes <path> not specified");
        // --baseline would overwrite the floor before --check read it, so the check could never fail
        if (opts.baseline && opts.check) throw new Error("--baseline and --check are separate runs");
        if (opts.via && opts.via !== "mcp") throw new Error("--via takes `mcp`");
        const dir = evalDir(opts.notes, opts.dir);
        const cases = loadSets(opts.notes, opts.set, opts.dir); // before any file is written: a run with no sets leaves no targets.json behind
        if (!existsSync(join(dir, TARGETS_FILE))) {
          console.error(`wrote default targets: ${writeDefaults(dir, { only: [TARGETS_FILE] }).written[0]}`);
        }
        const { targets, unknown } = loadTargets(dir); // a malformed file stops the run before the slow part
        if (unknown.length) console.error(`${join(dir, TARGETS_FILE)}: ignoring unknown targets: ${unknown.join(", ")}`);
        const via = opts.via && { cli: opts.server ?? process.argv[1], cwd: opts.cwd ?? process.cwd(), waitForReady: !!opts.waitForReady, settle: !!opts.settle };
        const report = await runSuite(opts.notes, cases, via, targets);
        const version = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;
        // Warning only: labels stay as measured. One line per code-line facet that no doc matches.
        for (const d of report.diagnosis?.cases ?? []) {
          if (d.label !== "coverage") continue;
          for (const f of (d.missing_facets ?? []).filter(isCodeLineFacet)) console.error(`warning: ${d.id}: facet looks copied from a code line and matches no doc (write the facet from the answer in prose): ${f}`);
        }
        if (opts.gapsOut) {
          const today = new Date().toISOString().slice(0, 10);
          const byId = new Map(cases.map((c) => [c.id, c]));
          const diag = (report.diagnosis?.cases ?? []).filter((c) => c.label === "coverage");
          const base = toGapsV1(diag.map((c) => ({ query: c.q, used_doc: null, suggested: "new doc", count: 1, last_seen: today, signals: [] })), version);
          // toGapsV1 stays the usage log's five fields; the case detail hewtd plans from rides on top for these entries only.
          const gaps = diag.map((d, i) => { const c = byId.get(d.id)!; return { ...base.gaps[i], id: c.id, tier: c.tier, blind: !!c.blind, facets: c.facets ?? [], missing_facets: d.missing_facets ?? [], ...(d.nearest_doc && { nearest_doc: d.nearest_doc }), ...(c.expected && { expected: c.expected }) }; });
          mkdirSync(dirname(opts.gapsOut), { recursive: true });
          writeFileSync(opts.gapsOut, JSON.stringify({ ...base, gaps }, null, 2) + "\n");
          console.error(`coverage gaps written: ${opts.gapsOut} (${gaps.length})`);
        }
        if (!opts.oracle) delete report.diagnosis;
        console.log(opts.json ? JSON.stringify(report, null, 2) : formatSuite(report));
        const file = baselinePath(opts.notes, opts.dir);
        if (opts.baseline) {
          writeBaseline(file, report, version);
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
    .command("init")
    .description("Write targets.json, a question template and BLIND-SETS.md (how to write a blind set) into the eval dir; existing files are left alone")
    .option("--notes <path>", "Markdown notes folder, e.g. .documentation (locates the default eval dir)")
    .option("--dir <path>", "Eval dir (default <project>/.claude/.semantic-memory/eval)")
    .option("--force", "Rewrite files that already exist")
    .action((opts) => {
      try {
        if (!opts.notes && !opts.dir) throw new Error("required: --notes <path> or --dir <path>");
        const { written, kept } = writeDefaults(evalDir(opts.notes ?? ".", opts.dir), { force: !!opts.force });
        for (const f of written) console.log(`wrote ${f}`);
        for (const f of kept) console.log(`${f} already exists, left untouched (--force rewrites)`);
        process.exit(0);
      } catch (err: any) {
        console.error(`eval init failed: ${err.message}`);
        process.exit(1);
      }
    });

  evalCmd
    .command("generate")
    .description("Write blind questions for this vault with the host agent (claude): keyword, paraphrase, multi-doc and negative")
    .requiredOption("--notes <path>", "Markdown notes folder (required), e.g. .documentation")
    .option("--docs <n>", "Documents to sample", "20")
    .option("--model <name>", "Model for the generator (default: the skill loop model)")
    .option("--dir <path>", "Eval dir (default <project>/.claude/.semantic-memory/eval)")
    .action(async (opts) => {
      try {
        const { cases, rejected, costUsd } = await generateCases(opts.notes, { docs: Number(opts.docs), model: opts.model });
        const file = join(evalDir(opts.notes, opts.dir), "generated.jsonl");
        if (cases.length) writeGenerated(file, cases);
        for (const r of rejected) console.error(`rejected ${r.doc}${r.q ? ` "${r.q}"` : ""}: ${r.why}`);
        console.log(`${cases.length} questions kept, ${rejected.length} rejected, $${costUsd.toFixed(3)}${cases.length ? ` -> ${file} (marked blind: false: sampled from the docs, so not blind, see BLIND-SETS.md)` : ""}`);
        process.exit(cases.length ? 0 : 1);
      } catch (err: any) {
        console.error(`eval generate failed: ${err.message}`);
        process.exit(1);
      }
    });
}
