export { Indexer } from "./indexer.js";
export { Embedder } from "./embedder.js";
export { GraphBuilder } from "./graph.js";
export { VectorIndex } from "./vector.js";
export { TextSearch } from "./search-text.js";
export { NoteCrud } from "./crud.js";
export { FrontmatterManager, TagManager } from "./frontmatter.js";
export { Watcher } from "./watcher.js";
export { buildIngestChangeSet } from "./ingest.js";
export type { IngestInput, IngestPreview, IngestSource, IngestUnit } from "./ingest.js";
export { logEvent, logQuery } from "./log.js";
export type { LogEntry, LogEventInput, LogQueryOptions } from "./log.js";
export { regenDirectoryIndex, regenIndexesForPaths, INDEX_FILE, INDEX_OVERFLOW_THRESHOLD } from "./index-regen.js";
export type { IndexEntry, RegenResult } from "./index-regen.js";
export { applyPatch } from "./patch.js";
export type { ChangeSet, ApplyPatchOptions, ApplyPatchResult } from "./patch.js";
export { buildSynthesizeChangeSet, buildPromoteChangeSet } from "./synthesize.js";
export type { SynthesizeNoteInput, SynthesizePreview, PromoteInput, PromotePreview } from "./synthesize.js";
export { lintVault, formatLintReport } from "./lint.js";
export type { LintReport } from "./lint.js";
export { regenerateAgentsContract, inspectAgentsContract } from "./agents-contract.js";
export type {
  ToolSummary,
  ModeSummary,
  RegenerateContractOptions,
  RegenerateContractResult,
} from "./agents-contract.js";
export { SessionManager, deriveSessionDir, deriveProjectRoot } from "./session.js";
export type {
  SessionState,
  SessionStatus,
  VerificationRecord,
  SessionStartOptions,
  SessionFinishInput,
} from "./session.js";
export { runHealthcheck, formatDriftBanner, filterToDrift } from "./healthcheck.js";
export type {
  Tier as HealthcheckTier,
  Severity as HealthcheckSeverity,
  DriftFinding,
  HealthcheckResult,
  HealthcheckOptions,
} from "./healthcheck.js";
export { loadSchema, validateNote, installDefaultSchema } from "./schema.js";
export type { VaultSchema, LintFinding, Severity } from "./schema.js";

export type {
  IndexedDocument,
  SearchResult,
  GraphNode,
  GraphEdge,
  VaultStats,
} from "./types.js";
export { redact, redactDeep, REDACTED } from "./redact.js";
export type { RedactMode, RedactResult } from "./redact.js";
export { failureQuery, errorSignal, commandVerbs } from "./failure-query.js";
export { evaluateFailures, formatFailureEval, calibrateJudge, evaluateGate, formatGate, meetsBar } from "./failure-eval.js";
export type { FailureCase, Judgment, CaseResult, FailureEvalReport, ThresholdRow, JevJudgment, JudgeCalibration, GateRow } from "./failure-eval.js";
export { featureState, featureOn, jevAvailable, describeFeature } from "./features.js";
export { reviewSession, buildBrief, listDrafts, draftsDir } from "./skill-review.js";
export type { DraftRecord } from "./skill-review.js";
export { parseSkill, renderSkill, lintSkill, lintSkills, findSkills, SKILL_SCOPES, SKILL_STATUSES, SKILL_SECTIONS } from "./skill-schema.js";
export type { SkillLoopMeta, ParsedSkill, SkillFile, SkillFinding, SkillScope, SkillStatus } from "./skill-schema.js";
export type { Feature, FeatureState } from "./features.js";
export { askJev, jevSpendToday, jevVerdict, relevanceQuestion, failureState, JEV_BAR } from "./jev.js";
export type { JevCaller, JevQuestion, JevAnswer } from "./jev.js";
export * from "./skill-eval/index.js";
export { gateSkill, GATE_MIN_POSITIVE_RATE, GATE_MAX_FALSE_TRIGGER_RATE } from "./skill-gate.js";
export type { SkillScores, GateVerdict } from "./skill-gate.js";
