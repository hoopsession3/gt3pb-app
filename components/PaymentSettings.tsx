"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { squareClientReady } from "@/lib/square";
import { authedFetch } from "@/lib/authedFetch";

// PAYMENTS — the owner's checkout controls, in the Money section. Two facts, one switch:
//   • Card checkout is on when the Square keys are set in the host env (read-only status here).
//   • Pay-at-pickup is the owner's dial (live_status.pay_at_pickup, 0145) — offer a pay-in-person
//     path for PICKUP orders (a cup at the truck, or a pack picked up at a stop), with or without
//     Square. Default ON so a real order can be placed and tasted end-to-end before Square is even
//     connected. NOTE: this does NOT touch Sunday delivery — delivery is always prepaid on the card.
export default function PaymentSettings() {
  const { toast } = useApp();
  const [payAtPickup, setPayAtPickup] = useState<boolean | null>(null);
  const [health, setHealth] = useState<{ name: string; ok: boolean; note: string }[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [subsOn, setSubsOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    // select("*") is resilient to the subscriptions_enabled column not being applied yet — a missing
    // column just reads as undefined (off) instead of erroring out the whole settings load.
    const { data } = await supabase.from("live_status").select("*").maybeSingle();
    setPayAtPickup((data as { pay_at_pickup?: boolean } | null)?.pay_at_pickup !== false);
    // Default OFF — subscriptions are dark until the owner switches them on (0150).
    setSubsOn((data as { subscriptions_enabled?: boolean } | null)?.subscriptions_enabled === true);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Asks Square directly (server token, owner-gated route) and names the exact mismatch —
  // the Web SDK's init failure is one generic sentence with zero visibility.
  const runCheck = async () => {
    setChecking(true); setHealth(null);
    try {
      const res = await authedFetch("/api/square/health");
      const j = await res.json();
      setHealth(j.checks ?? [{ name: "Check", ok: false, note: j.error || "Couldn't run the check." }]);
    } catch { setHealth([{ name: "Check", ok: false, note: "Couldn't reach the server — try again." }]); }
    setChecking(false);
  };

  const toggle = async () => {
    if (!supabase || busy || payAtPickup === null) return;
    const next = !payAtPickup;
    setBusy(true);
    setPayAtPickup(next); // optimistic
    const { error } = await supabase.from("live_status").update({ pay_at_pickup: next }).eq("id", 1);
    setBusy(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); load(); return; }
    toast(next ? "Pay-at-pickup is ON — customers can order and pay in person" : "Pay-at-pickup is OFF — card only");
  };

  const toggleSubs = async () => {
    if (!supabase || busy || subsOn === null) return;
    const next = !subsOn;
    setBusy(true);
    setSubsOn(next); // optimistic
    const { error } = await supabase.from("live_status").update({ subscriptions_enabled: next }).eq("id", 1);
    setBusy(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); load(); return; }
    toast(next ? "Subscriptions are ON — customers can start a recurring pack" : "Subscriptions are OFF — hidden from customers");
  };

  return (
    <div className="paysettings">
      {/* Card status — driven by the Square env keys, not a toggle (that's a deploy setting). */}
      <div className="pay-row">
        <div className="pay-row-l">
          <div className="pay-row-t">Card checkout {squareClientReady ? "· on" : "· off"}</div>
          <div className="pay-row-s">
            {squareClientReady
              ? "Square is connected — customers can pay by card."
              : "Not connected yet. Add the Square keys in the host env to turn on card payments."}
          </div>
        </div>
        <span className={`pay-status${squareClientReady ? " on" : ""}`}>{squareClientReady ? "Connected" : "Off"}</span>
      </div>
      <button type="button" className="adm-regen" onClick={runCheck} disabled={checking}>{checking ? "Checking with Square…" : "🩺 Check card connection"}</button>
      {health && (
        <div className="pay-health">
          {health.map((c) => (
            <div key={c.name} className={`pay-health-row${c.ok ? "" : " bad"}`}>
              <span className="pay-health-ok">{c.ok ? "✓" : "✕"}</span>
              <b>{c.name}</b>
              <span className="pay-health-note">{c.note}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pay-at-pickup — the owner's toggle. */}
      <div className="pay-row">
        <div className="pay-row-l">
          <div className="pay-row-t">Pay at pickup <span className="pay-row-tag">pickup only</span></div>
          <div className="pay-row-s">
            Let customers place a <b>pickup</b> order now and pay in person — a cup at the truck, or a
            pack picked up at a stop. Works with or without Square. Turn it off to require a card.
            {/* {" "} after the </b>: Turbopack drops a plain same-line space when the text node
                after an inline element wraps to the next source line — an explicit expression
                survives the transform. (Rendered as "prepaidon"/"packsto" before this.) */}
            <br />Sunday <b>delivery is always prepaid</b>{" "}on the card — this switch doesn&apos;t affect it.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={payAtPickup === true}
          aria-label="Pay at pickup"
          className={`pay-toggle${payAtPickup ? " on" : ""}`}
          disabled={busy || payAtPickup === null}
          onClick={toggle}
        >
          <span className="pay-toggle-knob" />
        </button>
      </div>

      {/* Subscriptions — the owner's go-live switch (0150). Default OFF: the launch push is packs,
          reserves, and bulk packs for pickup + delivery. Flip on when Square plans are ready. */}
      <div className="pay-row">
        <div className="pay-row-l">
          <div className="pay-row-t">Subscriptions <span className="pay-row-tag">{subsOn ? "live" : "hidden"}</span></div>
          <div className="pay-row-s">
            {/* {" "} for the same Turbopack space-trim edge as the pay-at-pickup row above. */}
            Offer <b>recurring coffee packs</b>{" "}to customers. Off by default — the launch push is
            packs, reserves, and bulk packs for pickup + delivery. Leave off until you&apos;re ready
            to go live with recurring billing.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={subsOn === true}
          aria-label="Subscriptions"
          className={`pay-toggle${subsOn ? " on" : ""}`}
          disabled={busy || subsOn === null}
          onClick={toggleSubs}
        >
          <span className="pay-toggle-knob" />
        </button>
      </div>

      {!squareClientReady && payAtPickup && (
        <div className="pay-note">✓ You can place and taste a full order right now — it records as a pay-at-pickup pre-order.</div>
      )}
      {!squareClientReady && payAtPickup === false && (
        <div className="pay-note warn">Card checkout is off and pay-at-pickup is off — customers can&apos;t place an order. Turn one on.</div>
      )}
    </div>
  );
}
