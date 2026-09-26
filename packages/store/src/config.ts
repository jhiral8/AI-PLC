/**
 * @file Project configuration
 * @description `.coreflow/config.json`: which Markdown files hold definitions, which ID
 * prefixes map to which node types, and how to tell tests from code.
 */

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

export const CoreflowConfig = z.object({
  /** Markdown files scanned for definitions. */
  include: z.array(z.string()).default(["specs/**/*.md", "docs/**/*.md"]),
  /** Never scanned, never linked by the edit hook. */
  exclude: z
    .array(z.string())
    .default(["**/node_modules/**", "**/.git/**", ".coreflow/**", "**/dist/**"]),
  /** ID prefix (the part before the dash) to node type. IDs with other prefixes are ignored. */
  prefixes: z.record(NodeType).default(DEFAULT_PREFIXES),
  /** Regular expression on the repo-relative path that marks a file as a test. */
  testPattern: z
    .string()
    .default(String.raw`(^|/)(__tests__|tests?)/|\.(test|spec)\.[cm]?[jt]sx?$|(^|/)test_[^/]*\.py$|_test\.(py|go)$`),
});
export type CoreflowConfig = z.infer<typeof CoreflowConfig>;
