import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, bashSearchArgs } from "../../hooks/doc-search-redirect.js";

// v1.7.2: a grep of an indexed docs folder is denied once with a pointer to the MCP search, then allowed on retry.
describe("doc search redirect (PreToolUse)", () => {
  let repo: string;
  let n = 0;
  const sid = () => `s${++n}`;
  const grep = (path: string | undefined, session = sid(), extra: object = {}) => ({
    tool_name: "Grep", cwd: repo, session_id: session, tool_input: { pattern: "keycloak", ...(path ? { path } : {}), ...extra },
  });
  const bash = (command: string, session = sid()) => ({ tool_name: "Bash", cwd: repo, session_id: session, tool_input: { command } });
  const env = {};

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-redirect-"));
    await mkdir(join(repo, ".documentation", "features"), { recursive: true });
    await mkdir(join(repo, ".claude", ".vault"), { recursive: true });
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, ".documentation", "features", "auth.md"), "# Auth\n");
    await writeFile(
      join(repo, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "semantic-memory": { command: "node", args: ["x.mjs", "--notes", "./.claude/.vault"] },
          "semantic-memory-docs": { command: "node", args: ["x.mjs", "--notes", "./.documentation", "--read-only"] },
          playwright: { command: "npx", args: ["@playwright/mcp"] },
        },
      })
    );
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("denies a Grep of the docs folder, naming that server's search tools", () => {
    const reason = decide(grep(".documentation"), env);
    expect(reason).toContain("mcp__semantic-memory-docs__search_hybrid");
    expect(reason).toContain("mcp__semantic-memory-docs__search_text");
    expect(reason).toContain("run the same command again");
  });

  it("lets the identical call through on retry, and denies a different one", () => {
    const s = sid();
    expect(decide(grep(".documentation", s), env)).toBeTruthy();
    expect(decide(grep(".documentation", s), env)).toBeNull();
    expect(decide(grep(".documentation", s, { pattern: "mfa" }), env)).toBeTruthy();
  });

  it("matches subfolders, absolute paths, ./ paths, the vault, and a Grep glob with no path", () => {
    expect(decide(grep(".documentation/features"), env)).toBeTruthy();
    expect(decide(grep(join(repo, ".documentation")), env)).toBeTruthy();
    expect(decide(grep("./.documentation/"), env)).toBeTruthy();
    expect(decide(grep(".claude/.vault"), env)).toContain("mcp__semantic-memory__search_hybrid");
    expect(decide(grep(undefined, sid(), { glob: ".documentation/**/*.md" }), env)).toBeTruthy();
  });

  it("denies Bash grep/rg/git grep over the docs, including globs and pipelines", () => {
    expect(decide(bash('grep -rn "MFA" .documentation/features | head'), env)).toBeTruthy();
    expect(decide(bash("rg -l keycloak .documentation"), env)).toBeTruthy();
    expect(decide(bash("git grep -n keycloak -- .documentation"), env)).toBeTruthy();
    expect(decide(bash("cd x && grep -l auth .documentation/**/*.md"), env)).toBeTruthy();
  });

  it("allows everything that is not a folder search of an indexed corpus", () => {
    expect(decide(grep(undefined), env)).toBeNull(); // whole repo
    expect(decide(grep("src"), env)).toBeNull();
    expect(decide(grep(".documentation/features/auth.md"), env)).toBeNull(); // one named file
    expect(decide(grep(".documentation/missing"), env)).toBeNull();
    expect(decide(bash("rg -n keycloak src/"), env)).toBeNull();
    expect(decide(bash("find .documentation -name '*.md'"), env)).toBeNull();
    expect(decide(bash("cat .documentation/features/auth.md | grep MFA"), env)).toBeNull();
    expect(decide(bash("git tag -l"), env)).toBeNull();
    expect(decide({ tool_name: "Read", cwd: repo, tool_input: { file_path: join(repo, ".documentation/features/auth.md") } }, env)).toBeNull();
    expect(decide({ tool_name: "Glob", cwd: repo, tool_input: { pattern: ".documentation/**/*.md" } }, env)).toBeNull();
  });

  it("is off with the env switch, the repo config, in outage-silence, and inside a skill-loop review", async () => {
    expect(decide(grep(".documentation"), { SEMANTIC_MEMORY_DOC_SEARCH_REDIRECT: "0" })).toBeNull();
    expect(decide(grep(".documentation"), { SEMANTIC_MEMORY_REVIEWER: "1" })).toBeNull();
    await mkdir(join(repo, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(join(repo, ".claude", ".semantic-memory", "config"), "skill_loop: on\ndoc_search_redirect: off\n");
    expect(decide(grep(".documentation"), env)).toBeNull();
    await writeFile(join(repo, ".claude", ".semantic-memory", "config"), "doc_search_redirect: on\n");
    expect(decide(grep(".documentation"), env)).toBeTruthy();
    await writeFile(join(repo, ".claude", ".semantic-memory", "mode"), "outage-silence");
    expect(decide(grep(".documentation"), env)).toBeNull();
  });

  it("never redirects in a repo with no semantic-* server (the advice would name a missing tool)", async () => {
    await writeFile(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { playwright: { command: "npx", args: [] } } }));
    expect(decide(grep(".claude/.vault"), env)).toBeNull();
    expect(decide(grep(".documentation"), env)).toBeNull();
    await rm(join(repo, ".mcp.json"));
    expect(decide(grep(".claude/.vault"), env)).toBeNull();
  });

  it("parses the search arguments of each segment of a command", () => {
    expect(bashSearchArgs('FOO=1 rg -n "ab" docs && grep -r x .documentation; ls')).toEqual(["ab", "docs", "x", ".documentation"]);
    expect(bashSearchArgs("ls -la | wc -l")).toEqual([]);
  });
});
