/**
 * @file Project configuration
 * @description `.coreflow/config.json`: which Markdown files hold definitions, which ID
 * prefixes map to which node types, how files linked by path are typed, and the stage gates.
 */

import { GateDefinition } from "@coreflow/gates";
import { NodeType } from "@coreflow/trace";
import { z } from "zod";

export const DEFAULT_PREFIXES: Record<string, NodeType> = {
  EV: "evidence",
  INS: "insight",
  REQ: "requirement",
  FR: "requirement",
  NFR: "requirement",
  SC: "requirement",
  US: "requirement",
  DEC: "decision",
  ART: "artifact",
  DES: "design",
  SPEC: "spec",
};

/** Checked in order for files linked by path; the first match wins, then the test pattern, then code. */
export const DEFAULT_FILE_TYPES: { glob: string; type: NodeType }[] = [
  { glob: "{research,evidence}/**", type: "evidence" },
  {
    glob: "**/*.{pdf,ppt,pptx,key,odp,doc,docx,odt,rtf,xls,xlsx,ods,csv,png,jpg,jpeg,gif,svg,fig,md,markdown,html}",
    type: "artifact",
  },
];

export const CoreflowConfig = z.object({
  /** Markdown files scanned for definitions. */
  include: z.array(z.string()).default(["specs/**/*.md", "docs/**/*.md"]),
  /** Never scanned, never linked by the edit hook. */
  exclude: z
    .array(z.string())
    .default(["**/node_modules/**", "**/.git/**", ".coreflow/**", "**/dist/**"]),
  /** ID prefix (the part before the dash) to node type. IDs with other prefixes are ignored. */
  prefixes: z.record(NodeType).default(DEFAULT_PREFIXES),
  /** Types for files linked by path, such as decks, PDFs and interview transcripts. */
  fileTypes: z.array(z.object({ glob: z.string(), type: NodeType })).default(DEFAULT_FILE_TYPES),
  /** Regular expression on the repo-relative path that marks a file as a test. */
  testPattern: z
    .string()
    .default(String.raw`(^|/)(__tests__|tests?)/|\.(test|spec)\.[cm]?[jt]sx?$|(^|/)test_[^/]*\.py$|_test\.(py|go)$`),
  /** Where `coreflow new` writes artifacts. Keep it inside `include` so they are scanned. */
  artifactsDir: z.string().default("docs/artifacts"),
  /** Stage gates. Nodes join a stage through front-matter `stage:`. */
  gates: z.array(GateDefinition).default([]),
});
export type CoreflowConfig = z.infer<typeof CoreflowConfig>;
export type CoreflowConfigInput = z.input<typeof CoreflowConfig>;
