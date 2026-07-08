"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";
import Gt3Mark from "@/components/Gt3Mark";

// OPERATOR SCAN — the receiving end of a member's card QR. Staff-only: look up the member by their
// card code and add a stamp for a walk-up (cash) purchase. RPCs (0132) are SECURITY DEFINER + staff-
// gated, so this is safe even though the page reads a code from the URL.
type Member = { display_name: string | null; points: number; founding_member: boolean };
const GOAL = 10;

export default function ScanPage() {
  return <Suspense fallback={<section className="screen" id="s-scan" />}><ScanInner /></Suspense>;
}

function ScanInner() {
  const { profile, ready, user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("m") ?? "";
  const isStaff = ready && !!user && ["owner", "admin", "event_manager", "operator", "contractor", "server", "staff"].includes(roleOf(profile));
  const [member, setMember] = useState<Member | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "added">("idle");

  const load = async () => {
    if (!supabase || !code) return;
    setState("loading");
    const { data, error } = await supabase.rpc("member_by_code", { p_code: code });
    const m = (data as Member[] | null)?.[0] ?? null;
    setMember(m);
    setState(error || !m ? "notfound" : "idle");
  };
  useEffect(() => { if (isStaff) load(); /* eslint-disable-next-line */ }, [isStaff, code]);

  const addStamp = async () => {
    if (!supabase || !code) return;
    const { data, error } = await supabase.rpc("award_manual_point", { p_code: code });
    if (!error && typeof data === "number") { setMember((m) => (m ? { ...m, points: data } : m)); setState("added"); }
  };

  if (ready && (!user || !isStaff)) return (
    <section className="screen"><div className="h-title">Staff only</div><div className="h-sub">Sign in with a crew account to scan member cards.</div></section>
  );

  const inCard = member ? member.points % GOAL : 0;
  const name = member?.display_name?.trim() || "Member";

  return (
    <section className="screen scanpg">
      <div className="toprow">
        <div className="eyb">GT3 · Scan</div>
        <button type="button" className="pf" aria-label="Back to crew" onClick={() => router.push("/admin")}>‹</button>
      </div>
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
          <div className="scan-foot">{inCard === 0 && member.points > 0 ? "Card full — this one's on us 🎉" : `${GOAL - inCard} more till a free cup`}</div>
          <button type="button" className="scan-add" onClick={addStamp}>＋ Add a stamp</button>
          {state === "added" && <div className="scan-added">Stamp added — now {member.points} points.</div>}
        </div>
      )}
    </section>
  );
}
