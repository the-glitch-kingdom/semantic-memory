import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSkill } from "../core/skill-schema.js";
import { buildEvalSet, type CandidatePrompt } from "../core/skill-eval/sets.js";
import { runTrigger } from "../core/skill-eval/trigger.js";
import { runTaskEval } from "../core/skill-eval/task.js";
import { tuneDescription } from "../core/skill-eval/tune.js";

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

function load(file: string, promptsFile: string) {
  const skillRaw = readFileSync(resolve(file), "utf8");
  const candidates: CandidatePrompt[] = readFileSync(resolve(promptsFile), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { skillRaw, prompts: buildEvalSet(parseSkill(skillRaw), candidates) };
}

const out = (json: boolean | undefined, data: unknown, text: () => string) => console.log(json ? JSON.stringify(data, null, 2) : text());

export function registerSkillEvalCommands(program: Command): void {
  const ev = program.command("skill-eval").description("Evaluate a learned skill: does it trigger, does it help, can its description be better (v1.7)");
  const repoRoot = process.cwd();
  const fail = (e: unknown) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  };

  ev.command("trigger <skill-md>")
    .description("Run the trigger eval; --prompts is JSONL of {session, text}")
    .requiredOption("--prompts <jsonl>", "candidate prompts, one {session, text} per line")
    .option("--json", "machine-readable output")
    .action(async (file: string, opts: { prompts: string; json?: boolean }) => {
      try {
        const { skillRaw, prompts } = load(file, opts.prompts);
        const r = await runTrigger(prompts, { repoRoot, skillRaw });
        out(opts.json, r, () =>
          [
            `${r.skill}: ${prompts.length} prompts, ${r.runs} claude run(s)`,
            ...(["train", "heldout"] as const).map((s) => `  ${s}: triggers on ${pct(r[s].positiveRate)} of positives, false-triggers on ${pct(r[s].falseTriggerRate)} of near-misses (n=${r[s].n})`),
          ].join("\n"),
        );
      } catch (e) {
        fail(e);
      }
    });

  ev.command("task <skill-md>")
    .description("Replay a task with and without the skill and check its ## Verify")
    .requiredOption("--prompt <text>", "the task prompt")
    .option("--json", "machine-readable output")
    .action(async (file: string, opts: { prompt: string; json?: boolean }) => {
      try {
        const r = await runTaskEval({ repoRoot, skillRaw: readFileSync(resolve(file), "utf8"), prompt: opts.prompt });
        out(opts.json, r, () => `${r.skill}: with skill ${r.with.passed ? "PASS" : "FAIL"} (${r.with.evidence}); without ${r.without.passed ? "PASS" : "FAIL"} (${r.without.evidence})`);
      } catch (e) {
        fail(e);
      }
    });

  ev.command("tune <skill-md>")
    .description("Propose a better description (never writes the skill file)")
    .requiredOption("--prompts <jsonl>", "candidate prompts, one {session, text} per line")
    .option("--json", "machine-readable output")
    .action(async (file: string, opts: { prompts: string; json?: boolean }) => {
      try {
        const { skillRaw, prompts } = load(file, opts.prompts);
        const r = await tuneDescription({ repoRoot, skillRaw, prompts });
        out(opts.json, r, () =>
          r.improved
            ? `proposed (held-out ${pct(r.original.heldout)} -> ${pct(r.best.heldout)}):\n${r.best.description}`
            : `no better description found (held-out ${pct(r.original.heldout)}); ${r.candidates.length - 1} tried`,
        );
      } catch (e) {
        fail(e);
      }
    });
}
