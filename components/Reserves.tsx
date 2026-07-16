"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import Skeleton from "./Skeleton";
import Sheet from "./Sheet";
import SignIn from "./SignIn";
import type { Reserve, ReserveClaim } from "@/lib/db";
import Icon from "@/components/Icon";

// Live limited drops. Stock + claims are server-authoritative (claim_reserve RPC);
// this view just reflects them and reserves a unit on tap. Pay-at-pickup hold.
export default function Reserves() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [claims, setClaims] = useState<Record<string, ReserveClaim>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Signed-out tap opens sign-in right here instead of redirecting to /3mpire and losing the intent;
  // once signed in, the reserve that was tapped claims automatically.
  const [signInOpen, setSignInOpen] = useState(false);
  const pendingClaim = useRef<Reserve | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const { data } = await supabase.from("reserves").select("*").in("status", ["live", "sold_out"]).order("sort");
    setReserves((data as Reserve[]) ?? []);
    if (user) {
      const { data: c } = await supabase.from("reserve_claims").select("*").eq("user_id", user.id).in("state", ["held", "paid"]);
      const map: Record<string, ReserveClaim> = {};
      (c as ReserveClaim[] | null)?.forEach((cl) => { map[cl.reserve_id] = cl; });
      setClaims(map);
    }
    setLoaded(true);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Realtime: live stock + sold-out flips, plus the member's own claim changes
  // (hold expiry / admin release) so the "Reserved" badge never goes stale.
  useRealtimeTable(user ? ["reserves", { table: "reserve_claims", filter: `user_id=eq.${user.id}` }] : "reserves", load);

  const claim = async (r: Reserve) => {
    if (!user) { pendingClaim.current = r; setSignInOpen(true); return; }
    if (!supabase || busy) return;
    setBusy(r.id);
    const { error } = await supabase.rpc("claim_reserve", { p_reserve: r.id, p_qty: 1 });
    setBusy(null);
    if (error) {
      const m = /sold out/i.test(error.message) ? "Just sold out — sorry."
        : /limit/i.test(error.message) ? "You've hit the limit on this drop."
        : "Couldn't reserve — try again.";
      toast(m, "error");
      load();
      return;
    }
    toast("Reserved ✓ — pay at the truck on pickup");
    load();
  };

  // Sign-in completed while the sheet was open for a tapped reserve — claim it automatically instead
  // of the old redirect-to-/3mpire-and-lose-the-intent pattern.
  useEffect(() => {
    if (user && pendingClaim.current) { const r = pendingClaim.current; pendingClaim.current = null; setSignInOpen(false); claim(r); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const cancel = async (r: Reserve) => {
    const cl = claims[r.id];
    if (!cl || !supabase || busy) return;
    setBusy(r.id);
    await supabase.rpc("cancel_reserve_claim", { p_claim: cl.id });
    setBusy(null);
    toast("Reserve released");
    load();
  };

  if (!loaded) return <Skeleton variant="card" />;
  if (reserves.length === 0) return null;

  return (
    <>
      {reserves.map((r) => {
        const mine = claims[r.id];
        const sold = r.status === "sold_out" || r.stock_remaining <= 0;
        const price = `$${(r.price_cents / 100).toFixed(0)}`;
        return (
          <div className="drop" key={r.id}>
            {r.member_only && <span className="badge"><Icon name="star" /> Member access</span>}
            <div className="din">
              <div className="eyb">Limited Reserve</div>
              <h2>{r.name}</h2>
              {r.blurb && <div className="desc">{r.blurb}</div>}
              <div className="meta">
                <span className="cd">{price}</span>
                <span className="left">{sold ? "Sold out" : `${r.stock_remaining} of ${r.stock_total} left`}</span>
              </div>
              {mine ? (
                <div className="rsv-done">
                  <span>Reserved{mine.qty > 1 ? ` ·  ${mine.qty}` : ""} <Icon name="check" /> — pay at pickup</span>
                  <button type="button" className="rsv-cancel" onClick={() => cancel(r)} disabled={busy === r.id}>Release</button>
                </div>
              ) : (
                <button type="button" className="claim" onClick={() => claim(r)} disabled={sold || busy === r.id}>
                  {sold ? "Sold out" : busy === r.id ? "Reserving…" : "Reserve yours"}
                </button>
              )}
            </div>
          </div>
        );
      })}
      <Sheet open={signInOpen} onClose={() => { pendingClaim.current = null; setSignInOpen(false); }} labelledBy="reserve-signin-title">
        <div className="oa-kicker" id="reserve-signin-title">SIGN IN TO RESERVE</div>
        {pendingClaim.current && <h2 className="dl-h">{pendingClaim.current.name}</h2>}
        <SignIn />
      </Sheet>
    </>
  );
}
