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
import { isMissingColumn, isMissingRelation, isMissingTable } from "@/lib/schemaSkew";
import type { Plan } from "@/lib/visionPlans";

// PRIVATE LINKS (R52, 0447 vision_shares) — the plan for someone outside: an investor, a landlord, a partner. Each link
// is its own long random token, named for who it's for, with or without the money; it counts its opens, and one tap turns
// it off for good. The token rides after the # (app/present), so it never reaches a server log or a referrer.
type Share = { id: string; token: string; label: string; show_asks: boolean; created_at: string; revoked_at: string | null; last_opened_at: string | null; opens: number; expires_at?: string | null; money_plans?: string[]; research_plans?: string[] };
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

export default function Shares({ canEdit, isOwner = false, plans = [] }: { canEdit: boolean; isOwner?: boolean; plans?: Plan[] }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const [label, setLabel] = useState("");
  const [money, setMoney] = useState(true);
  const [ends, setEnds] = useState<(typeof ENDS)[number]["key"]>("30");
  const canEnd = true;   // 0448 is applied (2026-10-25): every link can end
  const [busy, setBusy] = useState(false);
  const [canCase, setCanCase] = useState(true);
  const loader = useCallback(async (): Promise<Share[]> => {
    if (!supabase) return [];
    // arrives-with: 0451  — money_plans, research_plans: before 0451 the read asks as before, and the case chooser hides
    const withCase = await supabase.from("vision_shares").select(`${COLS}, expires_at, money_plans, research_plans`).order("created_at", { ascending: false });
    if (!withCase.error) { setCanCase(true); return (withCase.data as Share[]) ?? []; }
    if (!isMissingColumn(withCase.error)) throw new Error(withCase.error.message);
    setCanCase(false);
    const first = await supabase.from("vision_shares").select(`${COLS}, expires_at`).order("created_at", { ascending: false });
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
                sub={st.live && isOwner && canCase ? <CaseChooser share={s} plans={plans.filter((p) => p.shareable)} onSaved={state.reload} /> : undefined}
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

/** What a link shows of each plan's case (R57, 0451) — an owner's choice, per link and per plan: the approved money (its
 *  baseline, rent, wages and terms included) and the accepted research. Nothing by default; adding the money asks first. */
function CaseChooser({ share, plans, onSaved }: { share: Share; plans: Plan[]; onSaved: () => void }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [money, setMoney] = useState<string[]>(share.money_plans ?? []);
  const [research, setResearch] = useState<string[]>(share.research_plans ?? []);
  const [busy, setBusy] = useState(false);
  const loadApproved = useCallback(async (): Promise<Set<string>> => {
    if (!supabase || !open) return new Set();
    // arrives-with: 0449
    const { data, error } = await supabase.from("vision_plan_money").select("plan_id").not("baseline", "is", null);
    if (error && (isMissingTable(error) || isMissingRelation(error))) return new Set();
    if (error) throw new Error(error.message);
    return new Set(((data ?? []) as { plan_id: string }[]).map((r) => r.plan_id));
  }, [open]);
  const approved = useAsyncData(loadApproved, [open]);
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const changed = JSON.stringify([[...money].sort(), [...research].sort()]) !== JSON.stringify([[...(share.money_plans ?? [])].sort(), [...(share.research_plans ?? [])].sort()]);
  const save = async () => {
    if (!supabase || busy) return;
    const added = money.filter((id) => !(share.money_plans ?? []).includes(id)).map((id) => plans.find((p) => p.id === id)?.name ?? "a plan");
    if (added.length && !(await confirm({ title: `Show ${added.join(", ")}'s money on the link for ${share.label}?`, body: "Anyone holding this link sees the approved baseline — the costs, rent, wages and the investor's terms — and what follows from it. Turn it off here any time.", confirmLabel: "Show it" }))) return;
    setBusy(true);
    const { error } = await supabase.from("vision_shares").update({ money_plans: money, research_plans: research }).eq("id", share.id);
    setBusy(false);
    if (error) { toast(failureWords(error, "Couldn't change what the link shows"), "error"); return; }
    haptic("success"); toast(`Saved — what the link for ${share.label} shows.`); onSaved();
  };
  const n = (share.money_plans ?? []).length;
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn-ter self-start" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Done choosing" : n ? `Shows the case for ${n} plan${n === 1 ? "" : "s"} — change` : "Show a plan's case on this link"}</button>
      {open && (
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          {plans.length === 0 ? <p className="vz-card-s">No plan is marked to show on a link yet — mark one in its sheet.</p> : plans.map((p) => {
            const has = approved.data?.has(p.id) ?? false;
            return (
              <div key={p.id} className="flex flex-col gap-1">
                <b className="font-sans">{p.name}</b>
                <label className="prod-toggle"><input type="checkbox" disabled={!has} checked={money.includes(p.id)} onChange={() => setMoney((l) => flip(l, p.id))} /> Its approved money{has ? "" : " — no approved baseline yet"}</label>
                <label className="prod-toggle"><input type="checkbox" checked={research.includes(p.id)} onChange={() => setResearch((l) => flip(l, p.id))} /> Its accepted research, with sources</label>
              </div>
            );
          })}
          <button type="button" className="btn-pri btn-sm self-start" onClick={() => void save()} disabled={!changed || busy}>{busy ? "Saving…" : "Save what it shows"}</button>
        </div>
      )}
    </div>
  );
}
