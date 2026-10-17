"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import { authedFetch } from "@/lib/authedFetch";
import { reserveClosesAt, reserveOpen, reservePickupWords, type ReserveStop } from "@/lib/reservePickup";
import { closesWords } from "@/lib/pickupDay";
import Sheet from "./Sheet";
import { useConfirm } from "./ConfirmSheet";
import type { Reserve, ReserveClaim } from "@/lib/db";
import Icon from "@/components/Icon";
import { money, moneyRound } from "@/lib/money";

// The sign-in sheet a guest's tap on a reserve opens — loaded with that tap, not in /reserve's and /shop's first download (R8).
const SignIn = dynamic(() => import("./SignIn"));

// The pay step loads with the first tap of "Reserve yours" — most visitors to /reserve and /shop never make it.
const ReservePay = dynamic(() => import("./ReservePay"), { ssr: false });

// LIMITED RESERVES — PAID TO HOLD (0400, 2026-10-14, R5 of the customer audit; decided 2026-10-13: charged like packs,
// no timer, a full refund on a cancel before the cutoff). A reserve names its pickup; "Reserve yours" pays for it, and
// it is the member's until the crew hand it over — no clock running out on it. Each claim says where it stands: paid
// (cancel for a refund until the pickup closes, then ask the crew), being confirmed, picked up, or an old hold paid at
// the truck.
// Stock and claims are the server's (app/api/reserves/pay, hold_reserve); this reflects them, live.
//
// THE CARD THAT WAS NEVER THERE (2026-10-02). This used to paint a 150px card skeleton until the query answered, and the
// query's usual answer is "no live drops" — so on /reserve and /shop every guest watched the order funnel jump up 164px
// about a second in. A skeleton stands in for content that is coming; it is the wrong tool for a section that is usually
// absent. Nothing paints until the answer is known.

type Shown = Reserve & { stop?: ReserveStop; open: boolean; closes: string | null };
type Board = { reserves: Shown[]; claims: ReserveClaim[] };

export default function Reserves() {
  const { toast } = useApp();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  // The reserve a signed-out tap was for: sign-in opens right here, and once signed in its pay step opens by itself.
  const [signInFor, setSignInFor] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);

  const board = useAsyncData<Board>(async () => {
    if (!supabase) return { reserves: [], claims: [] };
    // Each with its pickup (0400: reserves.stop_id).
    const res = await supabase.from("reserves").select("*, stop:stops(name, starts_at, ends_at, canceled_at)").in("status", ["live", "sold_out"]).order("sort");
    // A failed read is not "no live drops today" (the false-empty bug class): it is an error, said as one.
    if (res.error) throw new Error(res.error.message);
    const nowMs = Date.now();
    const reserves = ((res.data ?? []) as (Reserve & { stop?: ReserveStop })[]).map((r) => ({
      ...r, open: reserveOpen(r.stop ?? null, nowMs), closes: reserveClosesAt(r.stop ?? null)?.toISOString() ?? null,
    }));
    let claims: ReserveClaim[] = [];
    if (user) {
      // Handed over counts too: it is theirs, it says so, and it is part of their limit (hold_reserve counts it).
      const c = await supabase.from("reserve_claims").select("*").eq("user_id", user.id).in("state", ["held", "pending", "paid", "collected"]).order("created_at");
      if (c.error) throw new Error(c.error.message);
      claims = (c.data as ReserveClaim[]) ?? [];
    }
    return { reserves, claims };
  }, [user?.id]);
  const load = board.reload;

  // Live: stock and sold-out flips, and the member's own claims — paid, confirmed, canceled by the crew.
  useRealtimeTable(user ? ["reserves", { table: "reserve_claims", filter: `user_id=eq.${user.id}` }] : "reserves", load);

  const buy = (r: Shown) => {
    if (!user) { setSignInFor(r.id); return; }
    setPaying(r.id);
  };
  const payFor = paying ?? (user ? signInFor : null);
  const closePay = () => { setPaying(null); setSignInFor(null); };

  const cancel = async (r: Shown, cl: ReserveClaim) => {
    if (busy) return;
    const paid = cl.paid_cents ?? 0;
    const ok = await confirm({
      title: `Cancel your ${r.name}?`,
      body: paid > 0 ? `${money(paid)} goes back to the card you paid with.` : "Nothing was charged.",
      confirmLabel: paid > 0 ? "Cancel and refund" : "Cancel it", cancelLabel: "Keep it", danger: true,
    });
    if (!ok) return;
    setBusy(cl.id);
    const d = await authedFetch("/api/reserves/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cl.id }) })
      .then((x) => x.json()).catch(() => null) as { ok?: boolean; error?: string; warn?: string; refundedCents?: number } | null;
    setBusy(null);
    if (d?.ok !== true) { toast(d?.error || "Couldn't cancel it just now — try again, or ask at the truck.", "error"); load(); return; }
    toast(d.warn || (d.refundedCents ? `Canceled — ${money(d.refundedCents)} is on its way back to your card` : "Canceled"));
    load();
  };

  // An old hold — paid at the truck (0014) — goes back on the shelf with its own call, as before.
  const release = async (cl: ReserveClaim) => {
    if (!supabase || busy) return;
    setBusy(cl.id);
    const { error } = await supabase.rpc("cancel_reserve_claim", { p_claim: cl.id });
    setBusy(null);
    toast(error ? "Couldn't release it — try again." : "Reserve released", error ? "error" : undefined);
    load();
  };

  if (board.status === "loading") return null;
  if (board.status === "error") return <p className="rsv-err" role="alert">Couldn&rsquo;t load reserves right now — check back shortly.</p>;
  const reserves = board.data?.reserves ?? [];
  if (reserves.length === 0) return null;
  const claims = board.data?.claims ?? [];
  const paying1 = reserves.find((r) => r.id === payFor) ?? null;
  const signingFor = !user ? reserves.find((r) => r.id === signInFor) ?? null : null;

  return (
    <>
      {reserves.map((r) => {
        const mine = claims.filter((c) => c.reserve_id === r.id);
        const have = mine.reduce((a, c) => a + c.qty, 0);
        const sold = r.status === "sold_out" || r.stock_remaining <= 0;
        // Payable once 0400 is here and the crew have named its pickup; not when that pickup was called off or has closed.
        const ready = "stop_id" in r && !!r.stop_id && !!r.stop;
        const called = !!r.stop?.canceled_at;
        const pickup = reservePickupWords(r.stop ?? null);
        const price = moneyRound(r.price_cents);
        // Another, while under their limit — not while one is still being confirmed.
        const more = have < r.per_member_limit && !mine.some((c) => c.state === "pending");
        const why = !ready ? "Opening soon" : called ? "Pickup called off" : !r.open ? "Reserves closed" : sold ? "Sold out" : null;
        // Until when a cancel is refunded — said before it is bought, and again beside one that is paid for.
        const refundUntil = ready && r.open && r.closes ? closesWords(new Date(r.closes)) : null;
        return (
          <div className="drop" key={r.id}>
            {r.member_only && <span className="badge"><Icon name="star" /> Member access</span>}
            <div className="din">
              <div className="eyb">Limited Reserve</div>
              <h2>{r.name}</h2>
              {r.blurb && <div className="desc">{r.blurb}</div>}
              {ready && pickup && (
                <p className="mt-2 text-footnote text-cream-muted">
                  {called ? <>Its pickup on {pickup} was called off — check back for the new one.</> : <>Pickup {pickup}</>}
                </p>
              )}
              <div className="meta">
                <span className="cd">{price}</span>
                <span className="left">{sold ? "Sold out" : `${r.stock_remaining} of ${r.stock_total} left`}</span>
              </div>
              {mine.map((cl) => (
                <div className="rsv-done" key={cl.id}>
                  {cl.state === "paid" ? (
                    <>
                      <span>Yours <Icon name="check" />{cl.qty > 1 ? ` · ${cl.qty}` : ""}{cl.paid_cents ? ` · ${money(cl.paid_cents)} paid` : ""}</span>
                      {r.open || called || !ready
                        ? <button type="button" className="rsv-cancel" onClick={() => cancel(r, cl)} disabled={busy === cl.id}>{busy === cl.id ? "Canceling…" : "Cancel"}</button>
                        : <span className="text-caption text-cream-muted">Ask the crew to change it</span>}
                    </>
                  ) : cl.state === "pending" ? (
                    <span>Confirming your payment…</span>
                  ) : cl.state === "collected" ? (
                    <span>Picked up <Icon name="check" />{cl.qty > 1 ? ` · ${cl.qty}` : ""}</span>
                  ) : (
                    <>
                      <span>Reserved{cl.qty > 1 ? ` · ${cl.qty}` : ""} <Icon name="check" /> — pay at pickup</span>
                      <button type="button" className="rsv-cancel" onClick={() => release(cl)} disabled={busy === cl.id}>Release</button>
                    </>
                  )}
                </div>
              ))}
              {why ? (
                mine.length === 0 && <button type="button" className="btn-pri btn-wide mt-1" disabled>{why}</button>
              ) : mine.length === 0 ? (
                <button type="button" className="btn-pri btn-wide mt-1" onClick={() => buy(r)}>Reserve yours · {price}</button>
              ) : more ? (
                <button type="button" className="btn-sec btn-wide mt-2" onClick={() => buy(r)}>Reserve another</button>
              ) : null}
              {refundUntil && (mine.length === 0 ? !why : mine.some((c) => c.state === "paid")) && (
                <p className="mt-2 text-caption text-cream-muted">{mine.length === 0 ? <>Yours once it&rsquo;s paid — cancel</> : "Cancel"} for a full refund until {refundUntil}.</p>
              )}
            </div>
          </div>
        );
      })}
      <Sheet open={!!signingFor} onClose={() => setSignInFor(null)} labelledBy="reserve-signin-title">
        <div className="oa-kicker" id="reserve-signin-title">SIGN IN TO RESERVE</div>
        {signingFor && <h2 className="dl-h">{signingFor.name}</h2>}
        <SignIn compact />
      </Sheet>
      {paying1 && user && (
        <ReservePay
          reserve={{ id: paying1.id, name: paying1.name, price_cents: paying1.price_cents, per_member_limit: paying1.per_member_limit, stock_remaining: paying1.stock_remaining }}
          pickup={reservePickupWords(paying1.stop ?? null)}
          closes={paying1.closes}
          have={claims.filter((c) => c.reserve_id === paying1.id).reduce((a, c) => a + c.qty, 0)}
          onClose={closePay}
          onDone={(d) => {
            closePay();
            toast(d.warn || `${paying1.name} is yours${d.totalCents ? ` — ${money(d.totalCents)} paid` : ""}`);
            load();
          }}
        />
      )}
    </>
  );
}
