"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useCustomerKnown } from "./useCustomerKnown";
import { e164, phoneShown, textsOn } from "@/lib/texts";
import { haptic } from "@/lib/haptics";

// TEXTS, ON THE ACCOUNT (2026-10-14, R5 — 0398). One row in "Your account": texts about my packs and deliveries, on or
// off, for the number on the member's orders. A yes or a stop from here is recorded with "account" as its place
// (app/api/account/texts); a STOP by text turns the same switch off. Shown only once texts are switched on.

type Row = { phone: string; yes_at: string | null; stop_at: string | null };
const stands = (r: Row) => !!r.yes_at && (!r.stop_at || Date.parse(r.yes_at) > Date.parse(r.stop_at));

export default function TextsSetting() {
  const { user } = useAuth();
  const { toast } = useApp();
  const known = useCustomerKnown(!!user);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const on = textsOn();

  // Read again after each change (tick): the member's own rows, as 0398's policy lets them.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on || !supabase || !user) return;
    let live = true;
    // arrives-with: 0398 — until it is pasted the table is not there: the read errs and the switch shows Off for the number on
    // their orders; turning it on answers "Couldn't change it" (app/api/account/texts). Shown only once texts are switched on.
    supabase.from("text_consents").select("phone, yes_at, stop_at").eq("user_id", user.id)
      .then(({ data }) => { if (live) setRows((data ?? []) as Row[]); });
    return () => { live = false; };
  }, [on, user, tick]);

  if (!on || !user) return null;
  // The number: the one a yes was given for, else the one on the member's orders.
  const num = rows?.find(stands)?.phone ?? rows?.[0]?.phone ?? e164(known?.phone);
  if (!num) return null;
  const yes = !!rows?.some((r) => r.phone === num && stands(r));

  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await authedFetch("/api/account/texts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: num, on: !yes }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d?.error || "Couldn't change it — try again.", "error"); return; }
      if (yes) haptic("toggleOff"); else haptic("toggleOn");
      toast(!yes ? `Texts on for ${phoneShown(num)}` : "Texts off");
      setTick((n) => n + 1);
    } finally { setBusy(false); }
  };

  return (
    <div className="row" aria-label="Texts about my packs and deliveries">
      <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></div>
      <div className="rl"><b>Texts about my packs</b><span>{yes ? "On" : "Off"} · {phoneShown(num)}</span></div>
      <button type="button" role="switch" aria-checked={yes} aria-label="Texts about my packs and deliveries" className={`k-switch${yes ? " on" : ""}`} onClick={flip} disabled={busy}>
        <span className="k-switch-k" />
      </button>
    </div>
  );
}
