import { readFile, writeFile, appendFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { redact, redactDeep } from "./redact.js";

/**
 * Structured append-only log at the vault root.
 *
 * Shape: one markdown bullet per event, each followed by a fenced `yaml event`
 * block carrying the machine-readable payload. Human scrolling and YAML parsing
 * both work on the same file.
 *
 * Example rendered line pair:
 *   - 2026-04-22T00:00:00Z — ingest: added 3 notes from RFC-1234
 *   ```yaml event
 *   ts: 2026-04-22T00:00:00Z
 *   kind: ingest
 *   payload:
 *     source: RFC-1234
 *     count: 3
 *   ```
 */

const LOG_FILE = "log.md";
const HEADER = `# Vault Log\n\n> Append-only session and ingest log. Machine-readable YAML blocks follow each line.\n\n`;

export interface LogEventInput {
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
  ts?: string;
}

export interface LogEntry {
  ts: string;
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface LogQueryOptions {
  kind?: string;
  after?: string;
  before?: string;
  limit?: number;
}

export async function logEvent(vaultPath: string, input: LogEventInput): Promise<LogEntry> {
  const path = join(vaultPath, LOG_FILE);
  const ts = input.ts ?? new Date().toISOString();
  // log.md is a vault note (usually committed): precise set, so paths and ids in payloads survive
  const summary = redact(input.summary).text;
  const entry: LogEntry = { ts, kind: input.kind, summary };
  if (input.payload) entry.payload = redactDeep(input.payload, "precise").value;

  await ensureLogFile(path);

  const line = `- ${ts} — ${input.kind}: ${summary}\n`;
  const block = renderYamlBlock(entry);
  await appendFile(path, line + block + "\n", "utf-8");

  return entry;
}

export async function logQuery(vaultPath: string, opts: LogQueryOptions = {}): Promise<LogEntry[]> {
  const path = join(vaultPath, LOG_FILE);
  let raw = "";
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }

  const entries = parseEntries(raw);
  const filtered = entries.filter((e) => {
    if (opts.kind && e.kind !== opts.kind) return false;
    if (opts.after && new Date(e.ts).getTime() < new Date(opts.after).getTime()) return false;
    if (opts.before && new Date(e.ts).getTime() > new Date(opts.before).getTime()) return false;
    return true;
  });
  if (opts.limit) return filtered.slice(-opts.limit);
  return filtered;
}

async function ensureLogFile(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    await writeFile(path, HEADER, "utf-8");
  }
}

function renderYamlBlock(entry: LogEntry): string {
  const lines = [
    "```yaml event",
    `ts: ${entry.ts}`,
    `kind: ${entry.kind}`,
    `summary: ${yamlInline(entry.summary)}`,
  ];
  if (entry.payload && Object.keys(entry.payload).length > 0) {
    lines.push(`payload:`);
    for (const [k, v] of Object.entries(entry.payload)) {
      lines.push(`  ${k}: ${yamlInline(v)}`);
    }
  }
  lines.push("```");
  return lines.join("\n") + "\n";
}

function yamlInline(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return "[" + v.map((x) => yamlInline(x)).join(", ") + "]";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  // Quote if it contains colons, special chars, or would be parsed as a non-string
  if (/[:\-#&*!|>%@`"'{}[\]]|^\s|\s$/.test(s) || /^(true|false|null|\d)/i.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function parseEntries(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const blockRe = /```yaml event\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(raw)) !== null) {
    const block = m[1];
    const parsed = parseFlatYaml(block);
    if (parsed && typeof parsed.ts === "string" && typeof parsed.kind === "string") {
      entries.push(parsed as LogEntry);
    }
  }
  return entries;
}

/**
 * Minimal line-by-line YAML parser for the fixed shape we emit.
 * Accepts: top-level scalars + `payload:` followed by indented `key: value` pairs.
 * Anything more complex than our renderer produces is not guaranteed.
 */
function parseFlatYaml(block: string): Partial<LogEntry> | null {
  const out: any = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const topMatch = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (!topMatch) {
      i++;
      continue;
    }
    const [, key, rhs] = topMatch;
    if (key === "payload") {
      const payload: Record<string, unknown> = {};
      i++;
      while (i < lines.length && /^\s{2,}[a-z_]/i.test(lines[i])) {
        const m2 = lines[i].match(/^\s+([a-z_]+):\s*(.*)$/i);
        if (m2) payload[m2[1]] = parseYamlScalar(m2[2]);
        i++;
      }
      out.payload = payload;
      continue;
    }
    out[key] = parseYamlScalar(rhs);
    i++;
  }
  return out;
}

function parseYamlScalar(s: string): unknown {
  const v = s.trim();
  if (v === "") return "";
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    try {
      return JSON.parse(v);
    } catch {
      /* fall through */
    }
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    try {
      return JSON.parse(v.replace(/^'|'$/g, '"'));
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}
