/**
 * @file Manifest to Constraints Compiler
 * @module @coreflow/core/services/constraints/manifest-compiler
 * @description
 * Compiles component manifests (from scanner) into constraint rules.
 * Analyzes component capabilities, limitations, and technical debt to generate rules.
 * 
 * Per spec Phase 5: US2 - Constraint-Aware PRD Drafting (T071)
 */

import { z } from "zod";
import {
  type ConstraintRule,
  type ConstraintManifest,
  type TriggerPattern,
  createRule,
  keywordTrigger,
  BUILT_IN_RULES,
} from "./constraint-rules";
import { logger } from "./lib/logger";

// ============================================================================
// Component Manifest Types (from Scanner)
// ============================================================================

/**
 * A prop definition from a component
 */
export const PropDefinitionSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
  deprecated: z.boolean().default(false),
  deprecationReason: z.string().optional(),
});

export type PropDefinition = z.infer<typeof PropDefinitionSchema>;

/**
 * A limitation or constraint defined on a component
 */
export const ComponentLimitationSchema = z.object({
  type: z.enum([
    "performance",
    "data_limit",
    "browser_support",
    "accessibility",
    "not_supported",
    "deprecated",
    "experimental",
  ]),
  description: z.string(),
  keywords: z.array(z.string()).default([]),
  severity: z.enum(["error", "warning", "info"]).default("warning"),
  workaround: z.string().optional(),
});

export type ComponentLimitation = z.infer<typeof ComponentLimitationSchema>;

/**
 * A single component manifest from the scanner
 */
export const ComponentManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  filePath: z.string(),
  category: z.string().optional(),
  
  // Component analysis
  props: z.array(PropDefinitionSchema).default([]),
  limitations: z.array(ComponentLimitationSchema).default([]),
  
  // Technical debt markers
  todos: z.array(z.string()).default([]),
  fixmes: z.array(z.string()).default([]),
  
  // Features
  supportsInfiniteScroll: z.boolean().default(false),
  supportsPagination: z.boolean().default(true),
  supportsVirtualization: z.boolean().default(false),
  supportsOffline: z.boolean().default(false),
  supportsRealTime: z.boolean().default(false),
  
  // Accessibility
  hasAriaLabels: z.boolean().default(false),
  keyboardNavigable: z.boolean().default(false),
  
  // Dependencies
  dependencies: z.array(z.string()).default([]),
  peerDependencies: z.array(z.string()).default([]),
  
  // Metadata
  version: z.string().optional(),
  lastModified: z.date().optional(),
});

export type ComponentManifest = z.infer<typeof ComponentManifestSchema>;

/**
 * A project-wide component manifest collection
 */
export const ProjectManifestSchema = z.object({
  projectId: z.string(),
  components: z.array(ComponentManifestSchema),
  generatedAt: z.date(),
  scannerVersion: z.string().optional(),
});

export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

// ============================================================================
// Compiler Options
// ============================================================================

export interface CompilerOptions {
  /** Include built-in rules */
  includeBuiltIn?: boolean;
  /** Minimum severity to include */
  minSeverity?: "error" | "warning" | "info";
  /** Categories to include (empty = all) */
  categories?: string[];
  /** Generate rules from TODO/FIXME comments */
  includeTechDebt?: boolean;
  /** Generate accessibility constraint rules */
  includeAccessibility?: boolean;
}

const DEFAULT_OPTIONS: Required<CompilerOptions> = {
  includeBuiltIn: true,
  minSeverity: "info",
  categories: [],
  includeTechDebt: true,
  includeAccessibility: true,
};

// ============================================================================
// Compiler Functions
// ============================================================================

/**
 * Compile a component's limitations into constraint rules
 */
function compileLimitations(
  component: ComponentManifest,
  projectId: string
): ConstraintRule[] {
  const rules: ConstraintRule[] = [];

  for (const limitation of component.limitations) {
    const triggers: TriggerPattern[] = limitation.keywords.map((kw) =>
      keywordTrigger(kw)
    );

    // Add component name as a trigger if no keywords specified
    if (triggers.length === 0) {
      triggers.push(keywordTrigger(component.name));
      if (component.displayName && component.displayName !== component.name) {
        triggers.push(keywordTrigger(component.displayName));
      }
    }

    const rule = createRule({
      id: `${projectId}-${component.id}-${limitation.type}`,
      name: `${component.displayName || component.name}: ${limitation.type}`,
      description: limitation.description,
      category: mapLimitationTypeToCategory(limitation.type),
      severity: limitation.severity,
      triggers,
      message: limitation.description,
      explanation: limitation.workaround
        ? `${limitation.description}\n\nWorkaround: ${limitation.workaround}`
        : limitation.description,
      suggestions: limitation.workaround
        ? [
            {
              label: "Workaround",
              description: limitation.workaround,
              recommended: true,
            },
          ]
        : [],
      source: {
        type: "manifest",
        componentId: component.id,
        componentName: component.displayName || component.name,
        filePath: component.filePath,
      },
      tags: [limitation.type, component.category || "uncategorized"],
    });

    rules.push(rule);
  }

  return rules;
}

/**
 * Map limitation type to constraint category
 */
function mapLimitationTypeToCategory(
  type: ComponentLimitation["type"]
): ConstraintRule["category"] {
  const mapping: Record<ComponentLimitation["type"], ConstraintRule["category"]> = {
    performance: "performance",
    data_limit: "data",
    browser_support: "compatibility",
    accessibility: "accessibility",
    not_supported: "technical_debt",
    deprecated: "technical_debt",
    experimental: "technical_debt",
  };
  return mapping[type] || "technical_debt";
}

/**
 * Compile feature-based constraints (e.g., no infinite scroll support)
 */
function compileFeatureConstraints(
  component: ComponentManifest,
  projectId: string
): ConstraintRule[] {
  const rules: ConstraintRule[] = [];

  // Infinite scroll constraint
  if (!component.supportsInfiniteScroll && component.supportsPagination) {
    rules.push(
      createRule({
        id: `${projectId}-${component.id}-no-infinite-scroll`,
        name: `${component.displayName || component.name}: No Infinite Scroll`,
        description: `The ${component.displayName || component.name} component does not support infinite scroll`,
        category: "ui",
        severity: "warning",
        triggers: [
          keywordTrigger("infinite scroll", ["endless scroll", "infinite loading"]),
          keywordTrigger(component.displayName || component.name),
        ],
        message: `${component.displayName || component.name} doesn't support infinite scroll`,
        explanation: `This component uses pagination instead of infinite scroll. Consider using pagination controls or a different component that supports virtualization.`,
        suggestions: [
          {
            label: "Use Pagination",
            description: "Use built-in pagination with this component",
            recommended: true,
          },
          ...(component.supportsVirtualization
            ? [
                {
                  label: "Enable Virtualization",
                  description: "Enable virtualization for better performance with large lists",
                  recommended: false,
                },
              ]
            : []),
        ],
        source: {
          type: "manifest" as const,
          componentId: component.id,
          componentName: component.displayName || component.name,
          filePath: component.filePath,
        },
        tags: ["feature", "ui"],
      })
    );
  }

  // Real-time constraint
  if (!component.supportsRealTime) {
    rules.push(
      createRule({
        id: `${projectId}-${component.id}-no-realtime`,
        name: `${component.displayName || component.name}: No Real-Time`,
        description: `The ${component.displayName || component.name} component doesn't support real-time updates natively`,
        category: "architecture",
        severity: "info",
        triggers: [
          keywordTrigger("real-time", ["realtime", "live"]),
          keywordTrigger(component.displayName || component.name),
        ],
        message: `${component.displayName || component.name} requires manual refresh for updates`,
        suggestions: [
          {
            label: "Use Polling",
            description: "Implement periodic data refresh",
            recommended: true,
          },
          {
            label: "Wrap with Real-Time Provider",
            description: "Add WebSocket or SSE wrapper for real-time updates",
            recommended: false,
          },
        ],
        source: {
          type: "manifest" as const,
          componentId: component.id,
          componentName: component.displayName || component.name,
          filePath: component.filePath,
        },
        tags: ["feature", "architecture"],
      })
    );
  }

  return rules;
}

/**
 * Compile TODO/FIXME comments into tech debt rules
 */
function compileTechDebtRules(
  component: ComponentManifest,
  projectId: string
): ConstraintRule[] {
  const rules: ConstraintRule[] = [];

  // Combine TODOs and FIXMEs
  const techDebtItems = [
    ...component.todos.map((t) => ({ type: "TODO" as const, text: t })),
    ...component.fixmes.map((f) => ({ type: "FIXME" as const, text: f })),
  ];

  for (let i = 0; i < techDebtItems.length; i++) {
    const item = techDebtItems[i];
    if (!item) continue;
    
    // Extract keywords from the tech debt comment
    const keywords = extractKeywords(item.text);

    if (keywords.length === 0) continue;

    rules.push(
      createRule({
        id: `${projectId}-${component.id}-techdebt-${i}`,
        name: `${component.displayName || component.name}: Tech Debt`,
        description: item.text,
        category: "technical_debt",
        severity: item.type === "FIXME" ? "warning" : "info",
        triggers: keywords.map((kw) => keywordTrigger(kw)),
        message: `Technical debt: ${item.text}`,
        explanation: `This is a known issue in ${component.displayName || component.name}. ${item.text}`,
        source: {
          type: "manifest" as const,
          componentId: component.id,
          componentName: component.displayName || component.name,
          filePath: component.filePath,
        },
        tags: ["tech-debt", item.type.toLowerCase()],
      })
    );
  }

  return rules;
}

/**
 * Extract meaningful keywords from a text string
 */
function extractKeywords(text: string): string[] {
  // Remove common stop words and extract meaningful terms
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "this", "that", "these",
    "those", "it", "its", "and", "or", "but", "if", "then", "else", "when",
    "where", "why", "how", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "no", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "also", "now", "here", "there",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  // Return unique keywords, max 5
  return [...new Set(words)].slice(0, 5);
}

/**
 * Compile accessibility constraints
 */
function compileAccessibilityRules(
  component: ComponentManifest,
  projectId: string
): ConstraintRule[] {
  const rules: ConstraintRule[] = [];

  if (!component.hasAriaLabels) {
    rules.push(
      createRule({
        id: `${projectId}-${component.id}-no-aria`,
        name: `${component.displayName || component.name}: Missing ARIA`,
        description: `The ${component.displayName || component.name} component may lack proper ARIA labels`,
        category: "accessibility",
        severity: "warning",
        triggers: [keywordTrigger(component.displayName || component.name)],
        message: `${component.displayName || component.name} may need additional ARIA attributes for accessibility`,
        suggestions: [
          {
            label: "Add ARIA Labels",
            description: "Ensure proper aria-label, aria-labelledby, or aria-describedby attributes",
            recommended: true,
          },
        ],
        source: {
          type: "manifest" as const,
          componentId: component.id,
          componentName: component.displayName || component.name,
          filePath: component.filePath,
        },
        tags: ["accessibility", "a11y"],
      })
    );
  }

  if (!component.keyboardNavigable) {
    rules.push(
      createRule({
        id: `${projectId}-${component.id}-no-keyboard`,
        name: `${component.displayName || component.name}: Keyboard Navigation`,
        description: `The ${component.displayName || component.name} component may have limited keyboard navigation`,
        category: "accessibility",
        severity: "warning",
        triggers: [keywordTrigger(component.displayName || component.name)],
        message: `${component.displayName || component.name} may need keyboard navigation improvements`,
        suggestions: [
          {
            label: "Add Keyboard Support",
            description: "Implement focus management and keyboard event handlers",
            recommended: true,
          },
        ],
        source: {
          type: "manifest" as const,
          componentId: component.id,
          componentName: component.displayName || component.name,
          filePath: component.filePath,
        },
        tags: ["accessibility", "keyboard"],
      })
    );
  }

  return rules;
}

// ============================================================================
// Main Compiler
// ============================================================================

/**
 * Compile a project manifest into constraint rules
 */
export function compileManifest(
  manifest: ProjectManifest,
  options: CompilerOptions = {}
): ConstraintManifest {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const allRules: ConstraintRule[] = [];

  logger.info(
    { projectId: manifest.projectId, componentCount: manifest.components.length },
    "Compiling component manifest to constraints"
  );

  // Add built-in rules
  if (opts.includeBuiltIn) {
    allRules.push(...BUILT_IN_RULES);
  }

  // Process each component
  for (const component of manifest.components) {
    // Compile limitations
    allRules.push(...compileLimitations(component, manifest.projectId));

    // Compile feature constraints
    allRules.push(...compileFeatureConstraints(component, manifest.projectId));

    // Compile tech debt rules
    if (opts.includeTechDebt) {
      allRules.push(...compileTechDebtRules(component, manifest.projectId));
    }

    // Compile accessibility rules
    if (opts.includeAccessibility) {
      allRules.push(...compileAccessibilityRules(component, manifest.projectId));
    }
  }

  // Filter by severity
  const severityOrder = ["error", "warning", "info"];
  const minIndex = severityOrder.indexOf(opts.minSeverity);
  const filteredRules = allRules.filter((rule) => {
    const ruleIndex = severityOrder.indexOf(rule.severity);
    return ruleIndex <= minIndex;
  });

  // Filter by category if specified
  const finalRules =
    opts.categories.length > 0
      ? filteredRules.filter((rule) => opts.categories.includes(rule.category))
      : filteredRules;

  logger.info(
    { totalRules: finalRules.length },
    "Constraint compilation complete"
  );

  return {
    version: "1.0.0",
    projectId: manifest.projectId,
    rules: finalRules,
    generatedAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Compile a single component into constraint rules
 */
export function compileComponent(
  component: ComponentManifest,
  projectId: string,
  options: CompilerOptions = {}
): ConstraintRule[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rules: ConstraintRule[] = [];

  rules.push(...compileLimitations(component, projectId));
  rules.push(...compileFeatureConstraints(component, projectId));

  if (opts.includeTechDebt) {
    rules.push(...compileTechDebtRules(component, projectId));
  }

  if (opts.includeAccessibility) {
    rules.push(...compileAccessibilityRules(component, projectId));
  }

  return rules;
}

// ============================================================================
// Export
// ============================================================================

export const manifestCompiler = {
  compileManifest,
  compileComponent,
  extractKeywords,
};
