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
  usage?: { input_tokens: number; output_tokens: number }; // token usage (cost visibility / logging)
}

// Transient API failures (rate limit, overloaded, 5xx, network blips) shouldn't surface to the
// crew mid-shift. Retry these with exponential backoff before giving up.
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: opts.tool_choice,
  });

  // Budget the whole call UNDER the route's maxDuration (60s) so callClaude always returns a clean
  // error itself — if instead a single attempt ran to 60s, the platform would kill the function first
  // (504/HTML), and the browser would throw the cryptic "string did not match the expected pattern".
  const TOTAL_BUDGET = 50_000;   // total wall-clock ceiling for all attempts
  const ATTEMPT_MS = 24_000;     // per-attempt timeout (well under maxDuration)
  const started = Date.now();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const elapsed = Date.now() - started;
    if (elapsed > TOTAL_BUDGET - 2000) break; // no budget for another attempt
    if (attempt > 0) await sleep(Math.min(400 * attempt, 1000));
    const ctrl = new AbortController();
    const perAttempt = Math.min(ATTEMPT_MS, TOTAL_BUDGET - (Date.now() - started));
    const timer = setTimeout(() => ctrl.abort(), perAttempt);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body, signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        // retry only fast, transient HTTP errors — and only if there's budget for another attempt
        if (RETRYABLE.has(res.status) && attempt < 2 && Date.now() - started < TOTAL_BUDGET - ATTEMPT_MS) { lastErr = new Error(`Anthropic ${res.status}: ${detail}`); continue; }
        throw new Error(`Anthropic ${res.status}: ${detail}`);
      }
      const data = await res.json();
      const blocks: any[] = data.content ?? [];
      const u = data.usage ?? {};
      console.log(`[claude] ${opts.model} ${Date.now() - started}ms in=${u.input_tokens ?? "?"} out=${u.output_tokens ?? "?"} stop=${data.stop_reason ?? "?"}${attempt ? ` retries=${attempt}` : ""}`);
      return {
        text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
        toolUses: blocks.filter((b) => b.type === "tool_use").map((b) => ({ name: b.name, input: b.input })),
        stop_reason: data.stop_reason ?? null,
        content: blocks,
        usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 },
      };
    } catch (e: any) {
      lastErr = e;
      // A timeout (abort) means the API is slow — retrying would blow the function budget, so give up
      // with a clean error the route can return as JSON. Only quick NETWORK blips get a retry.
      if (e?.name === "AbortError") throw new Error("Anthropic request timed out");
      const isNet = !(typeof e?.message === "string" && e.message.startsWith("Anthropic "));
      if (isNet && attempt < 2 && Date.now() - started < TOTAL_BUDGET - ATTEMPT_MS) continue;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Anthropic request failed");
}
