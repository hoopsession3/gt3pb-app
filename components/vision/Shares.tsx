"use client";

import { failureWords } from "@/lib/failureWords";
import { useCallback, useEffect, useState } from "react";
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
import { inScope } from "@/lib/sharePreview";
import type { Plan } from "@/lib/visionPlans";
import type { Layout, Program } from "@/lib/vision";
import dynamic from "next/dynamic";
import type { Draft } from "./LinkPreview";

// What a link sends (IMS7-0467): read on asking, so the Links tab carries none of it until then.
const LinkPreview = dynamic(() => import("./LinkPreview"), { ssr: false });

// PRIVATE LINKS (R52, 0447 vision_shares) — the plan for someone outside: an investor, a landlord, a partner. Each link
// is its own long random token, named for who it's for, with or without the money; it counts its opens, and one tap turns
// it off for good. The token rides after the # (app/present), so it never reaches a server log or a referrer.
type Share = { id: string; token: string; label: string; show_asks: boolean; created_at: string; revoked_at: string | null; last_opened_at: string | null; opens: number; expires_at?: string | null; money_plans?: string[]; research_plans?: string[]; program_ids?: string[]; layout_ids?: string[]; pinned_at?: string | null; plan_ids?: string[]; need_plans?: string[] };
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
/** The link in progress, kept in this tab only (IMS8 P2). Empty choices aren't kept; storage refused keeps nothing. */
type LinkDraft = { label: string; money: boolean; ends: string; programs: string[]; rooms: string[]; plans: string[]; needs: string[] };
const DRAFT_KEY = "gt3.vision.linkDraft.v1";
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
function readDraft(): LinkDraft | null {
  try {
    const j = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as Partial<LinkDraft> | null;
    if (!j || typeof j !== "object") return null;
    return { label: typeof j.label === "string" ? j.label.slice(0, 80) : "", money: j.money === true, ends: typeof j.ends === "string" ? j.ends : "30",
      programs: strs(j.programs), rooms: strs(j.rooms), plans: strs(j.plans), needs: strs(j.needs) };
  } catch { return null; }
}
function writeDraft(d: LinkDraft) {
  try {
    const empty = !d.label.trim() && !d.money && d.ends === "30" && !d.programs.length && !d.rooms.length && !d.plans.length && !d.needs.length;
    if (empty) sessionStorage.removeItem(DRAFT_KEY); else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch { /* storage refused: the draft lives on screen only */ }
}

export default function Shares({ canEdit, isOwner = false, plans = [], programs = [], layouts = [] }: { canEdit: boolean; isOwner?: boolean; plans?: Plan[]; programs?: Program[]; layouts?: Pick<Layout, "id" | "name">[] }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  // A LINK IN PROGRESS SURVIVES A DETOUR (IMS8 P2): the draft — name, asks, lifetime, every tick — is kept in this tab
  // (sessionStorage, never sent anywhere) while it's being made, so a "fix it" elsewhere in the vision and Back return
  // to it as it was. A link made clears it (A1); a failed one keeps it.
  const [kept] = useState<LinkDraft | null>(readDraft);
  const [label, setLabel] = useState(kept?.label ?? "");
  // NOTHING IS CHOSEN FOR YOU (IMS8 A1, Ryan 2026-11-01: "nothing selected by default… clear selections after successful
  // Create… preserve the draft on failure"). A new link starts empty — no programs, plans, needs, rooms, money or asks —
  // and a link made clears them, so the next link never inherits the last one's.
  const [money, setMoney] = useState(kept?.money ?? false);
  const [ends, setEnds] = useState<(typeof ENDS)[number]["key"]>(ENDS.some((e) => e.key === kept?.ends) ? (kept!.ends as (typeof ENDS)[number]["key"]) : "30");
  const canEnd = true;   // 0448 is applied (2026-10-25): every link can end
  const [busy, setBusy] = useState(false);
  const [canCase, setCanCase] = useState(true);
  // What a link shows of the roadmap and the store (0455): chosen per link, nothing until ticked.
  const [canChoose, setCanChoose] = useState(true);
  const shownPlans = plans.filter((p) => p.shareable);
  const [pickPrograms, setPickPrograms] = useState<string[]>(kept?.programs ?? []);
  const [pickRooms, setPickRooms] = useState<string[]>(kept?.rooms ?? []);
  // Which plans it shows, and whose open needs (IMS7-0467): per link, nothing until ticked — not every plan marked to
  // show, not every plan of a program it shows. canPick: 0467 is in (until it is, the links read and work as before).
  const [canPick, setCanPick] = useState(true);
  const [pickPlans, setPickPlans] = useState<string[]>(kept?.plans ?? []);
  const [pickNeeds, setPickNeeds] = useState<string[]>(kept?.needs ?? []);
  useEffect(() => { writeDraft({ label, money, ends, programs: pickPrograms, rooms: pickRooms, plans: pickPlans, needs: pickNeeds }); }, [label, money, ends, pickPrograms, pickRooms, pickPlans, pickNeeds]);
  const [peek, setPeek] = useState(false);
  // What's sent is what's visibly ticked: a plan under a program since unticked (and its needs) isn't carried.
  const scope = inScope(shownPlans, pickPrograms, pickPlans, pickNeeds);
  const state = useAsyncData(async (): Promise<Share[]> => {
    if (!supabase) return [];
    const base = `${COLS}, expires_at, money_plans, research_plans, program_ids, layout_ids, pinned_at`;
    // arrives-with: 0467 — until it's pasted, the select without plan_ids/need_plans: the links as they were, no plan
    // picking, no preview (and nothing else rides this select).
    const withPlans = await supabase.from("vision_shares").select(`${base}, plan_ids, need_plans`).order("created_at", { ascending: false });
    if (!withPlans.error) { setCanCase(true); setCanChoose(true); setCanPick(true); return (withPlans.data as unknown as Share[]) ?? []; }
    if (!isMissingColumn(withPlans.error)) throw new Error(withPlans.error.message);
    const withPin = await supabase.from("vision_shares").select(base).order("created_at", { ascending: false });
    if (withPin.error) throw new Error(withPin.error.message);
    setCanCase(true); setCanChoose(true); setCanPick(false);
    return (withPin.data as Share[]) ?? [];
  }, []);

  const copy = async (s: Share) => {
    try { await navigator.clipboard.writeText(shareUrl(s.token)); haptic("success"); toast(`Copied — the link for ${s.label}.`); }
    catch { toast(shareUrl(s.token)); }
  };
  const make = async () => {
    if (!supabase || busy || !label.trim()) return;
    setBusy(true);
    const days = ENDS.find((e) => e.key === ends)?.days ?? 0;
    const row = { label: label.trim(), show_asks: money, ...(canEnd && days ? { expires_at: new Date(Date.now() + days * 86400000).toISOString() } : {}),
      ...(canChoose ? { program_ids: pickPrograms, layout_ids: pickRooms } : {}), ...(canPick ? { plan_ids: scope.plans, need_plans: scope.needs } : {}) };
    const { data, error } = await supabase.from("vision_shares").insert(row).select(COLS).single();
    setBusy(false);
    // A failure keeps everything as it was, so nothing has to be chosen again.
    if (error) { toast(failureWords(error, "Couldn't make the link"), "error"); return; }
    setLabel(""); setMoney(false); setEnds("30"); setPickPrograms([]); setPickRooms([]); setPickPlans([]); setPickNeeds([]); setPeek(false); state.reload();
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
          {canChoose && <ShowsPicker programs={programs} layouts={layouts} pickPrograms={pickPrograms} setPickPrograms={setPickPrograms} pickRooms={pickRooms} setPickRooms={setPickRooms}
            plans={canPick ? shownPlans : null} pickPlans={pickPlans} setPickPlans={setPickPlans} pickNeeds={pickNeeds} setPickNeeds={setPickNeeds} />}
          <p className="vz-card-s">A plan shows on a link only when it&apos;s marked &ldquo;Show it on a link&rdquo; in its sheet and ticked here, under a program ticked here. Nothing else goes.</p>
          {canPick && <button type="button" className="btn-ter self-start" aria-expanded={peek} onClick={() => setPeek((v) => !v)}>{peek ? "Hide what it sends" : "See what it sends"}</button>}
          {canPick && peek && <LinkPreview draft={{ label: label.trim() || "A link", program_ids: pickPrograms, layout_ids: pickRooms, plan_ids: scope.plans, need_plans: scope.needs, show_asks: money } satisfies Draft} />}
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
                sub={st.live && (canEdit || isOwner) ? (
                  <div className="flex flex-col gap-1 px-1 whitespace-normal">
                    {canEdit && canChoose && <ShowsChooser share={s} programs={programs} layouts={layouts} plans={canPick ? shownPlans : null} onSaved={state.reload} />}
                    {isOwner && canCase && <CaseChooser share={s} plans={shownPlans.filter((p) => !canPick || (s.plan_ids ?? []).includes(p.id))} onSaved={state.reload} />}
                    {canEdit && canPick && <SendsLine share={s} />}
                    {s.pinned_at && <PinLine share={s} isOwner={isOwner} onSaved={state.reload} />}
                  </div>
                ) : undefined}
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
    const { data, error } = await supabase.from("vision_plan_money").select("plan_id").not("baseline", "is", null);
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
      <button type="button" className="btn-ter self-start max-w-full text-left whitespace-normal" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Done choosing" : n ? `Shows the case for ${n} plan${n === 1 ? "" : "s"} — change` : "Show a plan's case on this link"}</button>
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

/** The roadmap programs and store rooms a link shows (0455), as ticks — used when making a link and when changing one. */
function ShowsPicker({ programs, layouts, pickPrograms, setPickPrograms, pickRooms, setPickRooms, plans = null, pickPlans = [], setPickPlans, pickNeeds = [], setPickNeeds }: {
  programs: Program[]; layouts: Pick<Layout, "id" | "name">[];
  pickPrograms: string[]; setPickPrograms: (f: (l: string[]) => string[]) => void; pickRooms: string[]; setPickRooms: (f: (l: string[]) => string[]) => void;
  plans?: Plan[] | null; pickPlans?: string[]; setPickPlans?: (f: (l: string[]) => string[]) => void; pickNeeds?: string[]; setPickNeeds?: (f: (l: string[]) => string[]) => void;
}) {
  const under = (plans ?? []).filter((p) => p.program_id && pickPrograms.includes(p.program_id));
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="flex flex-col gap-1">
      <b className="font-sans text-subhead">What it shows of the roadmap</b>
      {programs.length === 0 ? <p className="vz-card-s">No programs yet.</p> : programs.map((p) => (
        <label key={p.id} className="prod-toggle"><input type="checkbox" checked={pickPrograms.includes(p.id)} onChange={() => setPickPrograms((l) => flip(l, p.id))} /> {p.title}</label>
      ))}
      {plans && setPickPlans && setPickNeeds && <>
        <b className="font-sans text-subhead mt-2">Which plans it shows</b>
        {under.length === 0 ? <p className="vz-card-s">No plan marked to show under the programs ticked.</p> : under.map((p) => (
          <div key={p.id} className="flex flex-col">
            <label className="prod-toggle"><input type="checkbox" checked={pickPlans.includes(p.id)} onChange={() => { setPickPlans((l) => flip(l, p.id)); if (pickPlans.includes(p.id)) setPickNeeds((l) => l.filter((x) => x !== p.id)); }} /> {p.name}</label>
            <label className="prod-toggle pl-6"><input type="checkbox" disabled={!pickPlans.includes(p.id)} checked={pickNeeds.includes(p.id)} onChange={() => setPickNeeds((l) => flip(l, p.id))} /> Its open needs</label>
          </div>
        ))}
      </>}
      <b className="font-sans text-subhead mt-2">Which rooms it shows</b>
      {layouts.length === 0 ? <p className="vz-card-s">No rooms yet.</p> : layouts.map((l) => (
        <label key={l.id} className="prod-toggle"><input type="checkbox" checked={pickRooms.includes(l.id)} onChange={() => setPickRooms((x) => flip(x, l.id))} /> {l.name}</label>
      ))}
    </div>
  );
}

/** Change what a live link shows of the roadmap and the store (0455). Nothing leaves until it's ticked and saved. */
function ShowsChooser({ share, programs, layouts, plans, onSaved }: { share: Share; programs: Program[]; layouts: Pick<Layout, "id" | "name">[]; plans: Plan[] | null; onSaved: () => void }) {
  const { toast } = useAppStable();
  const [open, setOpen] = useState(false);
  const [pickPrograms, setPickPrograms] = useState<string[]>(share.program_ids ?? []);
  const [pickRooms, setPickRooms] = useState<string[]>(share.layout_ids ?? []);
  const [pickPlans, setPickPlans] = useState<string[]>(share.plan_ids ?? []);
  const [pickNeeds, setPickNeeds] = useState<string[]>(share.need_plans ?? []);
  const [busy, setBusy] = useState(false);
  const sorted = (l: string[] | undefined) => [...(l ?? [])].sort();
  const changed = JSON.stringify([pickPrograms, pickRooms, pickPlans, pickNeeds].map(sorted)) !== JSON.stringify([share.program_ids, share.layout_ids, share.plan_ids, share.need_plans].map(sorted));
  const save = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.from("vision_shares").update({ program_ids: pickPrograms, layout_ids: pickRooms, ...(plans ? (({ plans: plan_ids, needs: need_plans }) => ({ plan_ids, need_plans }))(inScope(plans, pickPrograms, pickPlans, pickNeeds)) : {}) }).eq("id", share.id);
    setBusy(false);
    if (error) { toast(failureWords(error, "Couldn't change what the link shows"), "error"); return; }
    haptic("success"); toast(`Saved — the link for ${share.label} shows ${pickPrograms.length} program${pickPrograms.length === 1 ? "" : "s"} and ${pickRooms.length} room${pickRooms.length === 1 ? "" : "s"}.`); onSaved();
  };
  const np = (share.program_ids ?? []).length, nr = (share.layout_ids ?? []).length, nl = (share.plan_ids ?? []).length;
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn-ter self-start max-w-full text-left whitespace-normal" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Done choosing" : `${np} program${np === 1 ? "" : "s"}${plans ? ` · ${nl} plan${nl === 1 ? "" : "s"}` : ""} · ${nr} room${nr === 1 ? "" : "s"} — change`}</button>
      {open && (
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          <ShowsPicker programs={programs} layouts={layouts} pickPrograms={pickPrograms} setPickPrograms={setPickPrograms} pickRooms={pickRooms} setPickRooms={setPickRooms}
            plans={plans} pickPlans={pickPlans} setPickPlans={setPickPlans} pickNeeds={pickNeeds} setPickNeeds={setPickNeeds} />
          <button type="button" className="btn-pri btn-sm self-start" onClick={() => void save()} disabled={!changed || busy}>{busy ? "Saving…" : "Save what it shows"}</button>
        </div>
      )}
    </div>
  );
}

/** What a live link sends (IMS7-0467), on asking — the database's own answer for it. */
function SendsLine({ share }: { share: Share }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="btn-ter self-start max-w-full text-left whitespace-normal" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide what it sends" : "What it sends"}</button>
      {open && <LinkPreview share={share.id} />}
    </div>
  );
}

/** What a link's case is fixed at (BP2a, 0458): the approvals made by that moment. A newer approval doesn't reach a link
 *  already sent until an owner moves it on — the investor sees the date either way. */
function PinLine({ share, isOwner, onSaved }: { share: Share; isOwner: boolean; onSaved: () => void }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const when = new Date(share.pinned_at!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const move = async () => {
    if (!supabase || busy) return;
    if (!(await confirm({ title: `Show the latest approval on ${share.label}?`, body: `Anyone who opens this link will see the plans as approved now, instead of as approved by ${when}. The earlier approvals stay on record.`, confirmLabel: "Show the latest" }))) return;
    setBusy(true);
    const { error } = await supabase.from("vision_shares").update({ pinned_at: new Date().toISOString() }).eq("id", share.id);
    setBusy(false);
    if (error) { haptic("error"); toast(failureWords(error, "Couldn't move the link on"), "error"); return; }
    haptic("success"); toast(`${share.label} shows the latest approval now.`); onSaved();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="vz-card-s">Shows the case as approved by {when}.</span>
      {isOwner && <button type="button" className="btn-ter" onClick={() => void move()} disabled={busy}>{busy ? "Moving…" : "Show the latest approval"}</button>}
    </div>
  );
}
