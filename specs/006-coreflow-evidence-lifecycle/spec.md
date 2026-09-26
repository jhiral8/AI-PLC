# Feature Specification: CoreFlow Evidence-Linked Product Lifecycle

**Feature Branch**: `006-coreflow-evidence-lifecycle`

**Created**: 2026-09-26

**Status**: Draft

**Input**: Restart plan for AI-PM/CoreFlow (see `docs/provenance.md`). Numbering continues from AI-PM specs 001–005.

## Summary

CoreFlow keeps a product's decisions honest as evidence changes. It records how research
evidence flows into insights, requirements, PM artifacts (market research, business cases,
decks), designs, specs, code and tests. When anything upstream changes, it marks everything
downstream as suspect. Lifecycle gates between stages pass only when the stage's artifacts
exist, cite evidence, are not suspect, and are approved.

CoreFlow runs inside existing coding agents (Claude Code, Kiro, and tools that load the
Agent Plugins format) through a CLI, an MCP server, skills and hooks. A web workspace comes
later and reads the same files.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what a change breaks (Priority: P1)

A PM edits a requirement or an insight changes. They ask CoreFlow what is now suspect and
get every downstream spec, file, test, deck and business case that rests on it, with the
upstream change that caused each one.

**Why this priority**: This is the capability no other tool offers end to end, and every
later story builds on it.

**Independent Test**: In a repo with linked Markdown artifacts, change one requirement's text
and run the suspect report. It lists exactly the downstream items and nothing else.

**Acceptance Scenarios**:

1. **Given** INS-1 informs REQ-1 which is implemented by SPEC-1, CODE-1 and TEST-1, **When** INS-1's text changes, **Then** REQ-1, SPEC-1, CODE-1 and TEST-1 are reported suspect with cause INS-1.
2. **Given** a file is re-saved with only line-ending or trailing-space changes, **When** the report runs, **Then** nothing is suspect.
3. **Given** REQ-1 is suspect, **When** the PM confirms REQ-1 against the new INS-1, **Then** REQ-1 and everything that was suspect only because of it are cleared.
4. **Given** an interview is withdrawn, **When** a person marks it changed with a reason, **Then** everything downstream is suspect even though no text changed.

---

### User Story 2 - Links are captured while agents work (Priority: P1)

A developer asks Claude Code or Kiro to implement REQ-7. Without extra steps, CoreFlow
records links from REQ-7 to the files and tests the agent wrote.

**Why this priority**: Traces that depend on people remembering a command do not get made.

**Independent Test**: Run an agent session that implements one requirement ID; afterwards the
trace file contains links from that requirement to the changed files.

**Acceptance Scenarios**:

1. **Given** the plugin is installed in Claude Code, **When** an agent edits files while working on a task that names REQ-7, **Then** links REQ-7 → each edited file are recorded as automatic links.
2. **Given** the same plugin packaged as a Kiro power, **When** the same task runs in Kiro, **Then** the same links are recorded.
3. **Given** an automatic link, **When** a person reviews it, **Then** they can confirm or remove it.

---

### User Story 3 - Gates between lifecycle stages (Priority: P2)

A team defines stages (for example discover, validate, business case, define, build, launch)
and what each stage must produce. Moving to the next stage runs the gate.

**Why this priority**: Turns the trace graph into a product-management workflow; depends on US1.

**Independent Test**: Define a business-case gate that needs a business case and a deck.
Run it with and without those artifacts, with and without a changed insight.

**Acceptance Scenarios**:

1. **Given** the business case and deck exist, cite evidence, are not suspect and are approved, **When** the gate runs, **Then** it passes.
2. **Given** an insight cited by the business case changes, **When** the gate runs, **Then** it is blocked and names the business case, the deck and the insight.
3. **Given** a gate in "warn" mode, **When** checks fail, **Then** the failures are reported and the gate does not block.
4. **Given** research evidence below the quality bar (fewer than 3 insights, average confidence under 60% by default), **When** the gate runs, **Then** it is blocked with the reasons and recommendations.

---

### User Story 4 - Research and artifacts with citations (Priority: P2)

A PM ingests interviews and documents, runs market and competitor research, and generates a
research summary, business case and deck from templates. Every claim links to its source.

**Why this priority**: The PM-facing value; reuses open-source research and deck engines.

**Independent Test**: Take one product idea from three sources to a cited deck; change one
source and check that exactly the slides citing it become suspect.

**Acceptance Scenarios**:

1. **Given** a PDF interview, **When** it is ingested, **Then** it becomes an evidence node with paragraph-level anchors.
2. **Given** a research question, **When** deep research runs, **Then** each finding is saved as evidence with its URL.
3. **Given** a business-case template, **When** it is filled, **Then** each section links to the insights it uses.
4. **Given** a generated deck, **When** a cited source changes, **Then** the affected slides are suspect.

---

### User Story 5 - Constraint-aware requirements (Priority: P3)

While writing requirements, the PM is warned when a requirement needs a component the
codebase does not have, with a suggested alternative.

**Why this priority**: Already built and tested in AI-PM; needs wiring into the new surface.

**Independent Test**: Scan a sample codebase, write a requirement that needs a missing
component, and check the warning.

**Acceptance Scenarios**:

1. **Given** a component manifest from the scanner, **When** a requirement mentions "infinite scroll" and the table lacks it, **Then** a warning suggests pagination.

---

### User Story 6 - Pull-request check (Priority: P3)

When a pull request changes code or specs linked to requirements, a check comments with
items that became suspect.

**Independent Test**: Open a PR that changes a linked requirement; the comment lists the
affected items.

### Edge Cases

- Links that form a cycle must not loop forever.
- A trace file that references a node that no longer exists is rejected with a clear error.
- Two upstream changes meeting at one node are both reported as causes.
- Renamed files keep their node ID when the ID lives in front-matter.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST store nodes and links in a versioned JSON trace file in the product repo.
- **FR-002**: Each link MUST record the upstream node's content hash when made or confirmed.
- **FR-003**: The system MUST report suspect nodes with their causes and distance from the cause.
- **FR-004**: Content hashing MUST ignore line-ending and trailing-whitespace differences.
- **FR-005**: The system MUST support explicit change marks with a reason for changes a hash cannot show.
- **FR-006**: The system MUST provide a CLI and an MCP server exposing link, trace, suspect and confirm.
- **FR-007**: The system MUST ship as a Claude Code plugin and as a Kiro power (Agent Plugins format) sharing one SKILL.md and one MCP server.
- **FR-008**: Gates MUST check completeness, evidence coverage, freshness, evidence quality and approval, in block or warn mode.
- **FR-009**: Artifact templates MUST come from a permissively licensed library (initially product-on-purpose/pm-skills, Apache-2.0).
- **FR-010**: Model access MUST go through one injectable client.

### Key Entities

- **Node**: evidence, insight, requirement, decision, artifact, design, spec, plan, task, code, test. Has an ID, location and content hash.
- **Link**: directed from the thing relied on to the thing relying on it, with a type, confidence, automatic flag and the upstream hash at confirmation.
- **Gate**: stage, required node types, evidence and freshness rules, quality thresholds, approval rule, mode.

## Success Criteria *(mandatory)*

- **SC-001**: On this repository's own specs, changing one requirement lists every affected item with no false positives.
- **SC-002**: At least 80% of links in an agent-built feature are captured automatically.
- **SC-003**: A PM can take one idea from sources to an approved business-case gate without writing links by hand.

## Assumptions

- Early users work in git repositories and use Claude Code or Kiro.
- Hosted collaboration and a web UI are out of scope until User Stories 1–4 are proven.

## Status of Work

- Done in this repository: trace graph with suspect propagation (`packages/trace`), gate evaluation with the ported evidence-quality check (`packages/gates`), component scanner and constraint checker ported from AI-PM (`packages/scanner`, `packages/constraints`).
- Next: file format and CLI, MCP server, Claude Code plugin and Kiro power (User Stories 1–2).
