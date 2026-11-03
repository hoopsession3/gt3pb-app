"use client";

import { failureWords } from "@/lib/failureWords";
import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import Said from "@/components/Said";
import { useConfirm } from "@/components/ConfirmSheet";
import AsyncSection from "@/components/AsyncSection";
import { InfoRow } from "@/components/kit";
import { publicOrigin } from "@/lib/native";
import { ageLabel } from "@/lib/dates";
import { haptic } from "@/lib/haptics";
import { inScope } from "@/lib/sharePreview";
import { isStale, publishLink, reviewLink, toConfirm, type LinkDraft as PublishDraft, type Review } from "@/lib/sharePublish";
import type { Dep, Plan } from "@/lib/visionPlans";
import type { Layout, Program } from "@/lib/vision";
import dynamic from "next/dynamic";
import LinkStudio, { ShowsPicker, ENDS_FOR_ROW } from "./LinkStudio";
import { changesBetween, linkPhase } from "@/lib/linkStates";
import type { PublishFinding } from "@/lib/publishReadiness";

// What a link sends (IMS7-0467): read on asking, so the Links tab carries none of it until then.
const LinkPreview = dynamic(() => import("./LinkPreview"), { ssr: false });

// PRIVATE LINKS (R52, 0447 vision_shares) — the plan for someone outside: an investor, a landlord, a partner. Each link
// is its own long random token, named for who it's for, with or without the money; it counts its opens, and one tap turns
// it off for good. The token rides after the # (app/present), so it never reaches a server log or a referrer.
type Share = { id: string; token: string; label: string; show_asks: boolean; created_at: string; published_at?: string | null; revision?: number | null; revoked_at: string | null; last_opened_at: string | null; opens: number; expires_at?: string | null; money_plans?: string[]; research_plans?: string[]; program_ids?: string[]; layout_ids?: string[]; pinned_at?: string | null; plan_ids?: string[]; need_plans?: string[] };
const COLS = "id, token, label, show_asks, created_at, revoked_at, last_opened_at, opens";
/** A link's state, said: off, ended, or live (and when it ends). */
export function linkState(s: Pick<Share, "revoked_at" | "expires_at">, now = Date.now()): { live: boolean; word: string; ends: string | null } {
  if (s.revoked_at) return { live: false, word: "Off", ends: null };
  if (s.expires_at && Date.parse(s.expires_at) <= now) return { live: false, word: "Ended", ends: null };
  if (!s.expires_at) return { live: true, word: "Live", ends: null };
  const days = Math.ceil((Date.parse(s.expires_at) - now) / 86400000);
  return { live: true, word: "Live", ends: days <= 1 ? "ends within a day" : `ends in ${days} days` };
}
export const shareUrl = (token: string) => `${publicOrigin()}/present#${token}`;
/** Make or change a link the one way 0472 allows (IMS8 P5): review what it would send, confirm its material findings
 *  word for word (a sheet — nothing is confirmed unseen), publish with that review's fingerprint. A refusal shares
 *  nothing and keeps what was chosen; one because it changed since the review says so. */
function usePublishLink() {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  return async (share: string | null, draft: PublishDraft, what: string): Promise<{ id: string; token: string } | null> => {
    if (!supabase) return null;
    let r: Review;
    try { r = await reviewLink(supabase, share, draft); } catch (e) { haptic("error"); toast(failureWords(e as Error, `Couldn't ${what}`), "error"); return null; }
    const ask = toConfirm(r, draft.money_plans ?? []);
    if (ask.ids.length && !(await confirm({ title: ask.ids.length === 1 ? "Confirm this before it's shared" : `Confirm these ${ask.ids.length} before they're shared`,
      body: <ul className="flex flex-col gap-1.5 text-left">{ask.words.map((w, i) => <li key={i}>{w}</li>)}</ul>, confirmLabel: "Confirm and share" }))) return null;
    try { return await publishLink(supabase, share, draft, r, ask.ids); }
    catch (e) { haptic("error"); toast(isStale(e) ? "It changed since it was reviewed — nothing was shared. Try again to review it." : failureWords(e as Error, `Couldn't ${what}`), "error"); return null; }
  };
}

export default function Shares({ canEdit, isOwner = false, plans = [], programs = [], layouts = [], deps = [], onGo }: { canEdit: boolean; isOwner?: boolean; plans?: Plan[]; programs?: Program[]; layouts?: Pick<Layout, "id" | "name">[]; deps?: Dep[]; onGo?: (go: NonNullable<PublishFinding["go"]>) => void }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  // THE STUDIO (IMS8 P7) makes a link: Choose → Review → Preview → Share (components/vision/LinkStudio). Its draft is kept
  // in this tab while it's made (P2), nothing is chosen for it (A1), and a link made clears it.
  const [canCase, setCanCase] = useState(true);
  // What a link shows of the roadmap and the store (0455): chosen per link, nothing until ticked.
  const [canChoose, setCanChoose] = useState(true);
  const shownPlans = plans.filter((p) => p.shareable);
  // Which plans it shows, and whose open needs (IMS7-0467). canPick: 0467 is in (until it is, the links read as before).
  const [canPick, setCanPick] = useState(true);
  const state = useAsyncData(async (): Promise<Share[]> => {
    if (!supabase) return [];
    const base = `${COLS}, expires_at, money_plans, research_plans, program_ids, layout_ids, pinned_at`;
    // 0467 and 0472 are applied in production (ledger read 2026-11-03): the columns are there, so the fallback that read the
    // links without them is retired — a failed read is said, not quietly narrowed.
    const withPlans = await supabase.from("vision_shares").select(`${base}, plan_ids, need_plans, published_at, revision`).order("created_at", { ascending: false });
    if (withPlans.error) throw new Error(withPlans.error.message);
    setCanCase(true); setCanChoose(true); setCanPick(true);
    return (withPlans.data as unknown as Share[]) ?? [];
  }, []);

  const copy = async (s: Share) => {
    try { await navigator.clipboard.writeText(shareUrl(s.token)); haptic("success"); toast(`Copied — the link for ${s.label}.`); }
    catch { toast(shareUrl(s.token)); }
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
      {canEdit && <LinkStudio isOwner={isOwner} plans={plans} programs={programs} layouts={layouts} deps={deps} onMade={state.reload} onGo={onGo} />}
      <p className="vz-sub">A private, read-only link to the plan — the roadmap, the store in 3D and, if you choose, the asks. Nothing else in the app comes with it, and you can turn it off any time.</p>
      <AsyncSection state={state} isEmpty={(d) => d.length === 0} emptyTitle="No links yet" emptySub="Make one for the next person who asks what's next." errorTitle="Couldn't load the links">
        {(rows) => (
          <div className="k-rows">
            {rows.map((s) => { const st = linkState(s); return (
              <InfoRow key={s.id} name={s.label}
                nameExtra={st.live && canEdit ? <LiveState share={s} /> : <span className={`adm-substat ${st.live ? "active" : "past_due"}`}>{st.word}</span>}
                meta={`${s.show_asks ? "With the asks" : "The vision only"} · made ${ageLabel(s.created_at)}${s.published_at ? ` · revision ${s.revision ?? 1}, shared ${ageLabel(s.published_at)}` : ""}${st.ends ? ` · ${st.ends}` : ""} · ${s.opens ? `opened ${s.opens}× · last ${ageLabel(s.last_opened_at ?? s.created_at)}` : "not opened yet"}`}
                sub={st.live && (canEdit || isOwner) ? (
                  <div className="flex flex-col gap-1 px-1 whitespace-normal">
                    {canEdit && canChoose && <ShowsChooser share={s} programs={programs} layouts={layouts} plans={canPick ? shownPlans : null} onSaved={state.reload} />}
                    {isOwner && canCase && <CaseChooser share={s} plans={shownPlans.filter((p) => !canPick || (s.plan_ids ?? []).includes(p.id))} onSaved={state.reload} />}
                    {canEdit && canPick && <SendsLine share={s} />}
                    {canEdit && <Changes share={s} onSaved={state.reload} />}
                    {canEdit && <Lifetime share={s} onSaved={state.reload} />}
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
  const publish = usePublishLink();
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
    const done = await publish(share.id, { money_plans: money, research_plans: research }, "change what the link shows");
    setBusy(false);
    if (!done) return;
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

/** Change what a live link shows of the roadmap and the store (0455). Nothing leaves until it's ticked and saved. */
function ShowsChooser({ share, programs, layouts, plans, onSaved }: { share: Share; programs: Program[]; layouts: Pick<Layout, "id" | "name">[]; plans: Plan[] | null; onSaved: () => void }) {
  const { toast } = useAppStable();
  const publish = usePublishLink();
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
    const done = await publish(share.id, { program_ids: pickPrograms, layout_ids: pickRooms, ...(plans ? (({ plans: plan_ids, needs: need_plans }) => ({ plan_ids, need_plans }))(inScope(plans, pickPrograms, pickPlans, pickNeeds)) : {}) }, "change what the link shows");
    setBusy(false);
    if (!done) return;
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
  const publish = usePublishLink();
  const [busy, setBusy] = useState(false);
  const when = new Date(share.pinned_at!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const move = async () => {
    if (!supabase || busy) return;
    if (!(await confirm({ title: `Show the latest approval on ${share.label}?`, body: `Anyone who opens this link will see the plans as approved now, instead of as approved by ${when}. The earlier approvals stay on record.`, confirmLabel: "Show the latest" }))) return;
    setBusy(true);
    const done = await publish(share.id, { repin: true }, "move the link on");
    setBusy(false);
    if (!done) return;
    haptic("success"); toast(`${share.label} shows the latest approval now.`); onSaved();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="vz-card-s">Shows the case as approved by {when}.</span>
      {isOwner && <button type="button" className="btn-ter" onClick={() => void move()} disabled={busy}>{busy ? "Moving…" : "Show the latest approval"}</button>}
    </div>
  );
}

/** A live link's state, from its records and the server's review (IMS8 P8): Live, or Changed since shared — what it sends
 *  differs from what sharing it now would send (by fingerprint, 0472). Read once per link, on showing it. */
function LiveState({ share }: { share: Share }) {
  const r = useAsyncData(async () => (supabase ? reviewLink(supabase, share.id, {}) : null), [share.id]);
  const st = linkPhase(share, r.data?.changed ?? null);
  // A review that couldn't be read says so — "Live" alone would claim it's unchanged.
  return <span className={`adm-substat ${st.phase === "changed" ? "past_due" : "active"}`}>{st.word}{r.error ? " · couldn't check for changes" : ""}</span>;
}

/** What changed since a link was shared, word for word, and the way to share the changes (IMS8 P8): review → confirm →
 *  publish, like every change. Until then the link keeps sending what was reviewed. */
function Changes({ share, onSaved }: { share: Share; onSaved: () => void }) {
  const { toast } = useAppStable();
  const publish = usePublishLink();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = useAsyncData(async () => {
    if (!supabase) return null;
    const rev = await reviewLink(supabase, share.id, {});
    if (!rev.changed && !rev.material.some((id) => id.startsWith("newer_approval:"))) return { rev, diff: null };
    const sent = await supabase.rpc("vision_share_preview", { p_share: share.id, p_draft: null });
    if (sent.error) throw new Error(sent.error.message);
    return { rev, diff: changesBetween(sent.data, rev.payload) };
  }, [share.id]);
  const newer = r.data?.rev.material.filter((id) => id.startsWith("newer_approval:")).length ?? 0;
  if (r.error) return <Said as="p" className="vz-card-s" assertive>Couldn&apos;t check whether it changed since it was shared. <button type="button" className="btn-ter" onClick={() => void r.reload()}>Try again</button></Said>;
  if (!r.data?.rev.changed && !newer) return null;
  const again = async () => {
    if (busy) return;
    setBusy(true);
    const done = await publish(share.id, {}, "share the changes");
    setBusy(false);
    if (!done) return;
    haptic("success"); toast(`The link for ${share.label} sends the changes now.`); onSaved();
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="vz-card-s">{r.data?.rev.changed ? "It still sends what you shared; the plan has changed since." : ""}{newer ? ` ${newer === 1 ? "A plan has" : `${newer} plans have`} a newer approved money case than the one it shows.` : ""}</p>
      {r.data?.diff && (
        <>
          <button type="button" className="btn-ter self-start max-w-full text-left whitespace-normal" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide what changed" : "What changed"}</button>
          {open && (r.data.diff.changes.length ? (
            <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{r.data.diff.changes.map((c) => (
              <li key={c.title}><b className="font-sans">{c.title}</b>{c.added.length ? ` — new: ${c.added.map((t) => `“${t}”`).join(", ")}` : ""}{c.removed.length ? ` — no longer: ${c.removed.map((t) => `“${t}”`).join(", ")}` : ""}{!c.added.length && !c.removed.length ? " — its numbers changed" : ""}</li>
            ))}</ul>
          ) : <p className="vz-card-s">{r.data.diff.numbersOnly ? "Numbers changed — no writing did." : "Nothing a person reads changed."}</p>)}
        </>
      )}
      {r.data?.rev.changed && <button type="button" className="btn-sec btn-sm self-start" onClick={() => void again()} disabled={busy}>{busy ? "Sharing…" : "Review and share the changes"}</button>}
    </div>
  );
}

/** How long a live link lives, changed (IMS8 P8) — through review and publish (the lifetime is part of what's reviewed). */
function Lifetime({ share, onSaved }: { share: Share; onSaved: () => void }) {
  const { toast } = useAppStable();
  const publish = usePublishLink();
  const [busy, setBusy] = useState(false);
  const change = async (days: number) => {
    if (busy) return;
    setBusy(true);
    const done = await publish(share.id, { days }, "change how long it lives");
    setBusy(false);
    if (!done) return;
    haptic("success"); toast(days ? `The link for ${share.label} ends in ${days} days.` : `The link for ${share.label} lives until you turn it off.`); onSaved();
  };
  return (
    <label className="prod-f max-w-xs"><span>It lives</span>
      <select value="" disabled={busy} onChange={(e) => { if (e.target.value) void change(Number(e.target.value)); }}>
        <option value="">{busy ? "Changing…" : "Change…"}</option>
        {ENDS_FOR_ROW.map((e) => <option key={e.key} value={String(e.days)}>{e.label}{e.days ? " from now" : ""}</option>)}
      </select>
    </label>
  );
}
