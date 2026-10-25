#!/usr/bin/env node
// semantic-memory SessionStart hook.
//
// Critical path (zero external deps): run reconcile.js to wire .mcp.json +
// create .claude/.vault. This ALWAYS runs, even if the plugin is installed
// in a location where @theglitchking/claude-plugin-runtime isn't resolvable
// (which happens when Claude Code extracts the plugin tarball without running
// npm install afterward — the default for `/plugin install`).
//
// Optional: if claude-plugin-runtime IS resolvable, delegate to
// runSessionStart which also does policy-gated auto-update checks. Otherwise
// just emit the minimum-valid SessionStart response.
//
// Either way, this hook MUST NOT throw — a broken SessionStart hook is worse
// than an idle one.

import { reconcile } from "./reconcile.js";

async function main() {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  // recursion guard: a skill-loop claude run (v1.7) must not reconcile or update anything
  if (process.env.SEMANTIC_MEMORY_REVIEWER === "1") {
    emit();
    return;
  }

  // 1. Reconcile — no-deps, always runs.
  try {
    process.chdir(projectRoot);
  } catch {
    // If we can't chdir, emit an empty response and bail. Don't let this kill
    // the session.
    emit();
    return;
  }

  try {
    await reconcile(projectRoot);
  } catch (err) {
    process.stderr.write(`[semantic-memory] reconcile failed: ${err?.message || err}\n`);
  }

  // 2. Optional runtime-backed update check. Skip silently if the runtime
  //    isn't installed in this plugin's extraction dir (the common case when
  //    installed via /plugin install without a subsequent npm install).
  try {
    const mod = await import("@theglitchking/claude-plugin-runtime");
    if (typeof mod.runSessionStart === "function") {
      // runSessionStart emits its own response. It also re-runs reconcile —
      // that's idempotent (reconcile writes only what's missing), so the
      // double-invocation is harmless. We return early to avoid double-emit.
      await mod.runSessionStart({
        packageName: "@theglitchking/semantic-memory",
        pluginName: "semantic-memory",
        configFile: "semantic-memory.json",
        reconcile,
      });
      return;
    }
  } catch (err) {
    // ERR_MODULE_NOT_FOUND is the expected case when the runtime isn't
    // resolvable. Any other error gets logged but doesn't block the session.
    const msg = String(err?.message || err);
    if (!msg.includes("Cannot find package") && !msg.includes("ERR_MODULE_NOT_FOUND")) {
      process.stderr.write(`[semantic-memory] runtime import failed: ${msg}\n`);
    }
  }

  // Fallback emit — minimum-valid SessionStart response with empty context.
  // vault-context.js (the other SessionStart hook) provides the actual preload.
  emit();
}

function emit(additionalContext) {
  const out = { hookSpecificOutput: { hookEventName: "SessionStart" } };
  if (additionalContext && String(additionalContext).trim()) {
    out.hookSpecificOutput.additionalContext = String(additionalContext);
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((err) => {
  process.stderr.write(`[semantic-memory] session-start.js fatal: ${err?.message || err}\n`);
  // Still emit — never block the session.
  emit();
});
