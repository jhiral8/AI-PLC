/**
 * @coreflow/gates
 *
 * Lifecycle gate checks over the trace graph.
 */

export type { CheckResult, Severity } from "./types";
export {
  EvidenceQualityConfig,
  checkEvidenceQuality,
  measureEvidence,
  type EvidenceMetrics,
  type InsightSample,
} from "./evidence-quality";
export {
  GateDefinition,
  evaluateGate,
  type Approval,
  type GateContext,
  type GateDefinitionInput,
  type GateResult,
} from "./gate";
