import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerContext } from "../context.js";
import { applyPatch, type ChangeSet } from "../../core/patch.js";
import { buildSynthesizeChangeSet, buildPromoteChangeSet } from "../../core/synthesize.js";
import { buildIngestChangeSet } from "../../core/ingest.js";
import { installDefaultSchema } from "../../core/schema.js";
import { logEvent } from "../../core/log.js";
import { computeDecay, loadDecayConfig } from "../../core/decay.js";
import { addAlias, removeAlias, compileLexicon, loadLexiconCache, expandQuery } from "../../core/lexicon.js";
import { initDossier, listDossiers, appendIncident, setCurrentState, resolveDossierPath, compileDossiers } from "../../core/dossier.js";
import { initSpeakerProfile, readSpeakerProfile, updateProfileSection, SPEAKER_PROFILE_PATH } from "../../core/profile.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "../../core/matter.js";

export function registerPatchTools(server: McpServer, ctx: ServerContext): void {
  if (ctx.options.readOnly) return;

  server.tool(
    "apply_patch",
    "Atomic multi-note patch with rollback — apply a ChangeSet of creates/updates/deletes/moves. If any op fails, earlier ops are reverted. In dry-run, nothing is written; result describes the proposed state + schema findings.",
    {
      creates: z
        .array(
          z.object({
            path: z.string(),
            content: z.string(),
            frontmatter: z.record(z.unknown()).optional(),
          })
        )
        .optional(),
      updates: z
        .array(
          z.object({
            path: z.string(),
            content: z.string(),
            mode: z.enum(["overwrite", "append", "prepend", "patch-by-heading"]),
            heading: z.string().optional(),
          })
        )
        .optional(),
      deletes: z.array(z.object({ path: z.string() })).optional(),
      moves: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      dry_run: z.boolean().optional().default(false),
      validate: z.boolean().optional().default(true),
      allow_lint_warnings: z.boolean().optional().default(true),
    },
    async (args) => {
      const cs: ChangeSet = {
        creates: args.creates,
        updates: args.updates,
        deletes: args.deletes,
        moves: args.moves,
      };
      const result = await applyPatch(ctx.notesPath, cs, {
        dryRun: args.dry_run,
        validate: args.validate,
        allowLintWarnings: args.allow_lint_warnings,
      });
      if (!result.ok && !args.dry_run) {
        await logEvent(ctx.notesPath, {
          kind: "error",
          summary: `apply_patch failed: ${result.errors[0] ?? "unknown"}`,
          payload: { tool: "apply_patch", errors: result.errors, rolled_back: result.rolledBack.length },
        }).catch(() => { /* never let logging failure mask the real error */ });
      }
      if (result.ok && !args.dry_run) {
        const touched = result.applied.map((o) => o.path);
        await ctx.sessions.recordNotesTouched(touched).catch(() => {});
      }
      return ctx.textResponse(JSON.stringify(result, null, 2));
    }
  );

  server.tool(
    "synthesize_note",
    "Turn a researched answer + sources into a new filed note with provenance frontmatter and auto-wikilinks. Builds a ChangeSet and applies it (dry-run supported). The primary path from query-answer to durable vault artifact. Pass `proposal: true` to file the result under `proposals/<date>-<slug>.md` with `status: proposal` for review-first workflows; `synthesize_promote` then moves it to the canonical destination.",
    {
      topic: z.string(),
      answer: z.string(),
      suggested_path: z.string().describe("Target path relative to vault root, e.g. 'decisions/auth-migration.md'. In proposal mode, this is recorded as proposed_target frontmatter and the actual write goes to proposals/."),
      type: z.string().optional().default("note").describe("One of the schema types: note, decision, gotcha, source"),
      sources: z.array(z.string()).optional().describe("External URLs or paths — populate provenance.sources"),
      derived_from: z.array(z.string()).optional().describe("Wikilinks to other vault notes — populate provenance.derived_from"),
      related_notes: z.array(z.string()).optional().describe("Note names or paths to auto-link in the body + list under Related"),
      status: z.string().optional().default("active"),
      confidence: z.string().optional().default("medium"),
      decision_maker: z.string().optional(),
      decided_on: z.string().optional(),
      severity: z.string().optional(),
      symptoms: z.array(z.string()).optional().describe("Verbatim symptom phrases in the user's own words (e.g. 'it hangs after the second reindex'). Stored as `symptoms:` frontmatter and symptom-keyed at index time so terse symptom queries match this note — the retrieval key for next time."),
      dry_run: z.boolean().optional().default(false),
      proposal: z.boolean().optional().default(false).describe("Write to proposals/<date>-<slug>.md with status:proposal instead of the canonical destination. Use for review-first workflows."),
      proposal_subdir: z.string().optional().describe("Override the proposal subdirectory (default 'proposals'). Useful for source segregation, e.g. 'proposals/research'."),
      from_session: z.boolean().optional().default(false).describe("When true, pull defaults from the active session: prepend a verification summary to `answer`, default `derived_from` to session.notes_touched, and append session id+task to `sources`. No-op when no session is active."),
    },
    async (args) => {
      // from_session: if requested AND a session is active, enrich the synthesis input
      // with session context so the agent has fewer fields to specify by hand.
      let answer = args.answer;
      let derivedFrom = args.derived_from;
      let sources = args.sources;
      if (args.from_session) {
        const session = await ctx.sessions.readActive();
        if (session) {
          const verifLines = session.verifications.map((v) =>
            `- \`${v.cmd}\` → exit=${v.exit ?? "(killed)"} in ${v.duration_ms}ms`
          );
          if (verifLines.length > 0) {
            answer = `${answer}\n\n## Session verifications (${session.id})\n\n${verifLines.join("\n")}\n`;
          }
          if ((!derivedFrom || derivedFrom.length === 0) && session.notes_touched.length > 0) {
            derivedFrom = [...session.notes_touched];
          }
          const sessionTag = `session:${session.id} task:${session.task}`;
          sources = sources ? [...sources, sessionTag] : [sessionTag];
        }
      }

      const preview = buildSynthesizeChangeSet({
        topic: args.topic,
        answer,
        suggested_path: args.suggested_path,
        type: args.type,
        sources,
        derived_from: derivedFrom,
        related_notes: args.related_notes,
        status: args.status,
        confidence: args.confidence,
        decision_maker: args.decision_maker,
        decided_on: args.decided_on,
        severity: args.severity,
        symptoms: args.symptoms,
        proposal: args.proposal,
        proposal_subdir: args.proposal_subdir,
      });
      const result = await applyPatch(ctx.notesPath, preview.changeset, {
        dryRun: args.dry_run,
      });
      if (result.ok && !args.dry_run) {
        await logEvent(ctx.notesPath, {
          kind: "synthesis",
          summary: `synthesized ${preview.title}${preview.is_proposal ? " (proposal)" : ""}`,
          payload: {
            path: preview.path,
            type: args.type,
            sources: sources ?? [],
            derived_from: derivedFrom ?? [],
            ...(preview.is_proposal && { is_proposal: true, proposed_target: preview.proposed_target }),
          },
        }).catch(() => {});
        await ctx.sessions.recordNotesTouched([preview.path]).catch(() => {});
      } else if (!result.ok && !args.dry_run) {
        await logEvent(ctx.notesPath, {
          kind: "error",
          summary: `synthesize_note failed: ${result.errors[0] ?? "unknown"}`,
          payload: { tool: "synthesize_note", path: preview.path, errors: result.errors },
        }).catch(() => {});
      }
      return ctx.textResponse(
        JSON.stringify(
          {
            preview: {
              path: preview.path,
              title: preview.title,
              ...(preview.is_proposal && { is_proposal: true, proposed_target: preview.proposed_target }),
            },
            result,
          },
          null,
          2
        )
      );
    }
  );

  server.tool(
    "synthesize_promote",
    "Move a reviewed proposal note to its canonical destination. Reads the proposal's frontmatter (which must have `status: proposal` and `proposed_target`), strips proposal markers, restores canonical status, and atomically creates the target + deletes the proposal. Optional `target_path` overrides the proposal's recorded `proposed_target`.",
    {
      proposal_path: z.string().describe("Path to the proposal note relative to vault root, e.g. 'proposals/2026-05-08-auth-flow.md'"),
      target_path: z.string().optional().describe("Optional destination override. When omitted, uses the proposal's own `proposed_target` frontmatter."),
      dry_run: z.boolean().optional().default(false),
    },
    async (args) => {
      const absoluteProposalPath = join(ctx.notesPath, args.proposal_path);
      let raw: string;
      try {
        raw = await readFile(absoluteProposalPath, "utf-8");
      } catch (err) {
        return ctx.textResponse(JSON.stringify({
          ok: false,
          error: `Proposal file not found: ${args.proposal_path}`,
        }, null, 2));
      }
      const parsed = matter(raw);
      const fm = parsed.data as Record<string, unknown>;
      if (fm.status !== "proposal") {
        return ctx.textResponse(JSON.stringify({
          ok: false,
          error: `Note ${args.proposal_path} does not have status:proposal frontmatter (got status=${JSON.stringify(fm.status)}). Refusing to promote — only proposal-flagged notes are eligible.`,
        }, null, 2));
      }

      let preview;
      try {
        preview = buildPromoteChangeSet({
          proposal_path: args.proposal_path,
          target_path: args.target_path,
          body: parsed.content,
          frontmatter: fm,
        });
      } catch (err: any) {
        return ctx.textResponse(JSON.stringify({ ok: false, error: err?.message ?? String(err) }, null, 2));
      }

      const result = await applyPatch(ctx.notesPath, preview.changeset, { dryRun: args.dry_run });
      if (result.ok && !args.dry_run) {
        await logEvent(ctx.notesPath, {
          kind: "synthesis",
          summary: `promoted proposal ${preview.from} → ${preview.to}`,
          payload: { tool: "synthesize_promote", from: preview.from, to: preview.to },
        }).catch(() => {});
        await ctx.sessions.recordNotesTouched([preview.to]).catch(() => {});
      }
      return ctx.textResponse(JSON.stringify({ preview: { from: preview.from, to: preview.to }, result }, null, 2));
    }
  );

  server.tool(
    "ingest_source",
    "Build + apply a ChangeSet that ingests a source (paper, doc, URL) and the notes extracted from it. Produces one sources/<slug>.md note (type=source) plus one create per extracted unit, each stamped with derived_from pointing at the source. Routes through apply_patch — atomic, validated, rollback-capable, dry-run supported.",
    {
      source: z.object({
        source_uri: z.string(),
        source_title: z.string(),
        source_type: z.string().optional(),
        source_path: z.string().optional(),
        source_summary: z.string().optional(),
        source_tags: z.array(z.string()).optional(),
      }),
      units: z.array(
        z.object({
          path: z.string(),
          title: z.string().optional(),
          content: z.string(),
          type: z.string().optional(),
          extra_derived_from: z.array(z.string()).optional(),
          extra_frontmatter: z.record(z.unknown()).optional(),
          confidence: z.string().optional(),
        })
      ),
      dry_run: z.boolean().optional().default(false),
      auto_apply: z.boolean().optional().default(true).describe("If false, force dry-run regardless of dry_run flag — use for review-first workflows"),
    },
    async (args) => {
      const preview = buildIngestChangeSet({
        source: args.source,
        units: args.units,
      });
      const dry = args.dry_run || args.auto_apply === false;
      const result = await applyPatch(ctx.notesPath, preview.changeset, { dryRun: dry });
      if (result.ok && !dry) {
        await logEvent(ctx.notesPath, {
          kind: "ingest",
          summary: `ingested ${preview.unitPaths.length} note(s) from ${args.source.source_title}`,
          payload: {
            source_path: preview.sourcePath,
            unit_paths: preview.unitPaths,
            source_uri: args.source.source_uri,
          },
        }).catch(() => {});
      } else if (!result.ok && !dry) {
        await logEvent(ctx.notesPath, {
          kind: "error",
          summary: `ingest_source failed: ${result.errors[0] ?? "unknown"}`,
          payload: {
            tool: "ingest_source",
            source_uri: args.source.source_uri,
            source_title: args.source.source_title,
            errors: result.errors,
          },
        }).catch(() => {});
      }
      return ctx.textResponse(
        JSON.stringify(
          {
            preview: {
              source_path: preview.sourcePath,
              unit_paths: preview.unitPaths,
            },
            result,
            dry_run: dry,
          },
          null,
          2
        )
      );
    }
  );

  server.tool(
    "install_schema",
    "Bootstrap vault.schema.yml in the vault root with the default schema (note/decision/gotcha/source types + provenance fields). Skipped if present unless force=true.",
    { force: z.boolean().optional().default(false) },
    async ({ force }) => {
      const r = await installDefaultSchema(ctx.notesPath, force);
      return ctx.textResponse(
        r.written ? `Installed default schema: ${r.path}` : `Schema already exists: ${r.path} (pass force=true to overwrite)`
      );
    }
  );

  server.tool(
    "verify_note",
    "Re-verify a note: stamp `last_verified` to today WITHOUT changing content or any other frontmatter field, and log a `verify` event. Resets the confidence-decay clock so the note ranks fresh again. Returns the note's new decay multiplier (typically 1.0).",
    { path: z.string() },
    async ({ path }) => {
      let fm: Record<string, unknown>;
      try {
        fm = await ctx.frontmatterManager.get(path);
      } catch {
        return ctx.textResponse(`verify_note: note not found: ${path}`);
      }
      const today = new Date().toISOString().slice(0, 10);
      await ctx.frontmatterManager.update(path, { last_verified: today });
      await logEvent(ctx.notesPath, {
        kind: "verify",
        summary: `verified ${path}`,
        payload: { path, last_verified: today },
      });
      const d = computeDecay({
        type: typeof fm.type === "string" ? fm.type : undefined,
        last_verified: today,
        evergreen: fm.evergreen === true,
        config: loadDecayConfig(ctx.notesPath),
      });
      return ctx.textResponse(
        JSON.stringify({ path, last_verified: today, decay_multiplier: d.multiplier }, null, 2)
      );
    }
  );

  server.tool(
    "manage_lexicon",
    "Manage the learned human→artifact lexicon (v1.4). `action`: add (upsert a canonical target + the human phrases that refer to it; bumps evidence_count on repeats), lookup (expand a query via matching alias phrases), list (all aliases), remove (by canonical), compile (rebuild the derived cache). The lexicon maps how THIS human names things to concrete paths/symbols.",
    {
      action: z.enum(["add", "lookup", "list", "remove", "compile"]),
      canonical: z.string().optional().describe("For add/remove: the concrete target (note path or code symbol)."),
      phrases: z.array(z.string()).optional().describe("For add: the human's verbatim phrases for the canonical target."),
      query: z.string().optional().describe("For lookup: the utterance to expand via alias phrases."),
      source: z.enum(["learned", "authored"]).optional().describe("For add: provenance of the binding (default learned)."),
    },
    async ({ action, canonical, phrases, query, source }) => {
      switch (action) {
        case "add": {
          if (!canonical || !phrases || phrases.length === 0) return ctx.textResponse("manage_lexicon add requires `canonical` and non-empty `phrases`");
          const r = await addAlias(ctx.notesPath, { canonical, phrases, source });
          return ctx.textResponse(JSON.stringify(r, null, 2));
        }
        case "lookup": {
          if (!query) return ctx.textResponse("manage_lexicon lookup requires `query`");
          const aliases = await loadLexiconCache(ctx.notesPath);
          const { expanded, matched } = expandQuery(aliases, query);
          return ctx.textResponse(JSON.stringify({ query, expanded, matched }, null, 2));
        }
        case "list": {
          return ctx.textResponse(JSON.stringify(await loadLexiconCache(ctx.notesPath), null, 2));
        }
        case "remove": {
          if (!canonical) return ctx.textResponse("manage_lexicon remove requires `canonical`");
          const removed = await removeAlias(ctx.notesPath, canonical);
          return ctx.textResponse(removed ? `removed alias: ${canonical}` : `no alias for canonical: ${canonical}`);
        }
        case "compile": {
          const entries = await compileLexicon(ctx.notesPath);
          return ctx.textResponse(`compiled ${entries.length} alias(es) to lexicon-cache.json`);
        }
      }
    }
  );

  server.tool(
    "manage_dossier",
    "Manage entity dossiers (v1.5) — the per-component living notes that organize memory by entity instead of by file. `action`: init (scaffold a dossier for an entity with the fixed Purpose/Failure modes/Knobs/Incident log/Current state sections), append_incident (append a dated line to the Incident log — accretion, never a new note), set_state (replace the Current state one-liner), get (read a dossier by entity/alias/path), list (all dossiers with their current state). Knowledge about a critical component accretes IN PLACE here.",
    {
      action: z.enum(["init", "append_incident", "set_state", "get", "list"]),
      entity: z.string().optional().describe("For init/append_incident/set_state/get: the entity name, one of its aliases, or a dossier path."),
      aliases: z.array(z.string()).optional().describe("For init: the human's phrases for this entity (fed to the lexicon compiler for query expansion)."),
      purpose: z.string().optional().describe("For init: seed the Purpose section instead of the placeholder."),
      seeded_from: z.string().optional().describe("For init: provenance of the scaffold (e.g. a babel-fish project-map entry)."),
      incident: z.string().optional().describe("For append_incident: what happened → cause → fix, in one line. Dated automatically."),
      state: z.string().optional().describe("For set_state: the single freshest sentence about where the entity stands."),
    },
    async ({ action, entity, aliases, purpose, seeded_from, incident, state }) => {
      switch (action) {
        case "init": {
          if (!entity) return ctx.textResponse("manage_dossier init requires `entity`");
          const r = await initDossier(ctx.notesPath, entity, { aliases, purpose, seeded_from });
          if (r.created) await ctx.sessions.recordNotesTouched([r.path]).catch(() => {});
          return ctx.textResponse(JSON.stringify(r, null, 2));
        }
        case "append_incident": {
          if (!entity || !incident) return ctx.textResponse("manage_dossier append_incident requires `entity` and `incident`");
          const r = await appendIncident(ctx.notesPath, entity, incident);
          if (!r) return ctx.textResponse(`no dossier for entity: ${entity} (run action:init first)`);
          await ctx.sessions.recordNotesTouched([r.path]).catch(() => {});
          await logEvent(ctx.notesPath, { kind: "synthesis", summary: `dossier incident: ${entity}`, payload: { path: r.path, incident } }).catch(() => {});
          return ctx.textResponse(JSON.stringify(r, null, 2));
        }
        case "set_state": {
          if (!entity || !state) return ctx.textResponse("manage_dossier set_state requires `entity` and `state`");
          const r = await setCurrentState(ctx.notesPath, entity, state);
          if (!r) return ctx.textResponse(`no dossier for entity: ${entity} (run action:init first)`);
          await ctx.sessions.recordNotesTouched([r.path]).catch(() => {});
          return ctx.textResponse(JSON.stringify(r, null, 2));
        }
        case "get": {
          if (!entity) return ctx.textResponse("manage_dossier get requires `entity`");
          const rel = await resolveDossierPath(ctx.notesPath, entity);
          if (!rel) return ctx.textResponse(`no dossier for entity: ${entity}`);
          const content = await readFile(join(ctx.notesPath, rel), "utf-8");
          return ctx.textResponse(JSON.stringify({ path: rel, content }, null, 2));
        }
        case "list": {
          await compileDossiers(ctx.notesPath);
          const entries = await listDossiers(ctx.notesPath);
          return ctx.textResponse(JSON.stringify(entries, null, 2));
        }
      }
    }
  );

  server.tool(
    "manage_profile",
    "Manage the speaker profile (v1.5) — the model of how THIS human communicates (severity calibration, chronic omissions, verbosity preference, non-entity shorthand). `action`: init (scaffold profile/speaker.md with the fixed sections), get (read it), update_section (append a learned line to — or replace — one section; scaffolds first if absent). Update it when the user corrects an interpretation (\"no, when I say X I mean Y\"). One human, one profile.",
    {
      action: z.enum(["init", "get", "update_section"]),
      section: z.string().optional().describe("For update_section: the section heading (e.g. 'Severity calibration', 'Shorthand & terms')."),
      text: z.string().optional().describe("For update_section: the learned line or replacement body."),
      mode: z.enum(["append", "replace"]).optional().describe("For update_section: append a line (default) or replace the section body."),
    },
    async ({ action, section, text, mode }) => {
      switch (action) {
        case "init": {
          const r = await initSpeakerProfile(ctx.notesPath);
          if (r.created) await ctx.sessions.recordNotesTouched([r.path]).catch(() => {});
          return ctx.textResponse(JSON.stringify(r, null, 2));
        }
        case "get": {
          const p = await readSpeakerProfile(ctx.notesPath);
          if (!p) return ctx.textResponse(`no speaker profile yet (run action:init or manage_profile update_section)`);
          const content = await readFile(join(ctx.notesPath, SPEAKER_PROFILE_PATH), "utf-8");
          return ctx.textResponse(JSON.stringify({ path: p.path, head: p.head, content }, null, 2));
        }
        case "update_section": {
          if (!section || !text) return ctx.textResponse("manage_profile update_section requires `section` and `text`");
          const r = await updateProfileSection(ctx.notesPath, section, text, mode ?? "append");
          await ctx.sessions.recordNotesTouched([r.path]).catch(() => {});
          return ctx.textResponse(JSON.stringify(r, null, 2));
        }
      }
    }
  );
}
