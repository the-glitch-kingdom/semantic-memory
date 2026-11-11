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
    steps: ["Install the plugin and restart Claude Code.", "From the project root, check the install.", "Build the index once (the MCP server does this on start), then search from the shell.", "A new install writes two .mcp.json entries: semantic-memory (the vault) and semantic-memory-docs (the docs folder, read-only). The older semantic-vault and semantic-sidekick names still work."],
    commands: ["semantic-memory healthcheck --fast", `semantic-memory serve --reindex ${N}`, `semantic-memory search "how do we deploy" ${N}`],
    verify: "healthcheck reports no failures and search prints ranked JSON results; the MCP tools appear under semantic-memory.",
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
    id: "index-readiness", title: "Index readiness and stale answers", group: "Getting going", aliases: ["indexing", "indexing-in-progress", "stale", "wait-for-ready", "warm-up"],
    summary: "A cold build answers \"Indexing in progress\"; a warm start answers at once but marks results stale until it has reconciled.",
    steps: ["On a cold build (no index on disk) every search tool answers \"Indexing in progress... Try again shortly\" until the docs and the code graph have both landed, so the first answer is the final one.", "On a warm start the old index answers at once, marked stale (_meta.stale and a trailing [stale: ...] text block) until the reconcile ends. Run the search again to confirm.", "For scripts and evals, start the server with serve --wait-for-ready so it answers only when ready (the client then needs a longer connect timeout).", "Check the state with the get_stats tool or serve --stats."],
    commands: [`semantic-memory serve --stats ${N}`, `semantic-memory serve --wait-for-ready ${N}`, "get_stats {}"],
    verify: "serve --stats (or get_stats) reports state ready.",
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
    steps: ["For a separate server, start serve with its own --notes folder and add it to .mcp.json.", "To search it together with this vault, add it under federation.sources (see federated-search).", "For a rarely used frozen tree (old docs generations), do not run a second server: keep it as an opt-in source and search it only on request (see long-term-memory)."],
    commands: ["semantic-memory serve --notes ../other/.documentation --reindex", "semantic-memory serve --stats --notes ../other/.documentation"],
    verify: "serve --stats lists the new folder's notes.",
    doc: ".documentation/architecture/indices-and-storage.md",
  },
  {
    id: "federated-search", title: "Search across another repo's docs", group: "Search more", aliases: ["federation", "other-repo", "sibling-repos", "sources"],
    summary: "One search_hybrid call searches this vault and other docs trees and merges the results.",
    steps: ["Add a source under federation.sources in vault.schema.yml (label, path, optional weight); install-schema writes the file with the block commented out.", "Or list related_repos in .claude/hit-em-with-the-docs.json; they join with no setting here.", "Restart the server; the first build of a source runs in the background.", "Search with search_hybrid; items carry a source field.", "To keep a source out of normal searches, give it default: false (opt-in); add locked: true for a frozen tree that must never be reindexed or written to. related_repos: opt-in registers sibling repos that way.", "Search an opt-in source by naming it: sources: [\"label\"] on search_hybrid, search_semantic or search_text, or semantic-memory search --source label. Add \"primary\" to keep this vault in the call."],
    commands: ["semantic-memory install-schema --notes .documentation", "search_hybrid {query: \"...\"}", "search_hybrid {query: \"...\", sources: [\"label\"]}", `semantic-memory search "..." ${N} --source label`],
    verify: "search_hybrid results include items whose source is your label; a default: false source appears only when a call names it.",
    doc: ".documentation/operational/federation-guide.md",
  },
  {
    id: "long-term-memory", title: "Search long-term memory (old docs generations)", group: "Search more", aliases: ["long-term", "cold-storage", "documentation-cold", "legacy-docs", "opt-in", "historical"],
    summary: "Old docs generations rotated into .documentation-cold/ are opt-in: never in a default search, searched only when you ask.",
    steps: ["hit-em-with-the-docs rotates the old docs tree into .documentation-cold/<date>/ and registers it in .claude/hit-em-with-the-docs.json (cold_storage).", "The session-start notice says a generation exists (once per generation; problems show every time).", "Ask \"search long-term memory for ...\", or pass sources: [\"long-term\"] (CLI: --source long-term). The first query builds the generation's index and answers \"Indexing in progress\" until it is ready.", "Results carry source (cold-<date>) and historical; treat them as past behaviour, not current. Read one with read_note {path, source}.", "A generation is locked: it is never reindexed on its own. If it changed, the old index keeps answering with a note; rebuild on purpose with --reindex."],
    commands: [`semantic-memory search "what did we do about X" ${N} --source long-term`, "search_hybrid {query: \"...\", sources: [\"long-term\"]}", `semantic-memory search "..." ${N} --source cold-2026-11-11 --reindex`, "semantic-memory healthcheck --fast"],
    verify: "results carry source cold-<date> and historical.generation; a plain search shows none. healthcheck lists each generation as registered.",
    doc: ".documentation/operational/long-term-memory-guide.md",
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
    doc: ".documentation/reference/mcp-tools-reference.md",
  },
  {
    id: "query-routing", title: "Query routing and mode", group: "Search more", aliases: ["mode", "identifier", "fact", "flow", "query-type"],
    summary: "search_hybrid labels each query identifier, fact or flow (mode auto) and can be forced.",
    steps: ["Leave mode auto, or pass identifier, fact or flow to force one.", "Read the query-type label on the results.", "The label never changes ranking. A query naming an identifier present in the docs ranks the docs that hold it first, whatever the label (see tune-ranking)."],
    commands: ["search_hybrid {query, mode: \"identifier\"}"],
    verify: "results carry the query type that was used.",
    doc: ".documentation/operational/retrieval-tuning-guide.md",
  },
  {
    id: "weak-matches", title: "Weak matches and absent names", group: "Search more", aliases: ["missing_terms", "passing_terms", "no_strong_match", "abstention"],
    summary: "A result flags no_strong_match when the docs likely do not answer; missing_terms and passing_terms name the absent product or identifier.",
    steps: ["Read no_strong_match, missing_terms and passing_terms on the results.", "Verify before citing, or rephrase with the docs' own spelling. Hyphen, underscore and Title Case spellings count as present; hub pages a search never returns do not."],
    commands: ["search_hybrid {query}"],
    verify: "a query naming a product the docs never mention returns no_strong_match and missing_terms.",
    doc: ".documentation/operational/retrieval-tuning-guide.md",
  },
  {
    id: "eval", title: "Measure search on my docs", group: "Measure and improve", aliases: ["measure", "floors", "baseline", "retrieval-eval"],
    summary: "Score retrieval on a question set, hold a baseline, and fail on regressions.",
    steps: ["Build the index (eval refuses to run without one).", "Generate questions from your docs (this calls the host agent, claude, and costs a few cents).", "Run the eval.", "Save a baseline, then use --check to gate changes; it exits 1 without a baseline.", "To measure what an agent gets from the stdio server at once, add --via mcp (--settle scores the settled state).", "On multi-doc questions read cov@1/3/8 (the mean share of a question's facets found in the top k) and dominance (top-3 slots one doc takes on questions it does not answer; compare with the previous release, not with 3)."],
    commands: [`semantic-memory serve --reindex ${N}`, `semantic-memory eval generate ${N}`, `semantic-memory eval ${N}`, `semantic-memory eval ${N} --baseline`, `semantic-memory eval ${N} --check`],
    verify: "eval prints answered @1/@3/@8, cov@1/3/8 and dominance per arm and --check exits 0.",
    doc: ".documentation/operational/retrieval-eval-guide.md",
  },
  {
    id: "stable-results", title: "Why results are stable (or differ)", group: "Search more", aliases: ["reproducible", "limit", "same-order", "determinism"],
    summary: "The same files give the same ranking: a smaller limit is a prefix of a larger one, and two builds agree.",
    steps: ["Limits 1 to 8 return the first k of the limit 8 ranking, same order and scores; above 8 the candidate pool grows. The MCP default is 10, so a call without limit is not a prefix of limit 5.", "Two builds of the same files rank identically: below 100,000 chunks the vector search is exact.", "Decay scores are fixed for the UTC day, so near ties do not swap between calls.", "What does change a ranking: editing a doc, loading a new code graph, a new UTC day, and usage citations (a doc read after a search earns a small boost)."],
    commands: [`semantic-memory search "how do we deploy" ${N} --limit 3`, `semantic-memory search "how do we deploy" ${N} --limit 8`],
    verify: "the --limit 3 results are the first three of the --limit 8 results, in the same order with the same scores.",
    doc: ".documentation/operational/retrieval-tuning-guide.md",
  },
  {
    id: "tune-ranking", title: "Tune ranking", group: "Measure and improve", aliases: ["ranking", "rerank", "reranker", "path_class", "usage_boost", "coverage_weight", "link_prior", "clause_weight", "identifier-tier"],
    summary: "The ranking: block, the opt-in reranker, path classes, the usage boost and the identifier tier, with their measured defaults. Measure before and after.",
    steps: ["Leave the ranking: block at its defaults: coverage_weight 0, link_prior 1 and clause_weight 0 (off; clause matching lost on the held-out gate).", "The reranker (rerank.enabled) is off: about 0.7 s a search for +1 case in 35, and a 90 MB model download.", "path_class sets multipliers by glob: archive/ counts 0.3 and is excluded from the index unless path_class.exclude is emptied. usage_boost nudges docs that were read after a search.", "Docs that hold the query's identifier literally (gate-release.sh, check_widgets) rank first, whatever the query label; an identifier no doc holds changes nothing.", "Change one knob, restart with --reindex if the guide says so, and run the eval before and after (see eval)."],
    commands: ["semantic-memory decay-config", `semantic-memory eval ${N}`, `semantic-memory eval ${N} --check`],
    verify: "eval --check exits 0 after the change, and the counts you cared about did not drop.",
    doc: ".documentation/operational/retrieval-tuning-guide.md",
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
    id: "decay", title: "Make decay use git dates", group: "Measure and improve", aliases: ["decay-git", "git-dates", "last-verified"],
    summary: "Notes without last_verified take their age from git history (the default); inspect how any note decays.",
    steps: ["Check decay.missing_last_verified in vault.schema.yml: git (default), mtime, penalty or fresh. After changing it, re-run serve --reindex.", "Inspect the effective config and one note's trace. A note edited since its last commit gets the flat penalty until committed."],
    commands: ["semantic-memory decay-config", "semantic-memory decay-trace <notePath>"],
    verify: "decay-trace reports source git and an age for a committed note with no last_verified.",
    doc: ".documentation/operational/decay-guide.md",
  },
  {
    id: "code-graph", title: "Code graph and grounding", group: "Measure and improve", aliases: ["grounding", "code", "drift", "entity-card"],
    summary: "Docs are linked to the code symbols they name, so results can show code refs, drift and dead refs; only dead refs lower the rank.",
    steps: ["Index a vault that sits in a git repo.", "Search for a symbol name; read the code refs on each result.", "If a result says stale: true, the hewtd export is older than the tree; refresh it with npx hewtd index (the healthcheck code-graph-stale finding says the same)."],
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

const editDistance = (a: string, b: string): number => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};

/** Topics with a name word within about a third of a typo of a query word, nearest first (at most 3). */
export function closestTopics(words: string): HelpTopic[] {
  const q = tokens(words).filter((w) => !STOP.has(w) && w.length > 2);
  return TOPICS.map((t) => {
    const names = [t.id, ...t.aliases].flatMap(tokens);
    let d = Infinity;
    for (const w of q) for (const n of names) if (editDistance(w, n) <= Math.floor(Math.max(w.length, n.length) / 3)) d = Math.min(d, editDistance(w, n));
    return { t, d };
  }).filter((x) => x.d < Infinity).sort((a, b) => a.d - b.d).slice(0, 3).map((x) => x.t);
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
  const list = (hits.length ? hits : closestTopics(words)).map((t) => (md(f) ? `- \`${t.id}\`: ${t.title}` : `  ${t.id.padEnd(18)} ${t.title}`)).join("\n");
  if (!hits.length) return `No help topic matches "${words}".\n\n${list ? `Closest:\n\n${list}\n\n` : ""}${renderIndex(f)}`;
  return `"${words}" matches more than one topic:\n\n${list}`;
}
