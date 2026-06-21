"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { SUBSCRIPTIONS_ON, SUB_NAME, SUB_PRICE_LABEL, SQUARE_APP_ID, SQUARE_LOCATION_ID, squareClientReady, squareWebSdkUrl } from "@/lib/square";
import type { Subscription } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { Square?: any } }

function loadSquare(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.Square) return resolve(window.Square);
    const existing = document.querySelector<HTMLScriptElement>("script[data-square]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Square));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = squareWebSdkUrl;
    s.async = true;
    s.dataset.square = "1";
    s.onload = () => resolve(window.Square);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

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
  const cardRef = useRef<any>(null);

  const load = useCallback(async () => {
    if (!supabase || !user) { setLoaded(true); return; }
    const { data } = await supabase.from("subscriptions").select("*").eq("user_id", user.id)
      .in("status", ["active", "paused", "pending", "past_due"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    setSub((data as Subscription) ?? null);
    setLoaded(true);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!supabase || !user) return;
    const ch = supabase.channel("subs-self")
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load, user]);

  // mount the Square card field when the subscribe form opens
  useEffect(() => {
    if (!open || !squareClientReady) return;
    let card: any; let cancelled = false;
    (async () => {
      try {
        const Square = await loadSquare();
        if (cancelled) return;
        const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        card = await payments.card();
        await card.attach("#sq-sub-card");
        cardRef.current = card;
        if (!cancelled) setReady(true);
      } catch { if (!cancelled) setErr("Couldn't load the card form. Try again."); }
    })();
    return () => { cancelled = true; setReady(false); cardRef.current?.destroy?.(); cardRef.current = null; };
  }, [open]);

  const authToken = async () => (await supabase!.auth.getSession()).data.session?.access_token || "";

  const start = async () => {
    setErr("");
    if (!cardRef.current) return;
    setBusy(true);
    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK") { setErr("Card details look off — check and retry."); setBusy(false); return; }
      const res = await fetch("/api/subscriptions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await authToken()}` },
        body: JSON.stringify({ sourceId: result.token }),
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
    const res = await fetch("/api/subscriptions/manage", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await authToken()}` },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { toast(data.error || "Couldn't update subscription"); return; }
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
    return (
      <div className="subcard">
        <div className="eyb">Subscription</div>
        <h3>{SUB_NAME}</h3>
        <div className={`sub-status ${sub.status}`}><span className="sub-dot" />{label}</div>
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
        <p className="sub-sub">Your staples on a cadence — {SUB_PRICE_LABEL.toLowerCase()}. Opening to members soon.</p>
      </div>
    );
  }

  // Subscribe
  return (
    <div className="subcard">
      <div className="eyb">Subscription</div>
      <h3>{SUB_NAME}</h3>
      <p className="sub-sub">Your staples on a cadence — {SUB_PRICE_LABEL}. Pause or cancel anytime.</p>
      {!open ? (
        <button type="button" className="sub-cta" onClick={() => setOpen(true)}>Subscribe</button>
      ) : (
        <>
          <div id="sq-sub-card" className="sub-cardfield" />
          {err && <div className="auth-err">{err}</div>}
          <button type="button" className="sub-cta" onClick={start} disabled={!ready || busy}>
            {busy ? "Starting…" : ready ? `Start — ${SUB_PRICE_LABEL}` : "Loading card…"}
          </button>
          <button type="button" className="sub-link" onClick={() => setOpen(false)} disabled={busy}>Not now</button>
        </>
      )}
    </div>
  );
}
