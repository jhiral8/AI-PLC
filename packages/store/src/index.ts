/**
 * @coreflow/store
 *
 * Keeps a repository's trace graph in step with its files: Markdown definitions, code and
 * test file nodes, `.coreflow/traces.json`, and what agents are working on.
 */

export { CoreflowConfig, DEFAULT_PREFIXES } from "./config";
export { extractDefinitions, ID_PATTERN, typeForId, type MarkdownDefinition } from "./markdown";
export { COREFLOW_DIR, Project, type EditResult, type ScanResult } from "./project";
export { formatScan, formatSuspects, formatTrace } from "./report";
