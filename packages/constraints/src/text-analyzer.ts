/**
 * @file Real-Time Text Analyzer
 * @module @coreflow/core/services/constraints/text-analyzer
 * @description
 * Analyzes PRD content in real-time against constraint rules.
 * Optimized for <500ms response time as per spec requirement.
 * 
 * Per spec Phase 5: US2 - Constraint-Aware PRD Drafting (T072)
 * Independent Test: Type "Infinite Scroll", see warning within 500ms
 */

import {
  type ConstraintRule,
  type ConstraintViolation,
  type ViolationLocation,
  type TriggerPattern,
} from "./constraint-rules";
import { logger } from "./lib/logger";

// ============================================================================
// Types
// ============================================================================

export interface AnalysisResult {
  /** Violations found */
  violations: ConstraintViolation[];
  /** Analysis time in milliseconds */
  analysisTimeMs: number;
  /** Number of rules checked */
  rulesChecked: number;
  /** Number of patterns matched */
  patternsMatched: number;
}

export interface AnalyzerOptions {
  /** Maximum analysis time before abort (ms) */
  maxTimeMs?: number;
  /** Enable performance logging */
  debugPerformance?: boolean;
  /** Minimum match length to consider */
  minMatchLength?: number;
  /** Maximum violations to return */
  maxViolations?: number;
}

// ============================================================================
// Pre-compiled Pattern Cache
// ============================================================================

interface CompiledPattern {
  rule: ConstraintRule;
  trigger: TriggerPattern;
  regex: RegExp;
}

/**
 * Cache for compiled regex patterns (significant perf improvement)
 */
const patternCache = new Map<string, CompiledPattern[]>();

/**
 * Compile all patterns from rules into optimized regex
 */
function compilePatterns(rules: ConstraintRule[]): CompiledPattern[] {
  const cacheKey = rules.map((r) => r.id).join(",");
  
  if (patternCache.has(cacheKey)) {
    return patternCache.get(cacheKey)!;
  }

  const compiled: CompiledPattern[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    for (const trigger of rule.triggers) {
      const regex = buildRegex(trigger);
      compiled.push({ rule, trigger, regex });
    }
  }

  // Cache the compiled patterns
  patternCache.set(cacheKey, compiled);
  
  // Limit cache size
  if (patternCache.size > 100) {
    const firstKey = patternCache.keys().next().value;
    if (firstKey) patternCache.delete(firstKey);
  }

  return compiled;
}

/**
 * Build a regex from a trigger pattern
 */
function buildRegex(trigger: TriggerPattern): RegExp {
  let pattern: string;

  if (trigger.isRegex) {
    pattern = trigger.pattern;
  } else {
    // Escape special regex characters
    const escaped = trigger.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    
    // Handle word boundary
    if (trigger.wholeWord) {
      pattern = `\\b${escaped}\\b`;
    } else {
      pattern = escaped;
    }

    // Add synonyms as alternation
    if (trigger.synonyms.length > 0) {
      const synonymPatterns = trigger.synonyms.map((s) => {
        const escapedSyn = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return trigger.wholeWord ? `\\b${escapedSyn}\\b` : escapedSyn;
      });
      pattern = `(?:${pattern}|${synonymPatterns.join("|")})`;
    }
  }

  const flags = trigger.caseSensitive ? "g" : "gi";
  return new RegExp(pattern, flags);
}

// ============================================================================
// Analyzer Functions
// ============================================================================

/**
 * Find all matches of a pattern in text with locations
 */
function findMatches(
  text: string,
  regex: RegExp,
  minLength: number
): ViolationLocation[] {
  const locations: ViolationLocation[] = [];
  
  // Reset regex state
  regex.lastIndex = 0;
  
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const matchedText = match[0];
    
    if (matchedText.length < minLength) continue;

    const start = match.index;
    const end = start + matchedText.length;
    
    // Calculate line and column
    const beforeMatch = text.slice(0, start);
    const lines = beforeMatch.split("\n");
    const line = lines.length;
    const column = (lines[lines.length - 1]?.length ?? 0) + 1;

    locations.push({
      start,
      end,
      line,
      column,
      matchedText,
    });

    // Prevent infinite loops with zero-width matches
    if (matchedText.length === 0) {
      regex.lastIndex++;
    }
  }

  return locations;
}

/**
 * Analyze text against constraint rules
 * Optimized for <500ms response time
 */
export function analyzeText(
  text: string,
  rules: ConstraintRule[],
  options: AnalyzerOptions = {}
): AnalysisResult {
  const startTime = performance.now();
  const {
    maxTimeMs = 400, // Leave 100ms buffer for UI
    debugPerformance = false,
    minMatchLength = 3,
    maxViolations = 50,
  } = options;

  const violations: ConstraintViolation[] = [];
  const matchedRuleIds = new Set<string>();
  let patternsMatched = 0;

  // Early exit for empty text
  if (!text || text.trim().length === 0) {
    return {
      violations: [],
      analysisTimeMs: performance.now() - startTime,
      rulesChecked: 0,
      patternsMatched: 0,
    };
  }

  // Compile patterns (cached)
  const patterns = compilePatterns(rules);

  if (debugPerformance) {
    logger.debug({ patternCount: patterns.length }, "Patterns compiled");
  }

  // Analyze each pattern
  for (const { rule, trigger, regex } of patterns) {
    // Check time budget
    const elapsed = performance.now() - startTime;
    if (elapsed > maxTimeMs) {
      logger.warn(
        { elapsed, maxTimeMs, checked: patternsMatched },
        "Analysis time budget exceeded"
      );
      break;
    }

    // Check max violations
    if (violations.length >= maxViolations) {
      break;
    }

    // Find matches
    const locations = findMatches(text, regex, minMatchLength);
    
    if (locations.length > 0) {
      patternsMatched++;
      
      // Only create one violation per rule (aggregate locations)
      if (!matchedRuleIds.has(rule.id)) {
        matchedRuleIds.add(rule.id);
        
        violations.push({
          id: `${rule.id}-${Date.now()}`,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          category: rule.category,
          locations: locations.slice(0, 5), // Limit locations per violation
          message: rule.message,
          explanation: rule.explanation,
          suggestions: rule.suggestions,
          detectedAt: new Date(),
        });
      } else {
        // Add locations to existing violation
        const existing = violations.find((v) => v.ruleId === rule.id);
        if (existing && existing.locations.length < 10) {
          existing.locations.push(...locations.slice(0, 5));
        }
      }
    }
  }

  const analysisTimeMs = performance.now() - startTime;

  if (debugPerformance) {
    logger.debug(
      {
        analysisTimeMs,
        violationCount: violations.length,
        rulesChecked: patterns.length,
        patternsMatched,
      },
      "Analysis complete"
    );
  }

  return {
    violations,
    analysisTimeMs,
    rulesChecked: patterns.length,
    patternsMatched,
  };
}

/**
 * Incremental analysis - analyze only changed portions
 * For even faster updates during typing
 */
export function analyzeIncremental(
  text: string,
  changedRange: { start: number; end: number },
  rules: ConstraintRule[],
  previousViolations: ConstraintViolation[],
  options: AnalyzerOptions = {}
): AnalysisResult {
  const startTime = performance.now();
  
  // Expand range to include context (for word boundary matching)
  const contextPadding = 50;
  const analyzeStart = Math.max(0, changedRange.start - contextPadding);
  const analyzeEnd = Math.min(text.length, changedRange.end + contextPadding);
  
  // Find line boundaries to expand to full lines
  const lineStart = text.lastIndexOf("\n", analyzeStart) + 1;
  const lineEnd = text.indexOf("\n", analyzeEnd);
  const expandedEnd = lineEnd === -1 ? text.length : lineEnd;
  
  // Extract the region to analyze
  const regionText = text.slice(lineStart, expandedEnd);
  
  // Analyze the region
  const regionResult = analyzeText(regionText, rules, {
    ...options,
    maxTimeMs: Math.min(options.maxTimeMs ?? 400, 200), // Tighter budget for incremental
  });

  // Adjust violation locations to global positions
  const adjustedViolations = regionResult.violations.map((v) => ({
    ...v,
    locations: v.locations.map((loc) => ({
      ...loc,
      start: loc.start + lineStart,
      end: loc.end + lineStart,
    })),
  }));

  // Merge with previous violations outside the changed region
  const outsideViolations = previousViolations.filter((v) =>
    v.locations.every(
      (loc) => loc.end < lineStart || loc.start > expandedEnd
    )
  );

  const violations = [...outsideViolations, ...adjustedViolations];

  return {
    violations,
    analysisTimeMs: performance.now() - startTime,
    rulesChecked: regionResult.rulesChecked,
    patternsMatched: regionResult.patternsMatched,
  };
}

/**
 * Quick check - returns true if any violations would be found
 * Faster than full analysis when you just need a boolean
 */
export function hasViolations(
  text: string,
  rules: ConstraintRule[],
  options: AnalyzerOptions = {}
): boolean {
  const patterns = compilePatterns(rules);
  
  for (const { regex } of patterns) {
    regex.lastIndex = 0;
    if (regex.test(text)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Clear the pattern cache (call when rules change)
 */
export function clearPatternCache(): void {
  patternCache.clear();
}

// ============================================================================
// Export
// ============================================================================

export const textAnalyzer = {
  analyzeText,
  analyzeIncremental,
  hasViolations,
  clearPatternCache,
};
