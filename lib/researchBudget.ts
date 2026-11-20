// RESEARCH BUDGET — a hard per-run limit (Ryan, 2026-11-11: "an enforceable $1 total budget per run, covering model calls,
// tools, and retries … Before each billable step, reserve its maximum possible cost against the remaining budget. Stop
// when that bound cannot fit, and settle failed or interrupted runs accurately").
//
// Why the provider's server tools are not used: web search results are "not capped" and billed as input in every
// server-loop iteration (up to 10 per request, each re-billed), web_fetch's max_content_tokens is approximate and not
// applied to PDFs — so no request carrying them has a maximum knowable before it is sent (Anthropic pricing and tool
// docs, read 2026-11-11). This path sends one request with no server tools and the answer tool forced, so the API runs
// exactly one sampling step; the page is read by our server (lib/pageFetch), cut to a byte limit, and sent as text.
//
// The bound of one step, in tokens, is provable from what we send:
//   · text: a token is at least one byte, so a text's tokens ≤ its UTF-8 bytes (system, the ask, the page, the answer
//     tool's schema — all counted);
//   · the forced tool's own system prompt: 589 tokens for Sonnet 4.6 (pricing docs) — FRAME_TOKENS holds 2,000;
//   · an image: resized by the API to a long edge ≤ 1,568 px, ≈ (w·h)/750 ≤ 3,278 tokens (vision docs) — 4,000 each;
//   · a PDF: no bound (pages are text and images of unknown size) — refused on this path;
//   · output: max_tokens, enforced by the API.
// Priced at the dearer of plain input and a 5-minute cache write (whichever the request may be billed as) and output.
// A step whose answer reports usage is charged that usage; a step with no reported usage (timeout, network, an error
// status) is charged its full bound — the provider publishes no general rule that errored requests are free.
import { PRICING, costCents, type Rate, type Usage } from "./aiPricing";

export const RUN_LIMIT_CENTS = 100;     // $1 — the most any run may cost, whatever the budget row says
export const MAX_ATTEMPTS = 3;          // tries of the one call (each reserved before it is sent)
export const PAGE_TEXT_BYTES = 40_000;  // the fetched page's text, cut here
export const FRAME_TOKENS = 2_000;      // roles, message framing and the forced tool's prompt (589) — a margin above them
export const IMAGE_TOKENS = 4_000;      // per image (≤ 3,278 by the vision docs' formula at the API's resize limit)
export const OUTPUT_TOKENS = 2_000;     // max_tokens of the one answer

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** Upper bound of a request's input tokens. Images by IMAGE_TOKENS; base64 payloads are not counted as text. A PDF
 *  (a "document" block) makes the bound infinite: it can't be sent on this path. */
export function inputTokenBound(req: { system: string; messages: unknown[]; tools: unknown[] }): number {
  let n = FRAME_TOKENS + bytes(req.system) + bytes(JSON.stringify(req.tools ?? []));
  for (const m of req.messages as { content: unknown }[]) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as { type?: string; text?: string }[]);
    for (const b of blocks) {
      if (b.type === "text") n += bytes(b.text ?? "");
      else if (b.type === "image") n += IMAGE_TOKENS;
      else return Infinity;
    }
  }
  return n;
}

/** The most one step may cost, in cents. */
export function stepBoundCents(inputTokens: number, maxTokens: number, rate: Rate): number {
  return (inputTokens * Math.max(rate.in, rate.cacheWrite) + maxTokens * rate.out) / 1_000_000 * 100;
}

/** One run's spend: every step reserved at its bound before it is sent, then charged what it actually cost (or its
 *  bound when that is unknown). Nothing is sent that could take the run past its limit. */
export class RunLedger {
  readonly limit: number;
  spent = 0;            // cents charged so far (actual where reported, the bound where not)
  unknown = 0;          // steps charged at their bound because no usage came back
  steps = 0;
  constructor(limitCents: number) { this.limit = Math.min(RUN_LIMIT_CENTS, Math.max(0, limitCents)); }
  fits(boundCents: number): boolean { return Number.isFinite(boundCents) && this.spent + boundCents <= this.limit + 1e-9; }
  charge(boundCents: number, actual: { model: string; usage: Usage } | null): number {
    const c = actual ? Math.min(costCents(actual.model, actual.usage), Number.POSITIVE_INFINITY) : boundCents;
    if (!actual) this.unknown++;
    this.steps++;
    this.spent += c;
    return c;
  }
}

export const rateOf = (model: string): Rate => PRICING[model] ?? PRICING["claude-sonnet-4-6"];
