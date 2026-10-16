import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { cardTryFits, callerAddress, CARD_TRIES_WORDS } from "@/lib/cardGuard";
import { chargeVerdict, refusalWords, squareDeadline } from "@/lib/squareServer";
import { SQUARE_BASE, squareHeaders, planForPack, subsConfigured, mapSubStatus } from "@/lib/squareServer";
import { raiseAlert, raiseAlertOnce } from "@/lib/serverAlerts";
import { errorMessage } from "@/lib/errorMessage";
import { route } from "@/lib/apiRoute";

// Create a recurring subscription: ensure a Square Customer, vault the card, then
// CreateSubscription against the owner's plan variation. Square owns billing; we keep
// a status mirror (the webhook keeps it authoritative).
//
// AN ANSWER SQUARE NEVER GAVE IS NOT A "NO" (R10b, 2026-10-16 — the 10/10 audit). Any throw while Square was being asked
// to start the subscription — a dropped connection, a timeout, a 5xx, a body that would not parse — deleted the row and
// told the member to try again. If Square had started it, the member was billed monthly with nothing in the app to
// cancel, every webhook for it matched no row, and the retry started a second one. Now the row is stamped
// (square_asked_at, 0421) the moment Square is asked; an answer that does not say keeps it, tells the crew, and tells the
// member not to try again. Their next try asks Square first what it has for them: one it started is taken up, none means
// the stamp is cleared and the try goes on. The nightly sweep (0421) never deletes a row Square was asked about.
class SubscriptionUnknown extends Error {
  constructor(message: string) { super(message); this.name = "SubscriptionUnknown"; }
}

/** The member's live subscription at Square (one not canceled), or null when Square has none; undefined when Square could
 *  not be asked. */
async function liveAtSquare(token: string, customerId: string, locationId: string): Promise<{ id: string; status: string } | null | undefined> {
  try {
    const r = await fetch(`${SQUARE_BASE}/v2/subscriptions/search`, {
      method: "POST", headers: squareHeaders(token), signal: squareDeadline(),
      body: JSON.stringify({ query: { filter: { customer_ids: [customerId], location_ids: [locationId] } } }),
    });
    if (!r.ok) return undefined;
    const j = (await r.json().catch(() => null)) as { subscriptions?: { id?: string; status?: string }[] } | null;
    if (!j) return undefined;
    const live = (j.subscriptions ?? []).find((x) => x?.id && !["CANCELED", "DEACTIVATED"].includes(String(x.status ?? "").toUpperCase()));
    return live?.id ? { id: live.id, status: String(live.status ?? "") } : null;
  } catch {
    return undefined;
  }
}

async function post(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!subsConfigured() || !token || !locationId || !supabaseAdmin) {
    return NextResponse.json({ error: "Subscriptions aren't switched on yet." }, { status: 503 });
  }
  // Owner's go-live switch (0150): even with Square configured, subscriptions stay dark until the
  // owner flips subscriptions_enabled on (Money → Payments). Server-side authority, not just UI.
  const { data: ls } = await supabaseAdmin.from("live_status").select("subscriptions_enabled").maybeSingle();
  if ((ls as { subscriptions_enabled?: boolean } | null)?.subscriptions_enabled !== true) {
    return NextResponse.json({ error: "Subscriptions aren't available yet." }, { status: 503 });
  }
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to subscribe." }, { status: 401 });

  let body: { sourceId?: string; pack?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });   // a literal null (R10b)
  if (!body.sourceId) return NextResponse.json({ error: "Card required" }, { status: 400 });
  const pack = String(body.pack || "");
  const planId = planForPack(pack);
  if (!["6", "12", "18"].includes(pack) || !planId) return NextResponse.json({ error: "Choose a pack size (6, 12, or 18)." }, { status: 400 });
  // A card try, counted at every card door (R9, lib/cardGuard): saving a card at Square is one.
  if (!(await cardTryFits(supabaseAdmin, { userId: user.id, ip: callerAddress(req) }))) return NextResponse.json({ error: CARD_TRIES_WORDS }, { status: 429 });

  // A TRY SQUARE NEVER ANSWERED, ASKED ABOUT FIRST (R10b). A row of this member's that Square was asked about and never
  // answered is settled by Square's own word before anything else: a subscription it started is taken up — the member
  // is subscribed, and told so — and none means that try made nothing, so its row goes and this one carries on. A try
  // still minutes old is left to finish.
  // scoped-by: user_id = the caller's own id, from their verified session — only this member's rows.
  // arrives-with: 0421 — before it is pasted this read is refused (no column) and taken as no such row, the stamp below is
  // refused and ignored, and the self-heal's filter fails with it: the route runs exactly as it did before 0421.
  const { data: asked } = await supabaseAdmin.from("subscriptions").select("id, square_asked_at")
    .eq("user_id", user.id).eq("status", "pending").is("square_subscription_id", null).not("square_asked_at", "is", null);
  if (asked && asked.length) {
    const young = asked.some((r) => Date.now() - Date.parse(String((r as { square_asked_at: string }).square_asked_at)) < 120_000);
    if (young) return NextResponse.json({ error: "We're still confirming your last try with Square — give it a couple of minutes.", pending: true }, { status: 409 });
    const { data: prof0 } = await supabaseAdmin.from("profiles").select("square_customer_id").eq("id", user.id).maybeSingle();
    const custId = (prof0 as { square_customer_id?: string | null } | null)?.square_customer_id ?? null;
    const live = custId ? await liveAtSquare(token, custId, locationId) : null;
    if (live === undefined) return NextResponse.json({ error: "We couldn't check on your last try just now — give it a minute.", pending: true }, { status: 503 });
    const keep = (asked[0] as { id: string }).id;
    if (live) {
      // scoped-by: keep is one of this member's own rows, read just above by user_id.
      await supabaseAdmin.from("subscriptions").update({ square_subscription_id: live.id, status: mapSubStatus(live.status), square_asked_at: null, updated_at: new Date().toISOString() }).eq("id", keep);
      return NextResponse.json({ ok: true, status: mapSubStatus(live.status), warn: "Your last try went through at Square — you're subscribed." });
    }
    // scoped-by: user_id = the caller's own id; only rows Square was asked about and has nothing for.
    await supabaseAdmin.from("subscriptions").delete().eq("user_id", user.id).eq("status", "pending").is("square_subscription_id", null).not("square_asked_at", "is", null);
  }

  // Self-heal: clear the caller's own stale 'pending' rows that never reached Square
  // (a prior attempt that died before vaulting the card). Only rows older than 10 min
  // and with no Square id, so a genuinely concurrent in-flight attempt still trips the
  // double-subscribe guard below. Without this, one dead attempt locks the member out
  // of subscribing forever (the partial unique index keeps rejecting them). Never a row
  // Square was asked about (R10b — above).
  await supabaseAdmin
    .from("subscriptions").delete()
    .eq("user_id", user.id).eq("status", "pending").is("square_subscription_id", null).is("square_asked_at", null)
    .lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  // Atomic double-subscribe guard: claim a 'pending' row BEFORE calling Square. The
  // partial unique index subscriptions_one_active(user_id) rejects a concurrent or
  // existing active/paused/pending/past_due subscription, so only one request ever
  // reaches Square — no duplicate billable subscriptions.
  // Canonical customer link (0151), so a subscription counts toward the same person as their orders.
  const canonCustomerId = (await supabaseAdmin.rpc("resolve_customer", { p_user_id: user.id, p_phone: null, p_email: null, p_name: null })).data as string | null;
  const { data: pending, error: claimErr } = await supabaseAdmin
    .from("subscriptions").insert({ user_id: user.id, customer_id: canonCustomerId, plan: `coffee_${pack}`, status: "pending" }).select("id").single();
  if (claimErr || !pending) {
    return NextResponse.json({ error: "You already have a subscription." }, { status: 409 });
  }
  // scoped-by: rowId is not client-supplied. It is the id returned by the INSERT twelve lines
  // above, which wrote user_id: user.id from the verified session — so every update keyed on it
  // below touches a row this request just created for this caller. There is no path by which a
  // caller names someone else's subscription, so a tenant filter here would assert nothing.
  const rowId = pending.id as string;
  // Tracks whether a LIVE Square subscription exists for this attempt. Once it does, we must never
  // delete the mirror row — that would orphan a billing subscription the member can't cancel in-app.
  let squareSubId: string | null = null;

  try {
    const { data: prof } = await supabaseAdmin.from("profiles").select("display_name, square_customer_id").eq("id", user.id).maybeSingle();
    const { data: au } = await supabaseAdmin.auth.admin.getUserById(user.id);
    const email = au?.user?.email ?? undefined;

    // 1) ensure a Square Customer (persist so we never orphan one)
    let customerId = prof?.square_customer_id || "";
    if (!customerId) {
      const cRes = await fetch(`${SQUARE_BASE}/v2/customers`, {
        method: "POST", headers: squareHeaders(token), signal: squareDeadline(),
        body: JSON.stringify({ idempotency_key: `cust-${user.id}`, given_name: prof?.display_name || undefined, email_address: email }),
      });
      const cData = await cRes.json();
      if (!cRes.ok) throw new Error("Couldn't set up billing just now — nothing was charged. Try again in a minute.");   // Square's own words stay here (R10b)
      customerId = cData?.customer?.id;
      await supabaseAdmin.from("profiles").update({ square_customer_id: customerId }).eq("id", user.id);
    }

    // 2) vault the card (idempotency keyed to this attempt's row → retries dedupe, resubscribe doesn't)
    const cardRes = await fetch(`${SQUARE_BASE}/v2/cards`, {
      method: "POST", headers: squareHeaders(token), signal: squareDeadline(),
      body: JSON.stringify({ idempotency_key: `card-${rowId}`, source_id: body.sourceId, card: { customer_id: customerId } }),
    });
    const cardData = await cardRes.json();
    // Square's reason stays here (R9): a security code, a ZIP, funds — what a script running stolen cards reads for. The
    // member is told one sentence, as a declined charge is (lib/squareServer refusalWords).
    if (!cardRes.ok) throw new Error(refusalWords(cardRes.status, cardData));
    const cardId = cardData?.card?.id;

    // 3) create the subscription — the row says Square was asked, BEFORE it is (R10b), so a request that dies waiting is
    // never taken for one that made nothing.
    // scoped-by: rowId came from this request's own INSERT (user_id: user.id from the verified session), never from the caller
    await supabaseAdmin.from("subscriptions").update({ square_asked_at: new Date().toISOString() }).eq("id", rowId);
    let subRes: Response;
    try {
      subRes = await fetch(`${SQUARE_BASE}/v2/subscriptions`, {
        method: "POST", headers: squareHeaders(token), signal: squareDeadline(),
        body: JSON.stringify({ idempotency_key: `sub-${rowId}`, location_id: locationId, plan_variation_id: planId, customer_id: customerId, card_id: cardId }),
      });
    } catch (e) {
      throw new SubscriptionUnknown(`no answer from Square: ${errorMessage(e, 160)}`);
    }
    const subData = await subRes.json().catch(() => null);
    const verdict = chargeVerdict(subRes.status, subData);
    if (verdict === "unknown" || (verdict === "charged" && !subData?.subscription?.id)) throw new SubscriptionUnknown(`Square answered ${subRes.status}`);
    if (verdict === "declined") throw new Error(refusalWords(subRes.status, subData));
    const sub = subData?.subscription;
    squareSubId = sub?.id ?? null;

    // Persist the Square id to the mirror IMMEDIATELY — before anything else can throw — so the row
    // can never be orphaned: the member can always cancel, and the webhook can always match by id.
    // scoped-by: rowId came from this request's own INSERT (user_id: user.id from the verified session), never from the caller
    if (squareSubId) await supabaseAdmin.from("subscriptions").update({ square_subscription_id: squareSubId, square_asked_at: null }).eq("id", rowId);

    // 4) fill the rest of the mirror (webhook reconciles authoritatively)
    // scoped-by: rowId came from this request's own INSERT (user_id: user.id from the verified session), never from the caller
    await supabaseAdmin.from("subscriptions").update({
      status: mapSubStatus(sub?.status),
      square_card_id: cardId,
      current_period_end: sub?.charged_through_date || null,
      updated_at: new Date().toISOString(),
    // scoped-by: rowId came from this request's own INSERT (user_id: user.id from the verified session), never from the caller
    }).eq("id", rowId);

    // Leadership visibility — new recurring revenue shouldn't be invisible.
    await raiseAlert({ severity: "fyi", category: "money", title: "New subscriber 🎉", body: `A member started a ${pack}-pack coffee subscription. See Subscribers.` });
    return NextResponse.json({ ok: true, status: mapSubStatus(sub?.status) });
  } catch (e) {
    if (squareSubId) {
      // A Square subscription is LIVE. Deleting the mirror would orphan a billing subscription the
      // member could never cancel in-app. Keep the row, ensure it carries the id, mark it active,
      // and flag staff to reconcile — never silently drop a paying member.
      // scoped-by: rowId came from this request's own INSERT (user_id: user.id from the verified session), never from the caller
      await supabaseAdmin.from("subscriptions").update({ status: "active", square_subscription_id: squareSubId, updated_at: new Date().toISOString() }).eq("id", rowId);
      await raiseAlert({ severity: "critical", category: "money", title: "Subscription needs reconcile", body: `A subscription is live at Square (${squareSubId}) but setup errored after billing started. It's kept so the member can cancel — verify the mirror in Subscribers.` });
      return NextResponse.json({ ok: true, status: "active", warn: "You're subscribed — we're finalizing a couple details." });
    }
    if (e instanceof SubscriptionUnknown) {
      // Square may have started it. The row stays (square_asked_at says Square was asked); the crew is told; the member
      // is told not to try again — their next try asks Square first (above).
      await raiseAlertOnce({ severity: "critical", category: "money", kind: "subscription_unknown", subjectId: rowId,
        title: "A subscription may have started at Square — check it",
        body: `A member's ${pack}-pack subscription was sent to Square and no answer came back (${e.message}). Look in Square for this member's subscriptions: if one started, it is theirs — the app takes it up on their next visit to Subscribe; if none did, nothing was charged.`,
        link: "/crew?s=money&a=pay" });
      return NextResponse.json({ pending: true, error: "We couldn't confirm your subscription with Square. Don't start another — we'll check and you'll see it here, or we'll be in touch." }, { status: 202 });
    }
    // Nothing was created at Square — safe to roll back the pending claim so the member can retry.
    // scoped-by: rowId came from this request's own INSERT (user_id: user.id from the verified session), never from the caller
    await supabaseAdmin.from("subscriptions").delete().eq("id", rowId);
    // Square's own words stay here (R10b): a customer's or card's refusal is said in one sentence (refusalWords), and a
    // failure of ours — a dropped connection, a body that would not parse — is not the member's to read.
    const said = e instanceof Error && !/fetch failed|JSON|Unexpected token|network|abort|timeout/i.test(e.message) ? e.message : "Your subscription couldn't start just now — nothing was charged. Try again in a minute.";
    return NextResponse.json({ error: said }, { status: 400 });
  }
}

export const POST = route("subscriptions/create", post);
