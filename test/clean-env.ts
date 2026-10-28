// The developer's own switches (in ~/.claude/settings.json env, inherited from Claude Code) must not reach the
// tests: with SEMANTIC_MEMORY_JEV=1 and a real TYPESAFE_API_KEY a hook test would call the real Jev.
// Tests that need a feature set it explicitly (and Jev tests use a fake key and a fake jev-loop).
for (const k of ["SEMANTIC_MEMORY_JEV", "SEMANTIC_MEMORY_SKILL_LOOP", "SEMANTIC_MEMORY_FAILURE_HOOK", "TYPESAFE_API_KEY", "JEV_LOOP_DIR"]) delete process.env[k];
