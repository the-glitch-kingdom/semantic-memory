import { basename } from "node:path";
import type { ChangeSet, PatchCreate, PatchUpdate } from "./patch.js";

export interface SynthesizeNoteInput {
  topic: string;
  answer: string;
  suggested_path: string;
  type?: string;
  sources?: string[];
  derived_from?: string[];
  related_notes?: string[];
  status?: string;
  confidence?: string;
  decision_maker?: string;
  decided_on?: string;
  severity?: string;
  /** Verbatim symptom phrases (the user's own words) — symptom-keyed for retrieval. */
  symptoms?: string[];
  extra_frontmatter?: Record<string, unknown>;
  /**
   * When true, the resulting note is filed under `proposals/<date>-<slug>.md` with
   * `status: proposal` frontmatter, regardless of `suggested_path`. The original path
   * is preserved as `proposed_target` in frontmatter so `synthesize_promote` knows
   * where to move it on acceptance.
   */
  proposal?: boolean;
  /**
   * When provided alongside `proposal: true`, used as the proposal subdirectory name.
   * Defaults to "proposals". Useful for callers that want to segregate by source
   * (e.g. "proposals/research", "proposals/outage").
   */
  proposal_subdir?: string;
  /**
   * Names of notes that exist in the vault (see `loadKnownNames`). When given, only related
   * entries that resolve are linked; the rest are listed as plain code text. Omitted: every entry is linked.
   */
  knownNames?: Set<string>;
}

export interface SynthesizePreview {
  changeset: ChangeSet;
  path: string;
  title: string;
  /** True when the preview is a proposal — caller (or `synthesize_promote`) must move it later. */
  is_proposal?: boolean;
  /** When `is_proposal` is true, the canonical path that `synthesize_promote` should move it to. */
  proposed_target?: string;
}

/**
 * Convert a query answer + provenance into a ChangeSet that can be fed to applyPatch.
 * The shaped note includes provenance frontmatter and auto-inserts [[wikilinks]] for
 * any related_notes that appear as bare titles in the body.
 *
 * Does NOT write to disk — always returns a ChangeSet. Callers pass it to applyPatch.
 *
 * Proposal mode: when `proposal: true`, the path is rewritten to
 * `<proposal_subdir>/<YYYY-MM-DD>-<slug>.md`, the `status` is forced to `proposal`,
 * and `proposed_target` records the original suggested path. `synthesize_promote`
 * later moves the file to that target and clears the proposal frontmatter.
 */
export function buildSynthesizeChangeSet(input: SynthesizeNoteInput): SynthesizePreview {
  const today = new Date().toISOString().slice(0, 10);
  const title = input.topic.trim();
  const canonicalPath = input.suggested_path.endsWith(".md") ? input.suggested_path : input.suggested_path + ".md";

  const isProposal = input.proposal === true;
  const subdir = (input.proposal_subdir ?? "proposals").replace(/\/+$/, "");
  const slug = slugForTopic(title);
  const path = isProposal ? `${subdir}/${today}-${slug}.md` : canonicalPath;

  const frontmatter: Record<string, unknown> = {
    title,
    type: input.type ?? "note",
    status: isProposal ? "proposal" : (input.status ?? "active"),
    last_verified: today,
    confidence: input.confidence ?? "medium",
    ...(input.sources && input.sources.length > 0 && { sources: input.sources }),
    ...(input.derived_from && input.derived_from.length > 0 && { derived_from: input.derived_from }),
    ...(input.decision_maker && { decision_maker: input.decision_maker }),
    ...(input.decided_on && { decided_on: input.decided_on }),
    ...(input.severity && { severity: input.severity }),
    ...(input.symptoms && input.symptoms.length > 0 && { symptoms: input.symptoms }),
    ...(isProposal && { proposed_target: canonicalPath }),
    ...(input.extra_frontmatter ?? {}),
  };

  const body = buildBody(title, input.answer, input.related_notes ?? [], input.knownNames);

  const create: PatchCreate = { path, content: body, frontmatter };
  const changeset: ChangeSet = { creates: [create] };

  return {
    changeset,
    path,
    title,
    ...(isProposal && { is_proposal: true, proposed_target: canonicalPath }),
  };
}

function slugForTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function buildBody(title: string, answer: string, relatedNotes: string[], knownNames?: Set<string>): string {
  let body = `# ${title}\n\n${answer.trim()}\n`;

  if (relatedNotes.length > 0) {
    const resolves = (r: string) => !knownNames || knownNames.has(wikilinkName(r));
    body = autoWikilink(body, relatedNotes.filter(resolves));
    const links = relatedNotes
      .map((r) => (resolves(r) ? `- [[${wikilinkName(r)}]]` : `- \`${wikilinkName(r)}\``))
      .join("\n");
    body += `\n## Related\n\n${links}\n`;
  }

  return body;
}

/**
 * For each related note, replace the first bare occurrence of its title in the body
 * with a [[wikilink]]. Conservative — only replaces whole-word matches outside code blocks.
 */
function autoWikilink(body: string, relatedNotes: string[]): string {
  // Skip content inside fenced code blocks and inline code spans
  const parts = body.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code block
      let out = part;
      for (const r of relatedNotes) {
        const name = wikilinkName(r);
        if (/[\[\]]/.test(out) && out.includes(`[[${name}]]`)) continue; // already linked
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // not \b: it fires inside paths and hyphenated names (`-`, `/`, `.` are boundaries)
        const re = new RegExp(`(?<![\\w./\\\\-])${escaped}(?![\\w/\\\\-]|\\.\\w)`, "i");
        out = out.replace(re, `[[${name}]]`);
      }
      return out;
    })
    .join("");
}

function wikilinkName(pathOrName: string): string {
  // "decisions/auth-migration.md" → "auth-migration"
  // "Auth Migration" → "Auth Migration"
  const base = basename(pathOrName).replace(/\.md$/, "");
  return base;
}

export interface PromoteInput {
  /**
   * Path to the proposal note (relative to vault root). Must have `status: proposal` frontmatter
   * AND `proposed_target` frontmatter, both written by `buildSynthesizeChangeSet` in proposal mode.
   */
  proposal_path: string;
  /**
   * Optional override for the destination path. When omitted, the proposal's own
   * `proposed_target` frontmatter is used.
   */
  target_path?: string;
}

export interface PromotePreview {
  changeset: ChangeSet;
  from: string;
  to: string;
}

/**
 * Promote a reviewed proposal to its canonical destination.
 *
 * Reads the proposal's existing content + frontmatter, strips `status: proposal` and
 * `proposed_target` keys, restores the original status (default "active"), and returns
 * a ChangeSet that:
 *   - creates the canonical path with the cleaned frontmatter + body
 *   - deletes the proposal path
 *
 * The caller (the MCP tool) reads the proposal file, runs this builder, and applies the
 * resulting changeset via applyPatch — preserving atomicity and rollback semantics.
 */
export function buildPromoteChangeSet(input: {
  proposal_path: string;
  target_path?: string;
  body: string;
  frontmatter: Record<string, unknown>;
}): PromotePreview {
  const fm = { ...input.frontmatter };
  const target = input.target_path ?? (typeof fm.proposed_target === "string" ? fm.proposed_target : undefined);
  if (!target) {
    throw new Error(
      `Cannot promote ${input.proposal_path}: no target_path provided and no 'proposed_target' frontmatter on the proposal.`
    );
  }
  // Restore canonical status (default "active") and strip proposal markers.
  if (fm.status === "proposal") fm.status = "active";
  delete fm.proposed_target;

  const create: PatchCreate = {
    path: target,
    content: input.body,
    frontmatter: fm,
  };
  const changeset: ChangeSet = {
    creates: [create],
    deletes: [{ path: input.proposal_path }],
  };

  return { changeset, from: input.proposal_path, to: target };
}
