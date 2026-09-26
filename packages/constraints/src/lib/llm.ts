/**
 * @file LLM seam
 * @description
 * Provider-agnostic hook for the few constraint features that call a model.
 * The host (CLI, MCP server, plugin) registers a client once; tests mock this module.
 * Replaces the multi-provider gateway from AI-PM, which pulled in OpenAI, Anthropic
 * and Copilot SDKs this package does not need.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMClient {
  /** Returns the model's text reply. When `json` is true the reply must be a JSON document. */
  complete(messages: LLMMessage[], options: LLMOptions & { json?: boolean }): Promise<string>;
}

let client: LLMClient | undefined;

export function setLLMClient(next: LLMClient | undefined): void {
  client = next;
}

function requireClient(): LLMClient {
  if (!client) {
    throw new Error("No LLM client configured. Call setLLMClient() before using model-backed features.");
  }
  return client;
}

export async function complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
  return requireClient().complete(messages, options);
}

export async function generateJSON<T>(messages: LLMMessage[], options: LLMOptions = {}): Promise<T> {
  const content = await requireClient().complete(messages, { ...options, json: true });
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error("Failed to parse LLM response as JSON");
  }
}
