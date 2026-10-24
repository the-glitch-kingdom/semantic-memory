import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import matter from "gray-matter";
import { redact } from "./redact.js";
import { replaceSectionBody, appendToSection } from "./dossier.js";

/**
 * Speaker profile (v1.5 Phase 11) — the model of THIS human.
 *
 * The difference between an expert who knows the system and one who knows the
 * system *and knows you*: how this person calibrates severity ("annoying" vs
 * "broken" vs "on fire"), what they chronically leave unsaid, how much detail they
 * want back, and the shorthand they use that isn't an entity. One note, one human
 * (multi-speaker is an explicit non-goal). Injected at SessionStart alongside the
 * session digest; updated via capture cues when the user corrects an interpretation.
 */

export const SPEAKER_PROFILE_PATH = "profile/speaker.md";

/** The fixed sections a speaker profile carries. */
export const PROFILE_SECTIONS = [
  "Severity calibration",
  "Chronic omissions",
  "Verbosity preference",
  "Shorthand & terms",
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export interface SpeakerProfile {
  path: string;
  /** The whole note body (frontmatter stripped), trimmed. */
  body: string;
  /** A capped, injection-ready rendering (headings + non-placeholder lines). */
  head: string;
}

export function speakerProfileTemplate(): string {
  return `# Speaker profile

_How this human communicates — learned over time, corrected in place. One human, one profile._

## Severity calibration

_What their words map to. e.g. "annoying" = low, "broken" = ship-blocking, "on fire" = drop everything._

## Chronic omissions

_What they habitually leave unsaid — env, repro steps, which service — so you ask up front._

## Verbosity preference

_How much detail they want back: terse answer first, or full reasoning? Code or prose?_

## Shorthand & terms

_Non-entity shorthand: "the usual", "ship it", "the thing from yesterday" — and what each has meant._
`;
}

/** True when a line is only a template placeholder (italic prompt) or blank. */
function isPlaceholderLine(line: string): boolean {
  const t = line.trim();
  return t === "" || /^_.*_$/.test(t);
}

/**
 * Read the speaker profile, returning a capped injection head that drops the
 * template placeholders (so an unfilled profile injects nothing but its headings,
 * and a filled one injects only the real content). Returns null when absent.
 */
export async function readSpeakerProfile(vaultPath: string, maxLines = 30): Promise<SpeakerProfile | null> {
  const abs = join(vaultPath, SPEAKER_PROFILE_PATH);
  if (!existsSync(abs)) return null;
  try {
    const raw = await readFile(abs, "utf-8");
    const { content } = matter(raw);
    const body = content.trim();
    // Build the head: keep headings and real (non-placeholder) content lines.
    const kept: string[] = [];
    let lastWasHeading = false;
    for (const line of body.split("\n")) {
      const isHeading = /^#{1,6}\s/.test(line);
      if (isHeading) {
        // Drop a heading immediately followed by nothing real (avoid trailing empty sections at render).
        kept.push(line.replace(/^#+\s*/, "").trim());
        lastWasHeading = true;
        continue;
      }
      if (isPlaceholderLine(line)) continue;
      kept.push(line.trim());
      lastWasHeading = false;
    }
    void lastWasHeading;
    const head = kept.slice(0, maxLines).join("\n").trim();
    return { path: SPEAKER_PROFILE_PATH, body, head };
  } catch {
    return null;
  }
}

export interface InitProfileResult {
  path: string;
  created: boolean;
}

/** Scaffold the speaker profile note. No-op (created:false) if it already exists. */
export async function initSpeakerProfile(vaultPath: string, today?: string): Promise<InitProfileResult> {
  const abs = join(vaultPath, SPEAKER_PROFILE_PATH);
  if (existsSync(abs)) return { path: SPEAKER_PROFILE_PATH, created: false };
  const date = today ?? new Date().toISOString().slice(0, 10);
  const fm = {
    title: "Speaker profile",
    type: "profile",
    status: "active",
    last_verified: date,
    confidence: "medium",
    evergreen: true,
  };
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, matter.stringify(speakerProfileTemplate(), fm), "utf-8");
  return { path: SPEAKER_PROFILE_PATH, created: true };
}

/**
 * Update one section of the speaker profile. `mode: "replace"` swaps the section
 * body; `mode: "append"` adds a line (accretion). Scaffolds the note first if
 * absent. Returns the resolved path.
 */
export async function updateProfileSection(
  vaultPath: string,
  section: string,
  text: string,
  mode: "replace" | "append" = "append"
): Promise<{ path: string; redacted?: number }> {
  await initSpeakerProfile(vaultPath);
  const abs = join(vaultPath, SPEAKER_PROFILE_PATH);
  const raw = await readFile(abs, "utf-8");
  const parsed = matter(raw);
  const incoming = redact(text.trim());
  const patchedBody = mode === "replace"
    ? replaceSectionBody(parsed.content, section, incoming.text)
    : appendToSection(parsed.content, section, `- ${incoming.text}`);
  await writeFile(abs, matter.stringify(patchedBody, parsed.data), "utf-8");
  return { path: SPEAKER_PROFILE_PATH, ...(incoming.count ? { redacted: incoming.count } : {}) };
}
