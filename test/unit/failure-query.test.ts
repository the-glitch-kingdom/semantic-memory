import { describe, it, expect } from "vitest";
import { failureQuery, errorSignal, commandVerbs } from "../../src/core/failure-query.js";

describe("commandVerbs", () => {
  it("keeps program + subcommand per segment, dropping cd/env noise", () => {
    expect(commandVerbs("cd ~/repo && git push origin main")).toBe("git push origin");
    expect(commandVerbs("NODE_ENV=test npm run build | tee log")).toBe("npm run build, tee log");
    expect(commandVerbs("pkill -f 'node server.js'")).toBe("pkill -f");
    expect(commandVerbs("/usr/bin/python3 -m pytest tests/")).toBe("python3 -m pytest");
  });

  it("handles empty input", () => {
    expect(commandVerbs("")).toBe("");
  });
});

describe("errorSignal", () => {
  it("strips paths to basenames, ids, timestamps, hex and long numbers", () => {
    const s = errorSignal(
      "2026-10-24T18:14:09.243Z ERROR open /home/u/proj/src/app/config.yaml: no such file (pid 123456, req 3f2b8c1e-9d4a-4f6b-8e2c-1a7d9b3e5f0c, sha 733bc75a1f)"
    );
    expect(s).toContain("ERROR open config.yaml: no such file");
    expect(s).not.toContain(" :");
    for (const gone of ["2026-10-24", "/home/u", "123456", "3f2b8c1e", "733bc75a1f"]) expect(s).not.toContain(gone);
  });

  it("keeps the error lines and the exit code, drops stack frames and chatter", () => {
    const s = errorSignal(
      ["Exit code 144", "starting worker", "Traceback (most recent call last):", '  File "/x/y/z.py", line 3, in <module>', "    at Object.<anonymous> (/a/b.js:1:1)", "PermissionError: [Errno 13] Permission denied"].join("\n")
    );
    expect(s).toContain("Exit code 144");
    expect(s).toContain("Permission denied");
    expect(s).not.toContain("starting worker");
    expect(s).not.toContain("line 3");
    expect(s).not.toContain("Object.<anonymous>");
  });

  it("falls back to the first lines when nothing looks like an error", () => {
    expect(errorSignal("weird output\nsecond")).toBe("weird output\nsecond");
  });

  it("strips ANSI colors, URL paths and redaction marks", () => {
    const s = errorSignal("\x1b[31merror\x1b[0m: GET https://api.example.com/v1/items?id=9 returned 403 [REDACTED]");
    expect(s).toBe("error: GET api.example.com returned 403");
  });

  it("caps the length and dedupes repeated lines", () => {
    const s = errorSignal(Array(50).fill("error: same thing").join("\n") + "\n" + "error: " + "x".repeat(1000));
    expect(s).toBe("error: same thing");
  });
});

describe("failureQuery", () => {
  it("joins verbs and signal", () => {
    expect(failureQuery("Exit code 144\nTerminated", "pkill -f vite")).toBe("pkill -f vite: Exit code 144");
  });

  it("tolerates missing parts", () => {
    expect(failureQuery("", "git status")).toBe("git status");
    expect(failureQuery("fatal: not a git repository", "")).toBe("fatal: not a git repository");
  });
});
