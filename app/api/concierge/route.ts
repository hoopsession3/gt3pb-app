import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ClaudeMsg } from "@/lib/anthropic";
import { menuKnowledge } from "@/lib/conciergeKb";
import { ownerCorrections } from "@/lib/agentKnowledge";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// PUBLIC CONCIERGE — the guest-facing pocket brain. Answers what's on the menu, where the truck is,
// how to book it, and how membership works. PUBLIC (no auth) so it grounds ONLY on customer-safe data:
// the canonical menu copy + live prices, the live truck status, upcoming public events, and the
// membership tiers. Claim-safe (health-adjacent brand) and on-topic only. Haiku — fast + cheap.

const SYSTEM = `You are the GT3 Performance Bar concierge — a warm, concise host for GUESTS of a mobile whole-food beverage bar. You help people understand the menu, what to order and when, where to find the truck, how to book it for an event, and how membership works.

GROUND TRUTH: Answer ONLY from the MENU, LIVE STATUS, EVENTS, and MEMBERSHIP context below. Do not use outside knowledge or make anything up.

INGREDIENT EDUCATION (this is a whole-food brand — teach it well, within the lines):
- You MAY educate about our ingredients and methods using the INGREDIENT SCIENCE facts in your OWNER CORRECTIONS below — describe what an ingredient IS and its generally-recognized, sourced properties, plainly and warmly (e.g. "goat milk is naturally an A2 milk," "coconut water is naturally rich in potassium," "we use Ceylon — true cinnamon — naturally low in coumarin," "cold-brewed slow and cold, which many find smoother"). Share those facts in spirit; they are the truth.
- You must STILL NEVER make DISEASE claims (cure / treat / prevent / heal / detox / cleanse / "reduces inflammation" / "balances blood sugar"), give personalized medical advice, claim allergen safety ("lactose-free," "safe for a milk allergy," "safe for diabetics"), or state specific caffeine/nutrition numbers that aren't in your knowledge. For allergies, medical suitability, dosages, or exact numbers → say those aren't verified here and point them to the crew at the window or their doctor/dietitian.
- If asked whether a drink "detoxes," "cleanses," or gives "clean energy your body doesn't have to process," reframe honestly: it's clean because of WHAT'S IN IT — whole foods, nothing artificial, no refined sugar, no seed oils, no synthetic additives — not because of anything it does to the body. Never use the word "detox," and never say seed oils or additives are "harmful" (present them as a formulation choice, not a health verdict).
- Only answer about GT3: the menu, visiting/finding the truck, booking, membership, and events. If asked anything off-topic, warmly redirect to how you can help with GT3.
- If you don't have a fact (a price not listed, a location not shown, hours), say so plainly and point them to start an order, book the truck, or check back — don't guess.
- To order: tell them to tap "Start your order." To book the truck for an event: point them to the booking page. Keep it short, friendly, and human. No hype, no emoji spam.`;

// Best-effort, per-instance throttle on a public + paid endpoint. Resets on cold start by design —
// it's a courtesy cap against accidental hammering, not a security control.
const HITS = new Map<string, { n: number; t: number }>();
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 12;
function throttled(ip: string): boolean {
  const now = Date.now();
  const cur = HITS.get(ip);
  if (!cur || now - cur.t > WINDOW_MS) { HITS.set(ip, { n: 1, t: now }); return false; }
  cur.n += 1;
  return cur.n > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "Chat isn't available right now." }, { status: 503 });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  if (throttled(ip)) return NextResponse.json({ ok: false, error: "One sec — too many messages. Try again in a moment." }, { status: 429 });

  let messages: any[] = [];
  try { ({ messages } = await req.json()); } catch { /* */ }
  if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ ok: false, error: "messages required" }, { status: 400 });
  const trimmed: ClaudeMsg[] = messages.slice(-8).map((m) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "").slice(0, 1000) }));

  // Public live context (best-effort; the concierge still answers from the static menu alone).
  const today = new Date().toISOString().slice(0, 10);
  let prices = "", live = "", events = "", plans = "";
  if (supabaseAdmin) {
    const [pr, ls, ev, pl] = await Promise.all([
      supabaseAdmin.from("products").select("slug, name, price_cents, active").eq("active", true),
      supabaseAdmin.from("live_status").select("is_live, current_stop_id").eq("id", 1).maybeSingle(),
      supabaseAdmin.from("events").select("title, day_label, day, start_time, location_text, member_only").is("archived_at", null).gte("day", today).order("day").limit(8),
      supabaseAdmin.from("subscription_plans").select("label, price_cents, period_days, active").eq("active", true).order("price_cents"),
    ]);
    prices = (pr.data ?? []).map((p: any) => `- ${p.name ?? p.slug}: $${((p.price_cents ?? 0) / 100).toFixed(2)}`).join("\n");
    if (ls.data) {
      let where = "";
      if ((ls.data as any).current_stop_id) {
        const { data: s } = await supabaseAdmin.from("stops").select("name, location_text").eq("id", (ls.data as any).current_stop_id).maybeSingle();
        if (s) where = `${(s as any).name}${(s as any).location_text ? ` — ${(s as any).location_text}` : ""}`;
      }
      let next = "";
      if (!(ls.data as any).is_live) {
        // The truck's own schedule, not a hand-typed ETA field — the next stop that hasn't
        // started yet, in date order, same source of truth the Truck page reads.
        const { data: n } = await supabaseAdmin.from("stops").select("name, starts_at")
          .is("archived_at", null).neq("status", "done").gte("starts_at", new Date().toISOString())
          .order("starts_at").limit(1).maybeSingle();
        if (n && (n as any).starts_at) {
          const d = new Date((n as any).starts_at);
          next = `${(n as any).name}, ${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
        }
      }
      live = (ls.data as any).is_live
        ? `The truck is OPEN now${where ? ` at ${where}` : ""}.`
        : `The truck is not currently open${next ? `. Next: ${next}` : ""}.`;
    }
    events = (ev.data ?? []).filter((e: any) => !e.member_only).map((e: any) => `- ${e.title ?? "Event"}${e.day_label ? ` (${e.day_label})` : e.day ? ` (${e.day})` : ""}${e.start_time ? ` ${e.start_time}` : ""}${e.location_text ? ` — ${e.location_text}` : ""}`).join("\n");
    plans = (pl.data ?? []).map((p: any) => `- ${p.label}: $${((p.price_cents ?? 0) / 100).toFixed(2)} every ${p.period_days} days`).join("\n");
  }

  const corrections = await ownerCorrections("concierge");
  const system = `${SYSTEM}${corrections ? `\n\n${corrections}` : ""}

=== MENU (canonical copy; use these descriptions verbatim in spirit) ===
${menuKnowledge()}

=== CURRENT PRICES (live; prefer these over any price in the menu copy) ===
${prices || "(check at the window)"}

=== LIVE TRUCK STATUS ===
${live || "(status unknown — invite them to check back or start an order)"}

=== UPCOMING PUBLIC EVENTS ===
${events || "(none announced right now)"}

=== MEMBERSHIP TIERS ===
${plans || "(ask about membership at the window)"}

To book the truck for a private event, send people to the booking page (/book). To order, tell them to tap "Start your order."`;

  try {
    const r = await callClaude({ model: MODELS.haiku, maxTokens: 500, temperature: 0.3, system, messages: trimmed });
    return NextResponse.json({ ok: true, reply: r.text });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
