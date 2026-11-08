import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathsOutput } from "../../src/cli/search.js";

describe("search --paths", () => {
  it("prints each path once, one per line, nothing for no hits", () => {
    expect(pathsOutput([{ path: "a.md", score: 1 }, { path: "b/c.md", score: 1 }, { path: "a.md", score: 1 }])).toBe("a.md\nb/c.md\n");
    expect(pathsOutput([])).toBe("");
  });

  it("parses the way hewtd 2.21.0 runs reconcile.search_command (split on whitespace, {query} in one argument, no shell)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sm-paths-"));
    mkdirSync(join(dir, "ops"));
    writeFileSync(join(dir, "ops", "deploy.md"), "# Deploy\n\nHow we deploy the widget service to production.\n");
    writeFileSync(join(dir, "other.md"), "# Other\n\nUnrelated gardening notes.\n");
    // --text-only keeps the test off the embedder; the output contract is the same
    const template = `node bin/semantic-memory search --notes ${dir} --text-only --paths {query}`;
    const [bin, ...args] = template.trim().split(/\s+/).map((a) => a.split("{query}").join("how do we deploy the widget"));
    const lines = execFileSync(bin, args, { encoding: "utf-8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines).toEqual(["ops/deploy.md"]);
  });
});
