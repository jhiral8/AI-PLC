/**
 * @file Markdown definitions
 * @description
 * Finds trace nodes in Markdown. Three forms are recognised:
 *
 * - Front-matter with `id` and `type`: the whole file is one node and its body is the content.
 *   `derived_from: [INS-1, EV-3]` declares upstream links.
 * - Bold inline definitions: `- **FR-001**: The system MUST ...`. The content runs to the next
 *   blank line, definition or heading.
 * - Headings: `### REQ-12: Passwordless login`. The content runs to the next heading of the
 *   same or higher level.
 *
 * Only IDs whose prefix is configured are picked up, and fenced code blocks are skipped.
 */

import { contentHash, NodeType, type TraceNode } from "@coreflow/trace";
import { parse as parseYaml } from "yaml";

export interface MarkdownDefinition {
  node: TraceNode & { hash: string; location: string };
  /** Upstream IDs declared in front-matter `derived_from`. */
  derivedFrom: string[];
  line: number;
}

const INLINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*([A-Z][A-Z0-9]*-\d+):?\*\*\s*:?\s*(.*)$/;
const HEADING = /^(#{1,6})\s+([A-Z][A-Z0-9]*-\d+)\b[\s:.–—-]*(.*)$/;
const ANY_HEADING = /^(#{1,6})\s/;
const FENCE = /^\s*(```|~~~)/;
/** A token that looks like a definition ID. */
export const ID_PATTERN = /\b[A-Z][A-Z0-9]*-\d+\b/g;

export function typeForId(id: string, prefixes: Record<string, NodeType>): NodeType | undefined {
  const prefix = id.slice(0, id.lastIndexOf("-"));
  return prefixes[prefix];
}

function splitFrontMatter(text: string): { data: Record<string, unknown> | undefined; body: string; offset: number } {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { data: undefined, body: normalised, offset: 0 };
  const end = normalised.indexOf("\n---", 4);
  if (end === -1) return { data: undefined, body: normalised, offset: 0 };
  const after = normalised.indexOf("\n", end + 4);
  const body = after === -1 ? "" : normalised.slice(after + 1);
  try {
    const data = parseYaml(normalised.slice(4, end));
    const offset = normalised.slice(0, after === -1 ? normalised.length : after + 1).split("\n").length - 1;
    return { data: data && typeof data === "object" ? (data as Record<string, unknown>) : undefined, body, offset };
  } catch {
    return { data: undefined, body: normalised, offset: 0 };
  }
}

function firstHeading(body: string): string | undefined {
  const match = body.match(/^#{1,6}\s+(.+)$/m);
  return match?.[1]?.trim();
}

function toIdList(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function shortTitle(text: string): string | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > 100 ? `${t.slice(0, 97)}...` : t;
}

export function extractDefinitions(
  path: string,
  text: string,
  prefixes: Record<string, NodeType>,
): MarkdownDefinition[] {
  const { data, body, offset } = splitFrontMatter(text);
  const defs: MarkdownDefinition[] = [];

  if (data && typeof data.id === "string" && NodeType.safeParse(data.type).success) {
    defs.push({
      node: {
        id: data.id,
        type: NodeType.parse(data.type),
        title: typeof data.title === "string" ? data.title : firstHeading(body),
        location: path,
        hash: contentHash(body),
      },
      derivedFrom: toIdList(data.derived_from),
      line: 1,
    });
  }

  const lines = body.split("\n");
  let inFence = false;
  let open: { id: string; title: string; start: number; lines: string[]; level?: number } | undefined;

  const close = () => {
    if (!open) return;
    const type = typeForId(open.id, prefixes);
    if (type) {
      defs.push({
        node: {
          id: open.id,
          type,
          title: shortTitle(open.title),
          location: `${path}#${open.id}`,
          hash: contentHash(open.lines.join("\n").trim()),
        },
        derivedFrom: [],
        line: open.start + offset + 1,
      });
    }
    open = undefined;
  };

  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      if (open && open.level === undefined) close();
      else open?.lines.push(line);
      return;
    }
    if (inFence) {
      open?.lines.push(line);
      return;
    }

    const heading = line.match(HEADING);
    const anyHeading = line.match(ANY_HEADING);
    if (anyHeading) {
      const level = anyHeading[1]!.length;
      if (open && (open.level === undefined || level <= open.level)) close();
      if (heading && typeForId(heading[2]!, prefixes)) {
        open = { id: heading[2]!, title: heading[3] ?? "", start: i, lines: [line], level };
      } else {
        open?.lines.push(line);
      }
      return;
    }

    const inline = line.match(INLINE);
    if (inline && typeForId(inline[1]!, prefixes)) {
      if (open?.level === undefined) close();
      if (!open) {
        open = { id: inline[1]!, title: inline[2] ?? "", start: i, lines: [line] };
        return;
      }
    }

    if (open && open.level === undefined && line.trim() === "") {
      close();
      return;
    }
    open?.lines.push(line);
  });
  close();

  return defs;
}
