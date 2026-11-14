import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHealthcheck, filterToDrift } from "../../src/core/healthcheck.js";

// #34: plugin install found through installed_plugins.json when CLAUDE_PLUGIN_ROOT is unset.
// A temp HOME / CLAUDE_CONFIG_DIR keeps this away from the real ~/.claude.
let home: string;
let project: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "hc-home-"));
  project = await mkdtemp(join(tmpdir(), "hc-proj-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(home, ".claude"));
  vi.stubEnv("CLAUDE_PLUGIN_ROOT", "");
  delete process.env.CLAUDE_PLUGIN_ROOT;
  await mkdir(join(project, ".claude"), { recursive: true });
  await writeFile(join(project, ".claude", "settings.json"), "{}", "utf-8");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

async function installPlugin(entry: Record<string, unknown>) {
  const installPath = join(home, ".claude", "plugins", "cache", "m", "semantic-memory", "1.30.0");
  await mkdir(join(installPath, "hooks"), { recursive: true });
  const hooks = Object.fromEntries(["SessionStart", "UserPromptSubmit", "Stop"].map((e) => [e, [{ hooks: [{ command: "x" }] }]]));
  await writeFile(join(installPath, "hooks", "hooks.json"), JSON.stringify({ hooks }), "utf-8");
  await mkdir(join(home, ".claude", "plugins"), { recursive: true });
  await writeFile(
    join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "semantic-memory@m": [{ installPath, version: "1.30.0", ...entry }] } }),
    "utf-8",
  );
}

const hookFinding = async () =>
  filterToDrift(await runHealthcheck({ projectRoot: project, tier: "fast", force: true })).find((d) => d.check === "hook_registration");

describe("hook_registration with a plugin install and no CLAUDE_PLUGIN_ROOT (#34)", () => {
  it("user-scope entry whose hooks.json registers the three events is ok", async () => {
    await installPlugin({ scope: "user" });
    expect(await hookFinding()).toBeUndefined(); // ok findings are filtered out of drift
  });

  it("project-scope entry for this project counts", async () => {
    await installPlugin({ scope: "project", projectPath: project });
    expect(await hookFinding()).toBeUndefined();
  });

  it("guard: no installed_plugins.json entry keeps today's warning", async () => {
    const f = await hookFinding();
    expect(f?.severity).toBe("warn");
    expect(f?.summary).toMatch(/missing hook registrations/);
  });

  it("guard: a project-scope entry for another project does not count", async () => {
    await installPlugin({ scope: "project", projectPath: "/somewhere/else" });
    expect((await hookFinding())?.severity).toBe("warn");
  });

  it("a version 1 shape (no plugins map) keeps the warning", async () => {
    await mkdir(join(home, ".claude", "plugins"), { recursive: true });
    await writeFile(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 1, "semantic-memory": {} }), "utf-8");
    expect((await hookFinding())?.severity).toBe("warn");
  });

  it("an unreadable installed_plugins.json keeps the warning", async () => {
    await mkdir(join(home, ".claude", "plugins"), { recursive: true });
    await writeFile(join(home, ".claude", "plugins", "installed_plugins.json"), "{not json", "utf-8");
    expect((await hookFinding())?.severity).toBe("warn");
  });

  it("an installPath that no longer exists keeps the warning", async () => {
    await installPlugin({ scope: "user", installPath: join(home, "gone") });
    expect((await hookFinding())?.severity).toBe("warn");
  });

  it("a project-scope projectPath with a trailing slash still matches", async () => {
    await installPlugin({ scope: "project", projectPath: project + "/" });
    expect(await hookFinding()).toBeUndefined();
  });
});
