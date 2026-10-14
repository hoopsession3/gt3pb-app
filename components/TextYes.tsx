"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import EditableCopy from "./EditableCopy";
import { useSiteCopy } from "@/lib/copy";
import { e164, phoneShown, textsOn } from "@/lib/texts";

// THE YES TO TEXTS, AT CHECKOUT (2026-10-14, R5 of the customer audit — decided 2026-10-13: a recorded opt-in, STOP
// honoured, no texts at night, none until the Twilio number is registered). Under the phone field of a pack or a delivery:
//   · texts off (NEXT_PUBLIC_TEXTS_ON unset) — the plain line: the number is for this order, never marketing;
//   · the number already said yes (0398 text_consents, the member's own rows) — says so, and where to change it;
//   · otherwise — an unticked box with what is sent, what it costs and how to stop. The order sends the tick; the server
//     records the yes with the order (app/api/reserve, app/api/delivery/checkout). Never ticked for them.

type Row = { phone: string; yes_at: string | null; stop_at: string | null };
const stands = (r: Row) => !!r.yes_at && (!r.stop_at || Date.parse(r.yes_at) > Date.parse(r.stop_at));

export default function TextYes({ phone, checked, onChange }: { phone: string; checked: boolean; onChange: (yes: boolean) => void }) {
  const t = useSiteCopy();
  const { user } = useAuth();
  const on = textsOn();
  const [yesFor, setYesFor] = useState<string[]>([]);
  useEffect(() => {
    if (!on || !supabase || !user) return;
    let live = true;
    // arrives-with: 0398 — until it is pasted the table is not there: the read errs, no yes is found, and the box is shown
    // (this screen appears only once texts are switched on, which waits for 0398).
    supabase.from("text_consents").select("phone, yes_at, stop_at").eq("user_id", user.id)
      .then(({ data }) => { if (live) setYesFor(((data ?? []) as Row[]).filter(stands).map((r) => r.phone)); });
    return () => { live = false; };
  }, [on, user]);

  if (!on) return <EditableCopy k="funnel.tel_consent" value={t("funnel.tel_consent")} as="p" className="tel-consent" multiline />;
  const num = e164(phone);
  if (num && yesFor.includes(num)) {
    return <p className="tel-consent">Texts about your packs and deliveries are on for <span className="whitespace-nowrap">{phoneShown(num)}</span>. Turn them off on your account, or reply STOP.</p>;
  }
  return (
    <label className="dl-ack">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{t("funnel.text_yes")}</span>
    </label>
  );
}
