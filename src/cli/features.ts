import type { Command } from "commander";
import { featureState, describeFeature, setSettingsEnv, setRepoConfig, ENV, type Feature } from "../core/features.js";

const NEXT = "takes effect in the next Claude Code session (settings env is read at session start)";

function toggle(feature: Feature, on: boolean, opts: { repo?: boolean; clear?: boolean }) {
  const cwd = process.cwd();
  try {
    if (opts.repo) {
      const path = setRepoConfig(cwd, "skill_loop", opts.clear ? undefined : on ? "on" : "off");
      console.log(`✓ ${opts.clear ? "cleared" : "set"} skill_loop${opts.clear ? "" : `: ${on ? "on" : "off"}`} in ${path}`);
    } else {
      // "off" removes the key rather than writing 0: off is the default, and nothing is left behind
      const { path, backup } = setSettingsEnv(ENV[feature], on ? "1" : undefined);
      console.log(`✓ ${on ? "set" : "removed"} ${ENV[feature]}${on ? "=1" : ""} in ${path}${backup ? ` (previous file: ${backup})` : ""}`);
      console.log(`  ${NEXT}`);
    }
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }
  // the switch as this repo will see it next session
  const env = { ...process.env };
  if (!opts.repo) {
    if (on) env[ENV[feature]] = "1";
    else delete env[ENV[feature]];
  }
  console.log(`  now: ${describeFeature(featureState(feature, cwd, env))}`);
}

export function registerFeatureCommands(program: Command, extraStatus: Partial<Record<Feature, (cwd: string) => Promise<string[]>>> = {}) {
  for (const [feature, name, what] of [
    ["skill_loop", "skill-loop", "the skill loop (learned skills between sessions)"],
    ["jev", "jev-mode", "jev mode (Jev through jev-loop for closed-set decisions)"],
  ] as const) {
    const cmd = program.commands.find((c) => c.name() === name) ?? program.command(name).description(`Turn ${what} on or off, or show its state.`);
    const on = cmd.command("on").description(`Turn ${what} on (sets ${ENV[feature]}=1 in ~/.claude/settings.json env).`);
    const off = cmd.command("off").description(`Turn ${what} off (removes ${ENV[feature]} from ~/.claude/settings.json env).`);
    if (feature === "skill_loop") {
      for (const c of [on, off]) {
        c.option("--repo", "Write the per-repo override in .claude/.semantic-memory/config instead (beats the global switch)");
        c.option("--clear", "With --repo: remove the override so the global switch applies");
      }
    }
    on.action((opts) => toggle(feature, true, opts));
    off.action((opts) => toggle(feature, false, opts));
    cmd
      .command("status")
      .description(`Show whether ${what} is on, and why.`)
      .option("--json", "JSON output")
      .action(async (opts) => {
        const cwd = process.cwd();
        const s = featureState(feature, cwd);
        const extra = (await extraStatus[feature]?.(cwd)) ?? [];
        if (opts.json) console.log(JSON.stringify({ ...s, details: extra }, null, 2));
        else for (const line of [describeFeature(s), ...extra.map((l) => `  ${l}`)]) console.log(line);
        process.exit(0);
      });
  }
}
