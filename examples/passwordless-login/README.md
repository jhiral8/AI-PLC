# Example: passwordless login

A tiny product idea taken from research to an approved business-case gate.

- `research/interviews.md` holds the evidence (EV-1 to EV-3).
- `docs/insights.md` holds insights that cite it (INS-1, INS-2).
- `docs/artifacts/` holds a business case and a pitch deck. Each section and slide cites the
  insights it uses, and the deck is derived from the business case.
- `.coreflow/config.json` defines the gate: a business case and a deck, citing evidence,
  nothing suspect, approved.

Try it from this folder:

```bash
coreflow gate                  # passes
coreflow trace ART-2 --up      # slide -> insight -> evidence
# Change EV-2's numbers in research/interviews.md, then:
coreflow suspects              # INS-2, the Opportunity section, its slide, both documents
coreflow gate                  # blocked until someone reviews and confirms them
git checkout -- research       # put it back
```

(`coreflow` is `npx -y -p github:jhiral8/AI-PLC coreflow`, or `pnpm coreflow` from the repo root
with `COREFLOW_ROOT=examples/passwordless-login`.)
