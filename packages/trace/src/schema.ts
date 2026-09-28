/**
 * @file Trace graph schema
 * @description
 * The golden thread as data. Nodes are anything a product decision rests on or produces
 * (evidence, insights, requirements, artifacts such as decks and business cases, designs,
 * specs, code and tests). Links point downstream: from the thing relied on to the thing
 * that relies on it.
 *
 * Ported from AI-PM `trace-link.service.ts` / `trace_links` table, with two changes:
 * - IDs are human-readable strings (`REQ-12`, `INS-4`) instead of UUIDs, because the
 *   source of truth is Markdown front-matter in a git repo.
 * - Each link records the upstream node's content hash at the time it was made, so
 *   "stale" means the upstream text actually changed rather than a flag someone set.
 */

import { z } from "zod";

export const NodeType = z.enum([
  "evidence", // research source: interview, document, URL, dataset (was `research_source`)
  "insight",
  "requirement",
  "decision",
  "artifact", // PM deliverable: market research, business case, deck, brief
  "design", // was `design_link`
  "spec",
  "plan",
  "task",
  "code", // was `code_trace`
  "test",
]);
export type NodeType = z.infer<typeof NodeType>;

export const LinkType = z.enum([
  "derived_from",
  "implements",
  "references",
  "depends_on",
  "validates",
  "informs",
  "cites",
]);
export type LinkType = z.infer<typeof LinkType>;

export const NodeId = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/, "IDs may contain letters, digits and . _ : / # -");

export const TraceNode = z.object({
  id: NodeId,
  type: NodeType,
  title: z.string().optional(),
  /** Where the node lives: a repo path, optionally with an anchor (`docs/prd.md#REQ-12`), or a URL. */
  location: z.string().optional(),
  /** Content hash of the node's current text. Absent for nodes whose content is not tracked. */
  hash: z.string().optional(),
  /** Finer grouping than `type`, e.g. "business-case" or "deck" for artifacts, "section" for parts of a document. */
  kind: z.string().optional(),
  /** Lifecycle stage the node belongs to, e.g. "business-case". Gates collect their stage's nodes by this. */
  stage: z.string().optional(),
  /** Set when a node changed in a way a hash cannot show, e.g. a finding was retracted. */
  changed: z
    .object({ reason: z.string(), at: z.string() })
    .optional(),
});
export type TraceNode = z.infer<typeof TraceNode>;

export const TraceLink = z.object({
  from: NodeId,
  to: NodeId,
  type: LinkType.default("derived_from"),
  confidence: z.number().min(0).max(1).default(1),
  /** True when an agent or hook created the link rather than a person. */
  auto: z.boolean().default(false),
  /** The `from` node's hash when this link was last confirmed. */
  upstreamHash: z.string().optional(),
  createdAt: z.string(),
  confirmedAt: z.string().optional(),
  /** True when the link is written in the files (a citation or `derived_from`); scans add and remove it to match. */
  fromText: z.boolean().optional(),
});
export type TraceLink = z.infer<typeof TraceLink>;
export type TraceLinkInput = z.input<typeof TraceLink>;

export const TraceFile = z.object({
  version: z.literal(1),
  nodes: z.array(TraceNode),
  links: z.array(TraceLink),
});
export type TraceFile = z.infer<typeof TraceFile>;
