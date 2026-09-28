/**
 * @file Stage gates over the files
 * @description
 * Gate definitions live in `.coreflow/config.json`; a node belongs to a stage through its
 * front-matter `stage:`. Approvals live in `.coreflow/approvals.json` and record the hash of
 * every item in the stage when it was approved, so an approval stops counting as soon as
 * anything it covered changes, or something is added to or removed from the stage.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateGate, type GateDefinition, type GateResult } from "@coreflow/gates";
import type { TraceNode } from "@coreflow/trace";
import { COREFLOW_DIR, type Project } from "./project";

const APPROVALS_FILE = "approvals.json";

export interface ApprovalRecord {
  gate: string;
  by: string;
  at: string;
  /** Hash of each stage item when approved. */
  hashes: Record<string, string>;
}

export interface GateReport extends GateResult {
  title?: string;
  items: string[];
  /** Approvals that no longer count, with the reason. */
  staleApprovals: { by: string; at: string; reason: string }[];
}

function approvalsPath(project: Project): string {
  return join(project.root, COREFLOW_DIR, APPROVALS_FILE);
}

export function readApprovals(project: Project): ApprovalRecord[] {
  const path = approvalsPath(project);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8")) as { approvals?: ApprovalRecord[] };
  return Array.isArray(data.approvals) ? data.approvals : [];
}

/** Top-level items in a stage (documents, not their sections). */
export function stageItems(project: Project, stage: string): TraceNode[] {
  return project.graph
    .listNodes()
    .filter((n) => n.stage === stage && n.kind !== "section")
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function findGate(project: Project, gateId: string): GateDefinition {
  const gate = project.config.gates.find((g) => g.id === gateId || g.stage === gateId);
  if (!gate) {
    const known = project.config.gates.map((g) => g.id).join(", ") || "none defined";
    throw new Error(`Unknown gate "${gateId}". Gates in .coreflow/config.json: ${known}`);
  }
  return gate;
}

function whyStale(record: ApprovalRecord, items: TraceNode[]): string | undefined {
  const current = new Map(items.map((n) => [n.id, n.hash ?? ""]));
  for (const [id, hash] of Object.entries(record.hashes)) {
    if (!current.has(id)) return `${id} is no longer in the stage`;
    if (current.get(id) !== hash) return `${id} changed since approval`;
  }
  const added = [...current.keys()].filter((id) => !(id in record.hashes));
  if (added.length) return `${added.join(", ")} added since approval`;
  return undefined;
}

export function runGate(project: Project, gate: GateDefinition): GateReport {
  const items = stageItems(project, gate.stage);
  const records = readApprovals(project).filter((a) => a.gate === gate.id);
  const valid: { by: string; at: string }[] = [];
  const staleApprovals: GateReport["staleApprovals"] = [];
  for (const record of records) {
    const reason = whyStale(record, items);
    if (reason) staleApprovals.push({ by: record.by, at: record.at, reason });
    else valid.push({ by: record.by, at: record.at });
  }
  const result = evaluateGate(gate, {
    graph: project.graph,
    stageNodeIds: items.map((n) => n.id),
    approvals: valid,
  });
  if (staleApprovals.length) {
    result.recommendations.push(
      `Re-approve with "coreflow approve ${gate.id} --by <name>" once the changes are reviewed`,
    );
  }
  return { ...result, title: gate.title, items: items.map((n) => n.id), staleApprovals };
}

export function runGates(project: Project, gateId?: string): GateReport[] {
  const gates = gateId ? [findGate(project, gateId)] : project.config.gates;
  return gates.map((g) => runGate(project, g));
}

/**
 * Records a person's approval of everything currently in the gate's stage. Only people
 * approve: the CLI offers this, the MCP server deliberately does not.
 */
export function approveGate(project: Project, gateId: string, by: string, now = new Date()): ApprovalRecord {
  if (!by.trim()) throw new Error("An approval needs a name (--by)");
  const gate = findGate(project, gateId);
  const items = stageItems(project, gate.stage);
  if (items.length === 0) throw new Error(`Nothing is in stage "${gate.stage}" yet, so there is nothing to approve`);
  const record: ApprovalRecord = {
    gate: gate.id,
    by: by.trim(),
    at: now.toISOString(),
    hashes: Object.fromEntries(items.map((n) => [n.id, n.hash ?? ""])),
  };
  // One current approval per person per gate.
  const others = readApprovals(project).filter((a) => !(a.gate === gate.id && a.by === record.by));
  writeFileSync(approvalsPath(project), `${JSON.stringify({ approvals: [...others, record] }, null, 2)}\n`);
  return record;
}
