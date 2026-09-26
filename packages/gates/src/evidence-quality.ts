/**
 * @file Evidence quality check
 * @description
 * Ported from AI-PM `services/research/quality-gate.service.ts` (the "Low Confidence
 * Warning" gate before PRD generation). Same default thresholds and messages; the
 * metrics are now passed in instead of queried from Postgres, and
 * `requireVerifiedInsights`, which the original accepted but never checked, is enforced.
 */

import { z } from "zod";
import type { CheckResult } from "./types";

export const EvidenceQualityConfig = z.object({
  minConfidenceThreshold: z.number().min(0).max(1).default(0.6),
  minInsightCount: z.number().int().min(0).default(3),
  minSourceCount: z.number().int().min(0).default(2),
  maxLowConfidenceRatio: z.number().min(0).max(1).default(0.3),
  requireVerifiedInsights: z.boolean().default(false),
});
export type EvidenceQualityConfig = z.infer<typeof EvidenceQualityConfig>;

export interface InsightSample {
  id: string;
  confidence: number;
  /** IDs of the evidence nodes the insight cites. */
  sourceIds: string[];
  verified?: boolean;
}

export interface EvidenceMetrics {
  averageConfidence: number;
  insightCount: number;
  sourceCount: number;
  highConfidenceCount: number;
  lowConfidenceCount: number;
  unverifiedCount: number;
}

const HIGH_CONFIDENCE = 0.8;

export function measureEvidence(insights: InsightSample[], lowConfidenceBelow = 0.6): EvidenceMetrics {
  const count = insights.length;
  const sum = insights.reduce((acc, i) => acc + i.confidence, 0);
  return {
    averageConfidence: count ? sum / count : 0,
    insightCount: count,
    sourceCount: new Set(insights.flatMap((i) => i.sourceIds)).size,
    highConfidenceCount: insights.filter((i) => i.confidence >= HIGH_CONFIDENCE).length,
    lowConfidenceCount: insights.filter((i) => i.confidence < lowConfidenceBelow).length,
    unverifiedCount: insights.filter((i) => !i.verified).length,
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function checkEvidenceQuality(
  insights: InsightSample[],
  config: Partial<EvidenceQualityConfig> = {},
): { checks: CheckResult[]; metrics: EvidenceMetrics; recommendations: string[] } {
  const c = EvidenceQualityConfig.parse(config);
  const m = measureEvidence(insights, c.minConfidenceThreshold);
  const checks: CheckResult[] = [];
  const recommendations: string[] = [];

  const confidenceOk = m.averageConfidence >= c.minConfidenceThreshold;
  checks.push({
    name: "Minimum Confidence",
    passed: confidenceOk,
    message: confidenceOk
      ? `Average confidence (${pct(m.averageConfidence)}) meets threshold`
      : `Average confidence (${pct(m.averageConfidence)}) is below ${pct(c.minConfidenceThreshold)} threshold`,
    actual: m.averageConfidence,
    threshold: c.minConfidenceThreshold,
    severity: "error",
  });
  if (!confidenceOk) {
    recommendations.push(
      "Add more research sources to improve insight confidence",
      "Review and verify low-confidence insights manually",
      "Consider conducting additional user research",
    );
  }

  const countOk = m.insightCount >= c.minInsightCount;
  checks.push({
    name: "Minimum Insights",
    passed: countOk,
    message: countOk
      ? `${m.insightCount} insights meet minimum of ${c.minInsightCount}`
      : `Only ${m.insightCount} insights found, need at least ${c.minInsightCount}`,
    actual: m.insightCount,
    threshold: c.minInsightCount,
    severity: "error",
  });
  if (!countOk) {
    recommendations.push(
      "Upload additional research documents",
      "Extract insights from existing documents that may have been missed",
    );
  }

  const sourcesOk = m.sourceCount >= c.minSourceCount;
  checks.push({
    name: "Source Diversity",
    passed: sourcesOk,
    message: sourcesOk
      ? `${m.sourceCount} sources meet minimum of ${c.minSourceCount}`
      : `Only ${m.sourceCount} source(s) found, need at least ${c.minSourceCount} for diversity`,
    actual: m.sourceCount,
    threshold: c.minSourceCount,
    severity: "warning",
  });
  if (!sourcesOk) {
    recommendations.push(
      "Add research from diverse sources (user interviews, competitor analysis, etc.)",
      "Consider adding market research or analytics data",
    );
  }

  const lowRatio = m.lowConfidenceCount / Math.max(m.insightCount, 1);
  const lowOk = lowRatio <= c.maxLowConfidenceRatio;
  checks.push({
    name: "Low Confidence Ratio",
    passed: lowOk,
    message: lowOk
      ? `Only ${m.lowConfidenceCount} insights have low confidence`
      : `${m.lowConfidenceCount} insights (${pct(lowRatio)}) have low confidence`,
    actual: lowRatio,
    threshold: c.maxLowConfidenceRatio,
    severity: "warning",
  });
  if (!lowOk) {
    recommendations.push(
      "Review low-confidence insights and add supporting evidence",
      "Consider removing or merging uncertain insights",
    );
  }

  if (c.requireVerifiedInsights) {
    const verifiedOk = m.unverifiedCount === 0;
    checks.push({
      name: "Verified Insights",
      passed: verifiedOk,
      message: verifiedOk
        ? "All insights have been verified by a person"
        : `${m.unverifiedCount} insight(s) still need a person to verify them`,
      actual: m.unverifiedCount,
      threshold: 0,
      severity: "error",
    });
    if (!verifiedOk) recommendations.push("Verify each insight against its source before continuing");
  }

  return { checks, metrics: m, recommendations: [...new Set(recommendations)] };
}
