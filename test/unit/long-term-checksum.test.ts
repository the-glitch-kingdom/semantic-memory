import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checksumOf } from "../long-term-fixture.js";
import { execFileSync } from "node:child_process";
import { coldChecksum, coldMatches } from "../../src/core/cold.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// The fixtures' checksum helper IS the plan's definition; this pins it against a hand-computed value so
// src's coldChecksum has something fixed to match; it equals hit-em-with-the-docs 3.2.0's compute_tree_checksum.
describe("cold generation checksum definition", () => {
  it("is sha256 over the sorted `relpath\\0sha256(file)` lines joined by `\\n` (hewtd 3.2.0), symlinks by `link:sha256(target)`", async () => {
    const d = await mkdtemp(join(tmpdir(), "ck-"));
    try {
      await mkdir(join(d, "sub"));
      await writeFile(join(d, "b.md"), "bee");
      await writeFile(join(d, "sub", "a.md"), "ay");
      await symlink("/etc/hostname", join(d, "link.md"));
      const want = sha(`b.md\0${sha("bee")}\nlink.md\0link:${sha("/etc/hostname")}\nsub/a.md\0${sha("ay")}`.split("\n").sort().join("\n"));
      expect(coldChecksum(d)).toBe(want);
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

  it("coldMatches accepts the tracked-files checksum when the gitignored files are absent (a fresh clone)", async () => {
    const d = await mkdtemp(join(tmpdir(), "ck-"));
    try {
      const git = (...a: string[]) => execFileSync("git", a, { cwd: d });
      git("init", "-q");
      await writeFile(join(d, "a.md"), "ay");
      git("add", "a.md");
      const tracked = coldChecksum(d, new Set(["a.md"])); // .git sits in this test dir only
      await writeFile(join(d, "b.md"), "bee");
      const disk = coldChecksum(d, new Set(["a.md", "b.md"]));
      expect(coldMatches(d, tracked, disk)).toBe(true); // clone without the disk-only file
      await rm(join(d, "b.md"));
      await writeFile(join(d, "a.md"), "changed");
      expect(coldMatches(d, tracked, disk)).toBe(false);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});
