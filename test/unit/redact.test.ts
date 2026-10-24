import { describe, it, expect, afterEach } from "vitest";
import { redact, redactDeep, resetRedactCache, REDACTED } from "../../src/core/redact.js";

// Fake secrets are assembled at runtime so secret scanners never see a key-shaped literal here.
const j = (...parts: string[]) => parts.join("");
const RANDOM = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FAKE = {
  github: j("gh", "p_", RANDOM),
  npm: j("np", "m_", RANDOM),
  openai: j("s", "k-", "proj-", RANDOM),
  stripe: j("s", "k_", "live_", RANDOM),
  slack: j("xo", "xb-", "1234567890-", RANDOM),
  aws: j("AK", "IA", "ABCDEFGH12345678"),
  google: j("AI", "za", "Sy", RANDOM),
  jwt: j("ey", "JhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"),
  pem: j("-----BEGIN RSA PRI", "VATE KEY-----\nMIIEowIBAAKCAQEA\nabc123\n-----END RSA PRI", "VATE KEY-----"),
};

const masked = (text: string, mode: "precise" | "broad" = "precise") => redact(text, mode).text;

afterEach(() => {
  delete process.env.TEST_FAKE_API_KEY;
  resetRedactCache();
});

describe("redact: secrets are masked", () => {
  for (const [name, value] of Object.entries(FAKE)) {
    it(`masks a ${name} key`, () => {
      const r = redact(`before ${value} after`);
      expect(r.text).not.toContain(value);
      expect(r.text).toContain(REDACTED);
      expect(r.text.startsWith("before ")).toBe(true);
      expect(r.count).toBeGreaterThanOrEqual(1);
    });
  }

  it("masks name=value, name: value and JSON pairs", () => {
    const pw = j("hunter", "2-correct-horse");
    expect(masked(`DB_PASSWORD=${pw}`)).toBe(`DB_PASSWORD=${REDACTED}`);
    expect(masked(`api_key: ${pw}`)).toBe(`api_key: ${REDACTED}`);
    expect(masked(`{"client_secret": "${pw}"}`)).toBe(`{"client_secret": "${REDACTED}"}`);
    expect(masked(`OPENAI_API_KEY=${pw}`)).toBe(`OPENAI_API_KEY=${REDACTED}`);
  });

  it("masks flags, bearer headers and URL credentials", () => {
    const tok = j("abc123", "def456ghi789");
    expect(masked(`curl --token ${tok} https://x`)).toBe(`curl --token ${REDACTED} https://x`);
    expect(masked(`Authorization: Bearer ${tok}`)).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(masked(`postgres://admin:${tok}@db:5432/app`)).toBe(`postgres://${REDACTED}@db:5432/app`);
  });

  it("masks a truncated PEM block", () => {
    const cut = FAKE.pem.slice(0, 50);
    expect(masked(`key:\n${cut}`)).not.toContain("MIIE");
  });

  it("masks the exact value of a secret-named env var, whatever its shape", () => {
    const value = j("plain", "lowercase", "wordsecret");
    process.env.TEST_FAKE_API_KEY = value;
    resetRedactCache();
    expect(masked(`the value is ${value} here`)).toBe(`the value is ${REDACTED} here`);
  });

  it("is idempotent and counts each replacement", () => {
    const once = redact(`a ${FAKE.github} b ${FAKE.npm}`);
    expect(once.count).toBe(2);
    const twice = redact(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(0);
  });
});

describe("redact: ordinary note content is left alone (precise)", () => {
  const untouched = [
    "commit 733bc75a1f0e8d2c4b6a9e7f1d3c5b7a9e1f3d5c fixed it",
    "uuid 3f2b8c1e-9d4a-4f6b-8e2c-1a7d9b3e5f0c",
    "sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "see src/core/redact.ts and /home/user/project/file.md",
    "https://github.com/the-glitch-kingdom/semantic-memory/issues/29",
    "the password_reset_url field is optional",
    "set `api_key: <your-key>` in the config",
    "password: changeme",
    "token: ${API_TOKEN}",
    "api_key = process.env.OPENAI_API_KEY",
    "secret: xxxxxxxxxxxx",
    "postgres://user:password@localhost:5432/db",
    "the monkey: bananas-for-days",
    "max_tokens: 4096 and tokenizer: cl100k_base",
    "primary key pk_customer_orders_by_region",
    "npm_package_version_number_string is an env var",
    "re_compile_pattern_cache_helper",
    "Bearer authentication is described below in detail",
    "already masked: api_key: [REDACTED]",
  ];
  for (const text of untouched) {
    it(`leaves: ${text.slice(0, 50)}`, () => {
      const r = redact(text, "precise");
      expect(r.text).toBe(text);
      expect(r.count).toBe(0);
    });
  }

  it("ignores env values that do not look like secrets (short, paths, URLs)", () => {
    process.env.TEST_FAKE_API_KEY = "/usr/local/bin";
    resetRedactCache();
    expect(masked("path /usr/local/bin here")).toBe("path /usr/local/bin here");
  });
});

describe("redact: broad mode (logs)", () => {
  it("also masks long mixed tokens and base64 blobs", () => {
    const token = j("a1b2c3d4e5f6", "a1b2c3d4e5f6a1b2c3d4e5f6");
    const b64 = j("QWxhZGRpbjpvcGVu", "U2VzYW1lMTIzNDU2Nzg5MEFCQ0RFRg==");
    expect(masked(`id ${token}`, "broad")).toBe(`id ${REDACTED}`);
    expect(masked(`blob ${b64}`, "broad")).toBe(`blob ${REDACTED}`);
  });

  it("keeps every precise-mode mask", () => {
    for (const value of Object.values(FAKE)) {
      expect(masked(`x ${value} y`, "broad")).not.toContain(value);
    }
  });

  it("redactDeep masks strings inside objects and arrays", () => {
    const { value, count } = redactDeep({ cmd: `deploy --token ${FAKE.npm}`, args: [FAKE.github], n: 3 });
    expect(JSON.stringify(value)).not.toContain(FAKE.npm);
    expect(JSON.stringify(value)).not.toContain(FAKE.github);
    expect(value.n).toBe(3);
    expect(count).toBe(2);
  });
});

describe("redact: performance", () => {
  it("redacts a 1 MB note in well under a second", () => {
    const big = ("Some ordinary prose about the system, with a path src/core/x.ts and a sha 733bc75.\n").repeat(12_000);
    const start = performance.now();
    redact(big + FAKE.github);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it("stays linear on a 1 MB unbroken base64 run in broad mode", () => {
    const blob = "QWxh".repeat(250_000) + "1a";
    const start = performance.now();
    expect(redact(blob, "broad").text).toBe(REDACTED);
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  for (const [name, run] of [
    ["hyphenated run", "a1-".repeat(330_000)],
    ["dash rule", "-".repeat(1_000_000)],
    ["underscore run", "a_".repeat(500_000)],
    ["dotted run", "a.".repeat(500_000)],
  ] as const) {
    for (const mode of ["precise", "broad"] as const) {
      it(`stays linear on a 1 MB ${name} (${mode})`, () => {
        const start = performance.now();
        redact(run, mode);
        expect(performance.now() - start).toBeLessThan(2_000);
      });
    }
  }
});
