#!/usr/bin/env node
/**
 * @file coreflow-mcp executable (stdio)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Project } from "@coreflow/store";
import { createServer } from "./server";

const server = createServer({
  root: () => Project.findRoot(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()),
});

await server.connect(new StdioServerTransport());
