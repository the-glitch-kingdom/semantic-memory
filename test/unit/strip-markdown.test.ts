import { describe, it, expect } from "vitest";
import { Indexer } from "../../src/core/indexer.js";

const strip = (md: string) => (new Indexer("/nonexistent") as any).stripMarkdown(md) as string;

describe("stripMarkdown keeps code, tables and identifiers (#52)", () => {
  it("unwraps inline code", () => expect(strip("Run `check_rls_coverage.py` first.")).toBe("Run check_rls_coverage.py first."));
  it("keeps fenced contents, drops fence lines (also unclosed and ~~~)", () => {
    expect(strip("a\n\n```bash\nnpm run build\n```\n\nb")).toBe("a\n\nnpm run build\n\nb");
    expect(strip("~~~\nkubectl get pods\n")).toBe("kubectl get pods");
  });
  it("turns table rows into cells and drops the separator row", () => {
    expect(strip("| Var | Meaning |\n|---|:--:|\n| `DATABASE_POOL_SIZE` | pool |\n")).toBe("Var Meaning\n\nDATABASE_POOL_SIZE pool");
  });
  it("keeps snake_case, strips emphasis", () => {
    expect(strip("a snake_case_name and __bold__ and _em_ and **b** and ~~s~~")).toBe("a snake_case_name and bold and em and b and s");
  });
  it("does not damage arrows, in-line hashes or dashes", () => {
    expect(strip("a -> b, issue #12, x --- y, a>b\n---\n> quoted\n# Head")).toBe("a -> b, issue #12, x --- y, a>b\n\nquoted\nHead");
  });
});
