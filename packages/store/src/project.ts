/**
 * @file Project
 * @description
 * A repository with a `.coreflow/` folder. Loads and saves the trace graph, keeps it in step
 * with the Markdown and source files it describes, and records what agents do.
 *
 * Files are the source of truth: definitions come from Markdown, file nodes are hashed from
 * disk, and `.coreflow/traces.json` holds the links and the hashes they were confirmed at.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  contentHash,
  TraceGraph,
  type LinkType,
  type NodeType,
  type TraceLink,
  type TraceNode,
} from "@coreflow/trace";
import { glob } from "tinyglobby";
import { CoreflowConfig } from "./config";
import { extractDefinitions, ID_PATTERN, type MarkdownDefinition } from "./markdown";

export const COREFLOW_DIR = ".coreflow";
const CONFIG_FILE = "config.json";
const TRACES_FILE = "traces.json";
const SESSION_FILE = "session.json";
const MAX_SESSIONS = 20;
const DEFAULT_SESSION = "default";
const AUTO_LINK_CONFIDENCE = 0.8;

export interface ScanResult {
  added: string[];
  changed: string[];
  removed: string[];
  linked: string[];
  warnings: string[];
}

export interface EditResult {
  file?: string;
  linked: TraceLink[];
  rescanned: boolean;
}

interface SessionFile {
  sessions: Record<string, { active: string[]; updatedAt: string }>;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function isMarkdownLocation(location: string | undefined): boolean {
  if (!location) return false;
  return /\.(md|markdown)(#|$)/.test(location) && !/^[a-z]+:\/\//.test(location);
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function simpleMatch(pattern: string, path: string): boolean {
  // Glob to RegExp for the handful of patterns config uses: **, *, ?.
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        const slash = pattern[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`).test(path);
}

export class Project {
  readonly dir: string;
  graph: TraceGraph;

  private constructor(
    readonly root: string,
    readonly config: CoreflowConfig,
    graph: TraceGraph,
    private readonly now: () => Date,
  ) {
    this.dir = join(root, COREFLOW_DIR);
    this.graph = graph;
  }

  /** Finds the project root: `COREFLOW_ROOT`, then the nearest folder with `.coreflow` or `.git`. */
  static findRoot(start: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
    if (env.COREFLOW_ROOT) return resolve(env.COREFLOW_ROOT);
    let fallback: string | undefined;
    let dir = resolve(start);
    for (;;) {
      if (existsSync(join(dir, COREFLOW_DIR))) return dir;
      if (!fallback && existsSync(join(dir, ".git"))) fallback = dir;
      const parent = dirname(dir);
      if (parent === dir) return fallback ?? resolve(start);
      dir = parent;
    }
  }

  static isInitialised(root: string): boolean {
    return existsSync(join(root, COREFLOW_DIR, CONFIG_FILE));
  }

  static open(root: string, options: { now?: () => Date } = {}): Project {
    const now = options.now ?? (() => new Date());
    const dir = join(root, COREFLOW_DIR);
    const configPath = join(dir, CONFIG_FILE);
    const config = CoreflowConfig.parse(
      existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {},
    );
    const tracesPath = join(dir, TRACES_FILE);
    const graph = existsSync(tracesPath)
      ? TraceGraph.fromJSON(JSON.parse(readFileSync(tracesPath, "utf8")), now)
      : new TraceGraph(now);
    return new Project(root, config, graph, now);
  }

  /** Creates `.coreflow/` with a default config. Leaves an existing config alone. */
  static init(root: string, options: { now?: () => Date; config?: Partial<CoreflowConfig> } = {}): Project {
    const dir = join(root, COREFLOW_DIR);
    const configPath = join(dir, CONFIG_FILE);
    if (!existsSync(configPath)) {
      writeAtomic(configPath, `${JSON.stringify(CoreflowConfig.parse(options.config ?? {}), null, 2)}\n`);
    }
    const ignorePath = join(dir, ".gitignore");
    if (!existsSync(ignorePath)) writeAtomic(ignorePath, `${SESSION_FILE}\n*.tmp\n`);
    const project = Project.open(root, options);
    project.save();
    return project;
  }

  save(): void {
    writeAtomic(join(this.dir, TRACES_FILE), `${JSON.stringify(this.graph.toJSON(), null, 2)}\n`);
  }

  // ---------------------------------------------------------------- paths

  /** Repo-relative POSIX path, or undefined when the path is outside the project. */
  relativePath(path: string): string | undefined {
    const abs = isAbsolute(path) ? path : resolve(this.root, path);
    const rel = relative(this.root, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
    return toPosix(rel);
  }

  isExcluded(rel: string): boolean {
    return this.config.exclude.some((p) => simpleMatch(p, rel)) || rel.startsWith(`${COREFLOW_DIR}/`);
  }

  isDefinitionFile(rel: string): boolean {
    return this.config.include.some((p) => simpleMatch(p, rel));
  }

  fileType(rel: string): NodeType {
    return new RegExp(this.config.testPattern).test(rel) ? "test" : "code";
  }

  // ---------------------------------------------------------------- scanning

  /** Brings the graph in line with the files: new and changed definitions, deleted files. */
  async scan(): Promise<ScanResult> {
    const result: ScanResult = { added: [], changed: [], removed: [], linked: [], warnings: [] };
    const files = await glob(this.config.include, {
      cwd: this.root,
      ignore: this.config.exclude,
      onlyFiles: true,
    });
    const seen = new Set<string>();
    const scannedFiles = new Set(files.map(toPosix));
    for (const file of [...scannedFiles].sort()) {
      this.applyDefinitions(file, seen, result);
    }

    for (const node of this.graph.listNodes()) {
      if (seen.has(node.id)) continue;
      if (isMarkdownLocation(node.location)) {
        const file = node.location!.split("#")[0]!;
        this.markRemoved(node, existsSync(join(this.root, file)) ? `definition removed from ${file}` : `${file} deleted`, result);
      } else if (node.location && (node.type === "code" || node.type === "test")) {
        this.refreshFile(node, result);
      }
    }
    return result;
  }

  /** Re-reads one Markdown file. */
  scanFile(rel: string): ScanResult {
    const result: ScanResult = { added: [], changed: [], removed: [], linked: [], warnings: [] };
    const seen = new Set<string>();
    this.applyDefinitions(rel, seen, result);
    for (const node of this.graph.listNodes()) {
      if (seen.has(node.id) || !isMarkdownLocation(node.location)) continue;
      if (node.location!.split("#")[0] === rel) this.markRemoved(node, `definition removed from ${rel}`, result);
    }
    return result;
  }

  private applyDefinitions(rel: string, seen: Set<string>, result: ScanResult): void {
    const abs = join(this.root, rel);
    if (!existsSync(abs)) return;
    let defs: MarkdownDefinition[];
    try {
      defs = extractDefinitions(rel, readFileSync(abs, "utf8"), this.config.prefixes);
    } catch (error) {
      result.warnings.push(`${rel}: ${(error as Error).message}`);
      return;
    }
    for (const def of defs) {
      if (seen.has(def.node.id)) {
        const first = this.graph.getNode(def.node.id)?.location;
        result.warnings.push(`${def.node.id} is defined in ${first} and again in ${rel}:${def.line}; using the first`);
        continue;
      }
      seen.add(def.node.id);
      const existing = this.graph.getNode(def.node.id);
      if (!existing) {
        this.graph.upsertNode(def.node);
        result.added.push(def.node.id);
      } else {
        const { hash, ...rest } = def.node;
        this.graph.upsertNode({ ...existing, ...rest, hash: existing.hash });
        if (existing.hash !== hash) {
          this.graph.updateContent(def.node.id, hash);
          if (existing.hash !== undefined) result.changed.push(def.node.id);
        }
      }
    }
    // Declared links go in after every node in the file exists.
    for (const def of defs) {
      for (const upstream of def.derivedFrom) {
        if (!this.graph.getNode(upstream)) {
          result.warnings.push(`${def.node.id} is derived from ${upstream}, which is not defined anywhere scanned`);
          continue;
        }
        const exists = this.graph.linksTo(def.node.id).some((l) => l.from === upstream && l.type === "derived_from");
        if (!exists) {
          this.graph.link({ from: upstream, to: def.node.id, type: "derived_from" });
          result.linked.push(`${upstream} -> ${def.node.id}`);
        }
      }
    }
  }

  private markRemoved(node: TraceNode, reason: string, result: ScanResult): void {
    if (node.changed?.reason === reason) return;
    this.graph.markChanged(node.id, reason);
    result.removed.push(node.id);
  }

  private refreshFile(node: TraceNode, result: ScanResult): void {
    const abs = join(this.root, node.location!);
    if (!existsSync(abs)) {
      this.markRemoved(node, `${node.location} deleted`, result);
      return;
    }
    const hash = contentHash(readFileSync(abs, "utf8"));
    if (hash !== node.hash) {
      this.graph.updateContent(node.id, hash);
      result.changed.push(node.id);
    }
  }

  /** Adds or rehashes a code or test file node. The node ID is the repo-relative path. */
  ensureFileNode(rel: string): TraceNode {
    const abs = join(this.root, rel);
    const hash = existsSync(abs) ? contentHash(readFileSync(abs, "utf8")) : undefined;
    const existing = this.graph.getNode(rel);
    if (existing) {
      if (hash && existing.hash !== hash) return this.graph.updateContent(rel, hash);
      return existing;
    }
    return this.graph.upsertNode({ id: rel, type: this.fileType(rel), location: rel, hash });
  }

  // ---------------------------------------------------------------- references

  /** Turns a CLI or tool argument into a node ID: a known ID, or a path to a file. */
  resolveRef(ref: string, options: { createFile?: boolean } = {}): string {
    if (this.graph.getNode(ref)) return ref;
    const rel = this.relativePath(ref);
    if (rel) {
      if (this.graph.getNode(rel)) return rel;
      if (options.createFile && existsSync(join(this.root, rel))) return this.ensureFileNode(rel).id;
    }
    throw new Error(`Unknown node or file: ${ref}. Run "coreflow scan" if it was just added.`);
  }

  link(from: string, to: string, type: LinkType = "derived_from", options: { auto?: boolean; confidence?: number } = {}): TraceLink {
    const fromId = this.resolveRef(from, { createFile: true });
    const toId = this.resolveRef(to, { createFile: true });
    return this.graph.link({ from: fromId, to: toId, type, auto: options.auto ?? false, confidence: options.confidence ?? 1 });
  }

  /** IDs mentioned in text that exist in the graph, in order of first mention. */
  knownIds(text: string): string[] {
    const found: string[] = [];
    for (const match of text.matchAll(ID_PATTERN)) {
      const id = match[0];
      if (this.graph.getNode(id) && !found.includes(id)) found.push(id);
    }
    return found;
  }

  // ---------------------------------------------------------------- agent sessions

  private readSessions(): SessionFile {
    const path = join(this.dir, SESSION_FILE);
    if (!existsSync(path)) return { sessions: {} };
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as SessionFile;
      return data && typeof data.sessions === "object" ? data : { sessions: {} };
    } catch {
      return { sessions: {} };
    }
  }

  /**
   * What edits in this session link to. The default session is shared (the CLI and MCP server
   * cannot see an agent's session ID), so whichever of the two was set last wins.
   */
  activeIds(sessionId: string = DEFAULT_SESSION): string[] {
    const { sessions } = this.readSessions();
    const own = sessions[sessionId];
    const shared = sessions[DEFAULT_SESSION];
    const latest = own && shared ? (own.updatedAt >= shared.updatedAt ? own : shared) : (own ?? shared);
    return latest?.active ?? [];
  }

  /** Sets what the agent is working on. Edits in this session link from these IDs. */
  setActive(sessionId: string = DEFAULT_SESSION, ids: string[]): string[] {
    const known = ids.map((id) => this.resolveRef(id));
    const data = this.readSessions();
    data.sessions[sessionId] = { active: known, updatedAt: this.now().toISOString() };
    const kept = Object.entries(data.sessions)
      .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_SESSIONS);
    writeAtomic(join(this.dir, SESSION_FILE), `${JSON.stringify({ sessions: Object.fromEntries(kept) }, null, 2)}\n`);
    return known;
  }

  /** Reads a user prompt. Known IDs in it become the session's active set; otherwise it is unchanged. */
  notePrompt(sessionId: string = DEFAULT_SESSION, prompt: string): string[] {
    const ids = this.knownIds(prompt);
    if (ids.length === 0) return this.activeIds(sessionId);
    return this.setActive(sessionId, ids);
  }

  /**
   * Records that an agent wrote a file. Markdown definition files are rescanned. Any other
   * file gets a node and an automatic link from each active ID: `implements` for code,
   * `validates` for tests.
   */
  recordEdit(sessionId: string = DEFAULT_SESSION, path: string): EditResult {
    const rel = this.relativePath(path);
    if (!rel || this.isExcluded(rel)) return { linked: [], rescanned: false };
    if (this.isDefinitionFile(rel)) {
      this.scanFile(rel);
      return { file: rel, linked: [], rescanned: true };
    }
    const active = this.activeIds(sessionId).filter((id) => this.graph.getNode(id));
    if (active.length === 0) {
      // Keep hashes current for files already in the graph, but don't add unlinked nodes.
      if (this.graph.getNode(rel)) this.ensureFileNode(rel);
      return { file: rel, linked: [], rescanned: false };
    }
    const node = this.ensureFileNode(rel);
    const type: LinkType = node.type === "test" ? "validates" : "implements";
    const linked: TraceLink[] = [];
    for (const id of active) {
      if (id === rel) continue;
      const before = this.graph.linksTo(rel).some((l) => l.from === id && l.type === type);
      const link = this.graph.link({ from: id, to: rel, type, auto: true, confidence: AUTO_LINK_CONFIDENCE });
      if (!before) linked.push(link);
    }
    return { file: rel, linked, rescanned: false };
  }
}
