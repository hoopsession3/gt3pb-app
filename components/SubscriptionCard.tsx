"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { authedFetch } from "@/lib/authedFetch";
import { SUBSCRIPTIONS_ON, SUB_NAME, SUB_CADENCE, SUB_PACKS, squareClientReady } from "@/lib/square";
import type { Subscription } from "@/lib/db";
import PaymentCard, { type PaymentCardHandle } from "./PaymentCard";

// Member subscription: Square owns billing; we read the status mirror and drive
// create/manage through the server routes. The owner enables it via env once the
// Square plan + webhook are live.
export default function SubscriptionCard() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pack, setPack] = useState<"6" | "12" | "18">("12");
  const paymentRef = useRef<PaymentCardHandle>(null);

  const load = useCallback(async () => {
    if (!supabase || !user) { setLoaded(true); return; }
    const { data } = await supabase.from("subscriptions").select("*").eq("user_id", user.id)
      .in("status", ["active", "paused", "pending", "past_due"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    setSub((data as Subscription) ?? null);
    setLoaded(true);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  useRealtimeTable({ table: "subscriptions", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });

  const start = async () => {
    setErr("");
    if (!ready) return;
    setBusy(true);
    try {
      const result = await paymentRef.current!.tokenize();
      if (result.status !== "OK") { setErr("Card details look off — check and retry."); setBusy(false); return; }
      const res = await authedFetch("/api/subscriptions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: result.token, pack }),
      });
      const data = await res.json();
      setBusy(false);
      if (!res.ok) { setErr(data.error || "Couldn't start subscription"); return; }
      toast("Subscription started — welcome aboard");
      setOpen(false);
      load();
    } catch { setBusy(false); setErr("Subscription failed — nothing was charged. Try again."); }
  };

  const manage = async (action: "pause" | "resume" | "cancel") => {
    if (action === "cancel" && typeof window !== "undefined" && !window.confirm("Cancel your subscription?")) return;
    setBusy(true);
    const res = await authedFetch("/api/subscriptions/manage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { toast(data.error || "Couldn't update subscription", "error"); return; }
    toast(action === "cancel" ? "Subscription canceled" : action === "pause" ? "Subscription paused" : "Subscription resumed");
    load();
  };

  if (!user || !loaded) return null;

  // Existing subscription → status + manage
  if (sub) {
    const renew = sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
    const label = sub.status === "active" ? (renew ? `Active · renews ${renew}` : "Active")
      : sub.status === "paused" ? "Paused"
      : sub.status === "past_due" ? "Payment failed — update your card"
      : "Starting…";
    const packSize = (sub.plan || "").replace("coffee_", "");
    return (
      <div className="subcard">
        <div className="eyb">Subscription</div>
        <h3>{SUB_NAME}</h3>
        {/^\d+$/.test(packSize) && <p className="sub-sub">{packSize}-pack · {SUB_CADENCE}</p>}
        <div className={`sub-status ${sub.status}`}><span className="sub-dot" />{label}</div>
        {sub.status === "active" && <p className="sub-rest">We&apos;ll have your next pack ready — no need to reorder.</p>}
        <div className="sub-actions">
          {sub.status === "active" && <button onClick={() => manage("pause")} disabled={busy}>Pause</button>}
          {sub.status === "paused" && <button onClick={() => manage("resume")} disabled={busy}>Resume</button>}
          {sub.status !== "canceled" && <button className="ghost" onClick={() => manage("cancel")} disabled={busy}>Cancel</button>}
        </div>
      </div>
    );
  }

  // No subscription + not configured → honest teaser (no button)
  if (!SUBSCRIPTIONS_ON || !squareClientReady) {
    return (
      <div className="subcard">
        <div className="eyb">Subscription</div>
        <h3>{SUB_NAME}</h3>
        <p className="sub-sub">A 6, 12, or 18-pack of coffee delivered {SUB_CADENCE}. Opening to members soon.</p>
      </div>
    );
  }

  // Subscribe — choose a pack
  const selected = SUB_PACKS.find((p) => p.key === pack) ?? SUB_PACKS[1];
  return (
    <div className="subcard">
      <div className="eyb">Subscription</div>
      <h3>{SUB_NAME}</h3>
      <p className="sub-sub">Pick a coffee pack, {SUB_CADENCE}. Pause or cancel anytime.</p>
      <div className="sub-packs">
        {SUB_PACKS.map((p) => (
          <button key={p.key} type="button" className={`sub-pack${pack === p.key ? " on" : ""}`} onClick={() => setPack(p.key)} aria-pressed={pack === p.key}>
            <span className="sub-pack-size">{p.size}</span>
            <span className="sub-pack-cap">bottles</span>
            <span className="sub-pack-price">{p.price}</span>
            <span className="sub-pack-each">{p.each}</span>
          </button>
        ))}
      </div>
      {!open ? (
        <button type="button" className="sub-cta" onClick={() => setOpen(true)}>Subscribe — {selected.size} bottles</button>
      ) : (
        <>
          <PaymentCard ref={paymentRef} className="sub-cardfield" onReady={setReady} onError={(m) => setErr(m ?? "")} />
          {err && <div className="auth-err">{err}</div>}
          <button type="button" className="sub-cta" onClick={start} disabled={!ready || busy}>
            {busy ? "Starting…" : ready ? `Start ${selected.size}-pack · ${selected.price}` : "Loading card…"}
          </button>
          <button type="button" className="sub-link" onClick={() => setOpen(false)} disabled={busy}>Not now</button>
        </>
      )}
    </div>
  );
}
