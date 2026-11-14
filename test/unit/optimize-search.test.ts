// #96 Phase 2: acceptance for the shipped `optimize-search` skill and docs/measure-and-tune.md, written before either exists.
// `it.fails` cases become plain `it` in Phase 5 (skill) and Phase 6 (guide).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const CLI = join(root, "dist", "cli", "index.js");
const SKILL = join(root, "skills", "optimize-search", "SKILL.md");
const GUIDE = join(root, "docs", "measure-and-tune.md");
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf-8") : "");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { files: string[] };

/** Does the CLI (or hewtd) know this command line? `--help` exits 0 for a real command and 1 for an unknown one. */
const cliKnows = (args: string[]) => spawnSync("node", [CLI, ...args, "--help"], { encoding: "utf-8" });
const hewtdKnows = (sub: string) => spawnSync("npx", ["hewtd", sub, "--help"], { cwd: root, encoding: "utf-8" }).status === 0;
const cmdsIn = (text: string) => [...text.matchAll(/`((?:semantic-memory|npx hewtd|hewtd|\/reconcile)[^`\n]*)`/g)].map((m) => m[1].trim());

/** The commands the skill and the guide must name, and that must exist in this release (the plan's list). */
function checkCommands(text: string) {
  const cmds = cmdsIn(text);
  const has = (re: RegExp) => cmds.some((c) => re.test(c));
  expect(has(/^semantic-memory eval( |$)/), "semantic-memory eval").toBe(true);
  expect(has(/^semantic-memory eval init/), "eval init").toBe(true);
  expect(has(/^semantic-memory eval .*--gaps-out/), "eval --gaps-out").toBe(true);
  expect(has(/^semantic-memory gaps .*--json/), "gaps --json").toBe(true);
  expect(has(/^\/reconcile /), "/reconcile ...").toBe(true);
  expect(has(/^(npx )?hewtd audit/), "hewtd audit").toBe(true);
  // existence: every semantic-memory subcommand it names answers --help, `eval --gaps-out` is a real option, hewtd audit/reconcile exist
  expect(cliKnows(["eval", "init"]).status, "eval init").toBe(0);
  expect(cliKnows(["eval"]).stdout, "eval has --gaps-out").toContain("--gaps-out");
  expect(cliKnows(["gaps"]).status, "gaps").toBe(0);
  expect(hewtdKnows("audit"), "hewtd audit").toBe(true);
  expect(hewtdKnows("reconcile"), "hewtd reconcile").toBe(true);
  expect(existsSync(join(root, "node_modules/@theglitchking/hit-em-with-the-docs/commands/reconcile.md")), "/reconcile slash command").toBe(true);
}

describe("optimize-search skill (#96)", () => {
  it("skills/optimize-search/SKILL.md exists with frontmatter name and description", () => {
    const m = read(SKILL).match(/^---\n([\s\S]*?)\n---\n/);
    expect(m, "frontmatter").not.toBeNull();
    expect(m![1]).toMatch(/^name: optimize-search$/m);
    expect(m![1]).toMatch(/^description: .{40,}/m);
  });

  it("package.json files lists skills/optimize-search", () => {
    expect(pkg.files).toContain("skills/optimize-search");
  });

  it("skill-surfaces' scan sees it (the shipped-skill list includes it)", () => {
    expect(existsSync(SKILL)).toBe(true);
    // skill-surfaces.test.ts asserts the four skills by name; Phase 5 adds this fifth to that list
    expect(readFileSync(join(root, "test/unit/skill-surfaces.test.ts"), "utf-8")).toContain("skills/optimize-search/SKILL.md");
  });

  it("every command it names exists, and it names the full set", () => {
    checkCommands(read(SKILL));
  });

  it("it carries the hard rules and points at the guide", () => {
    const t = read(SKILL);
    expect(t).toContain("docs/measure-and-tune.md");
    expect(t).toMatch(/blind set/i);
    expect(t).toMatch(/never[^.\n]*tune[^.\n]*held-out/i);
    expect(t).toMatch(/never[^.\n]*(INDEX\.md|REGISTRY\.md)/i);
  });
});

describe("docs/measure-and-tune.md (#96)", () => {
  it.fails("exists and ships in the npm package", () => {
    expect(existsSync(GUIDE)).toBe(true);
    const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
    const paths = (JSON.parse(r.stdout)[0].files as { path: string }[]).map((f) => f.path);
    expect(paths).toContain("docs/measure-and-tune.md");
  }, 60_000);

  it.fails("every command it names exists", () => {
    checkCommands(read(GUIDE));
  });

  it.fails("holds no absolute home paths or repo-private names", () => {
    const t = read(GUIDE);
    expect(t.length).toBeGreaterThan(0); // an empty file would pass the deny-list vacuously
    expect(t).not.toMatch(/\/home\/|~\/workspace|\/Users\/|the-glitch-kingdom|theglitchking|kentro|reinvestorhub|tmarlette/i);
  });
});
