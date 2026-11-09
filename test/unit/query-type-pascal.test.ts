import { describe, it, expect } from "vitest";
import { classifyQuery } from "../../src/core/query-type.js";
import { identifiers } from "../../src/core/identifiers.js";

const known = (t: string) => t === "TaskResponse";

describe("PascalCase identifiers (#71) go through #57's detector with a 'known to the code' predicate", () => {
  it("is an identifier only when known; prose otherwise", () => {
    expect(identifiers("what does TaskResponse return?", known)).toEqual(["TaskResponse"]);
    expect(identifiers("what does TaskResponse return?")).toEqual([]);
    expect(identifiers("when does SessionEnd fire", known)).toEqual([]);
    expect(identifiers("what is SAML", () => true)).toEqual([]); // acronyms stay prose
    expect(classifyQuery("what does TaskResponse return?", known)).toBe("identifier");
    expect(classifyQuery("what does TaskResponse return?")).toBe("fact");
    expect(classifyQuery("how does SessionEnd work", known)).toBe("fact");
  });
});
