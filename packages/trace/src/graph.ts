/**
 * @file Trace graph
 * @description
 * In-memory golden thread with upstream/downstream traversal and suspect propagation.
 * Storage-agnostic: load from and save to `TraceFile` JSON (see `toJSON` / `fromJSON`).
 *
 * Suspect rule: a node is suspect when anything it depends on, directly or transitively,
 * has changed since the link was confirmed. A change is either a content hash that no
 * longer matches the link's recorded `upstreamHash`, or an explicit `markChanged`.
 * `confirm` records the current hash, which clears that link.
 */

import {
  TraceFile,
  TraceLink,
  TraceNode,
  type LinkType,
  type NodeType,
  type TraceLinkInput,
} from "./schema";

export interface TraversalStep {
  node: TraceNode;
  depth: number;
  via: LinkType;
}

export interface SuspectItem {
  node: TraceNode;
  /** Upstream nodes whose change makes this node suspect. */
  causes: TraceNode[];
  /** Shortest number of links from the nearest cause. */
  distance: number;
}

export interface TraversalOptions {
  maxDepth?: number;
  types?: NodeType[];
}

const DEFAULT_MAX_DEPTH = 10;

function linkKey(from: string, to: string, type: LinkType): string {
  return `${from}\u0000${to}\u0000${type}`;
}

export class TraceGraph {
  private readonly nodes = new Map<string, TraceNode>();
  private readonly links = new Map<string, TraceLink>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  // ---------------------------------------------------------------- nodes

  upsertNode(input: TraceNode): TraceNode {
    const node = TraceNode.parse(input);
    const existing = this.nodes.get(node.id);
    // Keep an explicit change marker unless the caller replaces it.
    const merged: TraceNode = existing ? { ...existing, ...node } : node;
    this.nodes.set(node.id, merged);
    return merged;
  }

  getNode(id: string): TraceNode | undefined {
    return this.nodes.get(id);
  }

  listNodes(type?: NodeType): TraceNode[] {
    const all = [...this.nodes.values()];
    return type ? all.filter((n) => n.type === type) : all;
  }

  /** Removes a node and every link touching it. */
  removeNode(id: string): boolean {
    for (const [key, link] of this.links) {
      if (link.from === id || link.to === id) this.links.delete(key);
    }
    return this.nodes.delete(id);
  }

  /** Records a new content hash. Links keep their old `upstreamHash`, so descendants become suspect. */
  updateContent(id: string, hash: string): TraceNode {
    const node = this.requireNode(id);
    const next = { ...node, hash };
    this.nodes.set(id, next);
    return next;
  }

  /** Flags a change a hash cannot capture, such as a retracted finding. */
  markChanged(id: string, reason: string): TraceNode {
    const node = this.requireNode(id);
    const next = { ...node, changed: { reason, at: this.now().toISOString() } };
    this.nodes.set(id, next);
    return next;
  }

  // ---------------------------------------------------------------- links

  link(input: Omit<TraceLinkInput, "createdAt" | "upstreamHash">): TraceLink {
    const from = this.requireNode(input.from);
    this.requireNode(input.to);
    if (input.from === input.to) {
      throw new Error(`A node cannot link to itself: ${input.from}`);
    }
    const parsed = TraceLink.parse({
      ...input,
      upstreamHash: from.hash,
      createdAt: this.now().toISOString(),
    });
    const key = linkKey(parsed.from, parsed.to, parsed.type);
    const existing = this.links.get(key);
    if (existing) return existing;
    this.links.set(key, parsed);
    return parsed;
  }

  unlink(from: string, to: string, type?: LinkType): number {
    let removed = 0;
    for (const [key, link] of this.links) {
      if (link.from === from && link.to === to && (!type || link.type === type)) {
        this.links.delete(key);
        removed++;
      }
    }
    return removed;
  }

  listLinks(): TraceLink[] {
    return [...this.links.values()];
  }

  linksFrom(id: string): TraceLink[] {
    return this.listLinks().filter((l) => l.from === id);
  }

  linksTo(id: string): TraceLink[] {
    return this.listLinks().filter((l) => l.to === id);
  }

  // ---------------------------------------------------------------- traversal

  upstream(id: string, options: TraversalOptions = {}): TraversalStep[] {
    return this.walk(id, "up", options);
  }

  downstream(id: string, options: TraversalOptions = {}): TraversalStep[] {
    return this.walk(id, "down", options);
  }

  private walk(start: string, direction: "up" | "down", options: TraversalOptions): TraversalStep[] {
    this.requireNode(start);
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const seen = new Set<string>([start]);
    const result: TraversalStep[] = [];
    let frontier = [start];

    // Breadth-first, so each node is reported at its shortest depth.
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const current of frontier) {
        const edges = direction === "down" ? this.linksFrom(current) : this.linksTo(current);
        for (const edge of edges) {
          const neighbourId = direction === "down" ? edge.to : edge.from;
          if (seen.has(neighbourId)) continue;
          seen.add(neighbourId);
          const node = this.nodes.get(neighbourId);
          if (!node) continue;
          if (!options.types || options.types.includes(node.type)) {
            result.push({ node, depth, via: edge.type });
          }
          next.push(neighbourId);
        }
      }
      frontier = next;
    }
    return result;
  }

  // ---------------------------------------------------------------- staleness

  /** A link is broken when its upstream node changed after the link was confirmed. */
  isLinkBroken(link: TraceLink): boolean {
    const from = this.nodes.get(link.from);
    if (!from) return false;
    if (from.changed) {
      const confirmed = link.confirmedAt ?? link.createdAt;
      if (from.changed.at > confirmed) return true;
    }
    return from.hash !== undefined && link.upstreamHash !== undefined && from.hash !== link.upstreamHash;
  }

  /** Every node downstream of a broken link, with the upstream changes that caused it. */
  suspects(options: { maxDepth?: number } = {}): SuspectItem[] {
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const byNode = new Map<string, { causes: Set<string>; distance: number }>();

    for (const link of this.listLinks()) {
      if (!this.isLinkBroken(link)) continue;
      const cause = link.from;
      const record = (id: string, distance: number) => {
        const entry = byNode.get(id);
        if (entry) {
          entry.causes.add(cause);
          entry.distance = Math.min(entry.distance, distance);
        } else {
          byNode.set(id, { causes: new Set([cause]), distance });
        }
      };
      record(link.to, 1);
      for (const step of this.downstream(link.to, { maxDepth: maxDepth - 1 })) {
        record(step.node.id, step.depth + 1);
      }
    }

    return [...byNode.entries()]
      .map(([id, entry]) => ({
        node: this.requireNode(id),
        causes: [...entry.causes].map((c) => this.requireNode(c)),
        distance: entry.distance,
      }))
      .sort((a, b) => a.distance - b.distance || a.node.id.localeCompare(b.node.id));
  }

  isSuspect(id: string): boolean {
    return this.suspects().some((s) => s.node.id === id);
  }

  /**
   * Confirms that `to` still holds given the current state of `from`.
   * Omit `from` to confirm every incoming link of `to`.
   */
  confirm(to: string, from?: string): number {
    let confirmed = 0;
    const stamp = this.now().toISOString();
    for (const [key, link] of this.links) {
      if (link.to !== to || (from && link.from !== from)) continue;
      const upstream = this.nodes.get(link.from);
      this.links.set(key, { ...link, upstreamHash: upstream?.hash, confirmedAt: stamp });
      confirmed++;
    }
    return confirmed;
  }

  // ---------------------------------------------------------------- persistence

  toJSON(): TraceFile {
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    return {
      version: 1,
      nodes: [...this.nodes.values()].sort(byId),
      links: this.listLinks().sort(
        (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type),
      ),
    };
  }

  static fromJSON(data: unknown, now?: () => Date): TraceGraph {
    const file = TraceFile.parse(data);
    const graph = new TraceGraph(now);
    for (const node of file.nodes) graph.nodes.set(node.id, node);
    for (const link of file.links) {
      if (!graph.nodes.has(link.from) || !graph.nodes.has(link.to)) {
        throw new Error(`Link ${link.from} -> ${link.to} points at a node that does not exist`);
      }
      graph.links.set(linkKey(link.from, link.to, link.type), link);
    }
    return graph;
  }

  private requireNode(id: string): TraceNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown trace node: ${id}`);
    return node;
  }
}
