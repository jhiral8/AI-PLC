#!/usr/bin/env node
/**
 * @file coreflow executable
 */

import { runSafe } from "./cli";

/** Reads stdin when something is piped in. Hosts that pass nothing get an empty string after a short wait. */
function readStdin(timeoutMs = 1500): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    const done = () => {
      clearTimeout(timer);
      process.stdin.pause();
      resolve(data);
    };
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

const script = process.argv[1] ?? "coreflow";
/** How Kiro hooks should call this CLI. npx cache paths get cleaned, so those use npx again. */
const selfCommand =
  process.env.COREFLOW_HOOK_COMMAND ??
  (script.includes("/_npx/")
    ? "npx -y -p github:jhiral8/AI-PLC coreflow"
    : /\.[cm]?js$/.test(script)
      ? `node "${script}"`
      : "coreflow");

runSafe(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  readStdin,
  selfCommand,
}).then((code) => {
  process.exitCode = code;
});
