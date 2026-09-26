# Working in this repository

- Read `.specify/memory/constitution.md` first. The current feature spec is `specs/006-coreflow-evidence-lifecycle/spec.md`.
- pnpm workspace, TypeScript on Node 22+, vitest. Packages export from `src/index.ts`; there is no build step yet.
- Run `pnpm check` (typecheck and tests) before calling work done.
- `packages/trace` and `packages/gates` are pure and storage-agnostic. Keep I/O (files, git, MCP) in new packages that depend on them.
- Any change to suspect propagation or gate results needs a test that shows the new behaviour.
- Model calls go through `setLLMClient` in `packages/constraints/src/lib/llm.ts`. Don't add provider SDKs to core packages.
- Only permissively licensed dependencies (MIT, Apache-2.0, BSD).
