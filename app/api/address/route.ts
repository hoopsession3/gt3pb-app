import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isJsonObject, route } from "@/lib/apiRoute";
import { callerKey, mapsConfigured, resolve, suggest } from "@/lib/appleMaps";
import { limitsFit } from "@/lib/rateLimit";

// public: address suggestions while a customer types one, and the address a pick names, from Apple Maps — reads only (asked in a POST's body, never the address bar), bounded per caller and for the app in the shared store
// ADDRESSES, AS THEY ARE TYPED (2026-10-10). components/AddressField asks here; lib/appleMaps asks Apple. Public on
// purpose: shipping and delivery addresses are typed by people who have not signed in yet. What keeps it from being a
// free Apple Maps for the internet is the limiter (rate_limit_hit, 0154), in the store every instance shares: 40 a
// minute for one caller (a person types a few dozen letters, and the field waits for a pause), and 1,000 an hour for
// the whole app, under Apple's 25,000 a day for the team. Nothing typed is stored or logged; the caller is a hash.
const PER_CALLER = { windowMs: 60_000, max: 40 };
const PER_APP = { windowMs: 3_600_000, max: 1_000 };

// WHAT IS TYPED GOES IN THE BODY (R18, 2026-10-17 — the 10/10 audit, security F10). It was a GET with the address in the
// query string — and a query string is written down by everything a request passes: the platform's request log, a
// proxy's, a crash report's address. "Nothing typed is stored or logged" was true of this file and not of the request.
// components/AddressField POSTs `{ q }` or `{ pick }` now; a body is logged by nobody. GET still answers, for iPhone
// builds made before R18 — the same answer, the same limits.
async function answer(req: Request, pickIn: unknown, qIn: unknown) {
  if (!mapsConfigured()) return NextResponse.json({ configured: false, results: [] });
  const pick = typeof pickIn === "string" ? pickIn.slice(0, 2000) : "";
  const q = (typeof qIn === "string" ? qIn : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!pick && q.length < 4) return NextResponse.json({ configured: true, results: [] });

  // The caller first, the app's hour last (lib/rateLimit, R10): one caller past its own forty never spends the thousand
  // every customer typing an address shares.
  if (supabaseAdmin && !(await limitsFit(supabaseAdmin, [
    { bucket: `address:${callerKey(req)}`, ...PER_CALLER },
    { bucket: "address:all", ...PER_APP },
  ]))) return NextResponse.json({ configured: true, results: [], busy: true }, { status: 429 });

  const headers = { "cache-control": "no-store" };
  if (pick) return NextResponse.json({ configured: true, address: await resolve(pick).catch(() => null) }, { headers });
  return NextResponse.json({ configured: true, results: await suggest(q).catch(() => []) }, { headers });
}

async function post(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  if (!isJsonObject(body)) return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  return answer(req, body.pick, body.q);
}

async function get(req: Request) {
  const u = new URL(req.url);
  return answer(req, u.searchParams.get("pick") ?? "", u.searchParams.get("q") ?? "");
}

export const POST = route("address", post);
export const GET = route("address", get);
