/**
 * @file Lifecycle gate
 * @description
 * A gate sits between two lifecycle stages. It passes when the stage's required artifacts
 * exist, each one traces back to evidence, none of them is suspect (something it rests on
 * changed and nobody re-confirmed it), the evidence meets the quality bar, and a person
 * approved it. In "warn" mode failures are reported but never block.
 */

import { z } from "zod";
import { NodeType, type TraceGraph } from "@coreflow/trace";
import { EvidenceQualityConfig, checkEvidenceQuality, type InsightSample } from "./evidence-quality";
import type { CheckResult } from "./types";

export const GateDefinition = z.object({
  id: z.string().min(1),
  /** The stage this gate closes, e.g. "business-case". */
  stage: z.string().min(1),
  title: z.string().optional(),
  mode: z.enum(["block", "warn"]).default("block"),
  /** Nodes that must exist in the stage, by type and optionally kind (e.g. artifact / "deck"), with a minimum count each. */
  requires: z
    .array(
      z.object({
        type: NodeType.default("artifact"),
        kind: z.string().optional(),
        min: z.number().int().min(1).default(1),
        label: z.string().optional(),
      }),
    )
    .default([]),
  /** Every required artifact must trace upstream to at least one evidence node. */
  requireEvidence: z.boolean().default(true),
  /** No artifact in the stage may be suspect. */
  requireFresh: z.boolean().default(true),
  evidenceQuality: EvidenceQualityConfig.partial().optional(),
  approval: z
    .object({ required: z.boolean().default(true), minApprovers: z.number().int().min(1).default(1) })
    .default({}),
});
export type GateDefinition = z.infer<typeof GateDefinition>;
export type GateDefinitionInput = z.input<typeof GateDefinition>;

export interface Approval {
  by: string;
  at: string;
}

export interface GateContext {
  graph: TraceGraph;
  /** Node IDs that belong to the stage being closed. */
  stageNodeIds: string[];
  /** Insight data for the evidence-quality check. Omit to skip that check. */
  insights?: InsightSample[];
  approvals?: Approval[];
}

export interface GateResult {
  gateId: string;
  stage: string;
  status: "passed" | "blocked" | "warning";
  passed: boolean;
  checks: CheckResult[];
  recommendations: string[];
}

export function evaluateGate(definitionInput: GateDefinitionInput, ctx: GateContext): GateResult {
  const def = GateDefinition.parse(definitionInput);
  const checks: CheckResult[] = [];
  const recommendations: string[] = [];

  const stageNodes = ctx.stageNodeIds
    .map((id) => ctx.graph.getNode(id))
    .filter((n): n is NonNullable<typeof n> => n !== undefined);
  const missingIds = ctx.stageNodeIds.filter((id) => !ctx.graph.getNode(id));
  if (missingIds.length > 0) {
    checks.push({
      name: "Known Artifacts",
      passed: false,
      message: `${missingIds.length} stage item(s) are not in the trace graph: ${missingIds.join(", ")}`,
      severity: "error",
      subjects: missingIds,
    });
  }

  // Completeness
  for (const req of def.requires) {
    const found = stageNodes.filter((n) => n.type === req.type && (!req.kind || n.kind === req.kind));
    const label = req.label ?? req.kind ?? req.type;
    checks.push({
      name: `Required: ${label}`,
      passed: found.length >= req.min,
      message:
        found.length >= req.min
          ? `${found.length} ${label} present`
          : `Need at least ${req.min} ${label}, found ${found.length}`,
      actual: found.length,
      threshold: req.min,
      severity: "error",
      subjects: found.map((n) => n.id),
    });
    if (found.length < req.min) recommendations.push(`Create the missing ${label} for stage "${def.stage}"`);
  }

  // Evidence coverage: every artifact that is not itself evidence must trace to evidence.
  if (def.requireEvidence) {
    const unsupported = stageNodes.filter(
      (n) => n.type !== "evidence" && ctx.graph.upstream(n.id, { types: ["evidence"] }).length === 0,
    );
    checks.push({
      name: "Evidence Coverage",
      passed: unsupported.length === 0,
      message:
        unsupported.length === 0
          ? "Every artifact traces back to evidence"
          : `${unsupported.length} artifact(s) cite no evidence: ${unsupported.map((n) => n.id).join(", ")}`,
      actual: unsupported.length,
      threshold: 0,
      severity: "error",
      subjects: unsupported.map((n) => n.id),
    });
    if (unsupported.length > 0) recommendations.push("Link each artifact to the evidence or insights it relies on");
  }

  // Freshness
  if (def.requireFresh) {
    const inStage = new Set(stageNodes.map((n) => n.id));
    const stale = ctx.graph.suspects().filter((s) => inStage.has(s.node.id));
    checks.push({
      name: "Freshness",
      passed: stale.length === 0,
      message:
        stale.length === 0
          ? "Nothing in this stage rests on changed evidence"
          : stale
              .map((s) => `${s.node.id} rests on changed ${s.causes.map((c) => c.id).join(", ")}`)
              .join("; "),
      actual: stale.length,
      threshold: 0,
      severity: "error",
      subjects: stale.map((s) => s.node.id),
    });
    if (stale.length > 0) recommendations.push("Review suspect artifacts, update them, then confirm their links");
  }

  // Evidence quality
  if (def.evidenceQuality && ctx.insights) {
    const quality = checkEvidenceQuality(ctx.insights, def.evidenceQuality);
    checks.push(...quality.checks);
    recommendations.push(...quality.recommendations);
  }

  // Approval
  if (def.approval.required) {
    const approvers = new Set((ctx.approvals ?? []).map((a) => a.by));
    const ok = approvers.size >= def.approval.minApprovers;
    checks.push({
      name: "Approval",
      passed: ok,
      message: ok
        ? `Approved by ${[...approvers].join(", ")}`
        : `Needs ${def.approval.minApprovers} approver(s), has ${approvers.size}`,
      actual: approvers.size,
      threshold: def.approval.minApprovers,
      severity: "error",
    });
  }

  const blocking = checks.some((c) => !c.passed && c.severity === "error");
  const anyFailed = checks.some((c) => !c.passed);
  const status: GateResult["status"] =
    blocking && def.mode === "block" ? "blocked" : anyFailed ? "warning" : "passed";

  return {
    gateId: def.id,
    stage: def.stage,
    status,
    passed: status !== "blocked",
    checks,
    recommendations: [...new Set(recommendations)],
  };
}
