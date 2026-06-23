// Server-only Anthropic client. Calls the Messages API (optionally with tool use).
// ANTHROPIC_API_KEY is a server secret set on the host — NEVER import this into client code.
// The browser never talks to Anthropic directly; it calls our API routes, which call this.

export const MODELS = {
  sonnet: "claude-sonnet-4-6",            // internal agents (recap, readiness) — quality/cost balance
  haiku: "claude-haiku-4-5-20251001",     // high-volume / public concierge
} as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };
export type ClaudeMsg = { role: "user" | "assistant"; content: any };

export interface ClaudeResult {
  text: string;
  toolUses: { name: string; input: any }[];
  stop_reason: string | null;
  content: any[]; // raw content blocks — needed to resume a server-tool pause_turn
}

export function anthropicEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function callClaude(opts: {
  model: string;
  system?: string;
  messages: ClaudeMsg[];
  tools?: ToolDef[];
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
  maxTokens?: number;
  temperature?: number;
}): Promise<ClaudeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.2,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      tool_choice: opts.tool_choice,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const blocks: any[] = data.content ?? [];
  return {
    text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
    toolUses: blocks.filter((b) => b.type === "tool_use").map((b) => ({ name: b.name, input: b.input })),
    stop_reason: data.stop_reason ?? null,
    content: blocks,
  };
}
