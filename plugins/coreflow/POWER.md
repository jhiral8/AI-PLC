---
name: coreflow
displayName: CoreFlow traces
description: Trace research, requirements, specs, code and tests, and see what an upstream change makes suspect.
keywords: ["traceability", "requirement", "suspect", "impact", "golden thread", "coreflow", "REQ-", "FR-"]
---

# CoreFlow for Kiro

This power gives Kiro the CoreFlow MCP tools and the `coreflow` skill. Follow
[skills/coreflow/SKILL.md](skills/coreflow/SKILL.md) for how to use them.

Powers cannot carry hooks, so automatic linking needs one extra step in each workspace:

```bash
npx -y -p github:jhiral8/AI-PLC coreflow init --kiro
```

That creates `.coreflow/` and writes `.kiro/hooks/coreflow.json`, which notes requirement IDs
in prompts and links saved files to them.
