"use client";

import { failureWords } from "@/lib/failureWords";
import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import AsyncSection from "@/components/AsyncSection";
import { InfoRow } from "@/components/kit";
import { publicOrigin } from "@/lib/native";
import { ageLabel } from "@/lib/dates";
import { haptic } from "@/lib/haptics";
import { isMissingColumn } from "@/lib/schemaSkew";

// PRIVATE LINKS (R52, 0447 vision_shares) — the plan for someone outside: an investor, a landlord, a partner. Each link
// is its own long random token, named for who it's for, with or without the money; it counts its opens, and one tap turns
// it off for good. The token rides after the # (app/present), so it never reaches a server log or a referrer.
type Share = { id: string; token: string; label: string; show_asks: boolean; created_at: string; revoked_at: string | null; last_opened_at: string | null; opens: number; expires_at?: string | null };
const COLS = "id, token, label, show_asks, created_at, revoked_at, last_opened_at, opens";
/** How long a new link lives (R53, 0448): until it's turned off, or a set number of days. */
const ENDS = [{ key: "never", label: "Until I turn it off", days: 0 }, { key: "7", label: "7 days", days: 7 }, { key: "30", label: "30 days", days: 30 }, { key: "90", label: "90 days", days: 90 }] as const;
/** A link's state, said: off, ended, or live (and when it ends). */
export function linkState(s: Pick<Share, "revoked_at" | "expires_at">, now = Date.now()): { live: boolean; word: string; ends: string | null } {
  if (s.revoked_at) return { live: false, word: "Off", ends: null };
  if (s.expires_at && Date.parse(s.expires_at) <= now) return { live: false, word: "Ended", ends: null };
  if (!s.expires_at) return { live: true, word: "Live", ends: null };
  const days = Math.ceil((Date.parse(s.expires_at) - now) / 86400000);
  return { live: true, word: "Live", ends: days <= 1 ? "ends within a day" : `ends in ${days} days` };
}
export const shareUrl = (token: string) => `${publicOrigin()}/present#${token}`;

export default function Shares({ canEdit }: { canEdit: boolean }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const [label, setLabel] = useState("");
  const [money, setMoney] = useState(true);
  const [ends, setEnds] = useState<(typeof ENDS)[number]["key"]>("30");
  const [canEnd, setCanEnd] = useState(true);
  const [busy, setBusy] = useState(false);
  const loader = useCallback(async (): Promise<Share[]> => {
    if (!supabase) return [];
    // arrives-with: 0447  — until 0447 is applied the table is absent: the error reaches the person in plain words (AsyncSection's error, failureWords), never as an empty plan
    // arrives-with: 0448  — expires_at: before 0448 the read asks again without it, and new links can't end (the choice hides)
    const first = await supabase.from("vision_shares").select(`${COLS}, expires_at`).order("created_at", { ascending: false });
    if (first.error && isMissingColumn(first.error)) {
      setCanEnd(false);
      const { data, error } = await supabase.from("vision_shares").select(COLS).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data as Share[]) ?? [];
    }
    if (first.error) throw new Error(first.error.message);
    return (first.data as Share[]) ?? [];
  }, []);
  const state = useAsyncData(loader, []);

  const copy = async (s: Share) => {
    try { await navigator.clipboard.writeText(shareUrl(s.token)); haptic("success"); toast(`Copied — the link for ${s.label}.`); }
    catch { toast(shareUrl(s.token)); }
  };
  const make = async () => {
    if (!supabase || busy || !label.trim()) return;
    setBusy(true);
    const days = ENDS.find((e) => e.key === ends)?.days ?? 0;
    const row = { label: label.trim(), show_asks: money, ...(canEnd && days ? { expires_at: new Date(Date.now() + days * 86400000).toISOString() } : {}) };
    const { data, error } = await supabase.from("vision_shares").insert(row).select(COLS).single();
    setBusy(false);
    if (error) { toast(failureWords(error, "Couldn't make the link"), "error"); return; }
    setLabel(""); state.reload();
    void copy(data as Share);
  };
  const off = async (s: Share) => {
    if (!supabase) return;
    if (!(await confirm({ title: `Turn off the link for ${s.label}?`, body: "Anyone holding it sees “This link isn't live” from now on. A new link can be made any time.", confirmLabel: "Turn it off", danger: true }))) return;
    const { error } = await supabase.from("vision_shares").update({ revoked_at: new Date().toISOString() }).eq("id", s.id);
    if (error) { toast(failureWords(error, "Couldn't turn it off"), "error"); return; }
    toast(`The link for ${s.label} is off.`); state.reload();
  };

  return (
    <div className="vz">
      <p className="vz-sub">A private, read-only link to the plan — the roadmap, the store in 3D and, if you choose, the asks. Nothing else in the app comes with it, and you can turn it off any time.</p>
      {canEdit && (
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          <label className="prod-f"><span>Who it&apos;s for</span><input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Upstate investors" /></label>
          <label className="prod-toggle"><input type="checkbox" checked={money} onChange={(e) => setMoney(e.target.checked)} /> Show where capital may be needed</label>
          {canEnd && <label className="prod-f"><span>It lives</span><select value={ends} onChange={(e) => setEnds(e.target.value as typeof ends)}>{ENDS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>}
          <p className="vz-card-s">Plans show on a link only when marked &ldquo;Show it on a link&rdquo; in their sheet — drafts stay with the crew.</p>
          <button type="button" className="btn-pri" onClick={() => void make()} disabled={busy || !label.trim()}>{busy ? "Making…" : "Make the link — it's copied"}</button>
        </div>
      )}
      <AsyncSection state={state} isEmpty={(d) => d.length === 0} emptyTitle="No links yet" emptySub="Make one for the next person who asks what's next." errorTitle="Couldn't load the links">
        {(rows) => (
          <div className="k-rows">
            {rows.map((s) => { const st = linkState(s); return (
              <InfoRow key={s.id} name={s.label}
                nameExtra={<span className={`adm-substat ${st.live ? "active" : "past_due"}`}>{st.word}</span>}
                meta={`${s.show_asks ? "With the asks" : "The vision only"} · made ${ageLabel(s.created_at)}${st.ends ? ` · ${st.ends}` : ""} · ${s.opens ? `opened ${s.opens}× · last ${ageLabel(s.last_opened_at ?? s.created_at)}` : "not opened yet"}`}
                trailing={st.live ? (
                  <span className="flex gap-2">
                    <button type="button" className="btn-sec btn-sm" onClick={() => void copy(s)}>Copy</button>
                    {canEdit && <button type="button" className="btn-ter" onClick={() => void off(s)}>Turn off</button>}
                  </span>
                ) : undefined} />
            ); })}
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
