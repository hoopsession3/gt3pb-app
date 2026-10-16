import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { benefitsForUser, refillIsFree } from "@/lib/benefits";
import { packCents } from "@/lib/packOrder";
import { isPackSize, type GlassPath } from "@/lib/orderAhead";
import { route } from "@/lib/apiRoute";

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
  const size = Number(body.size);
  const glass: GlassPath | null = body.glass === "return" ? "return" : body.glass === "new" ? "new" : null;
  if (!isPackSize(size) || !glass) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const code = typeof body.code === "string" && body.code.trim() ? body.code.trim().slice(0, 40) : null;
  const user = await userFromRequest(req);
  const benefits = await benefitsForUser(user?.id ?? null, code);
  const totalCents = packCents(size, glass, benefits);
  // What made it free, said as the owner named the perk (its label), when one did.
  const perk = glass === "return" && totalCents === 0 && refillIsFree(benefits)
    ? benefits.find((b) => b.kind === "free_refill")?.label ?? null : null;
  return NextResponse.json({ totalCents, perk }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = route("reserve/quote", post);
