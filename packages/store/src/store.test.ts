import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFIXES } from "./config";
import { extractDefinitions } from "./markdown";
import { Project } from "./project";
import { formatSuspects } from "./report";

describe("extractDefinitions", () => {
  it("reads bold inline definitions up to the next blank line or definition", () => {
    const md = [
      "## Requirements",
      "",
      "- **FR-001**: The system MUST store nodes.",
      "  It keeps them in JSON.",
      "- **FR-002:** Each link MUST record a hash.",
      "",
      "Not part of FR-002.",
      "**T-1**: unknown prefix, ignored",
    ].join("\n");
    const defs = extractDefinitions("specs/a.md", md, DEFAULT_PREFIXES);
    expect(defs.map((d) => d.node.id)).toEqual(["FR-001", "FR-002"]);
    expect(defs[0]!.node).toMatchObject({
      type: "requirement",
      title: "The system MUST store nodes.",
      location: "specs/a.md#FR-001",
    });
    expect(defs[1]!.line).toBe(5);
  });

  it("reads heading definitions up to the next heading of the same level", () => {
    const md = ["# PRD", "### REQ-12: Passwordless login", "Body.", "#### Notes", "More.", "### REQ-13 Other", "x"].join("\n");
    const defs = extractDefinitions("docs/prd.md", md, DEFAULT_PREFIXES);
    expect(defs.map((d) => [d.node.id, d.node.title])).toEqual([
      ["REQ-12", "Passwordless login"],
      ["REQ-13", "Other"],
    ]);
    const again = extractDefinitions("docs/prd.md", md.replace("More.", "Changed."), DEFAULT_PREFIXES);
    expect(again[0]!.node.hash).not.toBe(defs[0]!.node.hash);
    expect(again[1]!.node.hash).toBe(defs[1]!.node.hash);
  });

  it("reads front-matter nodes and their declared upstream", () => {
    const md = "---\nid: ART-1\ntype: artifact\nderived_from: [INS-1, INS-2]\n---\n# Business case\n\nText.\n";
    const [def] = extractDefinitions("docs/bc.md", md, DEFAULT_PREFIXES);
    expect(def!.node).toMatchObject({ id: "ART-1", type: "artifact", title: "Business case", location: "docs/bc.md" });
    expect(def!.derivedFrom).toEqual(["INS-1", "INS-2"]);
  });

  it("skips fenced code blocks", () => {
    const md = "```\n- **FR-9**: example only\n```\n- **FR-1**: real\n";
    expect(extractDefinitions("a.md", md, DEFAULT_PREFIXES).map((d) => d.node.id)).toEqual(["FR-1"]);
  });
});

describe("Project", () => {
  let root: string;
  let clock: number;
  const now = () => new Date(Date.UTC(2026, 8, 26, 0, 0, clock++));

  const write = (rel: string, text: string) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  };

  beforeEach(() => {
    clock = 0;
    root = mkdtempSync(join(tmpdir(), "coreflow-"));
    write("docs/research.md", "- **INS-1**: Users abandon login\n");
    write(
      "specs/login.md",
      "---\nid: SPEC-1\ntype: spec\nderived_from: [REQ-1]\n---\n# Login spec\n\n- **REQ-1**: Passwordless login\n",
    );
    write("src/login.ts", "export const login = 1;\n");
    write("src/login.test.ts", "test('login', () => {});\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function linkedProject() {
    const p = Project.init(root, { now });
    await p.scan();
    p.link("INS-1", "REQ-1", "informs");
    p.setActive("s1", ["REQ-1"]);
    p.recordEdit("s1", join(root, "src/login.ts"));
    p.recordEdit("s1", join(root, "src/login.test.ts"));
    p.save();
    return p;
  }

  it("finds definitions and declared links on scan", async () => {
    const p = Project.init(root, { now });
    const result = await p.scan();
    expect(result.added.sort()).toEqual(["INS-1", "REQ-1", "SPEC-1"]);
    expect(result.linked).toEqual(["REQ-1 -> SPEC-1"]);
    expect(p.graph.getNode("REQ-1")?.location).toBe("specs/login.md#REQ-1");
  });

  it("links active IDs to edited files: implements for code, validates for tests", async () => {
    const p = await linkedProject();
    const links = p.graph.linksFrom("REQ-1").map((l) => [l.to, l.type, l.auto]);
    expect(links).toContainEqual(["src/login.ts", "implements", true]);
    expect(links).toContainEqual(["src/login.test.ts", "validates", true]);
    expect(p.graph.getNode("src/login.test.ts")?.type).toBe("test");
  });

  it("US1-1: a changed insight makes everything downstream suspect with the insight as cause", async () => {
    await linkedProject();
    write("docs/research.md", "- **INS-1**: Users abandon login on mobile only\n");
    const p = Project.open(root, { now });
    const scan = await p.scan();
    expect(scan.changed).toEqual(["INS-1"]);
    const suspects = p.graph.suspects();
    expect(suspects.map((s) => s.node.id).sort()).toEqual(["REQ-1", "SPEC-1", "src/login.test.ts", "src/login.ts"]);
    expect(suspects.every((s) => s.causes.map((c) => c.id).join() === "INS-1")).toBe(true);
    expect(formatSuspects(suspects)).toContain("because INS-1 changed");
  });

  it("US1-2: line-ending and trailing-space changes are not changes", async () => {
    await linkedProject();
    write("docs/research.md", "- **INS-1**: Users abandon login   \r\n\r\n");
    const p = Project.open(root, { now });
    expect((await p.scan()).changed).toEqual([]);
    expect(p.graph.suspects()).toEqual([]);
  });

  it("US1-3: confirming the requirement clears it and what was suspect only because of it", async () => {
    await linkedProject();
    write("docs/research.md", "- **INS-1**: Users abandon login on mobile only\n");
    const p = Project.open(root, { now });
    await p.scan();
    p.graph.confirm("REQ-1");
    expect(p.graph.suspects()).toEqual([]);
  });

  it("US1-4: a change mark with a reason makes downstream suspect without a text change", async () => {
    const p = await linkedProject();
    p.graph.markChanged("INS-1", "interview withdrawn");
    expect(p.graph.suspects().map((s) => s.node.id)).toContain("src/login.ts");
    expect(formatSuspects(p.graph.suspects())).toContain("INS-1: interview withdrawn");
  });

  it("marks a definition changed when it is removed, and a file when it is deleted", async () => {
    await linkedProject();
    write("docs/research.md", "Nothing here now.\n");
    rmSync(join(root, "src/login.ts"));
    const p = Project.open(root, { now });
    const scan = await p.scan();
    expect(scan.removed.sort()).toEqual(["INS-1", "src/login.ts"]);
    expect(p.graph.getNode("INS-1")?.changed?.reason).toBe("definition removed from docs/research.md");
    // Scanning again does not re-mark, so a confirm is not undone.
    p.graph.confirm("REQ-1");
    expect((await p.scan()).removed).toEqual([]);
  });

  it("rehashes code files on scan, so edits upstream of a test show up", async () => {
    const p = await linkedProject();
    p.link("src/login.ts", "src/login.test.ts", "validates");
    write("src/login.ts", "export const login = 2;\n");
    expect((await p.scan()).changed).toEqual(["src/login.ts"]);
    expect(p.graph.suspects().map((s) => s.node.id)).toEqual(["src/login.test.ts"]);
  });

  it("uses prompt IDs as the active set, and keeps it when a prompt names none", async () => {
    const p = Project.init(root, { now });
    await p.scan();
    expect(p.notePrompt("s2", "Please implement REQ-1 and check INS-1; ignore REQ-99")).toEqual(["REQ-1", "INS-1"]);
    expect(p.notePrompt("s2", "carry on")).toEqual(["REQ-1", "INS-1"]);
    expect(p.activeIds("other")).toEqual([]);
  });

  it("lets the shared default session (CLI, MCP) override an agent session when set later", async () => {
    const p = Project.init(root, { now });
    await p.scan();
    p.notePrompt("agent", "REQ-1");
    p.setActive("default", ["INS-1"]);
    expect(p.activeIds("agent")).toEqual(["INS-1"]);
    p.notePrompt("agent", "back to REQ-1");
    expect(p.activeIds("agent")).toEqual(["REQ-1"]);
  });

  it("rescans Markdown on edit instead of linking it, and ignores excluded or outside paths", async () => {
    const p = await linkedProject();
    write("specs/login.md", "---\nid: SPEC-1\ntype: spec\n---\n# Login spec\n\n- **REQ-1**: Passkey login\n");
    expect(p.recordEdit("s1", join(root, "specs/login.md"))).toMatchObject({ rescanned: true, linked: [] });
    expect(p.graph.suspects().map((s) => s.node.id)).toContain("src/login.ts");
    expect(p.recordEdit("s1", join(root, "node_modules/x/index.js")).linked).toEqual([]);
    expect(p.recordEdit("s1", "/etc/hosts").linked).toEqual([]);
  });

  it("does not create nodes for edits when nothing is active", async () => {
    const p = Project.init(root, { now });
    await p.scan();
    p.recordEdit("nobody", join(root, "src/login.ts"));
    expect(p.graph.getNode("src/login.ts")).toBeUndefined();
  });

  it("round-trips through traces.json and keeps session state out of git", async () => {
    await linkedProject();
    const saved = JSON.parse(readFileSync(join(root, ".coreflow/traces.json"), "utf8"));
    expect(saved.version).toBe(1);
    expect(readFileSync(join(root, ".coreflow/.gitignore"), "utf8")).toContain("session.json");
    const p = Project.open(root, { now });
    expect(p.graph.linksFrom("REQ-1")).toHaveLength(3);
  });

  it("finds the root from a subfolder", () => {
    Project.init(root, { now });
    expect(Project.findRoot(join(root, "src"), {})).toBe(root);
    expect(Project.findRoot(join(root, "src"), { COREFLOW_ROOT: "/x" })).toBe("/x");
  });
});
