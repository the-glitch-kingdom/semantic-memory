import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { lintVault } from "../../src/core/lint.js";
import { findSecrets } from "../../src/core/redact.js";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

// v1.5.3: lint_vault({checks:["secrets"]}) reports secrets already sitting in notes — path, line,
// kind, never the value — and rewrites nothing.

const FAKE = ["gh", "p_", "Zq9Xw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDc"].join("");
const LEAKY = `---\ntitle: Leaky\nstatus: active\n---\n\n# Leaky\n\nline seven is fine\nexport GITHUB_TOKEN=${FAKE}\n`;

describe("lint_vault secrets check", () => {
  let vault: string;

  beforeAll(async () => {
    vault = await createTempVault();
    await mkdir(join(vault, "leaks"), { recursive: true });
    await writeFile(join(vault, "leaks", "leaky.md"), LEAKY, "utf-8");
    await writeFile(join(vault, "leaks", "howto.md"), "# How to\n\nSet `api_key: <your-key>` and `token: ${API_TOKEN}`.\n", "utf-8");
  });

  afterAll(async () => {
    await cleanupTempDir(vault);
  });

  it("findSecrets gives line and kind, never the value", () => {
    const hits = findSecrets(LEAKY);
    expect(hits).toContainEqual({ line: 9, kind: "vendor API key" });
    expect(JSON.stringify(hits)).not.toContain(FAKE);
  });

  it("reports the leaky note as an error with path and line, not the value", async () => {
    const report = await lintVault(vault, { checkSecrets: true });
    const secrets = report.byRule.secrets ?? [];
    const leaky = secrets.filter((f) => f.path === "leaks/leaky.md");
    expect(leaky.length).toBeGreaterThan(0);
    expect(leaky[0].severity).toBe("error");
    expect(leaky[0].message).toMatch(/^line 9: /);
    expect(JSON.stringify(report)).not.toContain(FAKE);
  });

  it("does not flag placeholders in how-to notes", async () => {
    const report = await lintVault(vault, { checkSecrets: true });
    expect((report.byRule.secrets ?? []).filter((f) => f.path === "leaks/howto.md")).toEqual([]);
  });

  it("is opt-in: the default report has no secrets key and is unchanged", async () => {
    const report = await lintVault(vault);
    expect("secrets" in report.byRule).toBe(false);
    expect(report.findings.some((f) => f.rule === "secrets")).toBe(false);
  });

  it("rewrites nothing", async () => {
    await lintVault(vault, { checkSecrets: true });
    expect(await readFile(join(vault, "leaks", "leaky.md"), "utf-8")).toBe(LEAKY);
  });

  it("works through lint_vault on a read-only (docs) server", async () => {
    const server = await createServer(vault, { watch: false, waitForReady: true, readOnly: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    try {
      const res = await client.callTool({ name: "lint_vault", arguments: { checks: ["secrets"] } });
      const text = (res.content as { text: string }[])[0].text;
      const body = JSON.parse(text);
      expect(Object.keys(body.byRule)).toEqual(["secrets"]);
      // counts describe the filtered report, not the full lint
      expect(body.counts.errors).toBe(body.findings.filter((f: { severity: string }) => f.severity === "error").length);
      expect(body.byRule.secrets.some((f: { path: string }) => f.path === "leaks/leaky.md")).toBe(true);
      expect(text).not.toContain(FAKE);
    } finally {
      await client.close();
    }
  }, 180_000);
});
