/**
 * @file Artifact templates
 * @description
 * Starting points for PM artifacts. Every template is a Markdown file with front-matter, so
 * the artifact is a trace node, and each `##` section is a node of its own that the citations
 * inside it (`[INS-3]`, `[EV-2]`) link to.
 *
 * `market-sizing` and `competitive-analysis` are adapted from product-on-purpose/pm-skills
 * (Apache-2.0, commit 1cef1a9), see THIRD_PARTY_NOTICES.md. Changes: CoreFlow front-matter,
 * citation guidance in each section, sections trimmed. `business-case` and `deck` are
 * CoreFlow's own; the business case borrows the section order of pm-skills' solution brief.
 *
 * A project can add or override templates with `.coreflow/templates/<name>.md`.
 */

export interface Template {
  name: string;
  description: string;
  kind: string;
  stage: string;
  text: string;
}

const CITE = "<!-- Cite the insights and evidence each claim rests on, like [INS-3] or [EV-2]. -->";

function frontMatter(kind: string): string {
  return `---
id: {{id}}
type: artifact
kind: ${kind}
stage: {{stage}}
title: {{title_yaml}}
created: {{date}}
status: draft
derived_from: [{{derived_from}}]
---
`;
}

export const TEMPLATES: Template[] = [
  {
    name: "market-sizing",
    description: "TAM, SAM and SOM, top-down and bottom-up, with assumptions (pm-skills)",
    kind: "market-sizing",
    stage: "discover",
    text: `${frontMatter("market-sizing")}
# {{title}}

${CITE}

## Executive summary
<!-- 3-5 sentences: what is being sized, headline TAM/SAM/SOM range with confidence, the single most important assumption. -->

## Market definition
<!-- Exactly what is included and excluded, geography and time frame. -->

- **Included:**
- **Excluded:**
- **Geography / horizon:**

## Top-down sizing

| Layer | Number | Method | Source | Confidence |
|---|---|---|---|---|
| TAM | | | [EV-?] | |
| SAM | | | | |
| SOM | | | | |

## Bottom-up sizing
<!-- Build from unit economics. If bottom-up data is unavailable, say so; do not invent counts. -->

| Segment | Customers | Revenue per customer | Subtotal | Source |
|---|---|---|---|---|

## Synthesis
<!-- Where the methods agree, where they diverge and why, and the central estimate with a range. -->

## Key assumptions

| Assumption | Source | Confidence | What changes if wrong |
|---|---|---|---|

## Confidence and limitations
<!-- Most and least confident, and the research that would raise confidence. -->
`,
  },
  {
    name: "competitive-analysis",
    description: "Competitors, feature and pricing comparison, positioning and white space (pm-skills)",
    kind: "competitive-analysis",
    stage: "discover",
    text: `${frontMatter("competitive-analysis")}
# {{title}}

${CITE}

## Scope
<!-- The product area and customer segment this analysis covers. -->

## Competitors

| Competitor | Direct or indirect | Target market | Source |
|---|---|---|---|

## Feature comparison
<!-- Rate as Full, Partial, None or Unknown. -->

| Feature | Us | Competitor A | Competitor B | Competitor C |
|---|---|---|---|---|

## Pricing

| Competitor | Entry | Mid tier | Enterprise | Model |
|---|---|---|---|---|

## Positioning and white space
<!-- Two axes that matter to buyers, where each competitor sits, and the underserved position. -->

## Competitor notes
<!-- One short paragraph per competitor: who they serve best, their edge, their weaknesses, recent moves. -->

## Implications
<!-- What this means for our positioning and roadmap. -->
`,
  },
  {
    name: "business-case",
    description: "Problem, opportunity, proposal, costs, benefits, risks and the decision asked for",
    kind: "business-case",
    stage: "business-case",
    text: `${frontMatter("business-case")}
# {{title}}

${CITE}

## Decision requested
<!-- One or two sentences: what you want approved, and by when. -->

## Problem
<!-- Who has the problem, how often, and what it costs them today. Cite interviews and data. -->

## Opportunity
<!-- Market size and why now. Cite the market sizing and competitive analysis. -->

## Proposed solution
<!-- What we would build, in plain language, and what we are deliberately not doing. -->

## Costs

| Item | One-off | Recurring | Basis |
|---|---|---|---|

## Benefits and success metrics

| Metric | Today | Target | By when | Basis |
|---|---|---|---|---|

## Options considered
<!-- Including doing nothing. Why the proposal beats each option. -->

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|

## Assumptions to validate
<!-- The assumptions the case depends on most, and how each will be tested. -->
`,
  },
  {
    name: "deck",
    description: "A slide deck in Markdown: one ## section per slide, each citing its sources",
    kind: "deck",
    stage: "business-case",
    text: `${frontMatter("deck")}
# {{title}}

<!-- One "##" section per slide. Keep slides short and cite each claim, like [INS-3]. -->
<!-- Put the business case this deck presents in derived_from above. -->

## The problem

## What we learned

## The opportunity

## Our proposal

## What it costs and what it returns

## Risks

## The decision we need
`,
  },
];

export function renderTemplate(
  template: Template,
  values: { id: string; title: string; stage?: string; derivedFrom?: string[]; date: string },
): string {
  const title = values.title.replace(/\n/g, " ");
  const vars: Record<string, string> = {
    id: values.id,
    title,
    title_yaml: JSON.stringify(title),
    stage: values.stage ?? template.stage,
    date: values.date,
    derived_from: (values.derivedFrom ?? []).join(", "),
  };
  return template.text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => vars[key] ?? whole);
}
