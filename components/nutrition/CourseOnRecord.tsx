"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import { failureWords } from "@/lib/failureWords";
import { money } from "@/lib/money";
import Icon from "@/components/Icon";
import { howWord, isLive, progressWords, rookieEarned, type Student } from "@/lib/courseStudents";

// GT3 NUTRITION ON A CUSTOMER'S RECORD (R47 — Ryan: "a member's profile should show if they enrolled and all of the other
// stuff"). Whether they have the course and how (bought, with what it cost; given, with the note and when; taken back),
// how far along they are, the Rookie badge, the last lesson they finished — and, for an owner or an admin, Give the
// course / Take it back (course_give, course_take_back, 0444: the database refuses anyone else, and every change is in
// the audit trail). Take it back asks first, on the card — never a browser dialog.

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export default function CourseOnRecord({ customerId, canGive }: { customerId: string; canGive: boolean }) {
  const { toast } = useAppStable();
  const loader = useCallback(async (): Promise<Student | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("course_students");
    if (error) throw new Error(error.message);
    return ((data as Student[] | null) ?? []).find((s) => s.customer_id === customerId) ?? null;
  }, [customerId]);
  const board = useAsyncData<Student | null>(loader, [customerId]);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (board.status === "loading") return <div className="crm-note">GT3 Nutrition — loading…</div>;
  if (board.status === "error") return <div className="crm-note">GT3 Nutrition — couldn&apos;t load. <button type="button" className="btn-ter" onClick={() => void board.reload()}>Try again</button></div>;
  const s = board.data;
  const live = !!s && isLive(s);

  const give = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("course_give", { p_customer: customerId, p_note: note.trim() || null });
    setBusy(false);
    if (error) { toast(failureWords(error, "Couldn't give the course"), "error"); return; }
    toast("GT3 Nutrition given — it's open on their account"); setNote(""); void board.reload();
  };
  const takeBack = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("course_take_back", { p_customer: customerId });
    setBusy(false); setAsking(false);
    if (error) { toast(failureWords(error, "Couldn't take the course back"), "error"); return; }
    toast("GT3 Nutrition taken back"); void board.reload();
  };

  return (
    <div className="crm-tier flex-col items-start gap-1.5" aria-label="GT3 Nutrition">
      <span className="crm-tier-l">GT3 Nutrition</span>
      {!s ? (
        <div className="crm-note mt-0">Not enrolled.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`k-tag${live ? " ok" : ""}`}>{howWord(s)}</span>
            {live && rookieEarned(s) && <span className="k-tag gold"><Icon name="star" size={11} /> Rookie badge</span>}
          </div>
          <div className="crm-note mt-0">
            {s.source === "purchase" ? `Bought ${day(s.granted_at)}${s.paid_cents != null ? ` · ${money(s.paid_cents)}` : ""}` : `Given ${day(s.granted_at)}${s.note ? ` — “${s.note}”` : ""}`}
            {s.revoked_at ? ` · taken back ${day(s.revoked_at)}` : ""}
          </div>
          {live && <div className="crm-note mt-0">{progressWords(s)} · Rookie {s.rookie_done} of {s.rookie_total}{s.last_done_at ? ` · last finished ${day(s.last_done_at)}` : " · hasn't finished one yet"}</div>}
        </>
      )}
      {canGive && !live && (
        <div className="flex flex-wrap items-center gap-2 w-full">
          <input aria-label="Why — a note kept with it (optional)" placeholder="Why — e.g. a gift, a coach" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="flex-1 min-w-0" />
          <button type="button" className="btn-sec btn-sm" onClick={give} disabled={busy}>{busy ? "Giving…" : "Give the course"}</button>
        </div>
      )}
      {canGive && live && !asking && <button type="button" className="btn-ter" onClick={() => setAsking(true)}>Take it back</button>}
      {canGive && live && asking && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="crm-note mt-0">{s?.source === "purchase" ? "They paid for it — refund the order too, from The Shop · orders. Take it back?" : "Take GT3 Nutrition back?"}</span>
          <button type="button" className="btn-sec btn-sm" onClick={takeBack} disabled={busy}>{busy ? "Taking back…" : "Take it back"}</button>
          <button type="button" className="btn-ter" onClick={() => setAsking(false)}>Keep it</button>
        </div>
      )}
      {!canGive && <div className="crm-note mt-0">An owner or an admin gives or takes back the course.</div>}
    </div>
  );
}
