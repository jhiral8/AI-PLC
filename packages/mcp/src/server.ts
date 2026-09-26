/**
 * @file CoreFlow MCP server
 * @description
 * The same operations as the CLI, as MCP tools. Each call reopens the project from disk and
 * scans first, so the server never works from a stale copy while people and hooks edit files.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatScan, formatSuspects, formatTrace, Project } from "@coreflow/store";
import { LinkType } from "@coreflow/trace";
import { z } from "zod";

export interface ServerOptions {
  /** Returns the project root; called on every tool call. */
  root: () => string;
  version?: string;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: "coreflow", version: options.version ?? "0.1.0" });

  async function withProject(fn: (p: Project) => string | Promise<string>, save = true): Promise<ToolResult> {
    try {
      const root = options.root();
      if (!Project.isInitialised(root)) {
        return { ...text(`CoreFlow is not set up in ${root}. Run "coreflow init" there first.`), isError: true };
      }
      const project = Project.open(root);
      await project.scan();
      const result = await fn(project);
      if (save) project.save();
      return text(result);
    } catch (error) {
      return { ...text((error as Error).message), isError: true };
    }
  }

  server.registerTool(
    "coreflow_scan",
    {
      title: "Scan traces",
      description: "Re-read Markdown definitions (FR-, REQ-, INS-... IDs) and rehash linked files. Reports what changed.",
      inputSchema: {},
    },
    async () => {
      try {
        const root = options.root();
        const project = Project.isInitialised(root) ? Project.open(root) : Project.init(root);
        const result = await project.scan();
        project.save();
        return text(formatScan(result));
      } catch (error) {
        return { ...text((error as Error).message), isError: true };
      }
    },
  );

  server.registerTool(
    "coreflow_link",
    {
      title: "Link two items",
      description:
        "Record that `to` relies on `from` (links point downstream: evidence -> insight -> requirement -> spec -> code/test). Accepts IDs or repo file paths.",
      inputSchema: {
        from: z.string().describe("The upstream item: an ID such as INS-3 or a file path"),
        to: z.string().describe("The downstream item that relies on it"),
        type: LinkType.optional().describe("Link type; defaults to derived_from"),
      },
    },
    ({ from, to, type }) =>
      withProject((p) => {
        const link = p.link(from, to, type ?? "derived_from", { auto: true });
        return `Linked ${link.from} -> ${link.to} (${link.type})`;
      }),
  );

  server.registerTool(
    "coreflow_trace",
    {
      title: "Show an item's golden thread",
      description: "Show what an item rests on (upstream) and what rests on it (downstream), marking suspect items.",
      inputSchema: {
        id: z.string().describe("An ID or repo file path"),
        direction: z.enum(["up", "down", "both"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ id, direction }) => withProject((p) => formatTrace(p.graph, p.resolveRef(id), direction ?? "both")),
  );

  server.registerTool(
    "coreflow_suspects",
    {
      title: "List suspect items",
      description:
        "List items whose upstream changed since they were last confirmed, with the change that caused each. Check this before building on a requirement.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => withProject((p) => formatSuspects(p.graph.suspects())),
  );

  server.registerTool(
    "coreflow_confirm",
    {
      title: "Confirm an item still holds",
      description:
        "After reviewing a suspect item against its changed upstream, record that it still holds. Only do this when the item really was checked; otherwise update it first.",
      inputSchema: {
        id: z.string().describe("The reviewed item"),
        from: z.string().optional().describe("Confirm only against this upstream item"),
      },
    },
    ({ id, from }) =>
      withProject((p) => {
        const count = p.graph.confirm(p.resolveRef(id), from ? p.resolveRef(from) : undefined);
        return `Confirmed ${count} link${count === 1 ? "" : "s"} into ${id}`;
      }),
  );

  server.registerTool(
    "coreflow_mark_changed",
    {
      title: "Mark an item changed",
      description: "Flag a change a text diff cannot show, such as a withdrawn interview or a reversed decision.",
      inputSchema: { id: z.string(), reason: z.string().min(1) },
    },
    ({ id, reason }) =>
      withProject((p) => {
        const resolved = p.resolveRef(id);
        p.graph.markChanged(resolved, reason);
        return `Marked ${resolved} changed. ${p.graph.downstream(resolved).length} downstream items are now suspect.`;
      }),
  );

  server.registerTool(
    "coreflow_work",
    {
      title: "Set the requirements being worked on",
      description:
        "Set the IDs the current work implements. Files written afterwards are linked to them automatically. Pass an empty list to stop linking.",
      inputSchema: {
        ids: z.array(z.string()).describe("IDs such as REQ-7 or FR-006"),
        session: z.string().optional().describe("Agent session ID; defaults to the shared default session"),
      },
    },
    ({ ids, session }) =>
      withProject((p) => {
        const active = p.setActive(session ?? "default", ids);
        return active.length ? `Files written now link to ${active.join(", ")}.` : "Automatic linking is off.";
      }),
  );

  return server;
}
