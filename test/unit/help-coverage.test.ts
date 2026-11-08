import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { TOPICS, closestTopics, renderHelp } from "../../src/core/help/topics.js";
import { CURRENT_TOOL_INVENTORY } from "../../src/mcp/tools/inventory.js";
import { DEFAULT_SCHEMA_YAML } from "../../src/core/schema-default.js";

const cli = (...a: string[]) => execFileSync("node", ["bin/semantic-memory", ...a], { encoding: "utf8" });
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean));
const topicText = TOPICS.map((t) => [t.id, ...t.aliases, t.summary, ...t.steps, ...t.commands, t.verify].join(" ")).join("\n");
const covered = words(topicText);

// Exempt = deliberately not a task a user asks help for; each needs a reason.
const EXEMPT_CLI: Record<string, string> = {
  "eval-failures": "maintainer replay of the failure hook", "log-event": "hook plumbing", "log-query": "hook plumbing",
  tools: "lists MCP tools; help covers tasks", "migrate-state": "one-off 1.x state move", lexicon: "advanced vault curation",
  dossier: "advanced vault curation", profile: "advanced vault curation", "selection-stats": "diagnostic",
  "skill-loop": "has its own slash command", "jev-mode": "has its own slash command", "skill-eval": "maintainer tool",
  skills: "non-Claude agent installs", policy: "covered via the slash command", status: "covered via the slash command",
  relink: "plugin plumbing", "normalize-config": "plugin plumbing", update: "covered via the slash command", lint: "see docs lint guide",
};
const EXEMPT_TOOL_GROUPS: Record<string, string> = {
  read: "note CRUD: each tool's own description is the help", write: "note CRUD", patch: "note CRUD", lint: "vault upkeep", log: "hook plumbing",
  metadata: "vault upkeep", graph: "graph tools list themselves", contract: "agent contract, has /contract", session: "session paging, own guide",
  system: "plumbing (help itself is named)",
};
const EXEMPT_TOOLS: Record<string, string> = { search_semantic: "search_hybrid is the entry point", search_text: "search_hybrid is the entry point", search_graph: "search_hybrid is the entry point" };
const EXEMPT_KEYS: Record<string, string> = {
  version: "file format", provenance_fields: "advanced schema", status_enum: "advanced schema", confidence_enum: "advanced schema",
  severity_enum: "advanced schema", types: "advanced schema", lint: "advanced schema", path_class: "ranking internals", results: "ranking internals",
  graph: "ranking internals", index_fields: "ranking internals", ranking: "ranking internals", rerank: "ranking internals",
  usage_boost: "ranking internals", tools: "advanced schema", telemetry: "advanced schema",
};

let cliCommands: string[];
beforeAll(() => {
  const out = cli("--help").split("Commands:")[1];
  cliCommands = out.split("\n").map((l) => l.match(/^ {2}(\S+)/)?.[1]).filter((x): x is string => !!x && x !== "help");
});

describe("coverage: every command, tool and schema key has a topic or an exemption", () => {
  it("CLI commands", () => {
    expect(cliCommands.length).toBeGreaterThan(20);
    const missing = cliCommands.filter((c) => !covered.has(c) && !(c in EXEMPT_CLI));
    expect(missing, `add a topic or an EXEMPT_CLI reason for: ${missing}`).toEqual([]);
  });
  it("MCP tools", () => {
    const missing = CURRENT_TOOL_INVENTORY.filter((t) => !covered.has(t.name) && !(t.group in EXEMPT_TOOL_GROUPS) && !(t.name in EXEMPT_TOOLS)).map((t) => t.name);
    expect(missing, `add a topic or an exemption for: ${missing}`).toEqual([]);
  });
  it("schema keys", () => {
    const keys = [...Object.keys(parseYaml(DEFAULT_SCHEMA_YAML)), "federation", "embedding"];
    expect(keys).toContain("decay");
    const missing = keys.filter((k) => !covered.has(k) && !(k in EXEMPT_KEYS));
    expect(missing, `add a topic or an EXEMPT_KEYS reason for: ${missing}`).toEqual([]);
  });
  it("every exemption is still a real name", () => {
    for (const c of Object.keys(EXEMPT_CLI)) expect(cliCommands, c).toContain(c);
    const names = CURRENT_TOOL_INVENTORY.map((t) => t.name);
    for (const n of Object.keys(EXEMPT_TOOLS)) expect(names, n).toContain(n);
  });
});

describe("drift: every command, flag and key a topic names exists", () => {
  const seen = new Map<string, string>();
  const flagsOf = (sub: string) => seen.get(sub) ?? (seen.set(sub, cli(sub, "--help")), seen.get(sub)!);
  it("semantic-memory commands and their flags", () => {
    for (const t of TOPICS) for (const c of t.commands) {
      const m = c.match(/^semantic-memory (\S+)(.*)$/);
      if (!m) continue;
      expect(cliCommands, `${t.id}: ${c}`).toContain(m[1]);
      const help = flagsOf(m[1]);
      for (const f of m[2].match(/--[a-z-]+/g) ?? []) expect(help, `${t.id}: ${f} on ${m[1]}`).toContain(f);
    }
  }, 60_000);
  it("slash commands, scripts and doc files exist", () => {
    for (const t of TOPICS) {
      expect(existsSync(t.doc), t.doc).toBe(true);
      for (const c of t.commands) {
        const s = c.match(/^\/semantic-memory:([a-z-]+)/);
        if (s) expect(existsSync(`commands/${s[1]}.md`), c).toBe(true);
        const sh = c.match(/^\.\/(scripts\/[\w.-]+\.sh|install-offline\.sh)/);
        if (sh) expect(existsSync(sh[1].startsWith("scripts/") ? sh[1] : "scripts/install-offline.sh"), c).toBe(true);
      }
    }
  });
  const toolSrc = readdirSync("src/mcp/tools").map((f) => readFileSync(`src/mcp/tools/${f}`, "utf8")).join("\n");
  it("MCP tool calls name a real tool; dotted schema keys exist", () => {
    const names = new Set(CURRENT_TOOL_INVENTORY.map((t) => t.name));
    for (const t of TOPICS) for (const c of t.commands) {
      const m = c.match(/^([a-z_]+) \{/);
      if (!m) continue;
      expect(names.has(m[1]), c).toBe(true);
      for (const k of c.slice(c.indexOf("{")).match(/[a-z_]+(?=[,:}])/g) ?? []) expect(toolSrc, `${c}: ${k}`).toContain(k);
    }
    for (const k of topicText.match(/\b(?:decay|federation)\.[a-z_]+/g) ?? []) {
      expect(DEFAULT_SCHEMA_YAML, k).toContain(k.split(".")[1] + ":");
    }
  });
});

describe("unknown topics", () => {
  it("suggest the closest topics, and fall back to the index", () => {
    expect(closestTopics("federted").map((t) => t.id)).toContain("federated-search");
    expect(renderHelp("embeder", "text")).toMatch(/Closest:[\s\S]*embedder/);
    expect(renderHelp("qqqqqq", "text")).not.toContain("Closest:");
    expect(renderHelp("qqqqqq", "text")).toContain("Getting going");
  });
});
