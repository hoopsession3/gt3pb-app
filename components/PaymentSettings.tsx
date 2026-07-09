"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { squareClientReady } from "@/lib/square";

// PAYMENTS — the owner's checkout controls, in the Money section. Two facts, one switch:
//   • Card checkout is on when the Square keys are set in the host env (read-only status here).
//   • Pay-at-pickup is the owner's dial (live_status.pay_at_pickup, 0145) — offer a pay-later path
//     (pay at the truck / on delivery) with or without Square. Governs the cup checkout, the pack
//     reserve, and Sunday delivery, all from this one toggle. Default ON so a real order can be
//     placed and tasted end-to-end before Square is even connected.
export default function PaymentSettings() {
  const { toast } = useApp();
  const [payAtPickup, setPayAtPickup] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("live_status").select("pay_at_pickup").maybeSingle();
    setPayAtPickup((data as { pay_at_pickup?: boolean } | null)?.pay_at_pickup !== false);
  }, []);
  useEffect(() => { load(); }, [load]);

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

      {/* Pay-at-pickup — the owner's toggle. */}
      <div className="pay-row">
        <div className="pay-row-l">
          <div className="pay-row-t">Pay at pickup / on delivery</div>
          <div className="pay-row-s">
            Let customers place an order now and pay in person — at the truck window or when a delivery
            arrives. Works with or without Square. Turn it off to require a card.
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

      {!squareClientReady && payAtPickup && (
        <div className="pay-note">✓ You can place and taste a full order right now — it records as a pay-at-pickup pre-order.</div>
      )}
      {!squareClientReady && payAtPickup === false && (
        <div className="pay-note warn">Card checkout is off and pay-at-pickup is off — customers can&apos;t place an order. Turn one on.</div>
      )}
    </div>
  );
}
