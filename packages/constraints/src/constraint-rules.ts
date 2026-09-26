/**
 * @file Constraint Rules DSL
 * @module @coreflow/core/services/constraints/constraint-rules
 * @description
 * Domain-specific language for defining technical constraints.
 * Rules are compiled from component manifests and can be evaluated against PRD content.
 * 
 * Per spec Phase 5: US2 - Constraint-Aware PRD Drafting (T070)
 */

import { z } from "zod";

// ============================================================================
// Constraint Rule Schema (DSL)
// ============================================================================

/**
 * Condition operators for constraint rules
 */
export const ConditionOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "matches_regex",
  "greater_than",
  "less_than",
  "in_list",
  "not_in_list",
  "exists",
  "not_exists",
]);

export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

/**
 * A single condition in a constraint rule
 */
export const ConstraintConditionSchema = z.object({
  /** The field or path to evaluate */
  field: z.string(),
  /** The operator to use */
  operator: ConditionOperatorSchema,
  /** The value to compare against (optional for exists/not_exists) */
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  /** Case sensitivity for string comparisons */
  caseSensitive: z.boolean().default(false),
});

export type ConstraintCondition = z.infer<typeof ConstraintConditionSchema>;

/**
 * Severity levels for constraint violations
 */
export const ConstraintSeveritySchema = z.enum([
  "error",    // Must be fixed, blocks generation
  "warning",  // Should be fixed, doesn't block
  "info",     // Informational only
]);

export type ConstraintSeverity = z.infer<typeof ConstraintSeveritySchema>;

/**
 * Categories of constraints
 */
export const ConstraintCategorySchema = z.enum([
  "performance",       // Performance limitations
  "compatibility",     // Browser/device compatibility
  "accessibility",     // A11y requirements
  "security",          // Security constraints
  "data",              // Data handling limits
  "ui",                // UI/UX limitations
  "integration",       // Third-party integration limits
  "technical_debt",    // Known technical debt issues
  "dependency",        // Dependency constraints
  "architecture",      // Architectural constraints
]);

export type ConstraintCategory = z.infer<typeof ConstraintCategorySchema>;

/**
 * A suggestion for addressing a constraint violation
 */
export const ConstraintSuggestionSchema = z.object({
  /** Short label for the suggestion */
  label: z.string(),
  /** Detailed description of the alternative */
  description: z.string(),
  /** Whether this is the recommended option */
  recommended: z.boolean().default(false),
  /** Example implementation or usage */
  example: z.string().optional(),
});

export type ConstraintSuggestion = z.infer<typeof ConstraintSuggestionSchema>;

/**
 * Keywords or phrases that trigger this constraint
 */
export const TriggerPatternSchema = z.object({
  /** The keyword or phrase to match */
  pattern: z.string(),
  /** Whether to use regex matching */
  isRegex: z.boolean().default(false),
  /** Word boundary matching */
  wholeWord: z.boolean().default(true),
  /** Case sensitivity */
  caseSensitive: z.boolean().default(false),
  /** Synonyms that should also trigger this rule */
  synonyms: z.array(z.string()).default([]),
});

export type TriggerPattern = z.infer<typeof TriggerPatternSchema>;

/**
 * A complete constraint rule
 */
export const ConstraintRuleSchema = z.object({
  /** Unique identifier for the rule */
  id: z.string(),
  /** Human-readable name */
  name: z.string(),
  /** Detailed description of the constraint */
  description: z.string(),
  
  /** Rule category */
  category: ConstraintCategorySchema,
  /** Violation severity */
  severity: ConstraintSeveritySchema,
  
  /** Patterns that trigger this constraint check */
  triggers: z.array(TriggerPatternSchema).min(1),
  
  /** Conditions that must be met for the constraint to apply */
  conditions: z.array(ConstraintConditionSchema).default([]),
  
  /** The error/warning message to display */
  message: z.string(),
  /** Detailed explanation shown in tooltip/popup */
  explanation: z.string().optional(),
  
  /** Alternative suggestions when constraint is violated */
  suggestions: z.array(ConstraintSuggestionSchema).default([]),
  
  /** Source of this constraint (component manifest, manual, etc.) */
  source: z.object({
    type: z.enum(["manifest", "manual", "learned"]),
    componentId: z.string().optional(),
    componentName: z.string().optional(),
    filePath: z.string().optional(),
  }),
  
  /** Whether this rule is currently active */
  enabled: z.boolean().default(true),
  
  /** Tags for filtering/grouping */
  tags: z.array(z.string()).default([]),
  
  /** Creation/update timestamps */
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type ConstraintRule = z.infer<typeof ConstraintRuleSchema>;

/**
 * A constraint manifest containing multiple rules
 */
export const ConstraintManifestSchema = z.object({
  /** Version of the constraint manifest schema */
  version: z.string().default("1.0.0"),
  /** Project identifier */
  projectId: z.string(),
  /** Rules in this manifest */
  rules: z.array(ConstraintRuleSchema),
  /** When the manifest was generated */
  generatedAt: z.date().optional(),
  /** Last update timestamp */
  updatedAt: z.date().optional(),
});

export type ConstraintManifest = z.infer<typeof ConstraintManifestSchema>;

// ============================================================================
// Constraint Violation (Result of evaluation)
// ============================================================================

/**
 * Position in the document where a violation was found
 */
export const ViolationLocationSchema = z.object({
  /** Starting character offset */
  start: z.number(),
  /** Ending character offset */
  end: z.number(),
  /** Line number (1-indexed) */
  line: z.number().optional(),
  /** Column number (1-indexed) */
  column: z.number().optional(),
  /** The matched text that triggered the violation */
  matchedText: z.string(),
});

export type ViolationLocation = z.infer<typeof ViolationLocationSchema>;

/**
 * A constraint violation found during analysis
 */
export const ConstraintViolationSchema = z.object({
  /** Unique ID for this violation instance */
  id: z.string(),
  /** The rule that was violated */
  ruleId: z.string(),
  /** Rule name for display */
  ruleName: z.string(),
  /** Violation severity */
  severity: ConstraintSeveritySchema,
  /** Category of the constraint */
  category: ConstraintCategorySchema,
  /** Location(s) in the document */
  locations: z.array(ViolationLocationSchema).min(1),
  /** The message to display */
  message: z.string(),
  /** Detailed explanation */
  explanation: z.string().optional(),
  /** Suggested alternatives */
  suggestions: z.array(ConstraintSuggestionSchema).default([]),
  /** When the violation was detected */
  detectedAt: z.date(),
});

export type ConstraintViolation = z.infer<typeof ConstraintViolationSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a new constraint rule with defaults
 */
export function createRule(
  partial: Partial<ConstraintRule> & {
    id: string;
    name: string;
    description: string;
    triggers: TriggerPattern[];
    message: string;
    source: ConstraintRule["source"];
  }
): ConstraintRule {
  return ConstraintRuleSchema.parse({
    category: "technical_debt",
    severity: "warning",
    conditions: [],
    suggestions: [],
    enabled: true,
    tags: [],
    ...partial,
  });
}

/**
 * Create a trigger pattern from a simple keyword
 */
export function keywordTrigger(keyword: string, synonyms: string[] = []): TriggerPattern {
  return TriggerPatternSchema.parse({
    pattern: keyword,
    isRegex: false,
    wholeWord: true,
    caseSensitive: false,
    synonyms,
  });
}

/**
 * Create a trigger pattern from a regex
 */
export function regexTrigger(pattern: string): TriggerPattern {
  return TriggerPatternSchema.parse({
    pattern,
    isRegex: true,
    wholeWord: false,
    caseSensitive: false,
    synonyms: [],
  });
}

/**
 * Validate a constraint rule
 */
export function validateRule(rule: unknown): { valid: boolean; errors?: string[] } {
  const result = ConstraintRuleSchema.safeParse(rule);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}

/**
 * Validate a constraint manifest
 */
export function validateManifest(manifest: unknown): { valid: boolean; errors?: string[] } {
  const result = ConstraintManifestSchema.safeParse(manifest);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}

// ============================================================================
// Example Rules (Built-in defaults)
// ============================================================================

/**
 * Built-in constraint rules for common scenarios
 */
export const BUILT_IN_RULES: ConstraintRule[] = [
  createRule({
    id: "builtin-infinite-scroll-table",
    name: "Infinite Scroll in Tables",
    description: "Tables may not support native infinite scroll without pagination",
    category: "ui",
    severity: "warning",
    triggers: [
      keywordTrigger("infinite scroll", ["endless scroll", "infinite loading"]),
      keywordTrigger("lazy load", ["lazy loading"]),
    ],
    message: "Infinite scroll may require pagination for large datasets in tables",
    explanation: "HTML tables don't natively support infinite scroll. Consider using virtualized lists or pagination for better performance with large datasets.",
    suggestions: [
      {
        label: "Use Pagination",
        description: "Implement traditional pagination with page numbers",
        recommended: true,
        example: "Show 25 items per page with Previous/Next navigation",
      },
      {
        label: "Use Virtual Scrolling",
        description: "Implement windowed rendering for long lists",
        recommended: false,
        example: "Use react-window or @tanstack/virtual for virtualized rendering",
      },
    ],
    source: { type: "manual" },
    tags: ["performance", "ux"],
  }),
  
  createRule({
    id: "builtin-real-time-updates",
    name: "Real-Time Updates",
    description: "Real-time features require WebSocket or SSE infrastructure",
    category: "architecture",
    severity: "info",
    triggers: [
      keywordTrigger("real-time", ["realtime", "real time", "live updates"]),
      keywordTrigger("instant updates", ["immediate updates"]),
    ],
    message: "Real-time updates require additional infrastructure (WebSockets/SSE)",
    explanation: "Real-time features need server-side event infrastructure. Consider polling as a simpler alternative for less critical updates.",
    suggestions: [
      {
        label: "Use Polling",
        description: "Poll the server at regular intervals",
        recommended: false,
        example: "Refresh data every 30 seconds using setInterval",
      },
      {
        label: "Use WebSockets",
        description: "Implement bidirectional real-time communication",
        recommended: true,
        example: "Use Socket.io or native WebSocket API",
      },
    ],
    source: { type: "manual" },
    tags: ["architecture", "infrastructure"],
  }),
  
  createRule({
    id: "builtin-offline-support",
    name: "Offline Support",
    description: "Offline functionality requires service workers and local storage",
    category: "architecture",
    severity: "warning",
    triggers: [
      keywordTrigger("offline", ["offline mode", "offline access"]),
      keywordTrigger("works offline", ["offline-first"]),
    ],
    message: "Offline support requires service workers and careful data synchronization",
    explanation: "Implementing offline functionality requires PWA service workers, IndexedDB for storage, and conflict resolution strategies for data sync.",
    suggestions: [
      {
        label: "Graceful Degradation",
        description: "Show cached data with offline indicator",
        recommended: true,
      },
      {
        label: "Full PWA",
        description: "Implement complete offline-first architecture",
        recommended: false,
      },
    ],
    source: { type: "manual" },
    tags: ["pwa", "architecture"],
  }),
];

// ============================================================================
// Export
// ============================================================================

export const constraintRules = {
  createRule,
  keywordTrigger,
  regexTrigger,
  validateRule,
  validateManifest,
  BUILT_IN_RULES,
};
