# CoreFlow

CoreFlow keeps product decisions tied to the evidence behind them. It records how research
flows into insights, requirements, business cases, decks, specs, code and tests. When
something upstream changes, it tells you everything downstream that now needs a second look,
and lifecycle gates won't pass until those items are reviewed.

It is built to run inside the coding agents people already use (Claude Code, Kiro, and tools
that load the Agent Plugins format) rather than as another IDE.

> Status: early. The trace graph, CLI, MCP server and the Claude Code plugin / Kiro power work
> and are tested. Lifecycle stages, research and artifact generation are next. See
> [spec 006](specs/006-coreflow-evidence-lifecycle/spec.md).

## Try it

In Claude Code:

```
/plugin marketplace add jhiral8/AI-PLC
/plugin install coreflow@coreflow
```

In Kiro, add the power from `plugins/coreflow` (see [its README](plugins/coreflow/README.md)).
From a terminal, in any git repository:

```bash
npx -y -p github:jhiral8/AI-PLC coreflow init        # add --kiro for Kiro hooks
npx -y -p github:jhiral8/AI-PLC coreflow suspects
```

CoreFlow reads IDs from Markdown under `specs/` and `docs/`: `- **FR-001**: ...`, `### REQ-12: ...`,
or front-matter `id:` / `type:` / `derived_from:`. Once installed, naming an ID in a prompt
("implement REQ-7") links the files the agent writes to it. Change REQ-7 later and
`coreflow suspects` lists those files and tests until someone confirms them.

This repository traces itself: `.coreflow/traces.json` links spec 006's requirements to the
code and tests that implement them, and CI fails if any of them is suspect.

## Packages

| Package | What it does |
|---|---|
| [`@coreflow/trace`](packages/trace) | The trace graph: nodes, links, content hashes, upstream/downstream traversal, suspect propagation, confirm, JSON persistence. |
| [`@coreflow/gates`](packages/gates) | Lifecycle gate evaluation: required artifacts, evidence coverage, freshness, evidence quality, approval, block or warn mode. |
| [`@coreflow/constraints`](packages/constraints) | Checks requirement text against a component manifest and constraint rules. |
| [`@coreflow/scanner`](packages/scanner) | Scans TypeScript, Angular and Python code into a component manifest and diffs scans. |
| [`@coreflow/store`](packages/store) | Keeps the graph in step with a repo: Markdown definitions, file hashes, `.coreflow/traces.json`, agent sessions. |
| [`@coreflow/cli`](packages/cli) | The `coreflow` command and the hook handler shared by Claude Code and Kiro. |
| [`@coreflow/mcp`](packages/mcp) | MCP server with scan, link, trace, suspects, confirm, mark-changed and work tools. |
| [`plugins/coreflow`](plugins/coreflow) | Claude Code plugin and Kiro power: skill, MCP server, hooks, bundled scripts. |

## Example

```ts
import { TraceGraph, contentHash } from "@coreflow/trace";

const g = new TraceGraph();
g.upsertNode({ id: "INS-1", type: "insight", hash: contentHash("Users abandon login") });
g.upsertNode({ id: "REQ-1", type: "requirement", hash: contentHash("Passwordless login") });
g.upsertNode({ id: "DECK-1", type: "artifact", title: "Business case deck" });
g.link({ from: "INS-1", to: "REQ-1", type: "informs" });
g.link({ from: "INS-1", to: "DECK-1", type: "references" });

g.updateContent("INS-1", contentHash("Users abandon login on mobile only"));
g.suspects(); // REQ-1 and DECK-1, both caused by INS-1
g.confirm("REQ-1"); // reviewed: REQ-1 still holds
```

## Development

Requires Node 22+ and pnpm 9.

```bash
pnpm install
pnpm check    # typecheck + tests
pnpm bundle   # rebuild plugins/coreflow/scripts after changing cli, mcp, store or trace
pnpm coreflow suspects   # run the CLI from source
```

Features are specified with [Spec Kit](https://github.com/github/spec-kit); the skills are
installed for Claude Code (`.claude/skills`) and Kiro CLI (`.kiro/prompts`). Project
principles are in [`.specify/memory/constitution.md`](.specify/memory/constitution.md).

Where this code came from is in [docs/provenance.md](docs/provenance.md).
