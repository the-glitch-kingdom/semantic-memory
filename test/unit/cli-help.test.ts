import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const help = async (...a: string[]) => (await run("node", ["bin/semantic-memory", ...a, "--help"], { encoding: "utf8" })).stdout;

/** Command names listed under "Commands:" (the `help` subcommand is commander's own). */
const subcommands = (h: string) =>
  (h.split("\nCommands:\n")[1] ?? "").split("\n").map((l) => l.match(/^ {2}(\S+)/)?.[1]).filter((x): x is string => !!x && x !== "help");

async function walk(path: string[], out: Map<string, string>) {
  const h = await help(...path);
  out.set(path.join(" ") || "(root)", h);
  await Promise.all(subcommands(h).map((c) => walk([...path, c], out)));
}

const all = new Map<string, string>();
beforeAll(async () => { await walk([], all); }, 120_000);

describe("every --help", () => {
  it("covers every command and the subcommands of the 8 groups", () => {
    const top = subcommands(all.get("(root)")!);
    expect(top.length).toBeGreaterThanOrEqual(27);
    for (const g of ["skills", "lexicon", "dossier", "profile", "skill-loop", "jev-mode", "skill-eval", "eval"]) {
      expect(subcommands(all.get(g)!).length, g).toBeGreaterThan(0);
    }
  });

  it("has a description, a described option list and no stale names or version tags", () => {
    for (const [name, h] of all) {
      const lines = h.split("\n");
      expect(lines[0], name).toMatch(/^Usage: /);
      expect(lines[1], name).toBe("");
      expect(lines[2].trim().length, `${name}: description`).toBeGreaterThan(10);
      // every option row has a description after its flags (continuation lines are indented deeper)
      for (const l of lines.slice(lines.indexOf("Options:") + 1)) {
        if (!l.startsWith("  -")) { if (l.trim() === "") break; continue; }
        expect(l.replace(/^ {2}\S.*?(?: {2,}|$)/, "").trim().length, `${name}: ${l}`).toBeGreaterThan(0);
      }
      expect(h, `${name}: version tag`).not.toMatch(/\(v1\.\d+(?:\.\d+)?\)|\(v1\.\d+ /);
      expect(h, `${name}: doubled default`).not.toMatch(/\(default: [^)]*\) \(default:/);
    }
  });

  it("describes the new long-term flags and tool parameters", async () => {
    const search = all.get("search")!;
    expect(search).toContain("--source");
    expect(search).toContain("--reindex");
    expect(search).toContain("search_hybrid tool defaults to 10");
    const { stdout } = await run("node", ["bin/semantic-memory", "tools", "search_hybrid"], { encoding: "utf8" });
    expect(stdout).toContain("sources");
  });
});
