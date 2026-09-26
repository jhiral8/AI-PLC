import { describe, expect, it } from "vitest";
import { TraceGraph, contentHash } from "./index";

/** A clock that advances one second per call, so change and confirm times are ordered. */
function tickingClock(start = Date.parse("2026-09-26T10:00:00Z")) {
  let t = start;
  return () => new Date((t += 1000));
}

/**
 * INT-1 (interview) ─cites→ INS-1 ─informs→ REQ-1 ─implements→ SPEC-1 ─implements→ CODE-1 ─validates→ TEST-1
 *                                            └──references→ DECK-1
 * INT-2 ─cites→ INS-2 ─informs→ REQ-2
 */
function sampleGraph() {
  const g = new TraceGraph(tickingClock());
  const node = (id: string, type: Parameters<TraceGraph["upsertNode"]>[0]["type"], text: string) =>
    g.upsertNode({ id, type, hash: contentHash(text) });
  node("INT-1", "evidence", "Interview with ops lead");
  node("INT-2", "evidence", "Interview with finance");
  node("INS-1", "insight", "Users abandon the login flow");
  node("INS-2", "insight", "Finance wants monthly exports");
  node("REQ-1", "requirement", "Support passwordless login");
  node("REQ-2", "requirement", "Monthly CSV export");
  node("SPEC-1", "spec", "Magic-link spec");
  node("CODE-1", "code", "src/auth/magic-link.ts");
  node("TEST-1", "test", "magic-link.test.ts");
  node("DECK-1", "artifact", "Q4 business case deck");
  g.link({ from: "INT-1", to: "INS-1", type: "cites" });
  g.link({ from: "INS-1", to: "REQ-1", type: "informs" });
  g.link({ from: "REQ-1", to: "SPEC-1", type: "implements" });
  g.link({ from: "SPEC-1", to: "CODE-1", type: "implements" });
  g.link({ from: "CODE-1", to: "TEST-1", type: "validates" });
  g.link({ from: "INS-1", to: "DECK-1", type: "references" });
  g.link({ from: "INT-2", to: "INS-2", type: "cites" });
  g.link({ from: "INS-2", to: "REQ-2", type: "informs" });
  return g;
}

describe("TraceGraph traversal", () => {
  it("walks downstream breadth-first with depths", () => {
    const g = sampleGraph();
    const steps = g.downstream("INS-1").map((s) => [s.node.id, s.depth]);
    expect(steps).toEqual([
      ["REQ-1", 1],
      ["DECK-1", 1],
      ["SPEC-1", 2],
      ["CODE-1", 3],
      ["TEST-1", 4],
    ]);
  });

  it("walks upstream to the evidence", () => {
    const g = sampleGraph();
    expect(g.upstream("TEST-1").map((s) => s.node.id)).toEqual(["CODE-1", "SPEC-1", "REQ-1", "INS-1", "INT-1"]);
  });

  it("filters by node type and respects maxDepth", () => {
    const g = sampleGraph();
    expect(g.upstream("TEST-1", { types: ["evidence"] }).map((s) => s.node.id)).toEqual(["INT-1"]);
    expect(g.downstream("INS-1", { maxDepth: 1 }).map((s) => s.node.id)).toEqual(["REQ-1", "DECK-1"]);
  });

  it("terminates on cycles", () => {
    const g = sampleGraph();
    g.link({ from: "TEST-1", to: "REQ-1", type: "depends_on" });
    expect(g.downstream("REQ-1").map((s) => s.node.id)).toEqual(["SPEC-1", "CODE-1", "TEST-1"]);
  });

  it("does not duplicate identical links", () => {
    const g = sampleGraph();
    g.link({ from: "INS-1", to: "REQ-1", type: "informs" });
    expect(g.linksTo("REQ-1")).toHaveLength(1);
  });

  it("rejects links to unknown nodes and self-links", () => {
    const g = sampleGraph();
    expect(() => g.link({ from: "INS-1", to: "NOPE" })).toThrow(/Unknown trace node/);
    expect(() => g.link({ from: "INS-1", to: "INS-1" })).toThrow(/itself/);
  });
});

describe("TraceGraph suspects", () => {
  it("has no suspects when nothing changed", () => {
    expect(sampleGraph().suspects()).toEqual([]);
  });

  it("marks everything downstream of a changed insight, and nothing else", () => {
    const g = sampleGraph();
    g.updateContent("INS-1", contentHash("Users abandon login only on mobile"));
    const suspects = g.suspects();
    expect(suspects.map((s) => [s.node.id, s.distance])).toEqual([
      ["DECK-1", 1],
      ["REQ-1", 1],
      ["SPEC-1", 2],
      ["CODE-1", 3],
      ["TEST-1", 4],
    ]);
    expect(suspects.every((s) => s.causes.map((c) => c.id).join() === "INS-1")).toBe(true);
    expect(g.isSuspect("REQ-2")).toBe(false);
  });

  it("ignores whitespace and line-ending differences", () => {
    const g = sampleGraph();
    g.updateContent("INS-1", contentHash("Users abandon the login flow  \r\n"));
    expect(g.suspects()).toEqual([]);
  });

  it("clears a suspect link once it is confirmed, leaving the rest of the chain", () => {
    const g = sampleGraph();
    g.updateContent("INS-1", contentHash("Users abandon login only on mobile"));
    g.confirm("DECK-1");
    expect(g.isSuspect("DECK-1")).toBe(false);
    expect(g.isSuspect("TEST-1")).toBe(true);

    // Confirming the requirement against the new insight clears everything below it.
    g.confirm("REQ-1", "INS-1");
    expect(g.suspects()).toEqual([]);
  });

  it("propagates an explicit change such as a retracted finding", () => {
    const g = sampleGraph();
    g.markChanged("INT-2", "Interview withdrawn by participant");
    expect(g.suspects().map((s) => s.node.id)).toEqual(["INS-2", "REQ-2"]);
    g.confirm("INS-2");
    expect(g.suspects()).toEqual([]);
  });

  it("collects every cause when two upstream changes meet", () => {
    const g = sampleGraph();
    g.link({ from: "INS-2", to: "SPEC-1", type: "informs" });
    g.updateContent("INS-1", contentHash("changed 1"));
    g.updateContent("INS-2", contentHash("changed 2"));
    const spec = g.suspects().find((s) => s.node.id === "SPEC-1");
    expect(spec?.causes.map((c) => c.id).sort()).toEqual(["INS-1", "INS-2"]);
    expect(spec?.distance).toBe(1);
  });
});

describe("TraceGraph persistence", () => {
  it("round-trips through JSON, including suspect state", () => {
    const g = sampleGraph();
    g.updateContent("REQ-1", contentHash("Support passkeys"));
    const copy = TraceGraph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(copy.toJSON()).toEqual(g.toJSON());
    expect(copy.suspects().map((s) => s.node.id)).toEqual(["SPEC-1", "CODE-1", "TEST-1"]);
  });

  it("rejects files with dangling links", () => {
    const file = sampleGraph().toJSON();
    file.nodes = file.nodes.filter((n) => n.id !== "TEST-1");
    expect(() => TraceGraph.fromJSON(file)).toThrow(/does not exist/);
  });

  it("removing a node removes its links", () => {
    const g = sampleGraph();
    g.removeNode("SPEC-1");
    expect(g.downstream("REQ-1")).toEqual([]);
  });
});
