/**
 * @coreflow/cli
 *
 * The coreflow command-line tool and the hook handler shared by Claude Code and Kiro.
 */

export { run, runSafe, USAGE, type CliIO } from "./cli";
export { runHook, type HookInput } from "./hook";
export { kiroHooks, KIRO_HOOKS_PATH, writeKiroHooks } from "./kiro";
