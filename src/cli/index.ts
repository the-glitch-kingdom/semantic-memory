#!/usr/bin/env node

import { program } from "commander";
import { resolve, join, dirname, relative } from "node:path";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { planFixes, type PlannedFix } from "../core/healthcheck-fix.js";
import { registerUpdateCommands } from "@theglitchking/claude-plugin-runtime";
import {
  resolveTarget,
  installSkills,
  uninstallSkills,
  listShippedSkills,
  SKILL_BUNDLER_AGENTS,
  type AgentName,
  type Scope,
} from "./skills.js";
import { migrateState } from "./migrate-state.js";
import { registerFeatureCommands } from "./features.js";
import { registerSkillLoopCommands, skillLoopStatus } from "./skill-loop.js";
import { registerSkillEvalCommands } from "./skill-eval.js";
import { featureState, describeFeature } from "../core/features.js";

const require_ = createRequire(import.meta.url);
const { version } = require_("../../package.json") as { version: string };

const PKG_NAME = "@theglitchking/semantic-memory";
const LEGACY_PKG_NAME = "@theglitchking/semantic-sidekick";

function runRelink(cwd: string) {
  const candidates = [
    join(cwd, "node_modules", "@theglitchking", "semantic-memory", "scripts", "link-skills.js"),
    join(cwd, "node_modules", "@theglitchking", "semantic-sidekick", "scripts", "link-skills.js"),
    resolve(process.cwd(), "scripts", "link-skills.js"),
  ];
  const script = candidates.find((p) => existsSync(p));
  if (!script) {
    console.error("link-skills.js not found — is the package installed?");
    return;
  }
  spawnSync(process.execPath, [script], {
    cwd,
    env: { ...process.env, INIT_CWD: cwd },
    stdio: "inherit",
  });
}

interface FixOutcome {
  check: string;
  action: string;
  status: "fixed" | "failed";
  detail: string;
}

/**
 * Execute a `--fix` plan. Actions are de-duplicated (running skill-link once
 * covers every skill-link finding) and each is best-effort: a failure is captured
 * as an outcome, never thrown. Returns one outcome per distinct action attempted.
 */
async function executeFixes(cwd: string, fixes: PlannedFix[]): Promise<FixOutcome[]> {
  const outcomes: FixOutcome[] = [];
  const actions = [...new Set(fixes.map((f) => f.action))];
  for (const action of actions) {
    const checks = fixes.filter((f) => f.action === action).map((f) => f.check).join(", ");
    try {
      switch (action) {
        case "skill-link": {
          runRelink(cwd);
          outcomes.push({ check: checks, action, status: "fixed", detail: "re-linked skills" });
          break;
        }
        case "state-migrate": {
          const r = migrateState({ projectRoot: cwd, force: true });
          outcomes.push({
            check: checks,
            action,
            status: "fixed",
            detail: `migrated ${r.migrated.length} file(s), resolved ${r.conflicts.length} conflict(s)`,
          });
          break;
        }
        case "mcp-reconcile": {
          const reconcilePath = join(findSourceRoot(), "hooks", "reconcile.js");
          if (!existsSync(reconcilePath)) {
            outcomes.push({ check: checks, action, status: "failed", detail: "reconcile.js not found" });
            break;
          }
          const mod = await import(pathToFileURL(reconcilePath).href);
          mod.reconcile(cwd);
          outcomes.push({ check: checks, action, status: "fixed", detail: "reconciled .mcp.json" });
          break;
        }
        case "reindex": {
          const bin = findLocalBin(cwd);
          if (!bin) {
            outcomes.push({ check: checks, action, status: "failed", detail: "no local bin to run reindex" });
            break;
          }
          const vault = join(cwd, ".claude", ".vault");
          const r = spawnSync("node", [bin, "--notes", vault, "--reindex"], { cwd, stdio: "pipe", timeout: 120_000 });
          if (r.status === 0) {
            outcomes.push({ check: checks, action, status: "fixed", detail: "reindexed vault" });
          } else {
            outcomes.push({ check: checks, action, status: "failed", detail: (r.stderr?.toString() || "reindex failed").slice(0, 200) });
          }
          break;
        }
      }
    } catch (err: any) {
      outcomes.push({ check: checks, action, status: "failed", detail: err?.message ?? String(err) });
    }
  }
  return outcomes;
}

function findLocalBin(cwd: string): string | null {
  const candidates = [
    join(cwd, "node_modules", "@theglitchking", "semantic-memory", "bin", "semantic-memory"),
    join(cwd, "node_modules", "@theglitchking", "semantic-sidekick", "bin", "semantic-sidekick"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function localBinArg(cwd: string): string | null {
  const abs = findLocalBin(cwd);
  if (!abs) return null;
  const rel = relative(cwd, abs);
  return rel.startsWith("..") ? abs : `./${rel}`;
}

function readJsonSafe(path: string): any {
  try {
    const raw = readFileSync(path, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Returns the fragile npx-form pattern we used to write in pre-0.10.0
 * SessionStart hooks, so normalize-config can detect and rewrite it.
 */
function isNpxForm(entry: any): boolean {
  if (!entry || typeof entry !== "object") return false;
  const cmd = entry.command;
  const args = Array.isArray(entry.args) ? entry.args : [];
  return (
    cmd === "npx" &&
    args.some(
      (a: unknown) => typeof a === "string" && (a.includes(PKG_NAME) || a.includes(LEGACY_PKG_NAME))
    )
  );
}

function isLocalForm(entry: any): boolean {
  if (!entry || typeof entry !== "object") return false;
  const cmd = entry.command;
  const args = Array.isArray(entry.args) ? entry.args : [];
  return (
    cmd === "node" &&
    args.some(
      (a: unknown) =>
        typeof a === "string" &&
        (a.includes("node_modules/@theglitchking/semantic-memory") ||
          a.includes("node_modules/@theglitchking/semantic-sidekick"))
    )
  );
}

function extractNotesPath(entry: any): string | null {
  const args = Array.isArray(entry?.args) ? entry.args : [];
  const i = args.indexOf("--notes");
  if (i === -1 || i + 1 >= args.length) return null;
  return String(args[i + 1]);
}

function extractExtraFlags(entry: any): string[] {
  const args = Array.isArray(entry?.args) ? entry.args : [];
  return args.filter((a: unknown): a is string => typeof a === "string" && a.startsWith("--") && a !== "--notes");
}

const TOOL_HELP: Record<string, { description: string; args: string; examples: string[] }> = {
  // Search
  search_semantic: {
    description: "Vector similarity search — find notes by meaning, not just keywords",
    args: '{ "query": "string", "limit?": 10 }',
    examples: [
      '{ "query": "microservices architecture", "limit": 5 }',
      '{ "query": "how to deploy to production" }',
    ],
  },
  search_text: {
    description: "Full-text keyword or regex search with optional filters",
    args: '{ "pattern": "string", "regex?": false, "caseSensitive?": false, "pathGlob?": "string", "tagFilter?": ["string"], "limit?": 20 }',
    examples: [
      '{ "pattern": "RabbitMQ" }',
      '{ "pattern": "OAuth\\\\d", "regex": true }',
      '{ "pattern": "deploy", "pathGlob": "devops/**", "tagFilter": ["kubernetes"] }',
    ],
  },
  search_graph: {
    description: "Graph traversal — find notes connected to a concept via wikilinks and tags",
    args: '{ "concept": "string", "maxDepth?": 2 }',
    examples: [
      '{ "concept": "microservices" }',
      '{ "concept": "auth", "maxDepth": 3 }',
    ],
  },
  search_hybrid: {
    description: "Combined semantic + graph search — vector results re-ranked by graph proximity",
    args: '{ "query": "string", "limit?": 10 }',
    examples: [
      '{ "query": "event driven architecture", "limit": 5 }',
    ],
  },

  // Read
  read_note: {
    description: "Read the full content of a specific note by path",
    args: '{ "path": "string" }',
    examples: [
      '{ "path": "project-overview.md" }',
      '{ "path": "notes/meeting-2024-01-15.md" }',
    ],
  },
  read_multiple_notes: {
    description: "Batch read multiple notes in one call",
    args: '{ "paths": ["string"] }',
    examples: [
      '{ "paths": ["overview.md", "architecture.md", "deployment.md"] }',
    ],
  },
  list_notes: {
    description: "List all indexed notes with metadata (title, tags, link count)",
    args: "{}",
    examples: ["{}"],
  },

  // Write
  create_note: {
    description: "Create a new markdown note with optional YAML frontmatter",
    args: '{ "path": "string", "content": "string", "frontmatter?": {} }',
    examples: [
      '{ "path": "new-guide.md", "content": "# Guide\\n\\nContent here." }',
      '{ "path": "tagged.md", "content": "Content.", "frontmatter": { "title": "Tagged Note", "tags": ["test"] } }',
    ],
  },
  update_note: {
    description: "Edit note content — overwrite, append, prepend, or patch by heading",
    args: '{ "path": "string", "content": "string", "mode": "overwrite|append|prepend|patch-by-heading", "heading?": "string" }',
    examples: [
      '{ "path": "guide.md", "content": "New content.", "mode": "overwrite" }',
      '{ "path": "guide.md", "content": "\\n## Appendix\\nExtra info.", "mode": "append" }',
      '{ "path": "guide.md", "content": "Updated architecture section.", "mode": "patch-by-heading", "heading": "Architecture" }',
    ],
  },
  delete_note: {
    description: "Delete a note permanently (requires confirm=true)",
    args: '{ "path": "string", "confirm": true }',
    examples: [
      '{ "path": "old-note.md", "confirm": true }',
      '{ "path": "old-note.md", "confirm": false }  // returns warning, does not delete',
    ],
  },
  move_note: {
    description: "Move or rename a note — automatically updates wikilinks across the vault",
    args: '{ "from": "string", "to": "string" }',
    examples: [
      '{ "from": "user-service.md", "to": "auth-service.md" }',
      '{ "from": "old/note.md", "to": "new/location/note.md" }',
    ],
  },

  // Metadata
  get_frontmatter: {
    description: "Read parsed YAML frontmatter from a note as JSON",
    args: '{ "path": "string" }',
    examples: ['{ "path": "project-overview.md" }'],
  },
  update_frontmatter: {
    description: "Set or delete YAML frontmatter keys — pass null to delete a key",
    args: '{ "path": "string", "fields": {} }',
    examples: [
      '{ "path": "note.md", "fields": { "status": "active", "priority": 1 } }',
      '{ "path": "note.md", "fields": { "deprecated_field": null } }  // deletes the key',
    ],
  },
  manage_tags: {
    description: "Add, remove, or list tags on a note (frontmatter and inline)",
    args: '{ "path": "string", "action": "add|remove|list", "tags?": ["string"] }',
    examples: [
      '{ "path": "note.md", "action": "list" }',
      '{ "path": "note.md", "action": "add", "tags": ["important", "reviewed"] }',
      '{ "path": "note.md", "action": "remove", "tags": ["draft"] }',
    ],
  },
  rename_tag: {
    description: "Rename a tag across all notes in the vault (frontmatter + inline)",
    args: '{ "oldTag": "string", "newTag": "string" }',
    examples: ['{ "oldTag": "architecture", "newTag": "arch" }'],
  },

  // Graph
  backlinks: {
    description: "Find all notes that link TO a given note via [[wikilinks]]",
    args: '{ "path": "string" }',
    examples: ['{ "path": "microservices.md" }'],
  },
  forwardlinks: {
    description: "Find all notes linked FROM a given note",
    args: '{ "path": "string" }',
    examples: ['{ "path": "project-overview.md" }'],
  },
  graph_path: {
    description: "Find the shortest path between two notes in the knowledge graph",
    args: '{ "from": "string", "to": "string" }',
    examples: ['{ "from": "project-overview.md", "to": "user-service.md" }'],
  },
  graph_statistics: {
    description: "Knowledge graph stats — most connected nodes, orphans, density",
    args: "{}",
    examples: ["{}"],
  },

  // System
  get_stats: {
    description: "Vault and index statistics — note count, chunks, embeddings, graph density",
    args: "{}",
    examples: ["{}"],
  },
  reindex: {
    description: "Force a full reindex of the vault",
    args: "{}",
    examples: ["{}"],
  },
};

const TOOL_CATEGORIES: Record<string, string[]> = {
  Search: ["search_semantic", "search_text", "search_graph", "search_hybrid"],
  Read: ["read_note", "read_multiple_notes", "list_notes"],
  Write: ["create_note", "update_note", "delete_note", "move_note"],
  Metadata: ["get_frontmatter", "update_frontmatter", "manage_tags", "rename_tag"],
  Graph: ["backlinks", "forwardlinks", "graph_path", "graph_statistics"],
  System: ["get_stats", "reindex"],
};

function printToolList() {
  console.log("\nSemantic Pages — 21 MCP Tools\n");
  console.log("Usage: These tools are available via MCP when the server is running.");
  console.log("       Run `semantic-memory tools <name>` for details on a specific tool.\n");

  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    console.log(`  ${category}:`);
    for (const name of tools) {
      const tool = TOOL_HELP[name];
      console.log(`    ${name.padEnd(24)} ${tool.description}`);
    }
    console.log();
  }

  console.log("Run `semantic-memory tools <tool-name>` for arguments and examples.");
}

function printToolDetail(name: string) {
  const tool = TOOL_HELP[name];
  if (!tool) {
    console.error(`Unknown tool: ${name}`);
    console.error(`Run \`semantic-memory tools\` to see all available tools.`);
    process.exit(1);
  }

  console.log(`\n  ${name}`);
  console.log(`  ${"─".repeat(name.length)}`);
  console.log(`  ${tool.description}\n`);
  console.log(`  Arguments:`);
  console.log(`    ${tool.args}\n`);
  console.log(`  Examples:`);
  for (const ex of tool.examples) {
    console.log(`    ${ex}`);
  }
  console.log();
}

program
  .name("semantic-memory")
  .description(
    "Unified memory-layer MCP server for Claude Code (rebrand of semantic-sidekick at v1.0.0).\n" +
    "The `semantic-sidekick` command is preserved as an alias.\n\n" +
    "  Start MCP server:  semantic-memory --notes ./vault\n" +
    "  Show vault stats:  semantic-memory --notes ./vault --stats\n" +
    "  Force reindex:     semantic-memory --notes ./vault --reindex\n" +
    "  List MCP tools:    semantic-memory tools\n" +
    "  Tool details:      semantic-memory tools search_semantic"
  )
  .version(version);

program
  .command("search <query>")
  .description("Run a vault search and print top hits as JSON (used by activation hooks)")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .option("--limit <n>", "Max results", (v) => parseInt(v, 10), 8)
  .option("--text-only", "Skip embedder — keyword-only search (fast path, no model init)")
  .option("--json", "Emit raw JSON (default)", true)
  .action(async (query: string, opts) => {
    const { runSearch } = await import("./search.js");
    try {
      const hits = await runSearch({
        notes: opts.notes,
        query,
        limit: opts.limit,
        textOnly: opts.textOnly,
      });
      process.stdout.write(JSON.stringify(hits, null, 2) + "\n");
      process.exit(0);
    } catch (err: any) {
      console.error(`search failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("eval-failures")
  .description("Replay failed tool calls through search and measure how often the top hit answers them (v1.6 failure lookup)")
  .requiredOption("--cases <file>", "JSONL of {id, notes, error, command}")
  .requiredOption("--judgments <file>", "JSONL of {case, path, relevant}")
  .option("--limit <n>", "Hits per search", (v) => parseInt(v, 10), 5)
  .option("--query <mode>", "raw (error + command as-is) or normalized (failureQuery)", "normalized")
  .option("--target <p>", "Target precision for the recommended threshold", (v) => parseFloat(v), 0.95)
  .option("--min-judged <n>", "Judged injections needed before a threshold can be recommended", (v) => parseInt(v, 10), 20)
  .option("--unjudged-out <file>", "Write unlabelled top hits here (JSONL) for labelling")
  .option("--hits-out <file>", "Write every case's hits here (JSONL) for analysis")
  .option("--json", "Print the report as JSON")
  .option("--hits-in <file>", "Reuse hits from an earlier --hits-out instead of searching")
  .option("--gate <kind>", "Also replay the failure hook's gate: 'jev' (needs --jev-scores)")
  .option("--jev-scores <files...>", "JSONL of {case, path, p} from scripts/eval-failures/judge-jev.mjs")
  .option("--gate-batch-out <file>", "With --gate jev: write the candidates Jev has not scored as a judge batch (set B format)")
  .action(async (opts) => {
    const { openSearch } = await import("./search.js");
    const { evaluateFailures, formatFailureEval } = await import("../core/failure-eval.js");
    const { failureQuery } = await import("../core/failure-query.js");
    const toQuery = (c: { error: string; command: string }) =>
      opts.query === "raw" ? `${c.error}\n${c.command}` : failureQuery(c.error, c.command);
    const readJsonl = (p: string) =>
      readFileSync(resolve(p), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const cases = readJsonl(opts.cases) as import("../core/failure-eval.js").FailureCase[];
    const judgments = readJsonl(opts.judgments) as import("../core/failure-eval.js").Judgment[];

    // one searcher per corpus: the model loads once, not once per case
    const searchers = new Map<string, Awaited<ReturnType<typeof openSearch>>>();
    const results: import("../core/failure-eval.js").CaseResult[] = [];
    if (opts.hitsIn) {
      const ids = new Set(cases.map((c) => c.id));
      results.push(...(readJsonl(opts.hitsIn) as import("../core/failure-eval.js").CaseResult[]).filter((r) => ids.has(r.case)));
    } else {
      for (const c of cases) {
        if (!searchers.has(c.notes)) searchers.set(c.notes, await openSearch(c.notes));
        const hits = await searchers.get(c.notes)!.search(toQuery(c), opts.limit);
        results.push({ case: c.id, hits: hits.map((h) => ({ path: h.path, score: h.score })) });
      }
    }
    const report = evaluateFailures(results, judgments, { targetPrecision: opts.target, minJudged: opts.minJudged });
    if (opts.gate) {
      if (opts.gate !== "jev" || !opts.jevScores) {
        console.error("--gate jev needs --jev-scores <file...>");
        process.exit(2);
      }
      const { evaluateGate, formatGate } = await import("../core/failure-eval.js");
      const jev = (opts.jevScores as string[]).flatMap((f) => readJsonl(f));
      const gate = evaluateGate(results, judgments, jev);
      const veto = evaluateGate(results, judgments, jev, { mode: "veto", thresholds: [0.3, 0.35, 0.4, 0.45, 0.5] });
      if (opts.gateBatchOut) {
        const { default: matter } = await import("../core/matter.js");
        const byId = new Map(cases.map((c) => [c.id, c]));
        const missing = [...new Map([...gate.missing, ...veto.missing].map((m) => [`${m.case}\0${m.path}`, m])).values()];
        const batch = missing.map((m) => {
          const c = byId.get(m.case)!;
          let title = m.path, excerpt = "";
          try {
            const doc = matter(readFileSync(join(c.notes, m.path), "utf-8"));
            title = String(doc.data.title ?? m.path);
            excerpt = doc.content.replace(/^#.*$/m, "").trim().slice(0, 600);
          } catch {}
          return { case: m.case, path: m.path, command: c.command, error: c.error, doc_title: title, doc_excerpt: excerpt };
        });
        writeFileSync(resolve(opts.gateBatchOut), JSON.stringify(batch, null, 1));
        console.error(`${batch.length} unscored candidates → ${opts.gateBatchOut} (judge them with judge-jev.mjs, then re-run)`);
      }
      if (opts.json) {
        console.log(JSON.stringify({ ...report, gate: gate.rows, veto: veto.rows }, null, 2));
        process.exit(0);
      }
      console.log(formatFailureEval(report, `query: ${opts.query}`));
      console.log("");
      console.log(formatGate(gate.rows));
      console.log("");
      console.log(formatGate(veto.rows, "veto"));
      process.exit(0);
    }
    if (opts.hitsOut) {
      writeFileSync(resolve(opts.hitsOut), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    if (opts.unjudgedOut) {
      writeFileSync(resolve(opts.unjudgedOut), report.unjudged.map((u) => JSON.stringify(u)).join("\n") + "\n");
    }
    console.log(opts.json ? JSON.stringify(report, null, 2) : formatFailureEval(report, `query: ${opts.query}`));
    process.exit(0);
  });

program
  .command("lint")
  .description("Lint the vault against vault.schema.yml (schema violations + missing provenance + stale)")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .option("--rule <name>", "Limit output to one rule: schema_violations | missing_provenance | stale")
  .option("--json", "Emit JSON instead of the human-readable report")
  .option("--strict", "Exit non-zero on warnings too (default: exit non-zero only on errors)")
  .action(async (opts) => {
    const { lintVault, formatLintReport } = await import("../core/lint.js");
    const report = await lintVault(resolve(opts.notes));
    // Use console.log + process.exitCode (not process.exit) so Node flushes
    // stdout fully before the process ends. Early process.exit with a large
    // buffered JSON payload can truncate output.
    if (opts.json) {
      const out = opts.rule ? report.byRule[opts.rule as keyof typeof report.byRule] : report;
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(formatLintReport(report, { rule: opts.rule }));
    }
    const bad = opts.strict ? report.counts.errors + report.counts.warnings : report.counts.errors;
    process.exitCode = bad > 0 ? 1 : 0;
  });

program
  .command("log-event")
  .description("Append a structured event to the vault's log.md (used by hooks and CI scripts — same shape as mcp__semantic-vault__log_event)")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .requiredOption("--kind <name>", "Event category: ingest, synthesis, error, mode_change, etc.")
  .requiredOption("--summary <text>", "One-line human summary")
  .option("--payload <json>", "Structured payload as JSON string")
  .action(async (opts) => {
    const { logEvent } = await import("../core/log.js");
    let payload: Record<string, unknown> | undefined;
    if (opts.payload) {
      try {
        payload = JSON.parse(opts.payload);
      } catch (e: any) {
        console.error(`invalid --payload JSON: ${e.message}`);
        process.exitCode = 1;
        return;
      }
    }
    try {
      const entry = await logEvent(resolve(opts.notes), {
        kind: opts.kind,
        summary: opts.summary,
        payload,
      });
      console.log(JSON.stringify(entry));
    } catch (e: any) {
      console.error(`log-event failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("log-query")
  .description("Read structured log entries from log.md — filters by kind, date range, limit")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .option("--kind <name>", "Filter by kind (ingest, synthesis, error, mode_change, etc.)")
  .option("--after <iso>", "ISO timestamp — only entries on or after")
  .option("--before <iso>", "ISO timestamp — only entries on or before")
  .option("--limit <n>", "Max entries (most recent)", (v) => parseInt(v, 10))
  .action(async (opts) => {
    const { logQuery } = await import("../core/log.js");
    try {
      const entries = await logQuery(resolve(opts.notes), {
        kind: opts.kind,
        after: opts.after,
        before: opts.before,
        limit: opts.limit,
      });
      console.log(JSON.stringify(entries));
    } catch (e: any) {
      console.error(`log-query failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("install-schema")
  .description("Bootstrap vault.schema.yml in the vault root with the default schema")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .option("--force", "Overwrite existing schema file")
  .action(async (opts) => {
    const { installDefaultSchema } = await import("../core/schema.js");
    const r = await installDefaultSchema(resolve(opts.notes), opts.force);
    console.log(r.written ? `Installed default schema: ${r.path}` : `Schema already exists: ${r.path} (use --force to overwrite)`);
    process.exit(0);
  });

program
  .command("tools [name]")
  .description("List all MCP tools, or show details for a specific tool")
  .action((name?: string) => {
    if (name) {
      printToolDetail(name);
    } else {
      printToolList();
    }
    process.exit(0);
  });

program
  .command("serve", { isDefault: true })
  .description("Start the MCP server (default command)")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .option("--reindex", "Force full reindex and exit")
  .option("--stats", "Show vault statistics and exit")
  .option("--wait-for-ready", "Block startup until index is fully built before serving (default: index in background; tools return 'Indexing in progress' until ready)")
  .option("--read-only", "Suppress write tools (create_note, update_note, delete_note, move_note, update_frontmatter, manage_tags, rename_tag, log_event, ...) — use for shared docs vaults owned by another tool")
  .option("--model <name>", "Embedding model to use (default: all-MiniLM-L6-v2, fast; use nomic-ai/nomic-embed-text-v1.5 for higher quality)")
  .option("--workers <n>", "Number of worker threads for parallel embedding", parseInt)
  .option("--batch-size <n>", "Texts per ONNX forward pass (default: 8)", parseInt)
  .option("--no-quantized", "Use full-precision model instead of quantized (slower, slightly higher quality)")
  .option("--no-watch", "Disable file watcher")
  .action(async (opts) => {
    const notesPath = resolve(opts.notes);

    if (!existsSync(notesPath)) {
      console.error(`Error: notes directory not found: ${notesPath}`);
      process.exit(1);
    }

    if (opts.stats) {
      const { Indexer } = await import("../core/indexer.js");
      const indexer = new Indexer(notesPath);
      const docs = await indexer.indexAll();
      console.log(`Notes: ${docs.length}`);
      console.log(`Chunks: ${docs.reduce((n: number, d: any) => n + d.chunks.length, 0)}`);
      console.log(`Wikilinks: ${docs.reduce((n: number, d: any) => n + d.wikilinks.length, 0)}`);
      console.log(`Tags: ${new Set(docs.flatMap((d: any) => d.tags)).size} unique`);
      process.exit(0);
    }

    if (opts.reindex) {
      const { createServer } = await import("../mcp/server.js");
      await createServer(notesPath, {
        watch: false,
        waitForReady: true,
        model: opts.model,
        workers: opts.workers,
        batchSize: opts.batchSize,
        quantized: opts.quantized,
        onProgress: (embedded, total) => {
          process.stderr.write(`\rEmbedding ${embedded}/${total} chunks...`);
        },
      });
      process.stderr.write("\n");
      console.log("Reindex complete.");
      process.exit(0);
    }

    // Default: start MCP server on stdio
    const { startServer } = await import("../mcp/server.js");
    await startServer(notesPath, {
      watch: opts.watch,
      waitForReady: opts.waitForReady,
      model: opts.model,
      workers: opts.workers,
      batchSize: opts.batchSize,
      quantized: opts.quantized,
      readOnly: opts.readOnly,
    });
  });

registerUpdateCommands(program, {
  packageName: PKG_NAME,
  pluginName: "semantic-memory",
  configFile: "semantic-memory.json",
  onAfterUpdate: (cwd) => runRelink(cwd),
});

program
  .command("normalize-config")
  .description(
    "Rewrite fragile `npx @latest` entries in .mcp.json to the stable node-against-node_modules form (with backup and validation)",
  )
  .option("--dry-run", "print the proposed changes but don't write")
  .action((opts: { dryRun?: boolean }) => {
    const cwd = process.cwd();
    const mcpPath = join(cwd, ".mcp.json");
    if (!existsSync(mcpPath)) {
      console.log("no .mcp.json in current directory — nothing to do");
      process.exit(0);
    }
    const data = readJsonSafe(mcpPath);
    if (!data || typeof data !== "object" || !data.mcpServers || typeof data.mcpServers !== "object") {
      console.error(`could not parse ${mcpPath}`);
      process.exit(1);
    }
    const bin = localBinArg(cwd);
    if (!bin) {
      console.error(
        `no local install found at ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory ` +
          `(or the legacy semantic-sidekick path).\n` +
          `run 'npm install --save @theglitchking/semantic-memory' first, then re-run this command.`,
      );
      process.exit(1);
    }
    const rewritten: string[] = [];
    for (const [key, entry] of Object.entries<any>(data.mcpServers)) {
      if (!isNpxForm(entry)) continue;
      const notes = extractNotesPath(entry) ?? "./.claude/.vault";
      const extra = extractExtraFlags(entry);
      data.mcpServers[key] = {
        type: "stdio",
        command: "node",
        args: [bin, "--notes", notes, ...extra],
      };
      rewritten.push(key);
    }
    if (rewritten.length === 0) {
      console.log("no npx-form entries found — .mcp.json is already in the stable form.");
      process.exit(0);
    }
    console.log(`Rewriting ${rewritten.length} entr${rewritten.length === 1 ? "y" : "ies"}: ${rewritten.join(", ")}`);
    if (opts.dryRun) {
      console.log("--- proposed .mcp.json:");
      console.log(JSON.stringify(data, null, 2));
      console.log("--- (dry-run; no changes written)");
      process.exit(0);
    }
    // Back up
    const bakPath = join(dirname(mcpPath), ".mcp.json.bak");
    try {
      writeFileSync(bakPath, readFileSync(mcpPath, "utf8"));
      console.log(`backup written: ${bakPath}`);
    } catch (err: any) {
      console.error(`could not write backup: ${err.message}`);
      process.exit(1);
    }
    writeFileSync(mcpPath, JSON.stringify(data, null, 2) + "\n");

    // Verify the local bin starts cleanly. We just run --version — fast and
    // enough to catch ERR_MODULE_NOT_FOUND type failures.
    const verify = spawnSync("node", [bin, "--version"], { cwd, stdio: "pipe", timeout: 15_000 });
    if (verify.status !== 0) {
      console.error(`verification failed (exit ${verify.status}):\n${verify.stderr?.toString() || ""}`);
      console.error(`rolling back from ${bakPath}`);
      writeFileSync(mcpPath, readFileSync(bakPath, "utf8"));
      process.exit(1);
    }
    console.log(`✓ .mcp.json normalized and verified. Toggle the MCPs in /mcp to reconnect.`);
    process.exit(0);
  });

program
  .command("healthcheck")
  .description(
    "Verify the local install starts cleanly + run drift detection. Self-heals common npx-cache corruption (ERR_MODULE_NOT_FOUND). With --fast, skips the slow tier (full vault lint). With --fix, auto-applies safe fixes for fixable findings.",
  )
  .option("--fast", "Run only the fast-tier drift checks (file-system probes). Skips the slow tier (full vault lint).", false)
  .option("--json", "Emit structured JSON output instead of human-readable text.", false)
  .option("--fix", "Auto-apply safe fixes for fixable drift findings (re-link skills, reconcile .mcp.json, reindex, migrate state). Findings that need human review are reported, not touched.", false)
  .action(async (opts) => {
    const cwd = process.cwd();
    const bin = findLocalBin(cwd);
    if (!bin) {
      console.error(`no local install at ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory (or legacy semantic-sidekick path)`);
      console.error(`run 'npm install --save @theglitchking/semantic-memory' to install.`);
      process.exit(1);
    }

    // 1. Warn if .mcp.json uses the fragile form.
    const mcpPath = join(cwd, ".mcp.json");
    if (existsSync(mcpPath) && !opts.json) {
      const data = readJsonSafe(mcpPath);
      const entries = data?.mcpServers && typeof data.mcpServers === "object" ? Object.entries<any>(data.mcpServers) : [];
      const fragile = entries.filter(([, e]) => isNpxForm(e)).map(([k]) => k);
      if (fragile.length > 0) {
        console.warn(`⚠️  .mcp.json uses the fragile npx-@latest form for: ${fragile.join(", ")}`);
        console.warn(`   Rewrite to the stable form:`);
        console.warn(`     npx --no @theglitchking/semantic-memory normalize-config`);
      }
    }

    // 2. Smoke-test the local bin (with npx-cache self-heal on ERR_MODULE_NOT_FOUND).
    //    Unlike prior versions, this does NOT exit early — drift detection and
    //    --fix always run afterwards.
    let smokeOk = false;
    let smokeVersion = "";
    {
      const r = spawnSync("node", [bin, "--version"], { cwd, stdio: "pipe", timeout: 15_000 });
      if (r.status === 0) {
        smokeOk = true;
        smokeVersion = r.stdout?.toString().trim() ?? "";
      } else {
        const stderr = r.stderr?.toString() ?? "";
        if (stderr.includes("ERR_MODULE_NOT_FOUND")) {
          const match = stderr.match(/([\/~][^'"\s]*\/_npx\/[^\/'"\s]+)/);
          if (match) {
            const bad = match[1];
            if (!opts.json) console.warn(`detected broken npx cache at ${bad} — clearing and retrying...`);
            try { rmSync(bad, { recursive: true, force: true }); } catch {}
            const r2 = spawnSync("node", [bin, "--version"], { cwd, stdio: "pipe", timeout: 15_000 });
            if (r2.status === 0) {
              smokeOk = true;
              smokeVersion = r2.stdout?.toString().trim() ?? "";
            } else if (!opts.json) {
              console.error(`retry still failed:\n${r2.stderr?.toString() || ""}`);
            }
          }
        }
        if (!smokeOk && !opts.json && stderr) console.error(stderr);
      }
    }
    if (smokeOk && !opts.json) console.log(`✓ local install starts cleanly (v${smokeVersion})`);

    // 3. Run drift detection.
    const { runHealthcheck, formatDriftBanner, filterToDrift } = await import("../core/healthcheck.js");
    const vaultCandidate = join(cwd, ".claude", ".vault");
    const vaultPath = existsSync(vaultCandidate) ? vaultCandidate : undefined;
    let result = await runHealthcheck({ projectRoot: cwd, vaultPath, tier: opts.fast ? "fast" : "all", force: true });

    // 4. Apply fixes if requested.
    let fixOutcomes: FixOutcome[] = [];
    let plan = { fixes: [] as PlannedFix[], skipped: [] as { check: string; reason: string }[] };
    if (opts.fix) {
      plan = planFixes(filterToDrift(result));
      if (plan.fixes.length > 0) {
        fixOutcomes = await executeFixes(cwd, plan.fixes);
        // Re-run fast-tier drift to reflect the post-fix state.
        result = await runHealthcheck({ projectRoot: cwd, vaultPath, tier: opts.fast ? "fast" : "all", force: true });
      }
    }

    // 5. Emit.
    if (opts.json) {
      const features = { skill_loop: featureState("skill_loop", cwd), jev: featureState("jev", cwd) };
      console.log(JSON.stringify({ smoke: { ok: smokeOk, version: smokeVersion }, result, features, fix: opts.fix ? { plan, outcomes: fixOutcomes } : undefined }, null, 2));
    } else {
      if (opts.fix) {
        if (fixOutcomes.length === 0 && plan.skipped.length === 0) {
          console.log(`\n✓ nothing to fix`);
        } else {
          console.log(`\n--fix applied ${fixOutcomes.filter((o) => o.status === "fixed").length}/${fixOutcomes.length} action(s):`);
          for (const o of fixOutcomes) console.log(`  ${o.status === "fixed" ? "✓" : "✗"} ${o.action} (${o.check}) — ${o.detail}`);
          for (const s of plan.skipped) console.log(`  • skipped ${s.check} — ${s.reason}`);
        }
      }
      const banner = formatDriftBanner(result);
      if (banner) {
        console.log("");
        console.log(banner);
      } else {
        console.log(`\n✓ no drift detected (${result.findings.length} checks ran in ${result.duration_ms}ms)`);
      }
      console.log(`\n${describeFeature(featureState("skill_loop", cwd))}\n${describeFeature(featureState("jev", cwd))}`);
    }

    process.exit(smokeOk ? 0 : 1);
  });

// --- Skill bundler (Phase 6) ---

function parseAgent(input: string): AgentName {
  const a = input.toLowerCase();
  if (!SKILL_BUNDLER_AGENTS.includes(a as AgentName)) {
    console.error(`Unknown agent: ${input}. Supported: ${SKILL_BUNDLER_AGENTS.join(", ")}.`);
    process.exit(2);
  }
  return a as AgentName;
}

function parseScope(input: string): Scope {
  if (input !== "global" && input !== "local") {
    console.error(`Unknown scope: ${input}. Use 'global' or 'local'.`);
    process.exit(2);
  }
  return input;
}

function findSourceRoot(): string {
  // 1. Installed: <cwd>/node_modules/@theglitchking/semantic-sidekick or semantic-memory
  for (const pkg of ["semantic-memory", "semantic-sidekick"]) {
    const installed = join(process.cwd(), "node_modules", "@theglitchking", pkg);
    if (existsSync(installed)) return installed;
  }
  // 2. Dev: derive from the bin location (this file lives at <root>/dist/cli/index.js)
  const dev = resolve(new URL("../../", import.meta.url).pathname);
  return dev;
}

const skillsCmd = program.command("skills").description("Install, target, or uninstall skill bundles for non-Claude agents (codex, copilot, pi). Claude installs continue to use the npm postinstall flow.");

skillsCmd
  .command("targets")
  .description("Preview where skill bundles would be installed for one or more agents.")
  .option("--agent <name...>", "One or more agents (default: all). Repeatable.", undefined as any)
  .option("--scope <scope>", "global or local (default: local)", "local")
  .option("--project <path>", "Project root for local-scope paths (default: cwd)", process.cwd())
  .action((opts) => {
    const scope = parseScope(opts.scope);
    const agents: AgentName[] = (opts.agent && opts.agent.length > 0 ? opts.agent : SKILL_BUNDLER_AGENTS).map(parseAgent);
    const out = agents.map((a) => resolveTarget(a, scope, opts.project));
    console.log(JSON.stringify(out, null, 2));
  });

skillsCmd
  .command("install")
  .description("Install skill bundles into an agent's skill directory. Non-destructive by default; --force to overwrite.")
  .requiredOption("--agent <name>", "Agent runtime (claude, codex, copilot, pi)")
  .option("--scope <scope>", "global or local (default: local)", "local")
  .option("--project <path>", "Project root for local-scope paths (default: cwd)", process.cwd())
  .option("--only <names...>", "Restrict to specific skill names (default: all shipped)")
  .option("--force", "Overwrite even if drift is detected against an existing manifest", false)
  .action(async (opts) => {
    const agent = parseAgent(opts.agent);
    const scope = parseScope(opts.scope);
    if (agent === "claude") {
      console.error(
        "Claude skill installs are handled by the npm postinstall (claude-plugin-runtime). " +
          "Run `npm install @theglitchking/semantic-memory` instead — that flow symlinks " +
          "skills into ~/.claude/skills/ or .claude/skills/ automatically. The skills CLI " +
          "is intended for non-Claude agents (codex, copilot, pi) which do not have that " +
          "postinstall integration."
      );
      process.exit(2);
    }
    const sourceRoot = findSourceRoot();
    const result = await installSkills({
      agent,
      scope,
      sourceRoot,
      projectRoot: opts.project,
      version,
      only: opts.only,
      force: opts.force === true,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.installed.length === 0 && result.reason) process.exit(1);
  });

skillsCmd
  .command("uninstall")
  .description("Remove skill bundles tracked by the semantic-memory manifest. User-written skills outside the manifest are left untouched.")
  .requiredOption("--agent <name>", "Agent runtime (claude, codex, copilot, pi)")
  .option("--scope <scope>", "global or local (default: local)", "local")
  .option("--project <path>", "Project root for local-scope paths (default: cwd)", process.cwd())
  .action(async (opts) => {
    const agent = parseAgent(opts.agent);
    const scope = parseScope(opts.scope);
    if (agent === "claude") {
      console.error("Claude skill uninstalls go through the npm uninstall flow. The skills CLI is for non-Claude agents.");
      process.exit(2);
    }
    const result = await uninstallSkills({ agent, scope, projectRoot: opts.project });
    console.log(JSON.stringify(result, null, 2));
  });

skillsCmd
  .command("list")
  .description("List the skill bundles shipped with this plugin version.")
  .action(async () => {
    const sourceRoot = findSourceRoot();
    const shipped = await listShippedSkills(sourceRoot);
    console.log(JSON.stringify(shipped.map((s) => s.name), null, 2));
  });

// --- State migration (Phase 3, v1.2) ---

program
  .command("migrate-state")
  .description(
    "Move legacy .claude/.sidekick-* state files to .claude/.semantic-memory/. Idempotent. " +
      "Conflicts (both paths exist) require --force. Pass --dry-run to preview without changes.",
  )
  .option("--dry-run", "Print the planned migration without renaming any files.", false)
  .option(
    "--force",
    "When both old and new paths exist, prefer the new path and delete the old one.",
    false,
  )
  .option("--project <path>", "Project root (default: cwd)", process.cwd())
  .action((opts) => {
    const result = migrateState({
      projectRoot: opts.project,
      dryRun: opts.dryRun === true,
      force: opts.force === true,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.conflicts.length > 0 && !opts.force && !opts.dryRun) {
      console.error(
        `\n${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"} detected. Re-run with --force to resolve (keeps new path, deletes old).`,
      );
      process.exit(1);
    }
  });

// --- Confidence decay introspection (v1.3) ---

program
  .command("decay-config")
  .description("Print the active confidence-decay config (shipped defaults + any vault.schema.yml override).")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .action(async (opts) => {
    const { loadDecayConfig, DEFAULT_DECAY_CONFIG } = await import("../core/decay.js");
    const cfg = loadDecayConfig(resolve(opts.notes));
    const source = JSON.stringify(cfg) === JSON.stringify(DEFAULT_DECAY_CONFIG) ? "defaults" : "vault.schema.yml (overridden)";
    console.log(JSON.stringify({ source, config: cfg }, null, 2));
    process.exit(0);
  });

program
  .command("decay-trace <notePath>")
  .description("Show the decay calculation for one note: type, last_verified, age, half-life, evergreen, multiplier.")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .action(async (notePath: string, opts) => {
    const { loadDecayConfig, computeDecay, normalizeVerifiedDate } = await import("../core/decay.js");
    const matter = (await import("../core/matter.js")).default;
    const abs = resolve(opts.notes, notePath);
    if (!existsSync(abs)) {
      console.error(`note not found: ${abs}`);
      process.exit(1);
    }
    const { data: fm } = matter(readFileSync(abs, "utf8"));
    const lastVerified = normalizeVerifiedDate(fm.last_verified);
    const d = computeDecay({
      type: typeof fm.type === "string" ? fm.type : undefined,
      last_verified: lastVerified,
      evergreen: fm.evergreen === true,
      config: loadDecayConfig(resolve(opts.notes)),
    });
    console.log(
      JSON.stringify(
        {
          path: notePath,
          type: fm.type ?? null,
          last_verified: lastVerified ?? null,
          evergreen: fm.evergreen === true,
          multiplier: d.multiplier,
          age_days: Math.round(d.age_days),
          effective_half_life: d.effective_half_life,
          reason: d.reason,
        },
        null,
        2
      )
    );
    process.exit(0);
  });

// --- Lexicon (v1.4) ---

const lexiconCmd = program.command("lexicon").description("Manage the learned human→artifact lexicon (aliases).");

lexiconCmd
  .command("list")
  .description("List all aliases in the lexicon.")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .action(async (opts) => {
    const { loadLexiconCache } = await import("../core/lexicon.js");
    console.log(JSON.stringify(await loadLexiconCache(resolve(opts.notes)), null, 2));
    process.exit(0);
  });

lexiconCmd
  .command("compile")
  .description("Rebuild the derived lexicon cache from the lexicon/ notes.")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .action(async (opts) => {
    const { compileLexicon } = await import("../core/lexicon.js");
    const entries = await compileLexicon(resolve(opts.notes));
    console.log(`compiled ${entries.length} alias(es)`);
    process.exit(0);
  });

lexiconCmd
  .command("add <canonical> <phrases...>")
  .description("Upsert an alias: a canonical target and the human phrases that refer to it.")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .option("--authored", "Mark as human-authored (default: learned)")
  .action(async (canonical: string, phrases: string[], opts) => {
    const { addAlias } = await import("../core/lexicon.js");
    const r = await addAlias(resolve(opts.notes), { canonical, phrases, source: opts.authored ? "authored" : "learned" });
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  });

// --- Entity dossiers (v1.5 Phase 8) ---

const dossierCmd = program.command("dossier").description("Manage entity dossiers — per-component living notes (purpose / failure modes / knobs / incident log / current state).");

dossierCmd
  .command("init <entity>")
  .description("Scaffold a dossier for an entity (no-op if one already exists). Optionally seed aliases and provenance.")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .option("--alias <phrase...>", "Human phrase(s) for this entity — fed to the lexicon compiler")
  .option("--seeded-from <ref>", "Provenance of the scaffold (e.g. a babel-fish project-map entry)")
  .action(async (entity: string, opts) => {
    const { initDossier } = await import("../core/dossier.js");
    const r = await initDossier(resolve(opts.notes), entity, { aliases: opts.alias, seeded_from: opts.seededFrom });
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  });

dossierCmd
  .command("list")
  .description("List all dossiers with their entity, aliases, and current state.")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .action(async (opts) => {
    const { listDossiers } = await import("../core/dossier.js");
    console.log(JSON.stringify(await listDossiers(resolve(opts.notes)), null, 2));
    process.exit(0);
  });

// --- Speaker profile (v1.5 Phase 11) ---

const profileCmd = program.command("profile").description("Manage the speaker profile — how THIS human communicates (severity calibration, chronic omissions, verbosity, shorthand).");

profileCmd
  .command("init")
  .description("Scaffold profile/speaker.md with the fixed sections (no-op if it exists).")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .action(async (opts) => {
    const { initSpeakerProfile } = await import("../core/profile.js");
    const r = await initSpeakerProfile(resolve(opts.notes));
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  });

profileCmd
  .command("show")
  .description("Print the speaker profile's injection head (the capped, placeholder-stripped view).")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .action(async (opts) => {
    const { readSpeakerProfile } = await import("../core/profile.js");
    const p = await readSpeakerProfile(resolve(opts.notes));
    console.log(p ? p.head || "(profile is empty — only placeholders)" : "(no speaker profile — run `profile init`)");
    process.exit(0);
  });

// --- Selection-logging telemetry introspection (v1.3.1) ---

program
  .command("selection-stats")
  .description("Summarize the local selection log: searches, selections, most-cited notes, and retrieved-but-never-cited notes.")
  .requiredOption("--notes <path>", "Path to markdown notes directory")
  .option("--json", "Emit raw JSON instead of a human summary")
  .action(async (opts) => {
    const { computeSelectionStats, selectionLogPath } = await import("../core/telemetry.js");
    const stats = await computeSelectionStats(resolve(opts.notes));
    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
      process.exit(0);
    }
    console.log(`Selection log: ${selectionLogPath(resolve(opts.notes))}`);
    console.log(`  searches:   ${stats.searches}`);
    console.log(`  selections: ${stats.selections}`);
    const topCited = Object.entries(stats.citedPaths).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (topCited.length) {
      console.log(`  most cited:`);
      for (const [p, n] of topCited) console.log(`    ${n}×  ${p}`);
    }
    if (stats.retrievedNeverCited.length) {
      console.log(`  retrieved but never cited (${stats.retrievedNeverCited.length}): ${stats.retrievedNeverCited.slice(0, 10).join(", ")}${stats.retrievedNeverCited.length > 10 ? " …" : ""}`);
    }
    process.exit(0);
  });

skillsCmd
  .command("lint")
  .description("Lint the skill loop's learned skills this repo loads (v1.7): format, description, evidence, sections, cites, applies_to, secrets, name clashes.")
  .option("--root <dir>", "Repo root (default: cwd)")
  .option("--json", "JSON output")
  .action(async (opts) => {
    const { lintSkills } = await import("../core/skill-schema.js");
    const root = resolve(opts.root ?? process.cwd());
    const r = lintSkills(root);
    if (opts.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const f of r.findings) console.log(`${f.severity === "error" ? "✗" : "!"} ${relative(root, f.path)}: ${f.rule}: ${f.message}`);
      const errors = r.findings.filter((f) => f.severity === "error").length;
      console.log(`${r.files} learned skill(s), ${errors} error(s), ${r.findings.length - errors} warning(s)`);
    }
    process.exit(r.findings.some((f) => f.severity === "error") ? 1 : 0);
  });

// --- v1.7 switches: skill loop and jev mode ---

registerFeatureCommands(program, {
  skill_loop: skillLoopStatus,
  jev: async () => {
    const { jevSpendToday } = await import("../core/jev.js");
    const { jevLoopDir } = await import("../core/features.js");
    const spend = jevSpendToday(jevLoopDir());
    const total = Object.values(spend).reduce((a, b) => a + b, 0);
    return [`Jev today (semantic-memory callers): ${total.toLocaleString()} tokens${total ? ` — ${Object.entries(spend).map(([c, n]) => `${c} ${n.toLocaleString()}`).join(", ")}` : ""}`];
  },
});
registerSkillLoopCommands(program);
registerSkillEvalCommands(program);

program.parse();
