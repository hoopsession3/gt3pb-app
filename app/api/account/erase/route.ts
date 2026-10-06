import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { SQUARE_BASE, squareHeaders } from "@/lib/squareServer";
import { raiseAlert } from "@/lib/serverAlerts";
import { route } from "@/lib/apiRoute";

// DELETE MY ACCOUNT — the route behind "Delete account" in the account menu, on the web and in the
// iPhone app (App Store Review Guideline 5.1.1(v): an app that lets people make an account must let
// them delete it, in the app, without an email or a phone call).
//
//   GET                     → what deleting would mean for the caller, before anything changes:
//                             { blockers: [{ code, message }], membership: boolean }
//   POST { confirm: true }  → it happens: { ok: true }
//
// THE DATABASE DOES THE DELETING. Supabase's admin API deletes the account — the documented way,
// which takes the sign-ins and sessions with it — and 0353's trigger on auth.users erases the
// person's data in the same transaction (deleted, kept for the books without them, or kept as
// signed), or refuses with a reason and nothing changes. What only this route can do comes first,
// in this order, each step safe to repeat if a later one fails:
//   1. ask what stands in the way (account_erasure_blockers) and answer before anything changes;
//   2. cancel a membership at Square, so no charge outlives the account — if Square cannot confirm
//      it, stop there: nothing is deleted;
//   3. remove their photos from storage — their avatar and their VIP proof, both in public buckets;
//   4. delete the account;
//   5. delete their Square customer profile, which holds their saved card. Best effort: the account
//      is already gone, so a failure here raises an alert for the crew to finish it by hand.

type Blocker = { code: string; message: string };

const PHOTO_BUCKETS = ["avatars", "vip"] as const;   // both written to `<user id>/…` (ProfileSheet, StatusCard, VipVerify)
const BILLING = ["active", "paused", "pending", "past_due"];

async function blockersFor(userId: string): Promise<Blocker[] | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.rpc("account_erasure_blockers", { p_user: userId });
  if (error || !Array.isArray(data)) return null;
  return data as Blocker[];
}

async function get(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const list = await blockersFor(user.id);
  if (!list) return NextResponse.json({ error: "Deleting an account isn't available yet. Try again later today." }, { status: 503 });
  // A membership is not something they have to clear first: deleting cancels it (step 2).
  return NextResponse.json({ blockers: list.filter((b) => b.code !== "membership"), membership: list.some((b) => b.code === "membership") });
}

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  let body: { confirm?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (body.confirm !== true) return NextResponse.json({ error: "Confirm to delete your account." }, { status: 400 });

  // 1 · what stands in the way
  const first = await blockersFor(user.id);
  if (!first) return NextResponse.json({ error: "Deleting an account isn't available yet. Try again later today." }, { status: 503 });
  const standing = first.filter((b) => b.code !== "membership");
  if (standing.length) return NextResponse.json({ error: standing[0].message, blockers: standing }, { status: 409 });

  // 2 · the membership, cancelled at Square before anything is deleted
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const { data: subs } = await supabaseAdmin
    .from("subscriptions").select("square_subscription_id").eq("user_id", user.id).in("status", BILLING);
  for (const s of subs ?? []) {
    const id = s.square_subscription_id as string | null;
    if (!id) continue;   // never reached Square, so nothing can bill (0353 does not count it either)
    if (!token) return NextResponse.json({ error: "We can't reach our payment processor to cancel your membership, so nothing was deleted. Try again later today." }, { status: 503 });
    const res = await fetch(`${SQUARE_BASE}/v2/subscriptions/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: squareHeaders(token), body: "{}" });
    if (!res.ok) {
      // Already cancelled there (a second try, or cancelled from the card first)? Look before giving up.
      const look = await fetch(`${SQUARE_BASE}/v2/subscriptions/${encodeURIComponent(id)}`, { headers: squareHeaders(token) });
      const sub = (await look.json().catch(() => ({})))?.subscription;
      const ended = look.ok && (sub?.status === "CANCELED" || sub?.status === "DEACTIVATED" || !!sub?.canceled_date);
      if (!ended) return NextResponse.json({ error: "We couldn't cancel your membership with our payment processor, so nothing was deleted. Try again in a minute." }, { status: 502 });
    }
    // scoped-by: `id` was read above with .eq("user_id", user.id) — it is provably this caller's own
    // subscription, and the update keys off that verified id, never anything the request supplied.
    await supabaseAdmin.from("subscriptions")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("square_subscription_id", id);
  }

  // Read before the account goes — after it, the profile that names it is gone.
  const { data: prof } = await supabaseAdmin.from("profiles").select("square_customer_id").eq("id", user.id).maybeSingle();
  const squareCustomer = (prof?.square_customer_id as string | null) || null;

  // 3 · their photos (a bucket that does not exist here has nothing of theirs in it)
  for (const bucket of PHOTO_BUCKETS) {
    const store = supabaseAdmin.storage.from(bucket);
    const { data: files, error } = await store.list(user.id, { limit: 1000 });
    if (error) {
      if (/not.?found/i.test(error.message)) continue;
      return NextResponse.json({ error: "We couldn't remove your photos, so nothing was deleted. Try again in a minute." }, { status: 502 });
    }
    const paths = (files ?? []).filter((f) => f.name).map((f) => `${user.id}/${f.name}`);
    if (paths.length) {
      const { error: rmErr } = await store.remove(paths);
      if (rmErr) return NextResponse.json({ error: "We couldn't remove your photos, so nothing was deleted. Try again in a minute." }, { status: 502 });
    }
  }

  // 4 · the account — and with it, by 0353's trigger, their data
  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  if (delErr) {
    // The database said no. Supabase reports every refusal as "Database error deleting user", so
    // ask again what stands in the way: an order placed a moment ago, say.
    const now = (await blockersFor(user.id)) ?? [];
    if (now.length) return NextResponse.json({ error: now[0].message, blockers: now }, { status: 409 });
    throw new Error(`account erase: deleteUser failed — ${delErr.message}`);   // route() files it and answers in JSON
  }

  // 5 · their saved card, at Square
  if (squareCustomer && token) {
    let removed = false;
    try {
      const r = await fetch(`${SQUARE_BASE}/v2/customers/${encodeURIComponent(squareCustomer)}`, { method: "DELETE", headers: squareHeaders(token) });
      removed = r.ok || r.status === 404;
    } catch { /* below */ }
    if (!removed) {
      await raiseAlert({
        severity: "important", category: "money",
        title: "Remove a deleted account's Square profile",
        body: `Someone deleted their GT3 account. Their Square customer profile ${squareCustomer} could not be removed automatically and still holds their saved card — delete it in Square › Customers.`,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

export const GET = route("account/erase", get);
export const POST = route("account/erase", post);
