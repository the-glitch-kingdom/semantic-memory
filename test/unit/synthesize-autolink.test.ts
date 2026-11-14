import { describe, it, expect } from "vitest";
import { buildSynthesizeChangeSet } from "../../src/core/synthesize.js";

// #36. `knownNames` is the set of vault note names the MCP handler passes (Phase 3).
function body(answer: string, related: string[], knownNames?: Set<string>): string {
  const r = buildSynthesizeChangeSet({
    topic: "T",
    answer,
    suggested_path: "notes/t.md",
    related_notes: related,
    ...(knownNames ? { knownNames } : {}),
  } as any);
  return r.changeset.creates![0].content;
}

describe("synthesize autoWikilink (#36)", () => {
  describe("bugs", () => {
    it("leaves a related note named in an inline code span unlinked", () => {
      const out = body("Edit `.claude/rules/operational-runbook.md` first.", ["operational-runbook"]);
      expect(out).toContain("`.claude/rules/operational-runbook.md`");
      expect(out.split("\n## Related")[0]).not.toContain("[[");
    });

    it("does not link a name that is a prefix of a longer filename", () => {
      const out = body("See keycloak-custom-image-workflow.md for the steps.", ["keycloak-custom-image"]);
      expect(out).toContain("keycloak-custom-image-workflow.md");
      expect(out.split("\n## Related")[0]).not.toContain("[[keycloak-custom-image]]");
    });

    it("does not link a name that is the tail of a path", () => {
      const out = body("Docs live in devops/keycloak-custom-image.md today.", ["keycloak-custom-image"]);
      expect(out.split("\n## Related")[0]).toContain("devops/keycloak-custom-image.md");
      expect(out.split("\n## Related")[0]).not.toContain("[[");
    });

    it("never wraps a related entry that is not a vault note, in the body or under Related", () => {
      const out = body("Rules are in operational-runbook.", ["operational-runbook", "auth-migration"], new Set(["auth-migration"]));
      expect(out).not.toContain("[[operational-runbook]]");
      expect(out).toContain("`operational-runbook`"); // listed as code text
    });
  });

  describe("guards (pass today)", () => {
    it("links a bare title in prose once", () => {
      const out = body("We use auth-migration notes. auth-migration again.", ["auth-migration"]);
      expect(out.split("\n## Related")[0].match(/\[\[auth-migration\]\]/g)).toHaveLength(1);
    });

    it("links a title next to sentence punctuation", () => {
      const out = body("Please see keycloak-custom-image.", ["keycloak-custom-image"]);
      expect(out).toContain("see [[keycloak-custom-image]].");
    });

    it("leaves fenced code untouched", () => {
      const out = body("Text\n\n```\nauth-migration\n```\n", ["auth-migration"]);
      expect(out).toContain("```\nauth-migration\n```");
    });

    it("still links a name with spaces", () => {
      const out = body("The Auth Migration was big.", ["Auth Migration"]);
      expect(out).toContain("The [[Auth Migration]] was big.");
    });
  });

  describe("edge cases", () => {
    it("links a name with regex characters", () => {
      const out = body("See c++-notes for more.", ["c++-notes"]);
      expect(out.split("\n## Related")[0]).toContain("[[c++-notes]]");
    });

    it("links a name at the start and at the end of the body", () => {
      expect(body("auth.", ["auth"]).split("\n## Related")[0]).toContain("[[auth]].");
      expect(body("see auth", ["auth"]).split("\n## Related")[0]).toContain("see [[auth]]");
    });

    it("leaves a name inside a markdown link URL unlinked", () => {
      const out = body("See [x](devops/auth.md) now.", ["auth"]).split("\n## Related")[0];
      expect(out).toContain("[x](devops/auth.md)");
      expect(out).not.toContain("[[auth]]");
    });

    it("resolves a related entry given as a path", () => {
      const out = body("Uses auth here.", ["decisions/auth.md"], new Set(["auth"]));
      expect(out).toContain("- [[auth]]");
    });

    it("leaves a Windows-style path in inline code unlinked", () => {
      const out = body("Edit `devops\\auth.md` first.", ["auth"]).split("\n## Related")[0];
      expect(out).not.toContain("[[");
    });

    it("an empty vault lists every related entry as code text", () => {
      const out = body("Uses auth here.", ["auth"], new Set());
      expect(out).toContain("- `auth`");
      expect(out).not.toContain("[[");
    });
  });
});
