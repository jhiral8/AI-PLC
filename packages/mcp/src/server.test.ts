import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Project } from "@coreflow/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./server";

let root: string;
let client: Client;

const write = (rel: string, text: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text).join("\n"), isError: result.isError ?? false };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "coreflow-mcp-"));
  write("docs/research.md", "- **INS-1**: Users abandon login\n");
  write("specs/login.md", "- **REQ-7**: Passwordless login\n");
  write("src/auth.ts", "export {};\n");
  const server = createServer({ root: () => root });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterEach(async () => {
  await client.close();
  rmSync(root, { recursive: true, force: true });
});

describe("coreflow MCP server", () => {
  it("lists the trace tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "coreflow_confirm",
      "coreflow_link",
      "coreflow_mark_changed",
      "coreflow_scan",
      "coreflow_suspects",
      "coreflow_trace",
      "coreflow_work",
    ]);
  });

  it("explains how to set up when .coreflow is missing, and scan sets it up", async () => {
    expect(await call("coreflow_suspects")).toMatchObject({ isError: true });
    expect((await call("coreflow_scan")).text).toContain("2 added");
    expect(Project.isInitialised(root)).toBe(true);
  });

  it("links, traces, reports suspects and confirms", async () => {
    await call("coreflow_scan");
    await call("coreflow_link", { from: "INS-1", to: "REQ-7", type: "informs" });
    await call("coreflow_link", { from: "REQ-7", to: "src/auth.ts", type: "implements" });
    expect((await call("coreflow_trace", { id: "src/auth.ts", direction: "up" })).text).toContain("informs INS-1");

    await call("coreflow_mark_changed", { id: "INS-1", reason: "interview withdrawn" });
    const suspects = await call("coreflow_suspects");
    expect(suspects.text).toContain("2 suspect items");
    expect(suspects.text).toContain("interview withdrawn");

    await call("coreflow_confirm", { id: "REQ-7" });
    expect((await call("coreflow_suspects")).text).toBe("Nothing is suspect.");
  });

  it("returns tool errors instead of throwing", async () => {
    await call("coreflow_scan");
    const result = await call("coreflow_link", { from: "INS-1", to: "REQ-404" });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("Unknown node or file: REQ-404");
  });

  it("sets the active requirements used by the edit hook", async () => {
    await call("coreflow_scan");
    expect((await call("coreflow_work", { ids: ["REQ-7"] })).text).toContain("REQ-7");
    expect(Project.open(root).activeIds("any-agent-session")).toEqual(["REQ-7"]);
  });
});
