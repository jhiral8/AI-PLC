// Bundles the CLI and MCP server into single files the plugins run with plain `node`.
// Output is committed so plugin installs need no build; CI checks it is up to date.
import { chmodSync } from "node:fs";
import { build } from "esbuild";

const outdir = "plugins/coreflow/scripts";
const entries = {
  coreflow: "packages/cli/src/main.ts",
  "coreflow-mcp": "packages/mcp/src/main.ts",
};

await build({
  entryPoints: entries,
  outdir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "inline",
  logLevel: "warning",
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: 'import { createRequire as __cfRequire } from "node:module"; const require = __cfRequire(import.meta.url);' },
});

for (const name of Object.keys(entries)) chmodSync(`${outdir}/${name}.mjs`, 0o755);
