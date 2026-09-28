---
name: coreflow
description: Use when working on a requirement, insight, spec or other ID such as REQ-7, FR-006 or INS-3; when writing a PM artifact (market sizing, competitive analysis, business case, deck); when asked what a change affects, what is stale or suspect, whether a stage gate passes, or where something came from. Traces research to insights, requirements, PM artifacts, specs, code and tests with CoreFlow.
---

# CoreFlow traces

CoreFlow keeps a golden thread from evidence to insights, requirements, specs, code and tests
in `.coreflow/traces.json`. When something upstream changes, everything downstream is
**suspect** until someone checks it and confirms it.

## Where IDs come from

IDs are defined in Markdown under `specs/` and `docs/` (configurable in `.coreflow/config.json`):

- Bold inline: `- **FR-006**: The system MUST ...`
- Headings: `### REQ-12: Passwordless login`
- Front-matter: `id: ART-2`, `type: artifact`, optional `kind`, `stage` and
  `derived_from: [INS-1]`. Each `##` section becomes its own node, such as `ART-2#problem`.

Citations are bracketed IDs anywhere in the text: `[INS-3]` or `[INS-3, EV-2]`. Each one links
the cited item to the section (or definition) it appears in, so a change flags exactly the
sections and slides that relied on it. Deleting a citation removes the link.

Prefixes map to types: EV evidence, INS insight, REQ/FR/NFR/SC/US requirement, DEC decision,
ART artifact, DES design, SPEC spec. Files linked by path are named by their path: code,
tests, and artifacts such as decks and PDFs (files under `research/` or `evidence/` are evidence).

## PM artifacts

- Create them with `coreflow_new_artifact` (templates: market-sizing, competitive-analysis,
  business-case, deck, plus any in `.coreflow/templates/`). Pass `from` with what the artifact
  is based on, such as the business case a deck presents.
- Fill every section. Cite the insight or evidence behind each claim in that section. If a
  claim has no source, say so to the user instead of inventing one.
- A deck is Markdown with one `##` section per slide, so each slide traces to its sources.

## Gates

`coreflow_gate` checks whether a stage can close: required artifacts exist, trace back to
evidence, nothing is suspect, and a person approved the current content. Report each failing
check and what would fix it. Never approve a gate or suggest you can: approval is a person's
decision, recorded with `coreflow approve <gate> --by <name>` in a terminal, and it lapses
when approved content changes.

## While you work

- When the user names IDs in a prompt, the files you write are linked to them automatically
  (`implements` for code, `validates` for tests). If the task implements IDs the prompt did not
  name, call `coreflow_work` with those IDs before writing files. Call it with `[]` when you
  move on to unrelated work.
- Before building on a requirement, call `coreflow_trace` or `coreflow_suspects`. If it is
  suspect, tell the user which upstream change caused it and ask whether it still holds.
- When you change a requirement or insight, run `coreflow_suspects` afterwards and list what
  now needs review. Don't fix downstream items silently.
- Record links the hooks cannot see with `coreflow_link` (from the item relied on to the item
  relying on it), such as an insight informing a requirement.
- Use `coreflow_confirm` only after the item has actually been checked against its changed
  upstream, and say what you checked. Never confirm just to clear the list.
- Use `coreflow_mark_changed` with a reason for changes a text diff cannot show, such as a
  withdrawn interview.

## Tools

| Tool | Use |
|---|---|
| `coreflow_scan` | Re-read definitions and rehash files. Also creates `.coreflow/` if missing. |
| `coreflow_trace` | What an item rests on and what rests on it. |
| `coreflow_suspects` | Everything whose upstream changed, with causes. |
| `coreflow_link` | Add a link. |
| `coreflow_confirm` | Mark a reviewed item as still holding. |
| `coreflow_mark_changed` | Flag a change a hash cannot show. |
| `coreflow_work` | Set the IDs new files are linked to. |
| `coreflow_new_artifact` | Create a PM artifact from a template. |
| `coreflow_gate` | Check whether a lifecycle stage can close. |

The same operations are available as a CLI: `coreflow scan|link|trace|suspects|confirm|mark-changed|work|new|gate`, plus `approve` for people.
`coreflow suspects --check` exits 1 when anything is suspect, for CI.
