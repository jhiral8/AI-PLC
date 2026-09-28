import { describe, expect, it } from "vitest";
import { TraceGraph, contentHash } from "@coreflow/trace";
import { checkEvidenceQuality, evaluateGate, type GateDefinitionInput, type InsightSample } from "./index";

describe("checkEvidenceQuality (ported thresholds)", () => {
  const strong: InsightSample[] = [
    { id: "INS-1", confidence: 0.9, sourceIds: ["INT-1"] },
    { id: "INS-2", confidence: 0.8, sourceIds: ["INT-2"] },
    { id: "INS-3", confidence: 0.7, sourceIds: ["INT-1", "WEB-1"] },
  ];

  it("passes with three confident insights from several sources", () => {
    const result = checkEvidenceQuality(strong);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.metrics).toMatchObject({ insightCount: 3, sourceCount: 3, highConfidenceCount: 2 });
    expect(result.recommendations).toEqual([]);
  });

  it("fails confidence and count with the original messages", () => {
    const result = checkEvidenceQuality([{ id: "INS-1", confidence: 0.4, sourceIds: ["INT-1"] }]);
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(byName["Minimum Confidence"]?.message).toBe("Average confidence (40%) is below 60% threshold");
    expect(byName["Minimum Insights"]?.message).toBe("Only 1 insights found, need at least 3");
    expect(byName["Source Diversity"]?.severity).toBe("warning");
    expect(byName["Low Confidence Ratio"]?.passed).toBe(false);
  });

  it("handles no insights without dividing by zero", () => {
    const result = checkEvidenceQuality([]);
    expect(result.metrics.averageConfidence).toBe(0);
    expect(result.checks.find((c) => c.name === "Low Confidence Ratio")?.passed).toBe(true);
  });

  it("enforces verification when asked, which the original ignored", () => {
    const result = checkEvidenceQuality(strong, { requireVerifiedInsights: true });
    const verified = result.checks.find((c) => c.name === "Verified Insights");
    expect(verified).toMatchObject({ passed: false, actual: 3, severity: "error" });
  });
});

function businessCaseGraph() {
  let t = Date.parse("2026-09-26T10:00:00Z");
  const g = new TraceGraph(() => new Date((t += 1000)));
  g.upsertNode({ id: "INT-1", type: "evidence", hash: contentHash("interview") });
  g.upsertNode({ id: "MKT-1", type: "evidence", hash: contentHash("market report") });
  g.upsertNode({ id: "INS-1", type: "insight", hash: contentHash("SMBs churn at onboarding") });
  g.upsertNode({ id: "BC-1", type: "artifact", title: "Business case", hash: contentHash("bc v1") });
  g.upsertNode({ id: "DECK-1", type: "artifact", title: "Exec deck", hash: contentHash("deck v1") });
  g.link({ from: "INT-1", to: "INS-1", type: "cites" });
  g.link({ from: "INS-1", to: "BC-1", type: "informs" });
  g.link({ from: "MKT-1", to: "BC-1", type: "cites" });
  g.link({ from: "BC-1", to: "DECK-1", type: "derived_from" });
  return g;
}

const gate: GateDefinitionInput = {
  id: "G2",
  stage: "business-case",
  requires: [{ type: "artifact", min: 2, label: "business case and deck" }],
  evidenceQuality: { minInsightCount: 1, minSourceCount: 1 },
};
const insights: InsightSample[] = [{ id: "INS-1", confidence: 0.85, sourceIds: ["INT-1"] }];
const approvals = [{ by: "craig", at: "2026-09-26T11:00:00Z" }];

describe("evaluateGate", () => {
  it("passes when artifacts exist, cite evidence, are fresh and approved", () => {
    const result = evaluateGate(gate, {
      graph: businessCaseGraph(),
      stageNodeIds: ["BC-1", "DECK-1"],
      insights,
      approvals,
    });
    expect(result.status).toBe("passed");
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  });

  it("blocks when a cited insight changes, and passes again after re-confirming", () => {
    const g = businessCaseGraph();
    g.updateContent("INS-1", contentHash("SMBs churn at billing, not onboarding"));
    const blocked = evaluateGate(gate, { graph: g, stageNodeIds: ["BC-1", "DECK-1"], insights, approvals });
    expect(blocked.status).toBe("blocked");
    const fresh = blocked.checks.find((c) => c.name === "Freshness");
    expect(fresh?.subjects).toEqual(["BC-1", "DECK-1"]);
    expect(fresh?.message).toContain("BC-1 rests on changed INS-1");

    g.confirm("BC-1", "INS-1");
    const passed = evaluateGate(gate, { graph: g, stageNodeIds: ["BC-1", "DECK-1"], insights, approvals });
    expect(passed.status).toBe("passed");
  });

  it("blocks on missing artifacts, missing evidence and missing approval", () => {
    const g = businessCaseGraph();
    g.upsertNode({ id: "PITCH-1", type: "artifact", title: "Unsourced pitch" });
    const result = evaluateGate(gate, { graph: g, stageNodeIds: ["PITCH-1"], insights });
    const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
    expect(failed).toEqual(["Required: business case and deck", "Evidence Coverage", "Approval"]);
    expect(result.status).toBe("blocked");
  });

  it("reports but does not block in warn mode", () => {
    const result = evaluateGate({ ...gate, mode: "warn" }, { graph: businessCaseGraph(), stageNodeIds: ["BC-1"] });
    expect(result.status).toBe("warning");
    expect(result.passed).toBe(true);
  });

  it("flags stage items that are not in the graph", () => {
    const result = evaluateGate(gate, {
      graph: businessCaseGraph(),
      stageNodeIds: ["BC-1", "DECK-1", "GHOST-1"],
      approvals,
    });
    expect(result.checks[0]).toMatchObject({ name: "Known Artifacts", passed: false, subjects: ["GHOST-1"] });
  });

  it("requires artifacts by kind, so two business cases do not stand in for a deck", () => {
    const g = businessCaseGraph();
    g.upsertNode({ id: "BC-1", type: "artifact", kind: "business-case" });
    g.upsertNode({ id: "DECK-1", type: "artifact", kind: "business-case" });
    const byKind: GateDefinitionInput = {
      id: "G3",
      stage: "business-case",
      requires: [{ kind: "business-case" }, { kind: "deck" }],
    };
    const result = evaluateGate(byKind, { graph: g, stageNodeIds: ["BC-1", "DECK-1"], approvals });
    const deck = result.checks.find((c) => c.name === "Required: deck");
    expect(deck).toMatchObject({ passed: false, actual: 0 });
    expect(result.checks.find((c) => c.name === "Required: business-case")).toMatchObject({ passed: true, actual: 2 });
    expect(result.status).toBe("blocked");
  });
});
