/**
 * @file Kiro hooks
 * @description Kiro powers cannot carry hooks, so `coreflow init --kiro` writes them into the
 * workspace: a prompt hook that picks up requirement IDs and file hooks that record links.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const KIRO_HOOKS_PATH = ".kiro/hooks/coreflow.json";

export function kiroHooks(command: string) {
  const hook = (name: string, trigger: string, args: string) => ({
    name,
    trigger,
    action: { type: "command", command: `${command} hook kiro ${args}` },
  });
  return {
    version: "v1",
    hooks: [
      hook("CoreFlow: note requirement IDs in the prompt", "UserPromptSubmit", "--event prompt"),
      hook("CoreFlow: link saved files to the active requirements", "PostFileSave", '--event edit --file "{{filePath}}"'),
      hook("CoreFlow: link new files to the active requirements", "PostFileCreate", '--event edit --file "{{filePath}}"'),
    ],
  };
}

/** Writes the hooks file. Returns false when it already exists and differs, unless forced. */
export function writeKiroHooks(root: string, command: string, force = false): { path: string; written: boolean } {
  const path = join(root, KIRO_HOOKS_PATH);
  const text = `${JSON.stringify(kiroHooks(command), null, 2)}\n`;
  if (existsSync(path) && !force && readFileSync(path, "utf8") !== text) return { path, written: false };
  mkdirSync(join(root, ".kiro/hooks"), { recursive: true });
  writeFileSync(path, text);
  return { path, written: true };
}
