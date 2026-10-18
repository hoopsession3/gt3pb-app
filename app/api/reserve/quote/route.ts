import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { benefitsForUser, refillIsFree } from "@/lib/benefits";
import { packCents } from "@/lib/packOrder";
import { isPackSize, type GlassPath } from "@/lib/orderAhead";
import { route } from "@/lib/apiRoute";
import { callerIp, limitsFit } from "@/lib/rateLimit";

// public: a pack's price before Pay — the price anyone pays, or a signed-in member's with their tier's perks (who is calling prices the pack, never permits it); reads only, bounded per caller and for the app in the shared store

// A PACK'S PRICE, BEFORE PAY (R7b, 2026-10-16). What /api/reserve would charge this caller for this pack — their tier's
// perks (0176: a founding member's bring-back refill is on us) and a code's discount applied, in the reserve's own rule
// (lib/packOrder packCents) — so the pay step shows that amount and sends it. The funnel priced a pack from the grid and
// a code alone: a founding member read "Pay $42.00" for a pack the server prices at $0, and the charge failed (Square
// refuses $0). A read: nothing is reserved or charged here. Signed out, the price anyone pays.
async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Reservations aren't switched on yet." }, { status: 503 });
  let body: { size?: unknown; glass?: unknown; code?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  // BOUNDED (R23 — API F15): counted with a code only, before; each caller now, then the app (the cup quote's numbers and
  // buckets — one door for prices).
  if (!(await limitsFit(supabaseAdmin, [
    { bucket: `quote:${callerIp(req)}`, windowMs: 600_000, max: 600 },
    { bucket: "quote:all", windowMs: 3_600_000, max: 20_000 },
  ]))) return NextResponse.json({ error: "Too many price checks just now — give it a minute." }, { status: 429 });
  const size = Number(body.size);
  const glass: GlassPath | null = body.glass === "return" ? "return" : body.glass === "new" ? "new" : null;
  if (!isPackSize(size) || !glass) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const code = typeof body.code === "string" && body.code.trim() ? body.code.trim().slice(0, 40) : null;
  // A code asked about is counted (R9 — the abuse audit's eleventh): a price that changed told a script which of the
  // codes it tried were real. A hundred and twenty an address in ten minutes, with a code — a cart re-priced as it
  // changes stays far under, a venue's Wi-Fi too; without one, nothing is counted. Past it the quote says to wait — never
  // a price without the code, which Pay would then refuse as changed. Fails open.
  if (code) {
    const ip = callerIp(req);
    const fits = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `quote-code:${ip}`, p_window_ms: 600_000, p_max: 120 });
    if (fits.data === false) return NextResponse.json({ error: "Too many tries with a code — give it a minute." }, { status: 429 });
  }
  const user = await userFromRequest(req);
  const benefits = await benefitsForUser(user?.id ?? null, code);
  const totalCents = packCents(size, glass, benefits);
  // What made it free, said as the owner named the perk (its label), when one did.
  const perk = glass === "return" && totalCents === 0 && refillIsFree(benefits)
    ? benefits.find((b) => b.kind === "free_refill")?.label ?? null : null;
  return NextResponse.json({ totalCents, perk }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = route("reserve/quote", post);
