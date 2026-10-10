import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { route } from "@/lib/apiRoute";
import { callerKey, mapsConfigured, resolve, suggest } from "@/lib/appleMaps";

// public: address suggestions while a customer types one, and the address a pick names, from Apple Maps — reads only, bounded per caller and for the app in the shared store
// ADDRESSES, AS THEY ARE TYPED (2026-10-10). components/AddressField asks here; lib/appleMaps asks Apple. Public on
// purpose: shipping and delivery addresses are typed by people who have not signed in yet. What keeps it from being a
// free Apple Maps for the internet is the limiter (rate_limit_hit, 0154), in the store every instance shares: 40 a
// minute for one caller (a person types a few dozen letters, and the field waits for a pause), and 1,000 an hour for
// the whole app, under Apple's 25,000 a day for the team. Nothing typed is stored or logged; the caller is a hash.
const PER_CALLER = { windowMs: 60_000, max: 40 };
const PER_APP = { windowMs: 3_600_000, max: 1_000 };

async function get(req: Request) {
  if (!mapsConfigured()) return NextResponse.json({ configured: false, results: [] });
  const u = new URL(req.url);
  const pick = u.searchParams.get("pick") ?? "";
  const q = (u.searchParams.get("q") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!pick && q.length < 4) return NextResponse.json({ configured: true, results: [] });

  if (supabaseAdmin) {
    const [mine, all] = await Promise.all([
      supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `address:${callerKey(req)}`, p_window_ms: PER_CALLER.windowMs, p_max: PER_CALLER.max }),
      supabaseAdmin.rpc("rate_limit_hit", { p_bucket: "address:all", p_window_ms: PER_APP.windowMs, p_max: PER_APP.max }),
    ]);
    if (mine.data === false || all.data === false) return NextResponse.json({ configured: true, results: [], busy: true }, { status: 429 });
  }

  const headers = { "cache-control": "no-store" };
  if (pick) return NextResponse.json({ configured: true, address: await resolve(pick).catch(() => null) }, { headers });
  return NextResponse.json({ configured: true, results: await suggest(q).catch(() => []) }, { headers });
}

export const GET = route("address", get);
