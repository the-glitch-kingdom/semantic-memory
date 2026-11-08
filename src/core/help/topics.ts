/** One source of help topics: the CLI, the MCP tool and the slash command all render these (user-help plan). */

export interface HelpTopic {
  id: string;
  title: string;
  group: string;
  aliases: string[];
  summary: string;
  steps: string[];
  commands: string[];
  verify: string;
  /** Repo-relative path of the full guide. */
  doc: string;
}

export const GROUPS = ["Getting going", "Search more", "Measure and improve", "Working modes"] as const;

const N = "--notes .documentation";

export const TOPICS: HelpTopic[] = [
  {
    id: "getting-started", title: "Get started", group: "Getting going", aliases: ["start", "install", "quickstart"],
    summary: "Install the plugin, point it at a docs folder, and run a first search.",
    steps: ["Install the plugin and restart Claude Code.", "From the project root, check the install.", "Build the index once (the MCP server does this on start), then search from the shell."],
    commands: ["semantic-memory healthcheck --fast", `semantic-memory serve --reindex ${N}`, `semantic-memory search "how do we deploy" ${N}`],
    verify: "healthcheck reports no failures and search prints ranked JSON results.",
    doc: ".documentation/quickstart/installation-guide.md",
  },
  {
    id: "healthcheck", title: "Check the install and troubleshoot", group: "Getting going", aliases: ["troubleshooting", "doctor", "check-install", "broken"],
    summary: "Verify the local install, detect drift, and apply safe fixes.",
    steps: ["From the project root, run the fast check.", "Add --fix to apply the safe fixes.", "Read the troubleshooting guide for what remains."],
    commands: ["semantic-memory healthcheck --fast", "semantic-memory healthcheck --fix"],
    verify: "a second healthcheck run reports no failures.",
    doc: ".documentation/troubleshooting/troubleshooting.md",
  },
  {
    id: "offline-install", title: "Install offline (air-gapped)", group: "Getting going", aliases: ["offline", "air-gapped", "tarball"],
    summary: "Build a self-contained tarball on a connected host and install it where there is no npm, Hugging Face or GitHub.",
    steps: ["On a connected host, build the tarball.", "Move it to the target and extract it.", "Run the installer there; --rollback undoes it."],
    commands: ["./scripts/build-offline-tarball.sh", "./install-offline.sh", "./install-offline.sh --verify"],
    verify: "install-offline.sh --verify exits 0.",
    doc: ".documentation/deployment/release-process.md",
  },
  {
    id: "updating", title: "Update semantic-memory", group: "Getting going", aliases: ["update", "upgrade", "version"],
    summary: "See the installed and latest version, update, and choose how updates are applied.",
    steps: ["Show status.", "Update.", "Set the policy to auto, nudge or off."],
    commands: ["/semantic-memory:status", "/semantic-memory:update", "/semantic-memory:policy nudge"],
    verify: "/semantic-memory:status shows the latest version.",
    doc: ".documentation/quickstart/installation-guide.md",
  },
  {
    id: "add-index", title: "Add another index", group: "Search more", aliases: ["another-index", "second-vault", "more-docs"],
    summary: "Search a second docs tree: serve it as its own vault, or add it as a federation source.",
    steps: ["For a separate server, start serve with its own --notes folder and add it to .mcp.json.", "To search it together with this vault, add it under federation.sources (see federated-search)."],
    commands: ["semantic-memory serve --notes ../other/.documentation --reindex", "semantic-memory serve --stats --notes ../other/.documentation"],
    verify: "serve --stats lists the new folder's notes.",
    doc: ".documentation/architecture/indices-and-storage.md",
  },
  {
    id: "federated-search", title: "Search across another repo's docs", group: "Search more", aliases: ["federation", "other-repo", "sibling-repos", "sources"],
    summary: "One search_hybrid call searches this vault and other docs trees and merges the results.",
    steps: ["Add a source under federation.sources in vault.schema.yml (label, path, optional weight); install-schema writes the file with the block commented out.", "Or list related_repos in .claude/hit-em-with-the-docs.json; they join with no setting here.", "Restart the server; the first build of a source runs in the background.", "Search with search_hybrid; items carry a source field."],
    commands: ["semantic-memory install-schema --notes .documentation", "search_hybrid {query: \"...\"}"],
    verify: "search_hybrid results include items whose source is your label.",
    doc: ".documentation/operational/federation-guide.md",
  },
  {
    id: "hewtd-search", title: "Use semantic search inside hit-em-with-the-docs reconcile", group: "Search more", aliases: ["reconcile-search", "hit-em-with-the-docs", "hewtd"],
    summary: "Make hewtd reconcile rank docs by meaning: its search_command runs semantic-memory search --paths.",
    steps: ["Build the index once.", "Check the search prints one doc path per line.", "Put it in .claude/hit-em-with-the-docs.json as reconcile.search_command, with {query} where the question goes (hewtd splits it on spaces, runs it without a shell and keeps lines that are indexed docs).", "Run hewtd reconcile --overview \"<question>\"; members listed via search came from your command."],
    commands: [`semantic-memory serve --reindex ${N}`, `semantic-memory search ${N} --paths "how do we deploy"`, `{"reconcile": {"search_command": "npx semantic-memory search --notes .documentation --paths {query}"}}`, `npx hewtd reconcile --overview "how do we deploy"`],
    verify: "the search prints doc paths relative to the docs folder, one per line; reconcile --overview lists docs that share no words with the question. If the command fails hewtd warns and uses its own ranking.",
    doc: ".documentation/reference/cli-reference.md",
  },
  {
    id: "section-results", title: "Section results", group: "Search more", aliases: ["sections", "granularity", "anchors"],
    summary: "Results point at the best section of a doc (section, anchor, code refs); granularity=doc returns whole docs.",
    steps: ["Call search_hybrid with granularity section (default) or doc.", "Use the anchor to link straight to the passage."],
    commands: ["search_hybrid {query, granularity: \"doc\"}"],
    verify: "section results carry section and anchor; doc results do not.",
    doc: ".documentation/changelog/v1-17-0-section-results.md",
  },
  {
    id: "query-routing", title: "Query routing and mode", group: "Search more", aliases: ["mode", "identifier", "fact", "flow", "query-type"],
    summary: "search_hybrid labels each query identifier, fact or flow (mode auto) and can be forced.",
    steps: ["Leave mode auto, or pass identifier, fact or flow to force one.", "Read the query-type label on the results."],
    commands: ["search_hybrid {query, mode: \"identifier\"}"],
    verify: "results carry the query type that was used.",
    doc: ".documentation/changelog/v1-18-0-query-routing.md",
  },
  {
    id: "eval", title: "Measure search on my docs", group: "Measure and improve", aliases: ["measure", "floors", "baseline", "retrieval-eval"],
    summary: "Score retrieval on a question set, hold a baseline, and fail on regressions.",
    steps: ["Build the index (eval refuses to run without one).", "Generate questions from your docs (this calls the host agent, claude, and costs a few cents).", "Run the eval.", "Save a baseline, then use --check to gate changes; it exits 1 without a baseline."],
    commands: [`semantic-memory serve --reindex ${N}`, `semantic-memory eval generate ${N}`, `semantic-memory eval ${N}`, `semantic-memory eval ${N} --baseline`, `semantic-memory eval ${N} --check`],
    verify: "eval prints answered @1/@3/@8 per arm and --check exits 0.",
    doc: ".documentation/operational/retrieval-eval-guide.md",
  },
  {
    id: "gaps", title: "See what my docs fail to answer", group: "Measure and improve", aliases: ["unanswered", "usage-set", "handoff-hewtd"],
    summary: "List the queries that found nothing good, and hand the report to hit-em-with-the-docs.",
    steps: ["Let the usage-capture hook log a few sessions, then run gaps.", "Write the report as JSON and give it to hewtd.", "Turn real usage into an eval set with usage-set."],
    commands: ["semantic-memory gaps --root .", "semantic-memory gaps --root . --json > gaps.json", "npx hewtd reconcile --gaps gaps.json", "semantic-memory usage-set --root ."],
    verify: "gaps prints suggestions (new doc, or a symptoms.user_phrase to add); with no usage yet it prints an empty list, and reconcile --gaps says 0 proposals.",
    doc: ".documentation/operational/search-gaps-guide.md",
  },
  {
    id: "embedder", title: "Use a different embedder", group: "Measure and improve", aliases: ["embedders", "pooling", "query-prompt", "model"],
    summary: "Change the embedding model, its pooling (cls or mean) and its query prompt, then rebuild the index.",
    steps: ["Start serve with --reindex and --model, plus --pooling or --query-prompt if the model needs them; an index built with other settings is refused until rebuilt.", "Re-run the eval to compare."],
    commands: ["semantic-memory serve --model <hf-model-id> --pooling cls --reindex"],
    verify: "serve --stats shows the new model; the eval score is no worse.",
    doc: ".documentation/legacy/embedder-guide.md",
  },
  {
    id: "decay", title: "Make decay use git dates", group: "Measure and improve", aliases: ["decay-git", "git-dates", "stale", "last-verified"],
    summary: "Notes without last_verified take their age from git history (the default); inspect how any note decays.",
    steps: ["Check decay.missing_last_verified in vault.schema.yml: git (default), mtime, penalty or fresh. After changing it, re-run serve --reindex.", "Inspect the effective config and one note's trace. A note edited since its last commit gets the flat penalty until committed."],
    commands: ["semantic-memory decay-config", "semantic-memory decay-trace <notePath>"],
    verify: "decay-trace reports source git and an age for a committed note with no last_verified.",
    doc: ".documentation/operational/decay-guide.md",
  },
  {
    id: "code-graph", title: "Code graph and grounding", group: "Measure and improve", aliases: ["grounding", "code", "drift", "entity-card"],
    summary: "Docs are linked to the code symbols they name, so results can show code refs and drift.",
    steps: ["Index a vault that sits in a git repo.", "Search for a symbol name; read the code refs on each result."],
    commands: [`semantic-memory search "<symbol name>" ${N}`],
    verify: "results for a symbol name carry code refs.",
    doc: ".documentation/architecture/code-graph.md",
  },
  {
    id: "modes", title: "Modes: vault-first, research, outage-silence", group: "Working modes", aliases: ["vault-first", "research", "outage-silence"],
    summary: "The active mode decides how eagerly Claude consults the vault; an explicit choice sticks.",
    steps: ["Query the mode.", "Set one explicitly."],
    commands: ["/semantic-memory:mode", "/semantic-memory:mode research"],
    verify: "/semantic-memory:mode reports the mode you set.",
    doc: ".documentation/operational/modes-guide.md",
  },
];

export type HelpFormat = "text" | "markdown";

const STOP = new Set(["a", "an", "the", "to", "how", "do", "i", "my", "on", "in", "for", "of", "and", "or", "with", "use", "me", "what", "is", "can", "search", "doc", "docs"]);

const tokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));

/** Exact id or alias wins; else score by shared words (id/alias 3, title 1). Ties return several topics. */
export function findTopics(words: string): HelpTopic[] {
  const q = tokens(words).filter((w) => !STOP.has(w));
  if (!q.length) return [];
  const joined = q.join("-");
  const exact = TOPICS.find((t) => t.id === joined || t.aliases.includes(joined));
  if (exact) return [exact];
  const scored = TOPICS.map((t) => {
    const names = new Set([t.id, ...t.aliases].flatMap(tokens));
    const title = new Set(tokens(t.title));
    return { t, s: q.reduce((n, w) => n + (names.has(w) ? 3 : title.has(w) ? 1 : 0), 0) };
  }).filter((x) => x.s > 0);
  const top = Math.max(0, ...scored.map((x) => x.s));
  return scored.filter((x) => x.s === top).map((x) => x.t);
}

const md = (f: HelpFormat) => f === "markdown";

export function renderTopic(t: HelpTopic, f: HelpFormat): string {
  const h = (s: string) => (md(f) ? `## ${s}` : s.toUpperCase());
  const cmds = t.commands.map((c) => (md(f) ? `    ${c}` : `  ${c}`)).join("\n");
  return [
    md(f) ? `# ${t.title}` : t.title,
    t.summary, "",
    h("Steps"), ...t.steps.map((s, i) => `${i + 1}. ${s}`), "",
    h("Commands"), cmds, "",
    h("Check it worked"), t.verify, "",
    md(f) ? `Full guide: [${t.doc}](${t.doc})` : `Full guide: ${t.doc}`,
  ].join("\n");
}

export function renderIndex(f: HelpFormat): string {
  const lines = [md(f) ? "# semantic-memory help" : "semantic-memory help", "", 'Ask for a topic by id or words, e.g. "help federated search".', ""];
  for (const g of GROUPS) {
    lines.push(md(f) ? `## ${g}` : g);
    for (const t of TOPICS.filter((x) => x.group === g)) lines.push(md(f) ? `- \`${t.id}\`: ${t.title}` : `  ${t.id.padEnd(18)} ${t.title}`);
    lines.push("");
  }
  lines.push("What would you like to do?");
  return lines.join("\n");
}

/** No words: the grouped list. One match: that topic. Several or none: say so and list the candidates (or everything). */
export function renderHelp(words: string | undefined, f: HelpFormat): string {
  if (!words?.trim()) return renderIndex(f);
  const hits = findTopics(words);
  if (hits.length === 1) return renderTopic(hits[0], f);
  if (!hits.length) return `No help topic matches "${words}".\n\n${renderIndex(f)}`;
  const list = hits.map((t) => (md(f) ? `- \`${t.id}\`: ${t.title}` : `  ${t.id.padEnd(18)} ${t.title}`)).join("\n");
  return `"${words}" matches more than one topic:\n\n${list}`;
}
