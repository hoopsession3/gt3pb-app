"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import Skeleton from "./Skeleton";
import type { Reserve, ReserveClaim } from "@/lib/db";

// Live limited drops. Stock + claims are server-authoritative (claim_reserve RPC);
// this view just reflects them and reserves a unit on tap. Pay-at-pickup hold.
export default function Reserves() {
  const { toast } = useApp();
  const { user } = useAuth();
  const router = useRouter();
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [claims, setClaims] = useState<Record<string, ReserveClaim>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel("reserves-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "reserves" }, () => load());
    if (user) ch.on("postgres_changes", { event: "*", schema: "public", table: "reserve_claims", filter: `user_id=eq.${user.id}` }, () => load());
    ch.subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load, user]);

  const claim = async (r: Reserve) => {
    if (!user) { toast("Sign in to reserve yours"); router.push("/3mpire"); return; }
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
            {r.member_only && <span className="badge">★ Member access</span>}
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
                  <span>Reserved{mine.qty > 1 ? ` ·  ${mine.qty}` : ""} ✓ — pay at pickup</span>
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
    </>
  );
}
