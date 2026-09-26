/**
 * @file Feature to Component Matcher
 * @module @coreflow/core/services/constraints/feature-matcher
 * @description
 * Uses LLM to intelligently match feature descriptions to components.
 * Identifies when a requested feature might conflict with component capabilities.
 * 
 * Per spec Phase 5: US2 - Constraint-Aware PRD Drafting (T073)
 */

import { z } from "zod";
import { generateJSON, type LLMMessage } from "./lib/llm";
import type { ComponentManifest } from "./manifest-compiler";
import type { ConstraintRule, ConstraintViolation } from "./constraint-rules";
import { logger } from "./lib/logger";

// ============================================================================
// Types
// ============================================================================

export interface FeatureMatchInput {
  /** The feature description from the PRD */
  featureText: string;
  /** Available components to match against */
  components: ComponentManifest[];
  /** Existing constraint rules */
  rules: ConstraintRule[];
  /** Context from the PRD (surrounding text) */
  context?: string;
}

export interface FeatureMatch {
  /** The component that might be used */
  componentId: string;
  componentName: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Why this component was matched */
  reasoning: string;
  /** Potential conflicts/constraints */
  potentialIssues: Array<{
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
}

export interface FeatureMatchResult {
  /** Original feature text */
  feature: string;
  /** Matched components */
  matches: FeatureMatch[];
  /** Generated constraint violations */
  violations: ConstraintViolation[];
  /** Whether any blocking issues were found */
  hasBlockingIssues: boolean;
  /** Processing time in ms */
  processingTimeMs: number;
}

// ============================================================================
// LLM Response Schemas
// ============================================================================

const FeatureAnalysisSchema = z.object({
  featureType: z.enum([
    "data_display",
    "data_input",
    "navigation",
    "interaction",
    "layout",
    "visualization",
    "communication",
    "media",
    "utility",
    "unknown",
  ]),
  keywords: z.array(z.string()),
  impliedCapabilities: z.array(z.string()),
  potentialComponents: z.array(
    z.object({
      componentName: z.string(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    })
  ),
});

const ConstraintCheckSchema = z.object({
  hasConflict: z.boolean(),
  conflicts: z.array(
    z.object({
      componentName: z.string(),
      issue: z.string(),
      severity: z.enum(["error", "warning", "info"]),
      suggestion: z.string(),
    })
  ),
});

// ============================================================================
// Prompts
// ============================================================================

const FEATURE_ANALYSIS_PROMPT = `You are a technical analyst helping match feature requirements to UI components.

Given a feature description from a PRD, analyze what type of feature it is and what UI components might be needed.

Feature description:
"""
{feature}
"""

Context (surrounding text):
"""
{context}
"""

Available components in the system:
{componentList}

Respond with:
1. featureType: The category of this feature
2. keywords: Key technical terms that describe this feature
3. impliedCapabilities: What technical capabilities this feature requires (e.g., "infinite scroll", "real-time updates", "drag and drop")
4. potentialComponents: List of components that might be used, with confidence (0-1) and reasoning`;

const CONSTRAINT_CHECK_PROMPT = `You are a technical constraint validator. Check if a feature requirement conflicts with known component limitations.

Feature requirement:
"""
{feature}
"""

Implied capabilities needed:
{capabilities}

Matched component: {componentName}
Component limitations:
{limitations}

Component capabilities:
- Supports Infinite Scroll: {supportsInfiniteScroll}
- Supports Pagination: {supportsPagination}
- Supports Virtualization: {supportsVirtualization}
- Supports Offline: {supportsOffline}
- Supports Real-Time: {supportsRealTime}

Check if there are any conflicts between what the feature needs and what the component supports.
Provide specific suggestions for alternatives if conflicts exist.`;

// ============================================================================
// Matcher Functions
// ============================================================================

/**
 * Analyze a feature description and identify potential component matches
 */
async function analyzeFeature(
  featureText: string,
  components: ComponentManifest[],
  context: string = ""
): Promise<z.infer<typeof FeatureAnalysisSchema>> {
  const componentList = components
    .map(
      (c) =>
        `- ${c.displayName || c.name}: ${c.description || "No description"} (supports: ${
          [
            c.supportsPagination && "pagination",
            c.supportsInfiniteScroll && "infinite scroll",
            c.supportsVirtualization && "virtualization",
            c.supportsRealTime && "real-time",
            c.supportsOffline && "offline",
          ]
            .filter(Boolean)
            .join(", ") || "basic rendering"
        })`
    )
    .join("\n");

  const prompt = FEATURE_ANALYSIS_PROMPT.replace("{feature}", featureText)
    .replace("{context}", context || "No additional context")
    .replace("{componentList}", componentList);

  const messages: LLMMessage[] = [
    { role: "system", content: "You are a technical analyst. Respond with valid JSON only." },
    { role: "user", content: prompt }
  ];

  const response = await generateJSON<z.infer<typeof FeatureAnalysisSchema>>(messages);
  return FeatureAnalysisSchema.parse(response);
}

/**
 * Check if a feature conflicts with a component's capabilities
 */
async function checkConstraints(
  featureText: string,
  capabilities: string[],
  component: ComponentManifest
): Promise<z.infer<typeof ConstraintCheckSchema>> {
  const limitations = component.limitations
    .map((l) => `- ${l.type}: ${l.description}`)
    .join("\n") || "No documented limitations";

  const prompt = CONSTRAINT_CHECK_PROMPT.replace("{feature}", featureText)
    .replace("{capabilities}", capabilities.join(", "))
    .replace("{componentName}", component.displayName || component.name)
    .replace("{limitations}", limitations)
    .replace("{supportsInfiniteScroll}", String(component.supportsInfiniteScroll))
    .replace("{supportsPagination}", String(component.supportsPagination))
    .replace("{supportsVirtualization}", String(component.supportsVirtualization))
    .replace("{supportsOffline}", String(component.supportsOffline))
    .replace("{supportsRealTime}", String(component.supportsRealTime));

  const messages: LLMMessage[] = [
    { role: "system", content: "You are a technical constraint validator. Respond with valid JSON only." },
    { role: "user", content: prompt }
  ];

  const response = await generateJSON<z.infer<typeof ConstraintCheckSchema>>(messages);
  return ConstraintCheckSchema.parse(response);
}

/**
 * Match a feature to components and identify constraints
 */
export async function matchFeature(
  input: FeatureMatchInput
): Promise<FeatureMatchResult> {
  const startTime = performance.now();
  const { featureText, components, context } = input;

  logger.info({ feature: featureText.slice(0, 100) }, "Matching feature to components");

  const matches: FeatureMatch[] = [];
  const violations: ConstraintViolation[] = [];
  let hasBlockingIssues = false;

  try {
    // Step 1: Analyze the feature
    const analysis = await analyzeFeature(featureText, components, context);

    // Step 2: For each potential component, check constraints
    for (const potential of analysis.potentialComponents.slice(0, 3)) {
      const component = components.find(
        (c) =>
          c.name.toLowerCase() === potential.componentName.toLowerCase() ||
          c.displayName?.toLowerCase() === potential.componentName.toLowerCase()
      );

      if (!component) continue;

      // Check constraints
      const constraintCheck = await checkConstraints(
        featureText,
        analysis.impliedCapabilities,
        component
      );

      const match: FeatureMatch = {
        componentId: component.id,
        componentName: component.displayName || component.name,
        confidence: potential.confidence,
        reasoning: potential.reasoning,
        potentialIssues: constraintCheck.conflicts.map((c) => ({
          issue: c.issue,
          severity: c.severity,
          suggestion: c.suggestion,
        })),
      };

      matches.push(match);

      // Generate violations for conflicts
      if (constraintCheck.hasConflict) {
        for (const conflict of constraintCheck.conflicts) {
          if (conflict.severity === "error") {
            hasBlockingIssues = true;
          }

          violations.push({
            id: `match-${component.id}-${Date.now()}`,
            ruleId: `dynamic-${component.id}`,
            ruleName: `${component.displayName || component.name}: Feature Conflict`,
            severity: conflict.severity,
            category: "technical_debt",
            locations: [
              {
                start: 0,
                end: featureText.length,
                matchedText: featureText,
              },
            ],
            message: conflict.issue,
            explanation: conflict.suggestion,
            suggestions: [
              {
                label: "Alternative Approach",
                description: conflict.suggestion,
                recommended: true,
              },
            ],
            detectedAt: new Date(),
          });
        }
      }
    }
  } catch (error) {
    logger.error({ error }, "Feature matching failed");
    // Return empty results on error rather than throwing
  }

  const processingTimeMs = performance.now() - startTime;

  logger.info(
    {
      feature: featureText.slice(0, 50),
      matchCount: matches.length,
      violationCount: violations.length,
      processingTimeMs,
    },
    "Feature matching complete"
  );

  return {
    feature: featureText,
    matches,
    violations,
    hasBlockingIssues,
    processingTimeMs,
  };
}

/**
 * Batch match multiple features (more efficient for large PRDs)
 */
export async function matchFeatures(
  features: string[],
  components: ComponentManifest[],
  rules: ConstraintRule[]
): Promise<FeatureMatchResult[]> {
  const results: FeatureMatchResult[] = [];

  // Process in parallel with concurrency limit
  const concurrencyLimit = 3;
  for (let i = 0; i < features.length; i += concurrencyLimit) {
    const batch = features.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.all(
      batch.map((feature) =>
        matchFeature({
          featureText: feature,
          components,
          rules,
        })
      )
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Quick keyword-based matching (no LLM, for fast feedback)
 * Use this for real-time typing feedback, fall back to LLM for detailed analysis
 */
export function quickMatch(
  featureText: string,
  components: ComponentManifest[]
): FeatureMatch[] {
  const text = featureText.toLowerCase();
  const matches: FeatureMatch[] = [];

  // Keywords that suggest specific features
  const featureKeywords: Record<string, string[]> = {
    infiniteScroll: ["infinite scroll", "endless scroll", "infinite loading", "load more"],
    pagination: ["pagination", "page", "paged", "pages"],
    realTime: ["real-time", "realtime", "live", "instant", "immediate"],
    offline: ["offline", "offline mode", "works offline"],
    virtualization: ["virtual", "virtualized", "windowed"],
    dragDrop: ["drag", "drop", "drag and drop", "reorder", "sortable"],
    search: ["search", "filter", "find", "lookup"],
    export: ["export", "download", "csv", "excel", "pdf export"],
  };

  // Check each component
  for (const component of components) {
    let matchReason = "";
    let confidence = 0;

    // Check for infinite scroll mentions when component doesn't support it
    if (
      featureKeywords.infiniteScroll?.some((kw) => text.includes(kw)) &&
      !component.supportsInfiniteScroll
    ) {
      matchReason = "Feature requires infinite scroll but component uses pagination";
      confidence = 0.8;
    }

    // Check for real-time mentions
    if (
      featureKeywords.realTime?.some((kw) => text.includes(kw)) &&
      !component.supportsRealTime
    ) {
      matchReason = "Feature requires real-time updates but component doesn't support it";
      confidence = 0.7;
    }

    // Check for offline mentions
    if (
      featureKeywords.offline?.some((kw) => text.includes(kw)) &&
      !component.supportsOffline
    ) {
      matchReason = "Feature requires offline support but component doesn't support it";
      confidence = 0.7;
    }

    if (confidence > 0) {
      matches.push({
        componentId: component.id,
        componentName: component.displayName || component.name,
        confidence,
        reasoning: matchReason,
        potentialIssues: [
          {
            issue: matchReason,
            severity: "warning",
            suggestion: `Consider using a different approach or component that supports this feature`,
          },
        ],
      });
    }
  }

  return matches;
}

// ============================================================================
// Export
// ============================================================================

export const featureMatcher = {
  matchFeature,
  matchFeatures,
  quickMatch,
  analyzeFeature,
  checkConstraints,
};
