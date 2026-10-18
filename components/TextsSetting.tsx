"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "./AuthProvider";
import { useAppStable } from "./AppProvider";
import { useCustomerKnown } from "./useCustomerKnown";
import { e164, phoneShown, textsOn } from "@/lib/texts";
import { haptic } from "@/lib/haptics";
import { useSiteCopy } from "@/lib/copy";
import { TextYesFine } from "./TextYes";
import type { LegalDoc } from "./legal/LegalText";

// TEXTS, ON THE ACCOUNT (2026-10-14, R5 — 0398). One row in "Your account": texts about my packs and deliveries, on or
// off, for the number on the member's orders. A yes or a stop from here is recorded with "account" as its place
// (app/api/account/texts); a STOP by text turns the same switch off. Shown only once texts are switched on.
// IN NOTIFICATIONS, WITH ITS TERMS (2026-10-14, R6): the switch moved into the account's Notifications screen
// (components/NotificationsSheet), and turning it on is a yes like the box at checkout — so the same words sit under it:
// what is sent, how often, that rates may apply, STOP and HELP, that it is no condition of buying, the Terms and Privacy.

// The legal pages' words load when a link is tapped (components/TextYes says why).
const LegalSheet = dynamic(() => import("./LegalSheet"), { ssr: false });

type Row = { phone: string; yes_at: string | null; stop_at: string | null };
const stands = (r: Row) => !!r.yes_at && (!r.stop_at || Date.parse(r.yes_at) > Date.parse(r.stop_at));

export default function TextsSetting() {
  const { user } = useAuth();
  const { toast } = useAppStable();
  const known = useCustomerKnown(!!user);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const t = useSiteCopy();
  const on = textsOn();

  // Read again after each change (tick): the member's own rows, as 0398's policy lets them.
  const [tick, setTick] = useState(0);
  // A READ THAT FAILED IS NOT "OFF" (R8, 2026-10-16). It drew as no rows — "Off" — for a member whose texts were on, and
  // the switch, tapped to turn them off, turned them on. Until the read answers the switch waits; a failed read says so.
  const [readFailed, setReadFailed] = useState(false);
  useEffect(() => {
    if (!on || !supabase || !user) return;
    let live = true;
    supabase.from("text_consents").select("phone, yes_at, stop_at").eq("user_id", user.id)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { setReadFailed(true); return; }
        setReadFailed(false);
        setRows((data ?? []) as Row[]);
      });
    return () => { live = false; };
  }, [on, user, tick]);

  if (!on || !user) return null;
  // The number: the one a yes was given for, else the one on the member's orders.
  const num = rows?.find(stands)?.phone ?? rows?.[0]?.phone ?? e164(known?.phone);
  if (!num) return null;
  const yes = !!rows?.some((r) => r.phone === num && stands(r));

  const readOk = rows !== null && !readFailed;
  const flip = async () => {
    if (busy || !readOk) return;
    setBusy(true);
    try {
      const r = await authedFetch("/api/account/texts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: num, on: !yes }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d?.error || "Couldn't change it — try again.", "error"); return; }
      // A STOP texted from the phone holds until the phone says START (R9, 0418): said, and the switch stays off.
      if (d?.stoppedByText) { toast(d.error || "This number texted STOP — text START from it to turn texts back on.", "info"); setTick((n) => n + 1); return; }
      if (yes) haptic("toggleOff"); else haptic("toggleOn");
      toast(!yes ? `Texts on for ${phoneShown(num)}` : "Texts off");
      setTick((n) => n + 1);
    } finally { setBusy(false); }
  };

  return (
    <>
    <div className="row" aria-label="Texts about my packs and deliveries">
      <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></div>
      <div className="rl"><b>Texts about my packs</b><span>{readFailed ? "Couldn’t check just now" : rows === null ? "Checking…" : yes ? "On" : "Off"} · {phoneShown(num)}</span></div>
      {readFailed
        ? <button type="button" className="btn-sec btn-sm" onClick={() => { setReadFailed(false); setRows(null); setTick((n) => n + 1); }}>Try again</button>
        : <button type="button" role="switch" aria-checked={yes} aria-label="Texts about my packs and deliveries" className={`k-switch${yes ? " on" : ""}`} onClick={flip} disabled={busy || !readOk}>
            <span className="k-switch-k" />
          </button>}
    </div>
    <div className="texts-fine border-b border-line pb-3.5 pl-14 pr-0.5">
      <p className="mt-1 text-caption leading-normal text-cream-muted">{t("funnel.text_yes")}</p>
      <TextYesFine onLegal={setDoc} under="switch" />
      {doc && <LegalSheet open={doc} onClose={() => setDoc(null)} />}
    </div>
    </>
  );
}
