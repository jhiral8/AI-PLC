import { createHash } from "node:crypto";

/**
 * Hash of a node's content, stable across line-ending and trailing-whitespace changes
 * so that re-saving a file in another editor does not mark everything downstream suspect.
 */
export function contentHash(text: string): string {
  const normalised = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return "sha256:" + createHash("sha256").update(normalised, "utf8").digest("hex").slice(0, 16);
}
