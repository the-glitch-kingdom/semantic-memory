import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checksumOf } from "../long-term-fixture.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// The fixtures' checksum helper IS the plan's definition; this pins it against a hand-computed value so
// src's coldChecksum (Phase 4) has something fixed to match. hit-em-with-the-docs#97 must use the same definition.
describe("cold generation checksum definition", () => {
  it("is sha256 over the sorted `relpath\\0sha256(file)\\n` lines of every regular file, symlinks not followed", async () => {
    const d = await mkdtemp(join(tmpdir(), "ck-"));
    try {
      await mkdir(join(d, "sub"));
      await writeFile(join(d, "b.md"), "bee");
      await writeFile(join(d, "sub", "a.md"), "ay");
      await symlink("/etc/hostname", join(d, "link.md"));
      const want = sha(`b.md\0${sha("bee")}\nsub/a.md\0${sha("ay")}\n`);
      expect(checksumOf(d)).toBe(want);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("coldChecksum in src/core/cold.ts computes the same value", async () => {
    const d = await mkdtemp(join(tmpdir(), "ck-"));
    try {
      await writeFile(join(d, "x.md"), "ex");
      const { coldChecksum } = await import("../../src/core/cold.js");
      expect(coldChecksum(d)).toBe(checksumOf(d));
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});
