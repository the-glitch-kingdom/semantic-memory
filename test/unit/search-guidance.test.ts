import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverInstructions } from "../../src/mcp/server.js";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf-8");

// issue #45: the agent reads this at search time; it must tell it to read the top 3 and to split end-to-end questions
describe("broad-question guidance", () => {
  const surfaces: Record<string, string> = {
    "search_hybrid description": read("src/mcp/tools/search.ts").slice(read("src/mcp/tools/search.ts").indexOf('"search_hybrid"')),
    "server instructions": serverInstructions("/tmp/x"),
    "semantic-first skill": read("skills/semantic-first/SKILL.md"),
    "vault-first skill": read("skills/vault-first/SKILL.md"),
  };
  for (const [name, text] of Object.entries(surfaces)) {
    it(`${name} says to read the top 3 and search each step separately`, () => {
      expect(text).toMatch(/top 3/);
      expect(text).toMatch(/each step separately/);
    });
  }
});
