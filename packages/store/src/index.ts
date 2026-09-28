/**
 * @coreflow/store
 *
 * Keeps a repository's trace graph in step with its files: Markdown definitions, code and
 * test file nodes, `.coreflow/traces.json`, and what agents are working on.
 */

export { listTemplates, newArtifact, nextArtifactId, type NewArtifactOptions } from "./artifacts";
export { CoreflowConfig, DEFAULT_FILE_TYPES, DEFAULT_PREFIXES, type CoreflowConfigInput } from "./config";
export {
  approveGate,
  findGate,
  readApprovals,
  runGate,
  runGates,
  stageItems,
  type ApprovalRecord,
  type GateReport,
} from "./gates";
export { extractCitations, extractDefinitions, ID_PATTERN, slugify, typeForId, type MarkdownDefinition } from "./markdown";
export { COREFLOW_DIR, fileHash, Project, type EditResult, type ScanResult } from "./project";
export { formatGate, formatScan, formatSuspects, formatTrace } from "./report";
export { renderTemplate, TEMPLATES, type Template } from "./templates";
