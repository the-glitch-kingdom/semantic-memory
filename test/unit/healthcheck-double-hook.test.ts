import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHealthcheck } from "../../src/core/healthcheck.js";

/**
 * checkHookDoubleRegistration fires only in a plugin context (CLAUDE_PLUGIN_ROOT set)
 * where the same event is registered in BOTH .claude/settings.json AND the plugin's
 * hooks/hooks.json — the double-fire that injected <vault-context> twice per prompt.
 */
describe("healthcheck: hook double-registration", () => {
  let projectDir: string;
  let pluginDir: string;
  const orig = process.env.CLAUDE_PLUGIN_ROOT;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hc-proj-"));
    pluginDir = await mkdtemp(join(tmpdir(), "hc-plugin-"));
    await mkdir(join(pluginDir, "hooks"), { recursive: true });
    await mkdir(join(projectDir, ".claude"), { recursive: true });
    vi.stubEnv("CLAUDE_CONFIG_DIR", join(projectDir, "no-claude-config")); // keep the real installed_plugins.json out (#34)
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (orig === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = orig;
    await rm(projectDir, { recursive: true, force: true });
    await rm(pluginDir, { recursive: true, force: true });
  });

  async function writePluginHooks(events: string[]) {
    const hooks: Record<string, unknown> = {};
    for (const e of events) hooks[e] = [{ hooks: [{ type: "command", command: "node plugin.js" }] }];
    await writeFile(join(pluginDir, "hooks", "hooks.json"), JSON.stringify({ hooks }), "utf-8");
  }
  async function writeSettings(events: string[]) {
    const hooks: Record<string, unknown> = {};
    for (const e of events) hooks[e] = [{ hooks: [{ type: "command", command: "node ./hooks/vault-context.js" }] }];
    await writeFile(join(projectDir, ".claude", "settings.json"), JSON.stringify({ hooks }), "utf-8");
  }
  const find = (r: Awaited<ReturnType<typeof runHealthcheck>>) =>
    r.findings.find((x) => x.check === "hook_double_registration");

  it("warns on events registered in both settings.json and the plugin hooks.json", async () => {
    process.env.CLAUDE_PLUGIN_ROOT = pluginDir;
    await writePluginHooks(["SessionStart", "UserPromptSubmit", "Stop"]);
    await writeSettings(["SessionStart", "UserPromptSubmit", "Stop"]);
    const f = find(await runHealthcheck({ projectRoot: projectDir, tier: "fast", force: true }));
    expect(f?.severity).toBe("warn");
    expect(f?.summary).toMatch(/SessionStart.*UserPromptSubmit.*Stop/);
    expect(f?.detail).toMatch(/single source of truth/);
  });

  it("is a silent no-op without CLAUDE_PLUGIN_ROOT (npm-dependency install)", async () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    await writeSettings(["SessionStart", "UserPromptSubmit", "Stop"]);
    const f = find(await runHealthcheck({ projectRoot: projectDir, tier: "fast", force: true }));
    expect(f).toBeUndefined(); // check returns null → not in findings
  });

  it("does not warn when settings and plugin register disjoint events", async () => {
    process.env.CLAUDE_PLUGIN_ROOT = pluginDir;
    await writePluginHooks(["SessionStart"]);
    await writeSettings(["Stop"]);
    const f = find(await runHealthcheck({ projectRoot: projectDir, tier: "fast", force: true }));
    expect(f?.severity).toBe("ok");
  });
});
