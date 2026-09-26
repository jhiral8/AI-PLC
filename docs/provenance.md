# Provenance

This repository restarts CoreFlow from [jhiral8/AI-PM](https://github.com/jhiral8/AI-PM) at
commit `626d1f5` (`main`, 2026-09-26). The reasoning is in the CoreFlow Restart Plan and the
CoreFlow Landscape 2026 report written for this project.

## Ported

| Here | From AI-PM | Changes |
|---|---|---|
| `packages/scanner` | `coreflow/packages/scanner/src` | Copied unchanged. Dropped the unused `@coreflow/core` and `@coreflow/db` dependencies. Its tests run under vitest but are excluded from `tsc`, as they were in AI-PM. |
| `packages/constraints` | `coreflow/packages/core/src/services/constraints` | `constraint-rules`, `manifest-compiler`, `text-analyzer`, `feature-matcher` and their tests. The multi-provider LLM gateway became a small injectable client (`src/lib/llm.ts`); pino became a minimal logger. `document-versioning.service.ts` was left behind because it was tied to Postgres. |
| `packages/trace` | `coreflow/packages/core/src/services/lifecycle/trace-link.service.ts` and the `trace_links` table | Rewritten as a pure in-memory graph with JSON persistence. Traversal and downstream propagation keep the original behaviour. New: string IDs, content hashes on links, explicit change marks, confirm, suspect causes. The original had no tests; this one has 15. |
| `packages/gates` | `coreflow/packages/core/src/services/research/quality-gate.service.ts` | Same thresholds and messages, metrics passed in instead of queried. `requireVerifiedInsights`, which the original accepted but never enforced, is now enforced. Generalised into lifecycle gates (completeness, evidence coverage, freshness, approval). |

## Node type mapping

| AI-PM entity type | CoreFlow node type |
|---|---|
| `research_source` | `evidence` |
| `insight`, `requirement`, `spec`, `plan`, `task` | same |
| `code_trace` | `code` |
| `design_link` | `design` |
| (none) | `decision`, `artifact`, `test` |

## Left behind on purpose

- `coreflow-ide/`: a fork of Roo Code, which shut down on 2026-05-15.
- The agent executor, spec/plan/mockup generators, Figma push and home-made auth.
- The Next.js web app and Drizzle schema. They remain in AI-PM for reference when the web
  workspace is built. The age-based staleness detector from `coreflow-ide` is not used.
- Specs 001–005 stay in AI-PM. Spec 006 here replaces them.
