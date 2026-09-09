"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";
import Gt3Mark from "@/components/Gt3Mark";
import { Masthead, ClosingBeat } from "@/components/kit";
import Icon from "@/components/Icon";
import { staffAccess } from "@/lib/access";

// OPERATOR SCAN — the receiving end of a member's card QR. Staff-only: look up the member by their
// card code and add a stamp for a walk-up (cash) purchase. RPCs (0132) are SECURITY DEFINER + staff-
// gated, so this is safe even though the page reads a code from the URL.
type Member = { display_name: string | null; points: number; founding_member: boolean };
const GOAL = 10;

export default function ScanPage() {
  return <Suspense fallback={<section className="screen" id="s-scan" />}><ScanInner /></Suspense>;
}

function ScanInner() {
  const { profile, ready, user, profileStatus } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("m") ?? "";
  // One policy, in lib/access: an unloaded or failed profile reads as "member" via roleOf and would
  // turn a staff member away from their own scanner.
  const access = ready ? staffAccess(!!user, profileStatus, profile) : "wait";
  const isStaff = access === "allow";
  const profileUnknown = access === "wait" || access === "failed";
  const [member, setMember] = useState<Member | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "added" | "error">("idle");
  const [busy, setBusy] = useState(false);

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
    if (!error && typeof data === "number") { setMember((m) => (m ? { ...m, points: data } : m)); setState("added"); }
    else setState("error"); // don't leave a failed award looking successful
    setBusy(false);
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
  if (ready && (!user || !isStaff)) return (
    <section className="screen">
      <Masthead eyebrow="Scan card" />
      <div className="h-title">Staff only</div>
      <div className="h-sub">Sign in with a crew account to scan member cards.</div>
      <ClosingBeat />
    </section>
  );

  const inCard = member ? member.points % GOAL : 0;
  const name = member?.display_name?.trim() || "Member";

  return (
    <section className="screen scanpg">
      <Masthead eyebrow="Scan card" right={<button type="button" className="pf" aria-label="Back to crew" onClick={() => router.push("/crew")}>‹</button>} />
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
          <div className="scan-foot">{inCard === 0 && member.points > 0 ? "Card full — this one's on us" : `${GOAL - inCard} more till a free cup`}</div>
          <button type="button" className="scan-add" onClick={addStamp} disabled={busy}>{busy ? "Adding…" : <><Icon name="plus" /> Add a stamp</>}</button>
          {state === "added" && <div className="scan-added">Stamp added — now {member.points} points.</div>}
          {state === "error" && <div className="h-sub">That didn&apos;t record — tap to try again.</div>}
        </div>
      )}
      <ClosingBeat />
    </section>
  );
}
