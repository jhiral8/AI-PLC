# CoreFlow Constitution

## Core Principles

### I. Evidence Before Output
Every artifact CoreFlow produces or tracks (insight, requirement, business case, deck, spec,
code, test) MUST trace upstream to the evidence it rests on. An artifact with no evidence
link is reported, never silently accepted.

### II. Staleness Is Computed, Not Declared
"Stale" means something upstream changed after a link was confirmed: a content hash no longer
matches, or a person flagged a change a hash cannot show. Age alone never makes an artifact
stale. Clearing a suspect link is an explicit confirm by a person or an agent acting for one.

### III. Files Are the Source of Truth
Artifacts are Markdown with front-matter IDs, and trace data lives in plain files in the
product's own repository. Databases, indexes and web views are caches that can be rebuilt
from the files. Git provides history and review.

### IV. Run Inside Existing Agents
CoreFlow does not ship its own coding agent, chat shell or IDE. It works through a CLI, an
MCP server, Agent Skills and hooks, so it runs in Claude Code, Kiro and any tool that reads
the Agent Plugins format. Capture happens automatically through hooks; a trace that depends
on someone remembering a command will not exist.

### V. Test-First for Core Logic
The trace graph, gate evaluation and constraint checks are pure, storage-agnostic modules
with unit tests written before or alongside the code. A change that alters suspect or gate
results MUST come with a test that shows the new behaviour.

### VI. Small, Usable Increments
Each milestone must be usable on its own on a real product idea. Prefer adopting a
permissively licensed open-source component over writing one. Scope that the market already
serves well (PRD drafting, code execution, design generation) stays out.

## Constraints

- TypeScript on Node 22+, pnpm workspaces, vitest. Python only behind a service boundary
  (for example a research engine).
- Dependencies MUST be MIT, Apache-2.0, BSD or similarly permissive. No AGPL and no
  non-commercial licences in anything that ships.
- Model access goes through a single injectable client so the product is not tied to one
  provider.
- No secrets in the repository. Configuration comes from the environment.

## Development Workflow

- Features follow Spec Kit: specify, clarify, plan, tasks, implement. Specs live in `specs/`.
- `pnpm check` (typecheck and tests) MUST pass before a pull request is ready for review.
- Gates run in "block" mode by default; teams may switch a gate to "warn" in configuration.

## Governance

This constitution takes precedence over other practice documents. Amendments are made by
pull request that states the reason and bumps the version below.

**Version**: 1.0.0 | **Ratified**: 2026-09-26 | **Last Amended**: 2026-09-26
