# CoreFlow plugin

One folder that works as a Claude Code plugin and as a Kiro power (Agent Plugins format). Both
share the skill in `skills/coreflow/` and the MCP server in `scripts/coreflow-mcp.mjs`.

| File | Used by |
|---|---|
| `.claude-plugin/plugin.json`, `.mcp.json`, `hooks/hooks.json` | Claude Code |
| `plugin.json`, `mcp.json`, `POWER.md` | Kiro and other Agent Plugins hosts |
| `skills/coreflow/SKILL.md` | both |
| `scripts/coreflow.mjs`, `scripts/coreflow-mcp.mjs` | both; bundled from `packages/cli` and `packages/mcp` by `pnpm bundle` |

## Claude Code

```
/plugin marketplace add jhiral8/AI-PLC
/plugin install coreflow@coreflow
```

Then in a repository run `coreflow_scan` (or ask Claude to "set up CoreFlow"), which creates
`.coreflow/`. The hooks do nothing in repositories without `.coreflow/`.

The hooks: on each prompt, IDs such as `REQ-7` that exist in the repo become the active set;
after each Edit, Write or MultiEdit, the file is linked to the active IDs.

## Kiro

Add the power from `https://github.com/jhiral8/AI-PLC/tree/main/plugins/coreflow`, then run
`npx -y -p github:jhiral8/AI-PLC coreflow init --kiro` in each workspace to create
`.coreflow/` and the Kiro hooks. The power's MCP server and the hooks run through `npx`, which
needs Node 22 and git access to the repository.

## Command line

```bash
npx -y -p github:jhiral8/AI-PLC coreflow help
```
