/**
 * @file Agent hook handler
 * @description
 * One handler for Claude Code and Kiro hooks. It reads the hook's JSON from stdin (and
 * `--file` / `--prompt` when the host passes values as arguments), then:
 *
 * - on a prompt: scans, picks up requirement IDs named in the prompt as the active set,
 *   and prints a short note that the host adds to the agent's context;
 * - on a file write: links the active IDs to the file.
 *
 * Hooks must never break the agent, so every failure is swallowed and the exit code is 0.
 */

import { Project } from "@coreflow/store";

export interface HookInput {
  host: "claude" | "kiro";
  stdin: string;
  file?: string;
  prompt?: string;
  event?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

type Event = "prompt" | "edit" | "unknown";

function parse(stdin: string): Record<string, unknown> {
  if (!stdin.trim()) return {};
  try {
    const data = JSON.parse(stdin);
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function classify(name: string | undefined): Event {
  const n = (name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (n.includes("prompt")) return "prompt";
  if (n.includes("tool") || n.includes("file") || n.includes("save") || n === "edit") return "edit";
  return "unknown";
}

/** Paths an edit event touched. Claude Code sends `tool_input.file_path`; Kiro may send `path` or pass `--file`. */
function editedPaths(data: Record<string, unknown>, file?: string): string[] {
  const paths = new Set<string>();
  if (file) paths.add(file);
  const input = (data.tool_input ?? data.toolInput ?? {}) as Record<string, unknown>;
  for (const key of ["file_path", "filePath", "path"]) {
    const value = str(input[key]) ?? str(data[key]);
    if (value) paths.add(value);
  }
  const edits = input.edits;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      const p = str((e as Record<string, unknown>)?.file_path);
      if (p) paths.add(p);
    }
  }
  return [...paths];
}

/** Returns text for the host to show the agent, or an empty string. Never throws. */
export async function runHook(input: HookInput): Promise<string> {
  try {
    const data = parse(input.stdin);
    const cwd = str(data.cwd) ?? input.cwd;
    const root = Project.findRoot(input.env.CLAUDE_PROJECT_DIR ?? cwd, input.env);
    if (!Project.isInitialised(root)) return "";
    const project = Project.open(root);
    const session = str(data.session_id) ?? str(data.sessionId) ?? "default";
    const prompt = input.prompt ?? str(data.prompt) ?? str(data.user_input) ?? str(data.userPrompt);
    const event = input.event
      ? classify(input.event)
      : prompt !== undefined
        ? "prompt"
        : classify(str(data.hook_event_name) ?? str(data.hookEventName));

    if (event === "prompt" && prompt !== undefined) {
      await project.scan();
      const before = project.activeIds(session).join();
      const active = project.notePrompt(session, prompt);
      project.save();
      if (active.length === 0 || active.join() === before) return "";
      const suspects = new Set(project.graph.suspects().map((s) => s.node.id));
      const names = active.map((id) => {
        const node = project.graph.getNode(id);
        const title = node?.title ? ` (${node.title})` : "";
        return `${id}${title}${suspects.has(id) ? " [suspect: upstream changed, check before building on it]" : ""}`;
      });
      return `CoreFlow: files you write now will be linked to ${names.join(", ")}. Use the coreflow_work tool to change this.`;
    }

    if (event === "edit" || (event === "unknown" && input.file)) {
      // Silent on edits: the agent does not need to hear about each link.
      for (const path of editedPaths(data, input.file)) project.recordEdit(session, path);
      project.save();
      return "";
    }
    return "";
  } catch {
    return "";
  }
}
