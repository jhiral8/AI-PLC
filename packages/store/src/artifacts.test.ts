import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newArtifact, nextArtifactId } from "./artifacts";
import { approveGate, runGate, runGates } from "./gates";
import { DEFAULT_PREFIXES } from "./config";
import { extractCitations, extractDefinitions } from "./markdown";
import { fileHash, Project } from "./project";
import { formatGate } from "./report";

let root: string;
let clock: number;
const now = () => new Date(Date.UTC(2026, 8, 28, 0, 0, clock++));

const write = (rel: string, text: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const RESEARCH = [
  "- **EV-1**: Interview with Sam, 12 Sep",
  "",
  "- **EV-2**: Analytics export, August",
  "",
  "- **INS-1**: Users abandon login on mobile [EV-1, EV-2]",
  "",
  "- **INS-2**: Password resets are 30% of support tickets [EV-2]",
  "",
].join("\n");

const BUSINESS_CASE = `---
id: ART-1
type: artifact
kind: business-case
stage: business-case
title: "Passwordless login: business case"
---
# Passwordless login

## Problem
Mobile users give up at the password step [INS-1].

## Opportunity
Fewer resets would cut support load [INS-2].

## Costs
Two sprints.
`;

const DECK = `---
id: ART-2
type: artifact
kind: deck
stage: business-case
derived_from: [ART-1]
---
# Passwordless login

## The problem
People give up at the password step [INS-1].

## The opportunity
Support load drops [INS-2].
`;

beforeEach(() => {
  clock = 0;
  root = mkdtempSync(join(tmpdir(), "coreflow-art-"));
  write("docs/research.md", RESEARCH);
  write("docs/artifacts/art-1.md", BUSINESS_CASE);
  write("docs/artifacts/art-2.md", DECK);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

async function scanned() {
  const p = Project.init(root, {
    now,
    config: {
      gates: [
        {
          id: "G-BC",
          stage: "business-case",
          title: "Business case approved",
          requires: [{ kind: "business-case" }, { kind: "deck" }],
        },
      ],
    },
  });
  const result = await p.scan();
  p.save();
  return { p, result };
}

describe("citations", () => {
  it("reads single and grouped citations outside code", () => {
    expect(extractCitations("a [INS-1] b [EV-1, EV-2; EV-3]\n```\n[INS-9]\n```\n[see INS-8]")).toEqual([
      "INS-1",
      "EV-1",
      "EV-2",
      "EV-3",
    ]);
  });

  it("splits a front-matter document into section nodes that carry their own citations", () => {
    const defs = extractDefinitions("docs/artifacts/art-1.md", BUSINESS_CASE, DEFAULT_PREFIXES);
    expect(defs.map((d) => [d.node.id, d.node.kind, d.cites, d.partOf])).toEqual([
      ["ART-1", "business-case", [], undefined],
      ["ART-1#problem", "section", ["INS-1"], "ART-1"],
      ["ART-1#opportunity", "section", ["INS-2"], "ART-1"],
      ["ART-1#costs", "section", [], "ART-1"],
    ]);
    expect(defs[0]!.node).toMatchObject({ stage: "business-case", title: "Passwordless login: business case" });
  });

  it("links citations on scan: evidence -> insight -> section -> document -> deck", async () => {
    const { p, result } = await scanned();
    expect(result.warnings).toEqual([]);
    const up = p.graph.upstream("ART-2").map((s) => s.node.id);
    expect(up).toEqual(expect.arrayContaining(["ART-1", "ART-2#the-problem", "INS-1", "INS-2", "EV-1", "EV-2"]));
    expect(p.graph.linksTo("ART-1#problem")).toMatchObject([{ from: "INS-1", type: "cites", fromText: true }]);
  });

  it("US4-4: a changed insight flags only the sections and slides that cite it, plus their documents", async () => {
    await scanned();
    write("docs/research.md", RESEARCH.replace("abandon login on mobile", "abandon login on mobile and desktop"));
    const p = Project.open(root, { now });
    await p.scan();
    const suspects = p.graph.suspects().map((s) => s.node.id);
    expect(suspects).toEqual(["ART-1#problem", "ART-2#the-problem", "ART-1", "ART-2"]);
    expect(suspects).not.toContain("ART-1#opportunity");
    expect(suspects).not.toContain("ART-2#the-opportunity");
  });

  it("removes a link when its citation is deleted, and a section node when its heading goes", async () => {
    await scanned();
    write("docs/artifacts/art-1.md", BUSINESS_CASE.replace(" [INS-2]", "").replace("## Costs\nTwo sprints.\n", ""));
    const p = Project.open(root, { now });
    const result = await p.scan();
    expect(result.unlinked).toEqual(["INS-2 -> ART-1#opportunity"]);
    expect(result.removed).toEqual(["ART-1#costs"]);
    expect(p.graph.getNode("ART-1#costs")).toBeUndefined();
  });

  it("warns about citations to IDs that are not defined", async () => {
    write("docs/artifacts/art-1.md", BUSINESS_CASE.replace("[INS-2]", "[INS-404]"));
    const { result } = await scanned();
    expect(result.warnings).toEqual(["ART-1#opportunity cites INS-404, which is not defined anywhere scanned"]);
  });

  it("links front-matter derived_from regardless of file order", async () => {
    write("docs/a-first.md", "---\nid: ART-9\ntype: artifact\nderived_from: [INS-2]\n---\nx\n");
    const { p, result } = await scanned();
    expect(result.warnings).toEqual([]);
    expect(p.graph.linksTo("ART-9").map((l) => l.from)).toEqual(["INS-2"]);
  });
});

describe("files linked by path", () => {
  it("types decks and documents as artifacts and research files as evidence", async () => {
    const { p } = await scanned();
    write("slides/pitch.pptx", "PK\u0003\u0004\u0000\u0000binary");
    write("research/interview-sam.pdf", "%PDF-1.7\u0000");
    write("README.md", "# Readme\n");
    write("src/app.ts", "x\n");
    expect(p.link("INS-1", "slides/pitch.pptx", "cites").to).toBe("slides/pitch.pptx");
    p.link("research/interview-sam.pdf", "INS-1", "cites");
    p.link("INS-1", "README.md");
    p.link("INS-1", "src/app.ts");
    expect(p.graph.getNode("slides/pitch.pptx")?.type).toBe("artifact");
    expect(p.graph.getNode("research/interview-sam.pdf")?.type).toBe("evidence");
    expect(p.graph.getNode("README.md")?.type).toBe("artifact");
    expect(p.graph.getNode("src/app.ts")?.type).toBe("code");
  });

  it("hashes binary files by bytes and text files ignoring line endings", () => {
    write("a.bin", "a\u0000b ");
    write("b.bin", "a\u0000b");
    write("a.txt", "x  \r\n");
    write("b.txt", "x\n");
    expect(fileHash(join(root, "a.bin"))).not.toBe(fileHash(join(root, "b.bin")));
    expect(fileHash(join(root, "a.txt"))).toBe(fileHash(join(root, "b.txt")));
  });
});

describe("newArtifact", () => {
  it("writes a template with the next ID, front-matter and upstream links, and scans it", async () => {
    const { p } = await scanned();
    expect(nextArtifactId(p)).toBe("ART-3");
    const { id, path } = newArtifact(p, {
      template: "market-sizing",
      title: "Passwordless: market size",
      from: ["INS-1"],
      date: "2026-09-28",
    });
    expect(id).toBe("ART-3");
    expect(path).toBe("docs/artifacts/art-3-passwordless-market-size.md");
    expect(read(path)).toContain('title: "Passwordless: market size"');
    expect(p.graph.getNode("ART-3")).toMatchObject({ kind: "market-sizing", stage: "discover", title: "Passwordless: market size" });
    expect(p.graph.getNode("ART-3#top-down-sizing")?.kind).toBe("section");
    expect(p.graph.linksTo("ART-3").map((l) => l.from)).toContain("INS-1");
  });

  it("uses project templates over built-in ones and rejects unknown names and taken IDs", async () => {
    const { p } = await scanned();
    write(".coreflow/templates/deck.md", "---\nid: {{id}}\ntype: artifact\nkind: deck\nstage: pitch\n---\n# {{title}}\n## Only slide\n");
    const { id } = newArtifact(p, { template: "deck", title: "Custom" });
    expect(p.graph.getNode(id)).toMatchObject({ kind: "deck", stage: "pitch" });
    expect(() => newArtifact(p, { template: "nope", title: "x" })).toThrow(/Unknown template "nope"/);
    expect(() => newArtifact(p, { template: "deck", title: "x", id: "ART-1" })).toThrow(/already exists/);
  });
});

describe("stage gates from files", () => {
  it("US3: blocks until approved, passes, then blocks when evidence changes and when approved content changes", async () => {
    const { p } = await scanned();
    let [report] = runGates(p);
    expect(report!.items).toEqual(["ART-1", "ART-2"]);
    expect(report!.status).toBe("blocked");
    expect(report!.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(["Approval"]);

    approveGate(p, "G-BC", "craig", now());
    report = runGate(p, p.config.gates[0]!);
    expect(report.status).toBe("passed");

    // US3-2: an insight the business case cites changes.
    write("docs/research.md", RESEARCH.replace("30%", "10%"));
    const p2 = Project.open(root, { now });
    await p2.scan();
    report = runGates(p2, "G-BC")[0]!;
    expect(report.status).toBe("blocked");
    const fresh = report.checks.find((c) => c.name === "Freshness")!;
    expect(fresh.subjects).toEqual(["ART-1", "ART-2"]);
    expect(fresh.message).toContain("rests on changed INS-2");

    // The PM updates the section; the approval no longer covers what is there now.
    write("docs/artifacts/art-1.md", BUSINESS_CASE.replace("Fewer resets", "Somewhat fewer resets"));
    await p2.scan();
    p2.graph.confirm("ART-1#opportunity");
    p2.graph.confirm("ART-2#the-opportunity");
    p2.graph.confirm("ART-1");
    p2.graph.confirm("ART-2");
    report = runGates(p2, "business-case")[0]!;
    expect(report.checks.find((c) => c.name === "Freshness")?.passed).toBe(true);
    expect(report.staleApprovals).toEqual([{ by: "craig", at: expect.any(String), reason: "ART-1 changed since approval" }]);
    expect(report.status).toBe("blocked");
    expect(formatGate(report)).toContain("Approval by craig no longer counts: ART-1 changed since approval");

    approveGate(p2, "G-BC", "craig", now());
    expect(runGates(p2)[0]!.status).toBe("passed");
    expect(JSON.parse(read(".coreflow/approvals.json")).approvals).toHaveLength(1);
  });

  it("blocks a stage whose artifacts cite no evidence, and names the missing kind", async () => {
    write("docs/artifacts/art-2.md", "---\nid: ART-2\ntype: artifact\nkind: brief\nstage: business-case\n---\n# Unsourced\n");
    write("docs/artifacts/art-1.md", BUSINESS_CASE.replace(/ \[INS-\d\]/g, ""));
    const { p } = await scanned();
    approveGate(p, "G-BC", "craig", now());
    const report = runGates(p)[0]!;
    const failed = Object.fromEntries(report.checks.filter((c) => !c.passed).map((c) => [c.name, c.message]));
    expect(failed).toEqual({
      "Required: deck": "Need at least 1 deck, found 0",
      "Evidence Coverage": "2 artifact(s) cite no evidence: ART-1, ART-2",
    });
  });

  it("refuses unknown gates and empty stages", async () => {
    const { p } = await scanned();
    expect(() => runGates(p, "G-NOPE")).toThrow(/Unknown gate "G-NOPE"/);
    p.config.gates.push({ ...p.config.gates[0]!, id: "G-EMPTY", stage: "launch" });
    expect(() => approveGate(p, "G-EMPTY", "craig")).toThrow(/Nothing is in stage "launch"/);
    expect(() => approveGate(p, "G-BC", " ")).toThrow(/needs a name/);
  });
});
