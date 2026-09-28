import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "@coreflow/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSafe, type CliIO } from "./cli";

let root: string;
let out: string[];
let err: string[];

function io(stdin = ""): CliIO {
  return {
    cwd: root,
    env: {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    readStdin: async () => stdin,
    selfCommand: 'node "/plugins/coreflow/scripts/coreflow.mjs"',
  };
}

const write = (rel: string, text: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};

async function cf(args: string, stdin = ""): Promise<number> {
  out = [];
  err = [];
  const argv = args.match(/"[^"]*"|\S+/g)!.map((a) => a.replace(/^"|"$/g, ""));
  return runSafe(argv, io(stdin));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "coreflow-cli-"));
  mkdirSync(join(root, ".git"));
  write("docs/research.md", "- **INS-1**: Users abandon login\n");
  write("specs/login.md", "- **REQ-7**: Passwordless login\n");
  write("src/auth.ts", "export {};\n");
  write("src/auth.test.ts", "export {};\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("coreflow CLI", () => {
  it("asks for init before anything else", async () => {
    expect(await cf("suspects")).toBe(1);
    expect(err.join()).toContain("coreflow init");
  });

  it("init scans, link and trace show the thread, suspects --check fails after a change", async () => {
    expect(await cf("init")).toBe(0);
    expect(out.join("\n")).toContain("2 added");
    expect(await cf("link INS-1 REQ-7 --type informs")).toBe(0);
    expect(await cf("link REQ-7 src/auth.ts --type implements")).toBe(0);
    expect(await cf("trace REQ-7")).toBe(0);
    expect(out.join("\n")).toMatch(/Upstream:\n\s+informs INS-1/);
    expect(out.join("\n")).toContain("implements src/auth.ts (code)");

    expect(await cf("suspects --check")).toBe(0);
    write("docs/research.md", "- **INS-1**: Users abandon login on mobile\n");
    expect(await cf("suspects --check")).toBe(1);
    expect(out.join("\n")).toContain("src/auth.ts (code)");

    expect(await cf("confirm REQ-7")).toBe(0);
    expect(await cf("suspects --check")).toBe(0);
  });

  it("mark-changed needs a reason and flags downstream", async () => {
    await cf("init");
    await cf("link INS-1 REQ-7");
    expect(await cf("mark-changed INS-1")).toBe(2);
    expect(await cf('mark-changed INS-1 --reason "interview withdrawn"')).toBe(0);
    await cf("suspects --json");
    expect(JSON.parse(out.join(""))[0].causes[0].changed.reason).toBe("interview withdrawn");
  });

  it("reports unknown nodes and link types as usage errors", async () => {
    await cf("init");
    expect(await cf("link INS-1 REQ-99")).toBe(2);
    expect(err.join()).toContain("Unknown node or file: REQ-99");
    expect(await cf("link INS-1 REQ-7 --type owns")).toBe(2);
  });

  it("init --kiro writes Kiro hooks that call this script", async () => {
    await cf("init --kiro");
    const hooks = JSON.parse(readFileSync(join(root, ".kiro/hooks/coreflow.json"), "utf8"));
    expect(hooks.hooks.map((h: { trigger: string }) => h.trigger)).toEqual(["UserPromptSubmit", "PostFileSave", "PostFileCreate"]);
    expect(hooks.hooks[1].action.command).toBe(
      'node "/plugins/coreflow/scripts/coreflow.mjs" hook kiro --event edit --file "{{filePath}}"',
    );
  });
});

describe("coreflow hook", () => {
  it("does nothing and succeeds when the repo has no .coreflow", async () => {
    expect(await cf("hook claude", JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "do REQ-7" }))).toBe(0);
    expect(out).toEqual([]);
    expect(existsSync(join(root, ".coreflow"))).toBe(false);
  });

  it("never fails on bad input", async () => {
    await cf("init");
    expect(await cf("hook claude --weird-flag", "{not json")).toBe(0);
  });

  it("US2-1: Claude Code prompt then edits link the requirement to the files", async () => {
    await cf("init");
    const base = { session_id: "abc", cwd: root };
    expect(await cf("hook claude", JSON.stringify({ ...base, hook_event_name: "UserPromptSubmit", prompt: "Implement REQ-7 please" }))).toBe(0);
    expect(out.join()).toContain("linked to REQ-7 (Passwordless login)");

    for (const file of ["src/auth.ts", "src/auth.test.ts"]) {
      await cf(
        "hook claude",
        JSON.stringify({ ...base, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(root, file) } }),
      );
    }
    const links = Project.open(root).graph.linksFrom("REQ-7");
    expect(links.map((l) => [l.to, l.type, l.auto]).sort()).toEqual([
      ["src/auth.test.ts", "validates", true],
      ["src/auth.ts", "implements", true],
    ]);
  });

  it("stays quiet when the prompt repeats the active IDs", async () => {
    await cf("init");
    const prompt = JSON.stringify({ session_id: "abc", hook_event_name: "UserPromptSubmit", prompt: "REQ-7" });
    await cf("hook claude", prompt);
    await cf("hook claude", prompt);
    expect(out).toEqual([]);
  });

  it("US2-2: Kiro hooks record the same links from --file with no stdin", async () => {
    await cf("init");
    await cf("hook kiro --event prompt", JSON.stringify({ prompt: "work on REQ-7" }));
    await cf('hook kiro --event edit --file "src/auth.ts"');
    const links = Project.open(root).graph.linksFrom("REQ-7");
    expect(links.map((l) => [l.to, l.type])).toEqual([["src/auth.ts", "implements"]]);
  });

  it("warns the agent when the requirement it starts on is already suspect", async () => {
    await cf("init");
    await cf("link INS-1 REQ-7");
    write("docs/research.md", "- **INS-1**: changed\n");
    await cf("hook claude", JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "REQ-7" }));
    expect(out.join()).toContain("[suspect");
  });

  it("US2-3: an automatic link can be reviewed and removed", async () => {
    await cf("init");
    await cf("work REQ-7");
    await cf("hook claude", JSON.stringify({ hook_event_name: "PostToolUse", tool_input: { file_path: join(root, "src/auth.ts") } }));
    expect(Project.open(root).graph.linksFrom("REQ-7")).toHaveLength(1);
    expect(await cf("unlink REQ-7 src/auth.ts")).toBe(0);
    expect(Project.open(root).graph.linksFrom("REQ-7")).toHaveLength(0);
  });
});

describe("coreflow new, gate and approve", () => {
  it("creates artifacts from templates, then gates the stage until someone approves it", async () => {
    await cf("init");
    const configPath = join(root, ".coreflow/config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.gates = [{ id: "G-BC", stage: "business-case", requires: [{ kind: "business-case" }, { kind: "deck" }] }];
    writeFileSync(configPath, JSON.stringify(config));

    expect(await cf("gate")).toBe(1);
    expect(out.join("\n")).toContain("FAIL Required: business-case: Need at least 1 business-case, found 0");

    expect(await cf("new --list")).toBe(0);
    expect(out.join("\n")).toMatch(/business-case\s+Problem, opportunity/);
    expect(await cf('new business-case "Passwordless login" --from INS-1')).toBe(0);
    expect(out.join()).toContain("Created ART-1 at docs/artifacts/art-1-passwordless-login.md");
    expect(await cf('new deck "Passwordless pitch" --from ART-1')).toBe(0);

    expect(await cf("approve G-BC")).toBe(2);
    expect(err.join()).toContain("--by");
    expect(await cf("approve business-case --by craig")).toBe(0);
    expect(out.join()).toContain("Approved ART-1, ART-2 for gate G-BC as craig");

    // INS-1 is upstream of both artifacts but cites no evidence, so coverage still fails.
    expect(await cf("gate G-BC")).toBe(1);
    expect(out.join("\n")).toContain("FAIL Evidence Coverage");
    write("docs/research.md", "- **EV-1**: Interview\n\n- **INS-1**: Users abandon login [EV-1]\n");
    // Changing INS-1 makes both artifacts suspect; confirming them after review clears it.
    expect(await cf("gate G-BC --json")).toBe(1);
    expect(JSON.parse(out.join("")).at(0).checks.find((c: { name: string }) => c.name === "Freshness").passed).toBe(false);
    await cf("confirm ART-1");
    await cf("confirm ART-2");
    expect(await cf("gate G-BC")).toBe(0);
    expect(out.join("\n")).toContain("stage \"business-case\": PASSED");
  });

  it("reports unknown templates and gates as errors", async () => {
    await cf("init");
    expect(await cf('new pitch "x"')).toBe(2);
    expect(err.join()).toContain('Unknown template "pitch"');
    expect(await cf("gate")).toBe(0);
    expect(out.join()).toContain("No gates defined");
  });
});
