/**
 * @file Minimal structured logger
 * @description
 * Same call shape as the pino logger used in AI-PM (`logger.info(obj, msg)`),
 * without the dependency. Silent under test unless LOG_LEVEL is set.
 */

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | "silent" | undefined;
  if (configured && configured in ORDER) return ORDER[configured];
  return process.env.NODE_ENV === "test" || process.env.VITEST ? ORDER.silent : ORDER.info;
}

function write(level: Level, fields: Record<string, unknown>, message?: string): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const logger = {
  debug: (fields: Record<string, unknown>, message?: string) => write("debug", fields, message),
  info: (fields: Record<string, unknown>, message?: string) => write("info", fields, message),
  warn: (fields: Record<string, unknown>, message?: string) => write("warn", fields, message),
  error: (fields: Record<string, unknown>, message?: string) => write("error", fields, message),
};
