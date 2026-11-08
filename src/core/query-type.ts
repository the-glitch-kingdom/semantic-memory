import { identifiers } from "./identifiers.js";

export type QueryType = "identifier" | "fact" | "flow";

const ID_EXTRA = /^(?:[A-Z][a-z]+(?:[A-Z][a-z0-9]+){2,}|--[a-z][\w-]+|\w+\(\))$/; // PascalCase with 3+ words, --flag, name(); bare acronyms (SAML, CUDA) and SessionEnd-style product words are prose
const FLOW = /\b(?:end[- ]to[- ]end|walk(?:ing)? (?:me )?through|step[- ]by[- ]step|life ?cycle|whole life|journey|big picture|one-page summary|overview of|fit together|flow)\b|\bfrom\b[^,?]{2,40}\bto\b/i;

/**
 * Rules-first query type (#61): identifier (a name the docs or code may define; same detector as missing_terms), flow
 * (an end-to-end or several-part question) or fact. Labels only: it never changes ranking.
 * Not rules: "two wh-clauses joined by and" (train: 2 flows caught, 14 two-fact questions mislabelled) and "pipeline" (a fact
 * question about a pipeline wait); "2+ action verbs in a list" never fired on a train flow row.
 */
export function classifyQuery(query: string): QueryType {
  if (identifiers(query).length || query.split(/[\s,?]+/).some((w) => ID_EXTRA.test(w.replace(/^[`(]+|[`.:;]+$/g, "")))) return "identifier";
  return FLOW.test(query) ? "flow" : "fact";
}
