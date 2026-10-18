import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest, bearerProvedWithin } from "@/lib/apiAuth";
import { SQUARE_BASE, squareHeaders, squareDeadline } from "@/lib/squareServer";
import { route } from "@/lib/apiRoute";
import { raiseAlert } from "@/lib/serverAlerts";
import { revoke, siwaConfigured, verifyIdentityToken } from "@/lib/appleSignIn";
import { PROVED_FOR_S } from "@/lib/freshProof";
import { eraseAccount, ERASE_WORDS, type Blocker, type EraseSteps, type Followup } from "@/lib/accountErase";

// DELETE MY ACCOUNT — the route behind "Delete account" in the account menu, on the web and in the
// iPhone app (App Store Review Guideline 5.1.1(v): an app that lets people make an account must let
// them delete it, in the app, without an email or a phone call).
//
//   GET                     → what deleting would mean for the caller, before anything changes:
//                             { blockers: [{ code, message }], membership: boolean, office: string[] }
//   POST { confirm: true }  → it happens: { ok: true, appleManual, membershipPending }
//        { …, apple: { idToken, nonce } } — Apple's sheet, just now, for an account that signs in with Apple
//                          → 403 { error, prove: true } when the caller hasn't proved it is them just now (below)
//
// PROVED JUST NOW (R27, 2026-10-18 — the 10/10 audit, security F7; Ryan: "Yes, a fresh code"). A session was enough to
// delete an account for good, so a phone left unlocked, or lent for a minute, could delete its owner's. The delete asks
// for a proof from the last five minutes before anything changes: the session's own — the 8-digit code emailed when they
// press Delete (components/DeleteAccount), which Supabase writes into the token with its time (lib/freshProof) — or
// Apple's word, just now, for this account's Apple ID (Face ID on the iPhone: lib/appleSignIn verifyIdentityToken).
// A screen with no code step — the iPhone app built before R27, or a web page loaded before it — shows the 403's words,
// which ask for a fresh sign-in: that proves it just the same (a sign-in writes its time into the new session), so the
// older app keeps its delete with no door left open for it (lib/accountErase ERASE_WORDS.prove).
//
// THE DATABASE GOES FIRST (2026-10-15, A3 of the account audit). Supabase's admin API deletes the account — the
// documented way, which takes the sign-ins and sessions with it — and in that one transaction 0353's trigger erases the
// person's data (deleted, kept for the books without them, or kept as signed) and 0404's writes what is left outside the
// database: the membership to cancel at Square, the Square profile holding a saved card, the token Sign in with Apple gave
// GT3, each photo. Or the erasure refuses with a reason, and none of it happens — before, this cancelled the membership,
// removed the photos and revoked Apple first, so a refusal left an account without them (deletion stopped halfway). Then
// the steps outside, each tried twice; one that still fails goes to the crew by an alert saying what to do by hand, and a
// watch hands over anything this never reached (lib/accountErase decides the order; 0404 keeps the queue).

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
  if (!list) return NextResponse.json({ error: ERASE_WORDS.unavailable }, { status: 503 });
  // A membership is not something they have to clear first: deleting cancels it (0404 queues the cancel).
  // scoped-by: both reads are keyed by the caller's own verified id, never anything the request supplied.
  const { data: subs } = await supabaseAdmin.from("subscriptions").select("id")
    .eq("user_id", user.id).not("square_subscription_id", "is", null).in("status", BILLING).limit(1);
  // A company's weekly office order under their name stops when they go (0354 office_account_lost_person, which tells
  // the crew) — so the person deleting is told first, not only the crew after.
  const { data: offices } = await supabaseAdmin.from("business_accounts").select("company")
    .eq("user_id", user.id).eq("standing_active", true);
  return NextResponse.json({
    blockers: list,
    membership: (subs ?? []).length > 0,
    office: (offices ?? []).map((o) => String(o.company ?? "").trim() || "Your office").slice(0, 3),
  });
}

/** Apple's word, just now, that the person is this account's Apple ID: Apple's signed token, made for the nonce the phone
 *  asked with, in the last five minutes, naming an Apple identity this account holds. */
async function appleSaysNow(userId: string, apple: unknown): Promise<boolean> {
  if (!supabaseAdmin || !apple || typeof apple !== "object" || Array.isArray(apple)) return false;
  const { idToken, nonce } = apple as { idToken?: unknown; nonce?: unknown };
  const got = await verifyIdentityToken(idToken, nonce).catch(() => null);
  if (!got || got.iat === null || got.iat < Math.floor(Date.now() / 1000) - PROVED_FOR_S) return false;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return !!data?.user?.identities?.some((i) => i.provider === "apple" && String(i.identity_data?.sub ?? i.id ?? "") === got.sub);
}

/** One step outside the database, for a deleted account. */
async function run(f: Followup): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (f.kind === "square_subscription") {
    if (!token) return { ok: false, error: "Square isn't configured" };
    const res = await fetch(`${SQUARE_BASE}/v2/subscriptions/${encodeURIComponent(f.ref)}/cancel`, { method: "POST", headers: squareHeaders(token), body: "{}", signal: squareDeadline() });
    if (res.ok) return { ok: true };
    // Already cancelled there (a second try, or cancelled from the card first)? Look before calling it failed.
    const look = await fetch(`${SQUARE_BASE}/v2/subscriptions/${encodeURIComponent(f.ref)}`, { headers: squareHeaders(token), signal: squareDeadline() });
    const sub = (await look.json().catch(() => ({})))?.subscription;
    const ended = look.ok && (sub?.status === "CANCELED" || sub?.status === "DEACTIVATED" || !!sub?.canceled_date);
    return ended ? { ok: true } : { ok: false, error: `Square answered ${res.status}` };
  }
  if (f.kind === "square_customer") {
    if (!token) return { ok: false, error: "Square isn't configured" };
    const r = await fetch(`${SQUARE_BASE}/v2/customers/${encodeURIComponent(f.ref)}`, { method: "DELETE", headers: squareHeaders(token), signal: squareDeadline() });
    return r.ok || r.status === 404 ? { ok: true } : { ok: false, error: `Square answered ${r.status}` };
  }
  if (f.kind === "apple_token") {
    if (!siwaConfigured()) return { ok: false, error: "Sign in with Apple's key isn't set" };
    return (await revoke(f.ref).catch(() => false)) ? { ok: true } : { ok: false, error: "Apple did not confirm" };
  }
  // a photo: 'bucket/path', in one of the two buckets a person's photos are written to
  const slash = f.ref.indexOf("/");
  const bucket = f.ref.slice(0, slash), path = f.ref.slice(slash + 1);
  if (slash < 1 || !(PHOTO_BUCKETS as readonly string[]).includes(bucket) || !path) return { ok: false, error: "not a photo of theirs" };
  const { error } = await supabaseAdmin!.storage.from(bucket).remove([path]);
  return !error || /not.?found/i.test(error.message) ? { ok: true } : { ok: false, error: error.message };
}

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const admin = supabaseAdmin;
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  let body: { confirm?: unknown; apple?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });   // a literal null is valid JSON (R10b): a 400, not a TypeError's 500
  if (body.confirm !== true) return NextResponse.json({ error: "Confirm to delete your account." }, { status: 400 });
  // Proved just now (R27, above) — before anything is asked, marked or deleted.
  if (!bearerProvedWithin(req) && !(await appleSaysNow(user.id, body.apple))) {
    return NextResponse.json({ error: ERASE_WORDS.prove, prove: true }, { status: 403 });
  }

  const steps: EraseSteps = {
    blockers: blockersFor,
    hasApple: async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      return !!data.user?.identities?.some((i) => i.provider === "apple");
    },
    // Read before the account goes, and done directly when the queue cannot be claimed (lib/accountErase's safety net).
    outside: async (id) => {
      const out: Followup[] = [];
      const { data: prof } = await admin.from("profiles").select("square_customer_id").eq("id", id).maybeSingle();
      if (prof?.square_customer_id) out.push({ id: `direct-${out.length}`, kind: "square_customer", ref: String(prof.square_customer_id) });
      const { data: held } = await admin.from("apple_tokens").select("refresh_token").eq("user_id", id).maybeSingle();
      if (held?.refresh_token) out.push({ id: `direct-${out.length}`, kind: "apple_token", ref: String(held.refresh_token) });
      for (const bucket of PHOTO_BUCKETS) {
        const { data: files } = await admin.storage.from(bucket).list(id, { limit: 1000 });
        for (const f of files ?? []) if (f.name) out.push({ id: `direct-${out.length}`, kind: "photo", ref: `${bucket}/${id}/${f.name}` });
      }
      return out;
    },
    newTicket: () => randomUUID(),
    // The ticket rides on the account into 0404's trigger, which marks this deletion's rows with it.
    markTicket: async (id, ticket) => !(await admin.auth.admin.updateUserById(id, { app_metadata: { erasure_ticket: ticket } })).error,
    deleteAccount: async (id) => {
      const { error } = await admin.auth.admin.deleteUser(id);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    claim: async (ticket) => {
      const { data, error } = await admin.rpc("claim_erasure_followups", { p_ticket: ticket, p_limit: 20 });
      // Any failure to claim — not only a function PostgREST does not know: the steps read before the delete are done
      // directly (R14; a refused claim answered [] and left the deleted account's card in Square with nobody told).
      if (error) { console.error(`erase: couldn't claim the follow-ups for ${ticket} — doing them directly: ${error.message}`); return null; }
      return (Array.isArray(data) ? data : []) as Followup[];
    },
    run,
    // Each queue write read (R12b, F4): a follow-up not marked finished is said in the log (the queue takes it up again),
    // and one the queue could not hand to the crew is handed to them directly, in the same words — a deleted account's
    // saved card is never left in Square with no one told.
    finish: async (f, ok, error) => {
      if (f.direct) return;
      const r = await admin.rpc("finish_erasure_followup", { p_id: f.id, p_ok: ok, p_error: error ?? null });
      if (r.error) console.error(`erase: follow-up ${f.id} done (${ok ? "ok" : "failed"}) but not marked — ${r.error.message}`);
    },
    handOff: async (f) => {
      if (!f.direct) {
        const r = await admin.rpc("erasure_followup_alert", { p_id: f.id });
        if (!r.error) return;
        console.error(`erase: follow-up ${f.id} couldn't go to the crew by the queue — telling them directly: ${r.error.message}`);
      }
      // When the queue cannot: the crew is told what is left, directly
      if (f.kind === "square_customer") {
        await raiseAlert({ severity: "important", category: "money", title: "Remove a deleted account's Square profile",
          body: `Someone deleted their GT3 account. Their Square customer profile ${f.ref} could not be removed automatically and still holds their saved card — delete it in Square › Customers.` });
      } else if (f.kind === "photo") {
        await raiseAlert({ severity: "important", category: "system", title: "Remove a deleted account's photo",
          body: `Someone deleted their GT3 account, and a photo of theirs could not be removed automatically: ${f.ref} in Supabase › Storage. Delete it there.` });
      }
    },
  };

  const answer = await eraseAccount(user.id, steps);
  if (answer.thrown) throw new Error(answer.thrown);   // route() files it and answers in JSON
  return NextResponse.json(answer.body, { status: answer.status });
}

export const GET = route("account/erase", get);
export const POST = route("account/erase", post);
