/**
 * @file Markdown definitions
 * @description
 * Finds trace nodes in Markdown. Three forms are recognised:
 *
 * - Front-matter with `id` and `type`: the whole file is one node and its body is the content.
 *   `derived_from: [INS-1, EV-3]` declares upstream links; `kind` and `stage` are kept on the
 *   node. Each `##` section becomes its own node (`ART-2#market-size`) that the document
 *   depends on, so a change can be traced to the section that cites it.
 * - Bold inline definitions: `- **FR-001**: The system MUST ...`. The content runs to the next
 *   blank line, definition or heading.
 * - Headings: `### REQ-12: Passwordless login`. The content runs to the next heading of the
 *   same or higher level.
 *
 * Citations are bracketed IDs in the content, `[INS-4]` or `[INS-4, EV-2]`, and become `cites`
 * links into the node (or section) that contains them.
 *
 * Only IDs whose prefix is configured are picked up, and fenced code blocks are skipped.
 */

import { contentHash, NodeType, type TraceNode } from "@coreflow/trace";
import { parse as parseYaml } from "yaml";

export interface MarkdownDefinition {
  node: TraceNode & { hash: string; location: string };
  /** Upstream IDs declared in front-matter `derived_from`. */
  derivedFrom: string[];
  /** IDs cited in the content as `[ID]`. */
  cites: string[];
  /** For a section, the document it belongs to. */
  partOf?: string;
  line: number;
  /** Set during a scan when another file already defined this ID. */
  duplicate?: boolean;
}

const ID = String.raw`[A-Z][A-Z0-9]*-\d+`;
const INLINE = new RegExp(String.raw`^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*(${ID}):?\*\*\s*:?\s*(.*)$`);
const HEADING = new RegExp(String.raw`^(#{1,6})\s+(${ID})\b[\s:.–—-]*(.*)$`);
const ANY_HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const CITATION = new RegExp(String.raw`\[(${ID}(?:\s*[,;]\s*${ID})*)\]`, "g");
/** A token that looks like a definition ID. */
export const ID_PATTERN = new RegExp(String.raw`\b${ID}\b`, "g");

export function typeForId(id: string, prefixes: Record<string, NodeType>): NodeType | undefined {
  const prefix = id.slice(0, id.lastIndexOf("-"));
  return prefixes[prefix];
}

/** Bracketed IDs in text, outside code fences, in order of first appearance. */
export function extractCitations(text: string, exclude?: string): string[] {
  const found: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(CITATION)) {
      for (const id of match[1]!.split(/\s*[,;]\s*/)) {
        if (id !== exclude && !found.includes(id)) found.push(id);
      }
    }
  }
  return found;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function shortTitle(text: string): string | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > 100 ? `${t.slice(0, 97)}...` : t;
}

/** Splits a document body at `##` headings outside code fences. */
function splitSections(body: string): { preamble: string; sections: { title: string; text: string; line: number }[] } {
  const lines = body.split("\n");
  const sections: { title: string; text: string[]; line: number }[] = [];
  const preamble: string[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = !inFence ? line.match(/^##\s+(.+)$/) : null;
    if (heading) sections.push({ title: heading[1]!.trim(), text: [line], line: i });
    else if (sections.length) sections[sections.length - 1]!.text.push(line);
    else preamble.push(line);
  });
  return {
    preamble: preamble.join("\n"),
    sections: sections.map((s) => ({ title: s.title, text: s.text.join("\n"), line: s.line })),
  };
}

export function extractDefinitions(
  path: string,
  text: string,
  prefixes: Record<string, NodeType>,
): MarkdownDefinition[] {
  const { data, body, offset } = splitFrontMatter(text);
  const defs: MarkdownDefinition[] = [];

  if (data && typeof data.id === "string" && NodeType.safeParse(data.type).success) {
    const docId = data.id;
    const type = NodeType.parse(data.type);
    const { preamble, sections } = splitSections(body);
    defs.push({
      node: {
        id: docId,
        type,
        title: optionalString(data.title) ?? firstHeading(body),
        kind: optionalString(data.kind),
        stage: optionalString(data.stage),
        location: path,
        hash: contentHash(body),
      },
      derivedFrom: toIdList(data.derived_from),
      cites: extractCitations(preamble, docId),
      line: 1,
    });
    const used = new Set<string>();
    for (const section of sections) {
      let slug = slugify(section.title);
      for (let n = 2; used.has(slug); n++) slug = `${slugify(section.title)}-${n}`;
      used.add(slug);
      defs.push({
        node: {
          id: `${docId}#${slug}`,
          type,
          kind: "section",
          title: shortTitle(section.title.replace(/\[[^\]]*\]/g, "")),
          location: `${path}#${slug}`,
          hash: contentHash(section.text.trim()),
        },
        derivedFrom: [],
        cites: extractCitations(section.text, docId),
        partOf: docId,
        line: section.line + offset + 1,
      });
    }
  }

  const lines = body.split("\n");
  let inFence = false;
  let open: { id: string; title: string; start: number; lines: string[]; level?: number } | undefined;

  const close = () => {
    if (!open) return;
    const type = typeForId(open.id, prefixes);
    if (type) {
      const content = open.lines.join("\n").trim();
      defs.push({
        node: {
          id: open.id,
          type,
          title: shortTitle(open.title.replace(CITATION, "")),
          location: `${path}#${open.id}`,
          hash: contentHash(content),
        },
        derivedFrom: [],
        cites: extractCitations(content, open.id),
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
