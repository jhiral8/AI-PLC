# Working in this repository

- Read `.specify/memory/constitution.md` first. The current feature spec is `specs/006-coreflow-evidence-lifecycle/spec.md`.
- pnpm workspace, TypeScript on Node 22+, vitest. Packages export from `src/index.ts` and run from source; only the plugin scripts are bundled.
- Run `pnpm check` (typecheck and tests) before calling work done. After changing `packages/cli`, `mcp`, `store`, `gates` or `trace`, run `pnpm bundle` and commit `plugins/coreflow/scripts`; CI checks they match.
- This repo traces itself. When you implement or change a requirement in spec 006, name its ID (e.g. FR-006) so edits are linked, and run `pnpm coreflow suspects` before finishing; CI fails on suspect items. Confirm an item only after checking it.
- `packages/trace` and `packages/gates` are pure and storage-agnostic. Keep I/O (files, git, MCP) in packages that depend on them, such as `store`, `cli` and `mcp`.
- Any change to suspect propagation or gate results needs a test that shows the new behaviour.
- Model calls go through `setLLMClient` in `packages/constraints/src/lib/llm.ts`. Don't add provider SDKs to core packages.
- Only permissively licensed dependencies (MIT, Apache-2.0, BSD).
