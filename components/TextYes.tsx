"use client";

import { useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import EditableCopy from "./EditableCopy";
import type { LegalDoc } from "./legal/LegalText";
import { useSiteCopy } from "@/lib/copy";
import { e164, phoneShown, textsOn } from "@/lib/texts";

// THE YES TO TEXTS, AT CHECKOUT (2026-10-14, R5 of the customer audit — decided 2026-10-13: a recorded opt-in, STOP
// honoured, no texts at night, none until the Twilio number is registered). Under the phone field of a pack or a delivery:
//   · texts off (NEXT_PUBLIC_TEXTS_ON unset) — the plain line: the number is for this order, never marketing;
//   · the number already said yes (0398 text_consents, the member's own rows) — says so, and where to change it;
//   · otherwise — an unticked box with what is sent, what it costs and how to stop. The order sends the tick; the server
//     records the yes with the order (app/api/reserve, app/api/delivery/checkout). Never ticked for them.
// UNDER THE BOX (2026-10-14, R6 — what Twilio's campaign review reads at the point a number is given): that saying yes is
// not a condition of buying, and the Terms and the Privacy policy, one tap away. They open in a sheet over the order
// (components/LegalSheet) — a link to /terms threw the half-filled order away.

// The Terms and the Privacy policy are whole pages of words: they load once the box is drawn, not with every page that
// can draw it (scripts/design.ratchet.mjs WEIGHT — /reserve, /delivery and /shop carried them, 4 KB).
const LegalSheet = dynamic(() => import("./LegalSheet"), { ssr: false });

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
    // A read that fails finds no yes, and the box is shown (0398).
    supabase.from("text_consents").select("phone, yes_at, stop_at").eq("user_id", user.id)
      .then(({ data }) => { if (live) setYesFor(((data ?? []) as Row[]).filter(stands).map((r) => r.phone)); });
    return () => { live = false; };
  }, [on, user]);

  if (!on) return <EditableCopy k="funnel.tel_consent" value={t("funnel.tel_consent")} as="p" className="tel-consent" multiline />;
  const num = e164(phone);
  if (num && yesFor.includes(num)) {
    return <p className="tel-consent">Texts about your packs and deliveries are on for <span className="whitespace-nowrap">{phoneShown(num)}</span>. Turn them off in Notifications on your account, or reply STOP.</p>;
  }
  return <TextYesBox checked={checked} onChange={onChange} />;
}

/** The box itself, with its line under it — at checkout (above), and on the public page that shows the carriers'
 *  reviewers what a customer sees (app/texts), where it is drawn whether or not texts are switched on yet. One copy of it,
 *  so the page can never show a box the checkout doesn't. */
export function TextYesBox({ checked, onChange }: { checked: boolean; onChange: (yes: boolean) => void }) {
  const t = useSiteCopy();
  const id = useId();
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  useEffect(() => { void import("./LegalSheet"); }, []);   // fetched while the box is read, so a tap opens it at once
  // The box, then one column holding its words and the line under them, so the line starts where the words do whatever
  // size a phone draws its checkbox. The words are the box's label; the Terms and Privacy buttons are not part of it.
  return (
    <div className="dl-ack">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer">{t("funnel.text_yes")}</label>
        <TextYesFine onLegal={setDoc} />
      </div>
      {doc && <LegalSheet open={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}

/** The line under a yes to texts — here and on the account's switch (components/TextsSetting). A div, not a paragraph:
 *  the public texts page draws the box inside its legal text, whose paragraph rule (.legal-wrap p) set it at body size. */
export function TextYesFine({ onLegal, under = "box" }: { onLegal: (doc: LegalDoc) => void; under?: "box" | "switch" }) {
  return (
    <div className={under === "box" ? "mt-1.5 text-caption leading-normal text-cream-muted" : "mt-1 text-caption leading-normal text-cream-muted"}>
      Consent isn&rsquo;t a condition of purchase.{" "}
      {/* the pair wraps as one: a line that starts "· Privacy" reads as a stray dot */}
      <span className="whitespace-nowrap">
        <button type="button" className="legal-link hit-44" onClick={() => onLegal("terms")}>Terms</button>
        <span aria-hidden> · </span>
        <button type="button" className="legal-link hit-44" onClick={() => onLegal("privacy")}>Privacy</button>
      </span>
    </div>
  );
}
