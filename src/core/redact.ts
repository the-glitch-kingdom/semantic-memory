import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Secret redaction for everything semantic-memory writes to disk. Ported from jev-loop's
 * redact.py: (1) exact values of secret-named env vars on this machine, (2) patterns.
 *
 * Two pattern sets:
 * - "precise" (notes, frontmatter, dossiers, profile, lexicon): only shapes that are almost
 *   never ordinary content, because a false positive in a note is data loss.
 * - "broad" (search log, log.md events, session state, capture-pending): precise plus long
 *   base64 / letter-and-digit tokens; over-redaction is fine in logs.
 *
 * Cannot catch a secret written in plain prose ("the password is hunter2"). Never logs values.
 */

export const REDACTED = "[REDACTED]";
export type RedactMode = "precise" | "broad";
export interface RedactResult {
  text: string;
  count: number;
}

const SECRET_ENV_NAME = /key|token|secret|passw|pwd|credential/i;
// The secret word must start a name segment: api_key, DB_PASSWORD, client-secret, apikey; not monkey, tokens, tokenizer
const SECRET_WORD = String.raw`(?:api[_-]?)?(?:key|token|secret|password|passwd|pwd|credentials?)`;
// prefix bounded so a long dotted run (a.b.c…) stays linear
const SECRET_NAME = String.raw`\b(?:[\w.]{0,64}[_.-])?${SECRET_WORD}`;
// Value characters: stops at whitespace, quotes, separators and markdown punctuation
const VALUE = String.raw`[^\s"'\`,;&|()<>\[\]{}]`;

// Obvious placeholders in how-to notes are left alone: <your-key>, ${API_KEY}, process.env.X, changeme, xxxx, ****
const PLACEHOLDER =
  /^(?:<[^>]*>|\$\{?\w+\}?|(?:process\.env|os\.environ|env)\b.*|\[REDACTED\]|(.)\1{3,}|\*+|x{3,}.*|password|passwd|pass|secret|token|pwd)$|example|changeme|placeholder|your[-_]|dummy|redacted/i;
const isPlaceholder = (value: string) => PLACEHOLDER.test(value);

// Vendor key prefixes. Word-shaped bodies must contain a digit, so identifiers like
// pk_customer_orders or npm_package_version stay; real keys are random and always have digits.
const withDigit = (prefix: string, body: string, min: number) => String.raw`${prefix}(?=${body}*\d)${body}{${min},}`;
const VENDOR = new RegExp(
  String.raw`\b(?:` +
    [
      withDigit(String.raw`(?:sk|rk|pk)[-_]`, String.raw`[\w-]`, 8),
      withDigit("whsec_", String.raw`\w`, 8),
      withDigit("gh[pousr]_", String.raw`\w`, 20),
      withDigit("github_pat_", String.raw`\w`, 20),
      withDigit("glpat-", String.raw`[\w-]`, 16),
      withDigit("xox[abprs]-", String.raw`[\w-]`, 10),
      withDigit("re_", String.raw`\w`, 16),
      withDigit("hf_", String.raw`\w`, 20),
      withDigit("npm_", String.raw`\w`, 20),
      String.raw`(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
      String.raw`AIza[\w-]{30,}`,
    ].join("|") +
    ")",
  "g"
);

interface Rule {
  name: string; // reported by lint_vault's secrets check
  re: RegExp;
  replace: (match: string, ...groups: string[]) => string | null; // null = leave as is
}

function rules(mode: RedactMode): Rule[] {
  const minValue = mode === "precise" ? 8 : 4;
  const precise: Rule[] = [
    // PEM private keys, even when the END line was cut off
    {
      name: "private key",
      re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      replace: () => REDACTED,
    },
    // credentials inside URLs: scheme://user:pass@host
    {
      name: "URL credentials",
      re: /(:\/\/)([^/\s:@]+):([^/\s@]+)@/g,
      replace: (_m, scheme, _user, pass) => (isPlaceholder(pass) ? null : `${scheme}${REDACTED}@`),
    },
    // Authorization headers
    {
      name: "authorization header",
      re: /\b(bearer|basic)(\s+)(?=[A-Za-z0-9._~+/=-]*\d)([A-Za-z0-9._~+/=-]{16,})/gi,
      replace: (_m, scheme, space) => `${scheme}${space}${REDACTED}`,
    },
    // name=value, name: value, "name": "value" where the name is a secret word
    {
      name: "secret-named value",
      re: new RegExp(String.raw`(${SECRET_NAME}["']?\s*[:=]\s*["']?)(${VALUE}{${minValue},})`, "gi"),
      replace: (_m, prefix, value) => (isPlaceholder(value) ? null : `${prefix}${REDACTED}`),
    },
    // command-line flags: --token VALUE, --api-key=VALUE
    {
      name: "secret flag",
      // a flag starts after whitespace/start, and its name is bounded: keeps long dash/hyphen runs linear
      re: new RegExp(String.raw`((?<![\w-])--?[\w-]{0,64}?${SECRET_WORD}[ =])(${VALUE}{${minValue},})`, "gi"),
      replace: (_m, flag, value) => (isPlaceholder(value) ? null : `${flag}${REDACTED}`),
    },
    { name: "vendor API key", re: VENDOR, replace: () => REDACTED },
    // JWTs
    { name: "JWT", re: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, replace: () => REDACTED },
  ];
  if (mode === "precise") return precise;
  return [
    ...precise,
    // base64 blobs with mixed case and digits (the lookbehind starts a try only at a run's start: linear on huge blobs)
    {
      name: "base64 blob",
      re: /(?<![A-Za-z0-9+/])(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{40,}={0,2}/g,
      replace: () => REDACTED,
    },
    // any other long token mixing letters and digits (hashes, ids: over-redaction is fine in logs)
    { name: "long token", re: /(?<![\w-])(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{32,}(?![\w-])/g, replace: () => REDACTED },
  ];
}

let knownSecrets: string[] | null = null;

/** Exact values of secret-named variables on this machine (env + ~/.claude/settings.json env), longest first. */
function loadKnownSecrets(): string[] {
  const values = new Set<string>();
  for (const [k, v] of Object.entries(process.env)) if (v && SECRET_ENV_NAME.test(k)) values.add(v);
  try {
    const env = JSON.parse(readFileSync(join(homedir(), ".claude", "settings.json"), "utf8"))?.env ?? {};
    for (const [k, v] of Object.entries(env)) if (SECRET_ENV_NAME.test(k)) values.add(String(v));
  } catch {
    // no settings file: env vars only
  }
  // Values written into notes must look like secrets: long, no whitespace, not a path or URL
  return [...values]
    .filter((v) => v.length >= 12 && !/\s/.test(v) && !v.startsWith("/") && !v.includes("://") && !isPlaceholder(v))
    .sort((a, b) => b.length - a.length);
}

/** Test seam: re-read env and settings on the next call. */
export function resetRedactCache(): void {
  knownSecrets = null;
}

export function redact(text: string, mode: RedactMode = "precise"): RedactResult {
  if (!text) return { text, count: 0 };
  knownSecrets ??= loadKnownSecrets();
  let count = 0;
  let out = text;
  for (const value of knownSecrets) {
    const parts = out.split(value);
    if (parts.length > 1) {
      count += parts.length - 1;
      out = parts.join(REDACTED);
    }
  }
  for (const rule of rules(mode)) {
    out = out.replace(rule.re, (match: string, ...args: unknown[]) => {
      const groups = args.slice(0, -2).map((g) => (typeof g === "string" ? g : ""));
      const replaced = rule.replace(match, ...groups);
      if (replaced === null || replaced === match) return match;
      count++;
      return replaced;
    });
  }
  return { text: out, count };
}

export interface SecretLocation {
  line: number;
  kind: string;
}

/** Where precise-set secrets sit in a text (for lint_vault): 1-based line and kind, never the value. */
export function findSecrets(text: string): SecretLocation[] {
  knownSecrets ??= loadKnownSecrets();
  const hits: { index: number; kind: string }[] = [];
  for (const value of knownSecrets) {
    for (let i = text.indexOf(value); i !== -1; i = text.indexOf(value, i + value.length)) {
      hits.push({ index: i, kind: "secret env value" });
    }
  }
  for (const rule of rules("precise")) {
    for (const m of text.matchAll(rule.re)) {
      const replaced = rule.replace(m[0], ...m.slice(1).map((g) => g ?? ""));
      if (replaced !== null && replaced !== m[0]) hits.push({ index: m.index ?? 0, kind: rule.name });
    }
  }
  const seen = new Set<string>();
  const out: SecretLocation[] = [];
  for (const h of hits.sort((a, b) => a.index - b.index)) {
    const line = text.slice(0, h.index).split("\n").length;
    const key = `${line}:${h.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ line, kind: h.kind });
    }
  }
  return out;
}

/** Redact every string inside a JSON-like value (for log payloads and state files). */
export function redactDeep<T>(value: T, mode: RedactMode = "broad"): { value: T; count: number } {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redact(v, mode);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, count };
}

/** Suffix for a tool result: says how many secrets were masked, never which. "" when none. */
export function redactedNote(count: number): string {
  return count > 0 ? ` (${count} secret${count === 1 ? "" : "s"} redacted)` : "";
}
