import { NextResponse } from "next/server";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { benefitsForUser } from "@/lib/benefits";
import { cartRefusal, MENU_UNCHECKED, type CartRow } from "@/lib/catalog";
import { priceCups } from "@/lib/cupPrice";
import { squarePriceMap } from "@/lib/squareCatalog";
import { route } from "@/lib/apiRoute";

// THE CUP CHECKOUT'S QUOTE (2026-10-12, C2 of the customer frontend audit, approved) — what /api/checkout would charge
// for this cart, before Pay: each line at its price, a member's perks applied and named, and the subtotal. The page
// shows it, and sends the amount it showed with the charge, which refuses any other (lib/cupPrice). The same reads as
// the charge — products (a drink off the menu or 86'd is refused in the same words, lib/catalog cartRefusal), Square
// for a price products lacks, the caller's perks (lib/benefits) — so the quote and the charge cannot drift.
// A guest gets the price anyone pays; a signed-in member gets their perks (userFromRequest, null for a guest).
async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });
  let body: { items?: unknown; code?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const items = Array.isArray(body.items) ? body.items.filter((x): x is string => typeof x === "string") : [];
  if (items.length === 0 || items.length > 25 || items.length !== (body.items as unknown[]).length) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code : null;

  const uniq = [...new Set(items)];
  const { data: avail, error: availErr } = await supabaseAdmin.from("products").select("slug, sold_out, active, price_cents").in("slug", uniq);
  if (availErr) return NextResponse.json({ error: MENU_UNCHECKED }, { status: 503 });
  const rows = (avail ?? []) as (CartRow & { price_cents: number | null })[];
  const refused = cartRefusal(uniq, rows, (slug) => DRINKS[slug as DrinkId]?.n ?? slug);
  if (refused) return NextResponse.json({ error: refused }, { status: 409 });
  const productPrices: Record<string, number> = {};
  for (const p of rows) if (typeof p.price_cents === "number" && p.price_cents > 0) productPrices[p.slug] = p.price_cents;
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const squarePrices = items.some((id) => productPrices[id] == null) && token ? await squarePriceMap(token) : {};
  const user = await userFromRequest(req);
  const benefits = await benefitsForUser(user?.id ?? null, code);

  const priced = priceCups(items, productPrices, squarePrices, benefits);
  if ("unknown" in priced) return NextResponse.json({ error: `Unknown item: ${priced.unknown}` }, { status: 400 });
  return NextResponse.json({ lines: priced.lines, subtotalCents: priced.subtotal }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = route("checkout/quote", post);
