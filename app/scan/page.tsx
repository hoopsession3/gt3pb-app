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
type Member = { display_name: string | null; points: number; founding_member: boolean };
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
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "added" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [redeem, setRedeem] = useState<Redeem>("idle");

  const load = async () => {
    if (!supabase || !code) return;
    setState("loading");
    const { data, error } = await supabase.rpc("member_by_code", { p_code: code });
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
    else { setState("error"); haptic("error"); } // don't leave a failed award looking successful
    setBusy(false);
  };

  const giveFreeCup = async () => {
    if (!supabase || !code || redeem === "busy") return; // a second tap waits for the first answer
    setRedeem("busy");
    const { data, error } = await supabase.rpc("redeem_free_cup", { p_code: code });
    if (!error && typeof data === "number") { setMember((m) => (m ? { ...m, points: data } : m)); setRedeem("done"); setState("idle"); haptic("success"); }
    else { setRedeem(/no free cup/i.test(error?.message ?? "") ? "none" : "failed"); haptic("error"); }
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
          <button type="button" className="btn-pri btn-wide" onClick={addStamp} disabled={busy || redeem === "busy"}>{busy ? "Adding…" : <><Icon name="plus" /> Add a stamp</>}</button>
          {state === "added" && <div className="scan-added">Stamp added — now {member.points} points.</div>}
          {state === "error" && <div className="h-sub">That didn&apos;t record — tap to try again.</div>}
          {card.free > 0 && redeem !== "ask" && redeem !== "busy" && (
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
        </div>
      )}
      <ClosingBeat />
    </section>
  );
}
