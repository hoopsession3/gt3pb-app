import { NextResponse } from "next/server";
import { nameFrom } from "@/lib/drinks";
import { readMenuRows } from "@/lib/drinksRead";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { benefitsForUser } from "@/lib/benefits";
import { cartRefusal, MENU_UNCHECKED } from "@/lib/catalog";
import { priceCups } from "@/lib/cupPrice";
import { squarePriceMap } from "@/lib/squareCatalog";
import { route } from "@/lib/apiRoute";

// THE CUP CHECKOUT'S QUOTE (2026-10-12, C2 of the customer frontend audit, approved) — what /api/checkout would charge
// for this cart, before Pay: each line at its price, a member's perks applied and named, and the subtotal. The page
// shows it, and sends the amount it showed with the charge, which refuses any other (lib/cupPrice). The same reads as
// the charge — products (a drink off the menu or 86'd is refused in the same words, lib/catalog cartRefusal), Square
// for a price products lacks, the caller's perks (lib/benefits) — so the quote and the charge cannot drift.
// A guest gets the price anyone pays; a signed-in member gets their perks (userFromRequest, null for a guest).
// An 86 in one city (0408, the Pass's) is the charge's to refuse, where the order's city is known — its stop's; the cart
// already shows it sold out for the viewer's city (lib/availability), and the charge refuses it before the card.
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
  // The Catalog's rows for this cart (lib/drinksRead — the menu's read; 0393's columns when they are there).
  const { rows, error: availErr } = await readMenuRows(supabaseAdmin, uniq);
  if (availErr) return NextResponse.json({ error: MENU_UNCHECKED }, { status: 503 });
  const nameOf = (slug: string) => nameFrom(rows, slug);
  const refused = cartRefusal(uniq, rows, nameOf);
  if (refused) return NextResponse.json({ error: refused }, { status: 409 });
  const productPrices: Record<string, number> = {};
  for (const p of rows) if (typeof p.price_cents === "number" && p.price_cents > 0) productPrices[p.slug] = p.price_cents;
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const squarePrices = items.some((id) => productPrices[id] == null) && token ? await squarePriceMap(token) : {};
  const user = await userFromRequest(req);
  const benefits = await benefitsForUser(user?.id ?? null, code);

  const priced = priceCups(items, productPrices, squarePrices, benefits, nameOf);
  if ("unknown" in priced) return NextResponse.json({ error: `Unknown item: ${priced.unknown}` }, { status: 400 });
  return NextResponse.json({ lines: priced.lines, subtotalCents: priced.subtotal }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = route("checkout/quote", post);
