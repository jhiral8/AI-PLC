/**
 * @coreflow/constraints
 *
 * Constraint-aware requirements: compile a component manifest, check requirement
 * text against constraint rules, and match features to existing components.
 * Ported from AI-PM `coreflow/packages/core/src/services/constraints`.
 */

export {
  constraintRules,
  type ConstraintRule,
  type ConstraintManifest,
  type ConstraintCondition,
  type ConstraintSeverity,
  type ConstraintCategory,
  type ConstraintSuggestion,
  type TriggerPattern,
  type ConstraintViolation,
  type ViolationLocation,
  ConstraintRuleSchema,
  ConstraintManifestSchema,
  ConstraintViolationSchema,
  BUILT_IN_RULES,
  createRule,
  keywordTrigger,
  regexTrigger,
  validateRule,
  validateManifest,
} from "./constraint-rules";

export {
  manifestCompiler,
  type ComponentManifest,
  type ProjectManifest,
  type PropDefinition,
  type ComponentLimitation,
  type CompilerOptions,
  ComponentManifestSchema,
  ProjectManifestSchema,
} from "./manifest-compiler";

export {
  textAnalyzer,
  type AnalysisResult,
  type AnalyzerOptions,
  analyzeText,
  analyzeIncremental,
  hasViolations,
  clearPatternCache,
} from "./text-analyzer";

export {
  featureMatcher,
  type FeatureMatchInput,
  type FeatureMatch,
  type FeatureMatchResult,
  matchFeature,
  matchFeatures,
  quickMatch,
} from "./feature-matcher";

export { setLLMClient, type LLMClient, type LLMMessage, type LLMOptions } from "./lib/llm";
