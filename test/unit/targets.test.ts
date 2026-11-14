import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TARGETS, loadTargets } from "../../src/core/retrieval-eval/targets.js";

describe("loadTargets", () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-tg-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const load = (body: string) => (writeFileSync(join(dir, "targets.json"), body), loadTargets(dir));

  it("merges a partial file over the defaults, keeps null, reports unknown keys", () => {
    const { targets, unknown } = load('{"hybrid_at1":{"value":0.5},"p95_ms":{"value":null,"why":"x"},"bogus":{"value":1}}');
    expect(targets.hybrid_at1).toEqual({ value: 0.5, why: DEFAULT_TARGETS.hybrid_at1.why });
    expect(targets.p95_ms.value).toBeNull();
    expect(targets.hybrid_at3).toEqual(DEFAULT_TARGETS.hybrid_at3);
    expect(unknown).toEqual(["bogus"]);
  });

  it.each(["{nope", "[]", '{"hybrid_at1":{"value":"high"}}', '{"hybrid_at1":5}'])("refuses %s, naming the file", (body) => {
    expect(() => load(body)).toThrow(/targets\.json/);
  });
});
