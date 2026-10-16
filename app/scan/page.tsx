"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";
import Gt3Mark from "@/components/Gt3Mark";
import { Masthead, ClosingBeat } from "@/components/kit";
import dynamic from "next/dynamic";
import Icon from "@/components/Icon";
import { staffAccess } from "@/lib/access";
import { haptic } from "@/lib/haptics";
import { cardOf, freeWords, STAMP_GOAL } from "@/lib/loyalty";
import { money } from "@/lib/money";
// The sign-in is for a visitor who is signed out — staff signed in never download it (2026-10-09).
const SignIn = dynamic(() => import("@/components/SignIn"));

// OPERATOR SCAN — the receiving end of a member's card QR. Staff-only: look up the member by their
// card code and add a stamp for a walk-up (cash) purchase. RPCs (0132) are SECURITY DEFINER + staff-
// gated, so this is safe even though the page reads a code from the URL.
//
// REDEEM (2026-10-12, C6 of the customer audit, approved — the button on the scan screen, decision 3): a card with
// a free cup on it says so and offers Redeem a free cup, which asks first — it takes ten points off the card, for
// good — and then records it (0387 redeem_free_cup: one ledger row of −10, with who gave it; two phones cannot give
// two cups for one). The card is lib/loyalty's: free cups READY, not "earned so far".
//
// ONE PURCHASE, ONE STAMP · CREDIT AT THE WINDOW (2026-10-12, H8 of the customer audit; the owner chose the window for
// credit). An app order stamps itself at pickup, so the screen says what the member ordered in the app today and the
// button stamps a walk-up cup (0389 member_card; award_manual_point now signed by who stamped). Referral credit is
// shown and taken off in one tap after an ask, like a free cup (0389 spend_credit: all of it, the profile locked first).
// Before 0389 is pasted the screen reads member_by_code, as it did, with neither line.
//
// CREDIT BY THE ORDER, AND NEVER YOUR OWN CARD (2026-10-15, R7 of the customer re-audit). "Use credit" took the whole
// balance whatever the order cost: $15 of credit on a $6 cup was $15 gone. The crew now enters the order's total, and
// the credit used is that much at most — the rest stays on the card (spend_credit's amount, 0389). And a crew member's
// own card is another crew member's to give a free cup from or take credit off, as its stamps are (0392, 0410): the
// screen offers neither on your own card, and the database refuses both.
type Member = {
  display_name: string | null; points: number; founding_member: boolean;
  credit_cents?: number; orders_today?: number; cups_today?: number; packs_today?: number;
};
type Redeem = "idle" | "ask" | "busy" | "done" | "none" | "failed";

export default function ScanPage() {
  return <Suspense fallback={<section className="screen" id="s-scan" />}><ScanInner /></Suspense>;
}

function ScanInner() {
  const { profile, ready, user, profileStatus } = useAuth();
  const params = useSearchParams();
  const code = params.get("m") ?? "";
  // One policy, in lib/access: an unloaded or failed profile reads as "member" via roleOf and would
  // turn a staff member away from their own scanner.
  const access = ready ? staffAccess(!!user, profileStatus, profile) : "wait";
  const isStaff = access === "allow";
  const profileUnknown = access === "wait" || access === "failed";
  const [member, setMember] = useState<Member | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "added" | "error" | "limit">("idle");
  // Never your own card (0392, A1 of the account audit): the database refuses it, so the screen doesn't offer it.
  const ownCard = !!code && (code === profile?.referral_code || code === user?.id);
  const [busy, setBusy] = useState(false);
  const [redeem, setRedeem] = useState<Redeem>("idle");
  const [credit, setCredit] = useState<Redeem>("idle");
  const [spent, setSpent] = useState(0);
  // The order's total, as the crew types it from the register — the most credit this order can use (R7).
  const [orderStr, setOrderStr] = useState("");
  // A member with an app order today is asked about once before a walk-up stamp (R7): its cups stamp themselves at
  // pickup, and the note above the button was all that stood between that order and a second stamp for it.
  const [stampAsk, setStampAsk] = useState(false);

  const load = async () => {
    if (!supabase || !code) return;
    setState("loading");
    const card = await supabase.rpc("member_card", { p_code: code });
    if (!card.error) {
      const m = (card.data as Member | null) ?? null;
      setMember(m);
      setState(m ? "idle" : "notfound");
      return;
    }
    const { data, error } = await supabase.rpc("member_by_code", { p_code: code });   // before 0389
    const m = (data as Member[] | null)?.[0] ?? null;
    setMember(m);
    setState(error || !m ? "notfound" : "idle");
  };
  useEffect(() => { if (isStaff) load(); }, [isStaff, code]);

  const addStamp = async () => {
    if (!supabase || !code || busy) return; // guard the double-tap → double point
    setBusy(true);
    const { data, error } = await supabase.rpc("award_manual_point", { p_code: code });
    // The stamp is felt either way (2026-10-05, the haptics round): the crew is looking at the guest,
    // not the screen. The failure is said inline below the card, so it buzzes here, not from a toast.
    if (!error && typeof data === "number") { setMember((m) => (m ? { ...m, points: data } : m)); setState("added"); setRedeem("idle"); haptic("success"); }
    // don't leave a failed award looking successful; the 6-in-10-minutes limit (0392) says so in words
    else { setState(/stamp limit/i.test(error?.message ?? "") ? "limit" : "error"); haptic("error"); }
    setBusy(false);
  };

  const giveFreeCup = async () => {
    if (!supabase || !code || redeem === "busy") return; // a second tap waits for the first answer
    setRedeem("busy");
    const { data, error } = await supabase.rpc("redeem_free_cup", { p_code: code });
    if (!error && typeof data === "number") { setMember((m) => (m ? { ...m, points: data } : m)); setRedeem("done"); setState("idle"); haptic("success"); }
    else { setRedeem(/no free cup/i.test(error?.message ?? "") ? "none" : "failed"); haptic("error"); }
  };

  const takeCredit = async (cents: number) => {
    if (!supabase || !code || credit === "busy" || !(cents > 0)) return; // a second tap waits for the first answer
    setCredit("busy");
    const { data, error } = await supabase.rpc("spend_credit", { p_code: code, p_cents: cents });
    if (!error && typeof data === "number") {
      setSpent(data);
      setMember((m) => (m ? { ...m, credit_cents: Math.max((m.credit_cents ?? 0) - data, 0) } : m));
      setOrderStr("");
      setCredit("done");
      haptic("success");
    }
    else { setCredit(/no credit|not that much/i.test(error?.message ?? "") ? "none" : "failed"); haptic("error"); }
  };

  // "Staff only" is only honest once we know. While the profile is unknown, say that instead —
  // otherwise a crew member on a slow connection is told they are not crew.
  if (profileUnknown) return (
    <section className="screen">
      <Masthead eyebrow="Scan card" />
      <div className="h-title">{access === "failed" ? "Couldn't check your access" : "One moment"}</div>
      <div className="h-sub">{access === "failed" ? "We couldn't read your profile just now — this isn't a refusal." : "Checking your crew access…"}</div>
      <ClosingBeat />
    </section>
  );
  // Signed out, the page names itself and signs in (2026-10-09, round 2) — it said "Staff only" with no way in.
  if (ready && !user) return <SignIn context={{ title: "Scan a member card.", sub: "Sign in with your crew account to add a stamp." }} />;
  if (ready && !isStaff) return (
    <section className="screen">
      <Masthead eyebrow="Scan card" />
      <div className="h-title">Staff only</div>
      <div className="h-sub">Sign in with a crew account to scan member cards.</div>
      <ClosingBeat />
    </section>
  );

  const card = cardOf(member?.points);
  const inCard = card.stamps, GOAL = STAMP_GOAL;
  const name = member?.display_name?.trim() || "Member";
  const first = name.split(" ")[0];
  const creditCents = member?.credit_cents ?? 0;
  // What this order uses: its total, at most what the card holds; what is left stays on the card.
  const orderCents = /^\$?\s*\d{1,4}(\.\d{0,2})?$/.test(orderStr.trim()) ? Math.round(Number(orderStr.trim().replace(/^\$\s*/, "")) * 100) : 0;
  const useCents = Math.min(creditCents, orderCents);
  // What the member ordered in the app today — those stamp themselves at pickup, so the stamp below is a walk-up's.
  const inApp = [
    member?.cups_today ? `${member.cups_today} ${member.cups_today === 1 ? "cup" : "cups"}` : "",
    member?.packs_today ? (member.packs_today === 1 ? "a pack pickup" : `${member.packs_today} pack pickups`) : "",
  ].filter(Boolean).join(" · ");

  return (
    <section className="screen scanpg">
      <Masthead eyebrow="Scan card" />
      <div className="h-title">Member card</div>
      {!code && <div className="h-sub">No card code — scan a member&apos;s QR from their account.</div>}
      {state === "loading" && <div className="h-sub">Looking up…</div>}
      {state === "notfound" && <div className="h-sub">No member found for that code.</div>}
      {member && (
        <div className="scan-card">
          <div className="scan-card-top"><Gt3Mark tone="cream" /><span className="scan-tier">{member.founding_member ? "Founding Member" : "Member"}</span></div>
          <div className="scan-name">{name}</div>
          <div className="scan-stamps" role="img" aria-label={`${inCard} of ${GOAL} stamps`}>
            {Array.from({ length: GOAL }).map((_, i) => <span key={i} className={`scan-dot${i < inCard ? " on" : ""}${i === GOAL - 1 ? " gift" : ""}`} />)}
          </div>
          <div className="scan-foot">{card.free > 0 ? `${freeWords(card.free)} — this one's on us` : `${card.toNext} more till a free cup`}</div>
          {inApp && <div className="h-sub" role="note">In the app today: {inApp} — those stamp themselves at pickup.</div>}
          {ownCard ? (
            <div className="h-sub" role="note">This is your card — another crew member stamps it, gives its free cup and uses its credit.</div>
          ) : inApp && stampAsk ? (
            <div className="flex flex-col gap-2" role="group" aria-label="Stamp a walk-up cup">
              <div className="h-sub">{first}&apos;s app order stamps itself at pickup. Is this another cup, bought here at the window?</div>
              <button type="button" className="btn-pri btn-wide" onClick={() => { void addStamp().then(() => setStampAsk(false)); }} disabled={busy || redeem === "busy"}>
                {busy ? "Adding…" : "Yes — stamp a walk-up cup"}
              </button>
              <button type="button" className="btn-ter self-center" onClick={() => setStampAsk(false)} disabled={busy}>No — it&apos;s the app order</button>
            </div>
          ) : (
            <button type="button" className="btn-pri btn-wide" onClick={inApp ? () => setStampAsk(true) : addStamp} disabled={busy || redeem === "busy"}>{busy ? "Adding…" : <><Icon name="plus" /> Stamp a walk-up cup</>}</button>
          )}
          {state === "added" && <div className="scan-added">Stamp added — now {member.points} points.</div>}
          {state === "error" && <div className="h-sub">That didn&apos;t record — tap to try again.</div>}
          {state === "limit" && <div className="h-sub" role="status">That&apos;s 6 walk-up stamps for {first} in 10 minutes, the most at once. Try again in a few minutes.</div>}
          {card.free > 0 && !ownCard && redeem !== "ask" && redeem !== "busy" && (
            <button type="button" className="btn-sec btn-wide mt-2.5" onClick={() => setRedeem("ask")}>Redeem a free cup</button>
          )}
          {(redeem === "ask" || redeem === "busy") && (
            <div className="mt-2.5 flex flex-col gap-2" role="group" aria-label="Redeem a free cup">
              <div className="h-sub">Give {first} a free cup? It takes ten points off the card.</div>
              <button type="button" className="btn-pri btn-wide" onClick={giveFreeCup} disabled={redeem === "busy"}>{redeem === "busy" ? "Redeeming…" : "Redeem — ring it up at $0"}</button>
              <button type="button" className="btn-ter self-center" onClick={() => setRedeem("idle")} disabled={redeem === "busy"}>Keep it for later</button>
            </div>
          )}
          {redeem === "done" && <div className="scan-added" role="status">Free cup given. {card.free > 0 ? `${freeWords(card.free)} still.` : `${card.toNext} more till the next one.`}</div>}
          {redeem === "none" && <div className="h-sub" role="status">No free cup on this card any more — it may have just been given.</div>}
          {redeem === "failed" && <div className="h-sub" role="status">Couldn&apos;t redeem — nothing was taken off the card. Try again.</div>}
          {creditCents > 0 && !ownCard && credit !== "ask" && credit !== "busy" && (
            <button type="button" className="btn-sec btn-wide mt-2.5" onClick={() => setCredit("ask")}>Use credit · {money(creditCents)} on the card</button>
          )}
          {(credit === "ask" || credit === "busy") && (
            <div className="mt-2.5 flex flex-col gap-2" role="group" aria-label="Use credit">
              <label className="h-sub" htmlFor="scan-order-total">What&apos;s {first}&apos;s order? Up to {money(creditCents)} of credit comes off it.</label>
              <input id="scan-order-total" className="auth-input" inputMode="decimal" enterKeyHint="done" autoComplete="off" placeholder="Order total, e.g. 6.50"
                value={orderStr} onChange={(e) => setOrderStr(e.target.value)} disabled={credit === "busy"} />
              {useCents > 0 && (
                <div className="h-sub" role="status">
                  Use {money(useCents)} — ring it up at {money(orderCents - useCents)}{creditCents - useCents > 0 ? `; ${money(creditCents - useCents)} stays on the card` : ""}.
                </div>
              )}
              <button type="button" className="btn-pri btn-wide" onClick={() => takeCredit(useCents)} disabled={credit === "busy" || useCents <= 0}>
                {credit === "busy" ? "Using…" : useCents > 0 ? `Use ${money(useCents)} of credit` : "Enter the order's total"}
              </button>
              <button type="button" className="btn-ter self-center" onClick={() => { setCredit("idle"); setOrderStr(""); }} disabled={credit === "busy"}>Keep it for later</button>
            </div>
          )}
          {credit === "done" && <div className="scan-added" role="status">Credit used — {money(spent)} off.{creditCents > 0 ? ` ${money(creditCents)} still on the card.` : ""}</div>}
          {credit === "none" && <div className="h-sub" role="status">No credit on this card any more — it may have just been used.</div>}
          {credit === "failed" && <div className="h-sub" role="status">Couldn&apos;t use the credit — nothing was taken off. Try again.</div>}
        </div>
      )}
      <ClosingBeat />
    </section>
  );
}
