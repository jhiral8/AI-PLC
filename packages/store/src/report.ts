/**
 * @file Plain-text reports shared by the CLI, the MCP server and hooks.
 */

import type { SuspectItem, TraceGraph, TraceNode } from "@coreflow/trace";
import type { GateReport } from "./gates";
import type { ScanResult } from "./project";

function label(node: TraceNode): string {
  const title = node.title ? ` ${node.title}` : "";
  return `${node.id} (${node.type})${title}`;
}

function cause(node: TraceNode): string {
  return node.changed ? `${node.id}: ${node.changed.reason}` : `${node.id} changed`;
}

export function formatSuspects(items: SuspectItem[]): string {
  if (items.length === 0) return "Nothing is suspect.";
  const lines = [`${items.length} suspect item${items.length === 1 ? "" : "s"}:`];
  for (const item of items) {
    lines.push(`- ${label(item.node)}`);
    lines.push(`    because ${item.causes.map(cause).join("; ")}${item.distance > 1 ? ` (${item.distance} links away)` : ""}`);
  }
  lines.push('Review each one, then run "coreflow confirm <id>" for items that still hold.');
  return lines.join("\n");
}

export function formatTrace(graph: TraceGraph, id: string, direction: "up" | "down" | "both" = "both"): string {
  const node = graph.getNode(id);
  if (!node) throw new Error(`Unknown trace node: ${id}`);
  const suspects = new Set(graph.suspects().map((s) => s.node.id));
  const mark = (n: TraceNode) => (suspects.has(n.id) ? " [suspect]" : "");
  const lines = [`${label(node)}${mark(node)}`];
  if (node.location) lines.push(`  at ${node.location}`);
  const section = (title: string, steps: ReturnType<TraceGraph["upstream"]>) => {
    lines.push(`${title}:`);
    if (steps.length === 0) lines.push("  (none)");
    for (const step of steps) {
      lines.push(`  ${"  ".repeat(step.depth - 1)}${step.via} ${label(step.node)}${mark(step.node)}`);
    }
  };
  if (direction !== "down") section("Upstream", graph.upstream(id));
  if (direction !== "up") section("Downstream", graph.downstream(id));
  return lines.join("\n");
}

export function formatScan(result: ScanResult): string {
  const parts = [
    `${result.added.length} added`,
    `${result.changed.length} changed`,
    `${result.removed.length} removed`,
    `${result.linked.length} links from the text added`,
  ];
  if (result.unlinked.length) parts.push(`${result.unlinked.length} removed from the text`);
  const lines = [`Scanned: ${parts.join(", ")}.`];
  if (result.changed.length) lines.push(`Changed: ${result.changed.join(", ")}`);
  if (result.removed.length) lines.push(`Removed: ${result.removed.join(", ")}`);
  for (const w of result.warnings) lines.push(`Warning: ${w}`);
  return lines.join("\n");
}

export function formatGate(report: GateReport): string {
  const verdict = { passed: "PASSED", blocked: "BLOCKED", warning: "PASSED WITH WARNINGS" }[report.status];
  const lines = [`Gate ${report.gateId}${report.title ? ` (${report.title})` : ""}, stage "${report.stage}": ${verdict}`];
  lines.push(`  Items: ${report.items.length ? report.items.join(", ") : "(none)"}`);
  for (const check of report.checks) {
    lines.push(`  ${check.passed ? "ok  " : check.severity === "error" ? "FAIL" : "warn"} ${check.name}: ${check.message}`);
  }
  for (const stale of report.staleApprovals) {
    lines.push(`  Approval by ${stale.by} no longer counts: ${stale.reason}`);
  }
  for (const rec of report.recommendations) lines.push(`  Next: ${rec}`);
  return lines.join("\n");
}
