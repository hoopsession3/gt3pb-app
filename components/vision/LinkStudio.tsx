"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import Said from "@/components/Said";
import { failureWords } from "@/lib/failureWords";
import { haptic } from "@/lib/haptics";
import { publicOrigin } from "@/lib/native";
import { sendsSentence } from "@/lib/sharePreview";
import { draftChecks, isFor, payloadChecks, readinessOf, BAND_WORD, type PublishFinding, type Readiness } from "@/lib/publishReadiness";
import { isStale, publishLink, reviewLink, type Review } from "@/lib/sharePublish";
import { toVision } from "@/lib/visionRead";
import type { Plan } from "@/lib/visionPlans";
import type { Layout, Program } from "@/lib/vision";
import { EMPTY, ENDS, STEPS, STEP_WORD, readDraft, toPublish, writeDraft, type Step, type StudioDraft } from "@/lib/linkDraft";
import { AUDIENCES, AUDIENCE_MODE, AUDIENCE_WORD, recommend, storyOf } from "@/lib/linkStory";
import type { Dep } from "@/lib/visionPlans";

const LinkPreview = dynamic(() => import("./LinkPreview"), { ssr: false });
const Present = dynamic(() => import("./Present"), { ssr: false });

// THE PUBLISHING STUDIO (IMS8 P7). Four steps, one dominant action each: CHOOSE what it shows (nothing is chosen for you —
// A1), REVIEW what the database would send (vision_share_review: the verdict in one of three bands, the three findings
// that matter first, each material one ticked by you, the rest worth a look with a way to fix it and come back), PREVIEW
// it as the investor will see it (the presenter, fed the reviewed response itself) with every field inspected, then SHARE
// (vision_share_publish with that review's fingerprint and exactly the confirmed findings — 0472). Suggestions never stop
// you sharing; only what the database refuses, or an unticked confirmation, does. The draft — every choice, the step, the
// confirmations and the fingerprint they were given against — lives in this tab (sessionStorage), so a "fix it" and Back
// return to it; confirmations are kept only while the response is the same.
/** The lifetimes a live link can be given again (IMS8 P8): the studio's own. */
export const ENDS_FOR_ROW = ENDS;
const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export default function LinkStudio({ isOwner, plans, programs, layouts, deps = [], onMade, onGo }: {
  isOwner: boolean; plans: Plan[]; programs: Program[]; layouts: Pick<Layout, "id" | "name">[]; deps?: Dep[];
  onMade: () => void; onGo?: (go: NonNullable<PublishFinding["go"]>) => void;
}) {
  const { toast } = useAppStable();
  const [d, setD] = useState<StudioDraft>(() => readDraft() ?? EMPTY);
  useEffect(() => { writeDraft(d); }, [d]);
  const set = (p: Partial<StudioDraft>) => setD((x) => ({ ...x, ...p }));
  const shown = plans.filter((p) => p.shareable);
  const pub = toPublish(d, shown, isOwner);
  const before = draftChecks({ label: d.label, programs: d.programs, plans: pub.plan_ids ?? [], needs: pub.need_plans ?? [], rooms: d.rooms, money: pub.money_plans, showAsks: d.money },
    { canEdit: true, isOwner, programs: programs.map((p) => ({ id: p.id, title: p.title })), rooms: layouts.map((l) => ({ id: l.id, name: l.name })), plans: plans.map((p) => ({ id: p.id, name: p.name, program_id: p.program_id, shareable: p.shareable })) });
  const blocked = before.filter((f) => f.cls === "enforced" || f.cls === "approval");

  // The review: the database's answer for exactly this draft.
  const [review, setReview] = useState<Review | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [made, setMade] = useState<{ token: string; label: string } | null>(null);
  const ready: Readiness | null = review ? readinessOf([...before, ...payloadChecks(review.payload, { latestApproved: review.latest, privateNames: review.private_names, moneyPlans: pub.money_plans ?? [] })]) : null;
  // The server's material ids are what's bound; each said in our words (lib/publishReadiness finds the same ones).
  // The server's ids carry a hash of the exact content they're about (0472); a finding is matched by the rest (isFor).
  const material = review ? review.material.map((id) => ready?.all.find((f) => isFor(id, f.confirm)) ?? null) : [];
  const allConfirmed = !!review && review.material.every((id) => d.confirmed.includes(id));
  // READY TO PUBLISH (IMS8 P11) is said only when every confirmation is given AND the server, asked again, answers with the
  // same response and the same findings — never "reviewed" while a confirmation is still owed.
  const [validated, setValidated] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const status: "needs" | "checking" | "ready" | null = !review ? null : !allConfirmed ? "needs" : validated === review.fingerprint ? "ready" : "checking";

  const runReview = async (then: Step = "review") => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const r = await reviewLink(supabase, null, pub);
      // Confirmations stand only for the response they were given against; kept ones covering every finding of this
      // fresh server review make it Ready to publish (the server has just answered with the same response).
      const kept = d.reviewed === r.fingerprint ? d.confirmed.filter((id) => r.material.includes(id)) : [];
      setReview(r); setCheckedAt(new Date()); setValidated(r.material.every((id) => kept.includes(id)) ? r.fingerprint : null);
      setD((x) => ({ ...x, step: then, reviewed: r.fingerprint, confirmed: kept }));
    } catch (e) { haptic("error"); toast(failureWords(e as Error, "Couldn't review it"), "error"); }
    finally { setBusy(false); }
  };
  // Back from a "fix it" (or a reload) on a later step: the review is read again, never assumed.
  const resumed = useRef(false);
  useEffect(() => { if (!resumed.current && d.step !== "choose" && !review) { resumed.current = true; void runReview(d.step); } });
  // Every confirmation given: ask the server again. The same response and findings → Ready to publish; anything else is a
  // new review (its confirmations start again — they were for something that changed).
  const validate = async () => {
    if (!supabase || !review || validating) return;
    setValidating(true);
    try {
      const r = await reviewLink(supabase, null, pub);
      const same = r.fingerprint === review.fingerprint && JSON.stringify(r.material) === JSON.stringify(review.material);
      if (same) setValidated(r.fingerprint);
      else { setReview(r); setCheckedAt(new Date()); setValidated(r.material.length === 0 ? r.fingerprint : null); setD((x) => ({ ...x, reviewed: r.fingerprint, confirmed: [] })); toast("It changed since you reviewed it — here it is again, to confirm.", "error"); }
    } catch (e) { toast(failureWords(e as Error, "Couldn't check it"), "error"); }
    finally { setValidating(false); }
  };
  // Ticking a box: when it's the last one owed, the server is asked again (validate).
  const flipConfirm = (id: string) => {
    const next = flip(d.confirmed, id);
    set({ confirmed: next });
    if (review && review.material.every((x) => next.includes(x))) void validate();
  };
  // A choice changed after review: back to Choose — the review was of something else.
  const edit = (p: Partial<StudioDraft>) => { set({ ...p, step: "choose" }); setReview(null); };

  const share = async () => {
    if (!supabase || !review || busy || status !== "ready") return;
    setBusy(true);
    try {
      const out = await publishLink(supabase, null, pub, review, review.material);
      // A1: a link made clears every choice; the next link inherits nothing.
      setMade({ token: out.token, label: pub.label ?? "" }); setD(EMPTY); setReview(null); onMade();
      haptic("success");
      try { await navigator.clipboard.writeText(`${publicOrigin()}/present#${out.token}`); toast(`Made and copied — the link for ${pub.label}.`); } catch { toast(`Made — the link for ${pub.label}.`); }
    } catch (e) {
      haptic("error");
      // A refusal shares nothing and keeps the draft; one because it changed is reviewed again.
      if (isStale(e)) { toast("It changed since you reviewed it — nothing was shared. Here it is again, to confirm.", "error"); setReview(null); void runReview("share"); }
      else toast(failureWords(e as Error, "Couldn't make the link"), "error");
    } finally { setBusy(false); }
  };

  const step = d.step, n = STEPS.indexOf(step) + 1;
  const head = useRef<HTMLHeadingElement>(null);
  const prevStep = useRef(step);
  useEffect(() => { if (prevStep.current !== step) { prevStep.current = step; head.current?.focus(); } }, [step]);
  const approved = useAsyncData(async (): Promise<Set<string>> => {
    if (!supabase || !isOwner) return new Set();
    const { data, error } = await supabase.from("vision_plan_money").select("plan_id").not("baseline", "is", null);
    if (error) throw new Error(error.message);
    return new Set(((data ?? []) as { plan_id: string }[]).map((r) => r.plan_id));
  }, [isOwner]);

  if (made) return (
    <div className="ls vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label="Link made">
      <Said as="p" className="sr-only">The link for {made.label} is made.</Said>
      <b className="font-sans text-subhead">The link for {made.label} is made.</b>
      <p className="vz-card-s">It sends what you reviewed. Edits you make from now on wait until you review and share it again; turning it off works at once.</p>
      <span className="flex flex-wrap gap-2">
        <button type="button" className="btn-sec btn-sm" onClick={() => { void navigator.clipboard.writeText(`${publicOrigin()}/present#${made.token}`).then(() => toast("Copied."), () => toast(`${publicOrigin()}/present#${made.token}`)); }}>Copy the link</button>
        <button type="button" className="btn-ter" onClick={() => setMade(null)}>Make another</button>
      </span>
    </div>
  );

  return (
    <div className="ls vz-insp mpanel mb-0 flex flex-col gap-3 p-3.5" aria-label="Make a link">
      {/* The one live region: it stays, and its words change with the step, the verdict and what stops Review (A11Y F12). */}
      <p className="sr-only" aria-live="polite">{`Step ${n} of 4, ${STEP_WORD[step]}.${ready && step === "review" ? ` ${ready.verdict}.` : ""}${status === "ready" ? " Ready to publish." : ""}${step === "choose" && blocked.length ? ` ${BAND_WORD.cant}: ${blocked.length === 1 ? "one thing" : `${blocked.length} things`} to fix.` : ""}`}</p>
      <div className="flex flex-col gap-1">
        <span className="vp-prog ls-steps" aria-hidden="true">{STEPS.map((s, i) => <i key={s} className={i < n ? "on" : undefined} />)}</span>
        <h2 ref={head} tabIndex={-1} className="ls-h">Step {n} of 4 · {STEP_WORD[step]}</h2>
        {JSON.stringify({ ...d, step: "choose", confirmed: [], reviewed: null }) !== JSON.stringify(EMPTY) && <span className="vz-card-s">Draft · kept on this device only, until it&apos;s shared</span>}
        {status && step !== "choose" && <span className={status === "ready" ? "ls-status ready" : "ls-status needs"}>{status === "ready" ? "Ready to publish" : status === "checking" ? "Checking it's still what you reviewed…" : `Needs confirmation · ${review!.material.filter((id) => !d.confirmed.includes(id)).length} to go`}</span>}
      </div>

      {step === "choose" && (
        <>
          <label className="prod-f"><span>Who it&apos;s for</span><input value={d.label} maxLength={80} onChange={(e) => edit({ label: e.target.value })} placeholder="e.g. Upstate investors" /></label>
          <ShowsPicker programs={programs} layouts={layouts} pickPrograms={d.programs} setPickPrograms={(f) => setD((x) => ({ ...x, step: "choose", programs: f(x.programs) }))} pickRooms={d.rooms} setPickRooms={(f) => setD((x) => ({ ...x, step: "choose", rooms: f(x.rooms) }))}
            plans={shown} pickPlans={d.plans} setPickPlans={(f) => setD((x) => ({ ...x, step: "choose", plans: f(x.plans) }))} pickNeeds={d.needs} setPickNeeds={(f) => setD((x) => ({ ...x, step: "choose", needs: f(x.needs) }))}
            cases={isOwner ? { approved: approved.data ?? new Set(), pickCases: d.cases, pickResearch: d.research, flipCase: (id) => edit({ cases: flip(d.cases, id) }), flipResearch: (id) => edit({ research: flip(d.research, id) }) } : null} />
          {(() => {
            // IMS8 P9: plans worth adding, ranked from recorded facts and the audience's order — a tap adds one; nothing is added for you.
            const sug = recommend({ plans: shown.map((p) => ({ id: p.id, name: p.name, program_id: p.program_id, shareable: p.shareable, phase: p.phase, layout_id: p.layout_id, deal: p.deal, sqft: p.sqft })),
              deps, approved: approved.data ?? new Set(), picked: d.plans, programs: d.programs, audience: d.audience }).slice(0, 3);
            return (
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Who it's for, to order suggestions and the preview">
                  <span className="vz-card-s">For</span>
                  {AUDIENCES.map((a) => <button key={a} type="button" role="radio" aria-checked={d.audience === a} className={`k-chip${d.audience === a ? " on" : ""}`} onClick={() => set({ audience: d.audience === a ? null : a })}>{AUDIENCE_WORD[a]}</button>)}
                </div>
                {sug.length > 0 && <>
                  <b className="font-sans text-subhead mt-1">Worth adding</b>
                  {sug.map((x) => <div key={x.id} className="ls-find"><span>{x.name} · <i>{x.reason}</i></span><button type="button" className="btn-ter" onClick={() => edit({ plans: [...d.plans, x.id] })}>Add</button></div>)}
                </>}
              </div>
            );
          })()}
          {approved.error && <Said as="p" className="vz-card-s" assertive>Couldn&apos;t read which plans have an approved money case — their money can&apos;t be chosen until it&apos;s read. <button type="button" className="btn-ter" onClick={() => void approved.reload()}>Try again</button></Said>}
          <label className="prod-toggle"><input type="checkbox" checked={d.money} onChange={(e) => edit({ money: e.target.checked })} /> Show where capital may be needed (the asks)</label>
          <label className="prod-f"><span>It lives</span><select value={d.ends} onChange={(e) => edit({ ends: e.target.value })}>{ENDS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
          {blocked.length > 0 && <Band items={blocked} />}
        </>
      )}

      {step !== "choose" && !review && <Said as="p" className="vz-card-s">Reading it again — the review is never assumed…</Said>}

      {step === "review" && ready && review && (
        <>
          <div className={ready.band === "cant" ? "ls-verdict cant" : ready.band === "confirm" ? "ls-verdict confirm" : "ls-verdict ready"}><b>{ready.verdict}</b></div>
          {review.material.length > 0 && <Confirms ids={review.material} material={material} confirmed={d.confirmed} onFlip={flipConfirm} onGo={onGo} />}
          {(() => {
            const look = ready.all.filter((f) => f.cls === "concern" || f.cls === "editorial");
            const first = look.slice(0, Math.max(0, 3 - material.length)), rest = look.slice(first.length);
            return look.length > 0 && (
              <div className="ls-look flex flex-col gap-1">
                <b className="font-sans">Worth a look <span className="vz-card-s">· suggestions never stop you sharing</span></b>
                {[...first, ...(more ? rest : [])].map((f) => <Finding key={f.id} f={f} onGo={onGo} />)}
                {rest.length > 0 && <button type="button" className="btn-ter self-start" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? "Fewer" : `${rest.length} more`}</button>}
              </div>
            );
          })()}
        </>
      )}

      {step === "preview" && review && (
        <>
          <p className="vz-card-s">{sendsSentence(review.payload)}</p>
          <button type="button" className="btn-sec self-start" onClick={() => setPresenting(true)}>▶ See it as they will</button>
          <LinkPreview payload={review.payload} diag={{ fingerprint: review.fingerprint, checkedAt }} />
          {(() => {
            // IMS8 P9: the story the response tells — facts, each with its source; a suggested opening apart, yours to change.
            const story = storyOf(review.payload);
            return story.facts.length > 0 && (
              <details className="ls-story">
                <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">The story, from its facts</b> · {story.facts.length}</summary>
                <ul className="flex flex-col gap-1.5 pl-1">{story.facts.map((f, i) => <li key={i} className="ls-fact"><span>{f.says}</span><small>{f.source}</small></li>)}</ul>
                {story.suggested && <div className="ls-suggest"><small>Suggested wording — yours to change; it isn&apos;t sent</small><p>{story.suggested}</p>
                  <button type="button" className="btn-ter self-start" onClick={() => { void navigator.clipboard.writeText(story.suggested!).then(() => toast("Copied."), () => toast(story.suggested!)); }}>Copy it</button></div>}
              </details>
            );
          })()}
          {presenting && <Present vision={toVision(review.payload)} forWhom={pub.label ?? null} exitLabel="Back to the studio" onExit={() => setPresenting(false)} initialMode={d.audience ? AUDIENCE_MODE[d.audience] : "pitch"} />}
        </>
      )}

      {step === "share" && review && (
        <>
          <p className="vz-card-s">{sendsSentence(review.payload)}</p>
          <p className="vz-card-s">It sends exactly what you reviewed. Edits you make after sharing wait until you review and share it again{pub.money_plans?.length ? "; the money case stays as approved by today" : ""}. It lives {(ENDS.find((e) => e.key === d.ends)?.label ?? "30 days").toLowerCase()}, and turning it off works at once.</p>
          {review.material.length > 0 && (allConfirmed
            ? <p className="vz-card-s">You confirmed {review.material.length === 1 ? "one thing" : `${review.material.length} things`}; they&apos;re kept with the link.</p>
            : <Confirms ids={review.material} material={material} confirmed={d.confirmed} onFlip={flipConfirm} onGo={onGo} />)}
        </>
      )}

      <div className="ls-foot">
        {step !== "choose" && <button type="button" className="btn-sec" onClick={() => set({ step: STEPS[n - 2] })} disabled={busy}>Back</button>}
        {step === "choose" && <button type="button" className="btn-pri" onClick={() => void runReview()} disabled={busy || blocked.length > 0}>{busy ? "Reviewing…" : "Review what it sends"}</button>}
        {/* Preview is open before confirmations — seeing it may be how the owner decides (IMS8 P11). */}
        {step === "review" && <button type="button" className="btn-pri" onClick={() => set({ step: "preview" })} disabled={busy || !review}>Preview it</button>}
        {step === "preview" && <button type="button" className="btn-pri" onClick={() => set({ step: "share" })} disabled={busy || !review}>Ready to share</button>}
        {step === "share" && <button type="button" className="btn-pri" onClick={() => void share()} disabled={busy || status !== "ready"}>{busy ? "Creating…" : status === "needs" ? "Confirm above to create" : status === "checking" ? "Checking…" : "Create the link"}</button>}
      </div>
    </div>
  );
}

/** What must be confirmed, each in full: a flagged passage word for word with where it is, said to go into the public link
 *  as written, and a way to edit it; anything else in its own words. Each box is for that exact content (0472). */
function Confirms({ ids, material, confirmed, onFlip, onGo }: { ids: string[]; material: (PublishFinding | null)[]; confirmed: string[]; onFlip: (id: string) => void; onGo?: (go: NonNullable<PublishFinding["go"]>) => void }) {
  return (
    <fieldset className="ls-confirm flex flex-col gap-3">
      <legend className="font-sans font-bold">Confirm before it&apos;s created</legend>
      {ids.map((id, i) => {
        const f = material[i], words = f?.rule === "internal_words";
        return (
          <div key={id} className="flex flex-col gap-1">
            {f ? <span>{f.words}</span> : <span>Something to confirm ({id.split(":")[0].replace(/_/g, " ")}).</span>}
            {words && f!.evidence.map((e, j) => <blockquote key={j} className="ls-passage"><span>{e.says}</span><small>{e.source}</small></blockquote>)}
            {f?.go && onGo && <button type="button" className="btn-ter self-start" onClick={() => onGo(f.go!)}>{f.action ?? "Fix it"} ›</button>}
            <label className="prod-toggle ls-check"><input type="checkbox" checked={confirmed.includes(id)} onChange={() => onFlip(id)} />
              <span>{words ? "Include these words in the public link exactly as written" : f?.rule === "asks_unset" ? "Show them as being priced" : f?.rule === "uses_unpriced" ? "Show these lines without a price" : f?.rule === "newer_approval" ? "Keep the version this link shows" : "Share it as it is"}</span></label>
          </div>
        );
      })}
    </fieldset>
  );
}

function Band({ items }: { items: PublishFinding[] }) {
  return (
    <div className="ls-verdict cant">
      <b><span aria-hidden="true">🔒 </span>{BAND_WORD.cant}</b>
      <ul className="flex flex-col gap-1 pl-4 list-disc">{items.map((f) => <li key={f.id}>{f.words}</li>)}</ul>
    </div>
  );
}

function Finding({ f, onGo }: { f: PublishFinding; onGo?: (go: NonNullable<PublishFinding["go"]>) => void }) {
  return (
    <div className="ls-find">
      <span>{f.words}</span>
      {f.go && onGo && <button type="button" className="btn-ter" onClick={() => onGo(f.go!)}>{f.action ?? "Open it"} ›</button>}
    </div>
  );
}

/** The roadmap programs, plans (and their needs, money and research) and store rooms a link shows, as ticks — when
 *  making a link and when changing one (0455, 0467). Nothing is ticked for you. */
export function ShowsPicker({ programs, layouts, pickPrograms, setPickPrograms, pickRooms, setPickRooms, plans = null, pickPlans = [], setPickPlans, pickNeeds = [], setPickNeeds, cases = null }: {
  programs: Program[]; layouts: Pick<Layout, "id" | "name">[];
  pickPrograms: string[]; setPickPrograms: (f: (l: string[]) => string[]) => void; pickRooms: string[]; setPickRooms: (f: (l: string[]) => string[]) => void;
  plans?: Plan[] | null; pickPlans?: string[]; setPickPlans?: (f: (l: string[]) => string[]) => void; pickNeeds?: string[]; setPickNeeds?: (f: (l: string[]) => string[]) => void;
  cases?: { approved: Set<string>; pickCases: string[]; pickResearch: string[]; flipCase: (id: string) => void; flipResearch: (id: string) => void } | null;
}) {
  const under = (plans ?? []).filter((p) => p.program_id && pickPrograms.includes(p.program_id));
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
            {cases && <label className="prod-toggle pl-6"><input type="checkbox" disabled={!pickPlans.includes(p.id) || !cases.approved.has(p.id)} checked={cases.pickCases.includes(p.id)} onChange={() => cases.flipCase(p.id)} /> Its approved money case{cases.approved.has(p.id) ? "" : " — none approved yet"}</label>}
            {cases && <label className="prod-toggle pl-6"><input type="checkbox" disabled={!pickPlans.includes(p.id)} checked={cases.pickResearch.includes(p.id)} onChange={() => cases.flipResearch(p.id)} /> Its accepted research, with sources</label>}
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
