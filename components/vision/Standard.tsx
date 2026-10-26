"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import AsyncSection from "@/components/AsyncSection";
import { Segmented } from "@/components/controls";
import Said from "@/components/Said";
import { failureWords } from "@/lib/failureWords";
import { haptic } from "@/lib/haptics";
import { isMissingRelation, isMissingTable } from "@/lib/schemaSkew";
import type { Layout } from "@/lib/vision";
import {
  EVIDENCE_KINDS, EVIDENCE_KIND_WORD, OUTCOME_TAG, OUTCOME_WORD, PILLARS, PILLAR_WORD, SEVERITY_WORD, STATE_WORD, SUBJECT_WORD,
  canCarryPass, evidenceState, isProhibited, parseMeasures, passBlockers, summaryWords,
  type Assessment, type Claim, type Criterion, type Evidence, type ItemMaterial, type Material, type Outcome, type Review, type Severity,
  type StdPillar, type Subject, type Summary, type Version,
} from "@/lib/standard";

// THE PRIMAL STANDARD, INSIDE (P1, 0456). Owners and admins only. What needs attention first (stale judgements, open
// reviews, evidence waiting, failures), then the evidence, the materials, the claims and the criteria. The database is
// the judge: a pass needs accepted, in-date evidence with its measurements; nobody reviews their own evidence; a
// published version never changes; a prohibited claim is never supported. This screen says why before you press.

type Data = { me: string | null; versions: Version[]; criteria: Criterion[]; materials: Material[]; links: ItemMaterial[]; evidence: Evidence[]; assessments: Assessment[]; claims: Claim[]; reviews: Review[]; summary: (Summary & { subject_type: Subject; subject_id: string })[] };
type Section = "attention" | "evidence" | "materials" | "claims" | "criteria";

async function readStandard(): Promise<Data | "missing"> {
  if (!supabase) throw new Error("Supabase client not configured");
  // arrives-with: 0456 — std_*: before 0456 the screen says so
  const [me, v, c, m, l, e, a, cl, r, s] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("std_versions").select("*").order("created_at", { ascending: false }),
    supabase.from("std_criteria").select("*").order("pillar").order("sort").order("code"),
    supabase.from("std_materials").select("*").order("name"),
    supabase.from("std_item_materials").select("id, item_id, material_id, role"),
    supabase.from("std_evidence").select("*").order("created_at", { ascending: false }),
    supabase.from("std_assessments").select("*").is("superseded_by", null).order("assessed_at", { ascending: false }),
    supabase.from("std_claims").select("*").order("created_at", { ascending: false }),
    supabase.from("std_reviews").select("*").eq("status", "open").order("created_at", { ascending: false }),
    supabase.from("std_subject_summary").select("*"),
  ]);
  const errs = [v, c, m, l, e, a, cl, r, s].map((x) => x.error).filter(Boolean);
  if (errs.some((x) => isMissingTable(x) || isMissingRelation(x))) return "missing";
  if (errs[0]) throw new Error(errs[0]!.message);
  return { me: me.data.user?.id ?? null, versions: v.data as Version[], criteria: c.data as Criterion[], materials: m.data as Material[], links: l.data as ItemMaterial[], evidence: e.data as Evidence[], assessments: a.data as Assessment[], claims: cl.data as Claim[], reviews: r.data as Review[], summary: (s.data ?? []).map((x) => ({ ...x, passes: Number(x.passes), conditionals: Number(x.conditionals), fails: Number(x.fails), unknowns: Number(x.unknowns), stale: Number(x.stale) })) as Data["summary"] };
}

export default function Standard({ layouts, isOwner }: { layouts: Layout[]; isOwner: boolean }) {
  const loader = useCallback(() => readStandard(), []);
  const state = useAsyncData(loader, []);
  const [section, setSection] = useState<Section>("attention");
  return (
    <div className="flex flex-col gap-3">
      <p className="vz-sub">The Primal Standard, inside: what a room, an object or a material is judged against, the evidence, and the judgement. Unknown is never safe, and missing evidence never passes.</p>
      <Segmented label="The Standard" kind="choice" value={section} onChange={setSection}
        options={[{ key: "attention", label: "Needs attention" }, { key: "evidence", label: "Evidence" }, { key: "materials", label: "Materials" }, { key: "claims", label: "Claims" }, { key: "criteria", label: "Criteria" }]} />
      <AsyncSection state={state} isEmpty={() => false} emptyTitle="Nothing yet" loadingLabel="Loading the Standard…" errorTitle="Couldn't load the Standard" errorSub="This is not an empty Standard — we couldn't read it just now.">
        {(d) => d === "missing"
          ? <p className="vz-sub">The Standard arrives with the next database update (0456).</p>
          : <Body d={d} section={section} layouts={layouts} isOwner={isOwner} reload={state.reload} />}
      </AsyncSection>
    </div>
  );
}

function Body({ d, section, layouts, isOwner, reload }: { d: Data; section: Section; layouts: Layout[]; isOwner: boolean; reload: () => void }) {
  const { toast } = useAppStable();
  const items = useMemo(() => layouts.flatMap((l) => l.items.map((i) => ({ ...i, layoutId: l.id, layoutName: l.name }))), [layouts]);
  const nameOf = useCallback((t: string, id: string) => {
    if (t === "room") return layouts.find((l) => l.id === id)?.name ?? "A room";
    if (t === "object") { const i = items.find((x) => x.id === id); return i ? `${i.label || i.kind} · ${i.layoutName}` : "A removed object"; }
    if (t === "material") return d.materials.find((m) => m.id === id)?.name ?? "A material";
    return "GT3";
  }, [layouts, items, d.materials]);
  const subjects = useMemo(() => [
    ...layouts.map((l) => ({ type: "room" as Subject, id: l.id, name: l.name })),
    ...items.map((i) => ({ type: "object" as Subject, id: i.id, name: `${i.label || i.kind} · ${i.layoutName}` })),
    ...d.materials.filter((m) => !m.archived_at).map((m) => ({ type: "material" as Subject, id: m.id, name: m.name })),
  ], [layouts, items, d.materials]);
  const run = async (what: string, p: PromiseLike<{ error: { message: string; code?: string } | null }>, done?: string) => {
    const { error } = await p;
    if (error) { toast(failureWords(error, `Couldn't ${what}`), "error"); haptic("error"); return false; }
    haptic("success"); if (done) toast(done); reload(); return true;
  };
  const sb = supabase!;
  if (section === "attention") return <Attention d={d} nameOf={nameOf} isOwner={isOwner} run={run} />;
  if (section === "evidence") return <EvidencePanel d={d} subjects={subjects} nameOf={nameOf} isOwner={isOwner} run={run} sb={sb} />;
  if (section === "materials") return <Materials d={d} items={items} run={run} sb={sb} />;
  if (section === "claims") return <Claims d={d} isOwner={isOwner} run={run} sb={sb} />;
  return <Criteria d={d} subjects={subjects} isOwner={isOwner} run={run} sb={sb} />;
}

type Run = (what: string, p: PromiseLike<{ error: { message: string; code?: string } | null }>, done?: string) => Promise<boolean>;
type Sb = NonNullable<typeof supabase>;
type SubjectRef = { type: Subject; id: string; name: string };

function Attention({ d, nameOf, isOwner, run }: { d: Data; nameOf: (t: string, id: string) => string; isOwner: boolean; run: Run }) {
  const stale = d.assessments.filter((a) => a.stale_at);
  const waiting = d.evidence.filter((e) => e.review_status === "submitted");
  const worst = d.summary.filter((s) => s.critical_fail || s.fails > 0 || s.serious_unknown);
  const crit = (id: string) => d.criteria.find((c) => c.id === id);
  if (!stale.length && !waiting.length && !worst.length && !d.reviews.length) return <p className="vz-sub">Nothing needs attention. Every judgement is current and every piece of evidence is reviewed.</p>;
  return (
    <div className="flex flex-col gap-3">
      {worst.length > 0 && <Group title="Not met, or a serious unknown" note="Shown first and never folded into a total.">
        {worst.map((s) => { const w = summaryWords(s); return <div key={s.subject_type + s.subject_id} className="vz-obs"><span>{nameOf(s.subject_type, s.subject_id)}</span><span className={w.tag}>{w.word}</span></div>; })}
      </Group>}
      {stale.length > 0 && <Group title={`Stale — ${stale.length}`} note="Something it depended on changed. The judgement stands as history until an owner reassesses it.">
        {stale.map((a) => <div key={a.id} className="vz-obs"><span>{crit(a.criterion_id)?.code} {crit(a.criterion_id)?.title} · {nameOf(a.subject_type, a.subject_id)}</span><span className="vz-card-s">{a.stale_reason}</span></div>)}
      </Group>}
      {waiting.length > 0 && <Group title={`Evidence waiting for review — ${waiting.length}`} note="It counts for nothing until an owner who didn't submit it accepts it. Review it under Evidence.">
        {waiting.map((e) => <div key={e.id} className="vz-obs"><span>{e.summary}</span><span className="vz-card-s">{nameOf(e.subject_type, e.subject_id)} · {EVIDENCE_KIND_WORD[e.kind]}</span></div>)}
      </Group>}
      {d.reviews.length > 0 && <Group title={`Open reviews — ${d.reviews.length}`} note="Questions the Standard raised. A watch-list match is a question about exposure, not a verdict.">
        {d.reviews.map((r) => <div key={r.id} className="vz-obs"><span>{nameOf(r.subject_type, r.subject_id)}</span><span className="vz-card-s">{r.reason}</span>
          {isOwner && <button type="button" className="btn-ter self-start" onClick={() => void run("close the review", supabase!.from("std_reviews").update({ status: "closed" }).eq("id", r.id), "Review closed.")}>Close — reviewed</button>}</div>)}
      </Group>}
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label={title}><b className="font-sans text-subhead">{title}</b>{note && <p className="vz-card-s">{note}</p>}{children}</section>;
}

function SubjectPick({ value, onChange, subjects, only }: { value: string; onChange: (v: string) => void; subjects: SubjectRef[]; only?: Subject }) {
  const list = only ? subjects.filter((s) => s.type === only) : subjects;
  return (
    <label className="prod-f"><span>About</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {(["room", "object", "material"] as Subject[]).filter((t) => !only || t === only).map((t) => (
          <optgroup key={t} label={SUBJECT_WORD[t]}>{list.filter((s) => s.type === t).map((s) => <option key={s.id} value={`${s.type}:${s.id}`}>{s.name}</option>)}</optgroup>
        ))}
      </select>
    </label>
  );
}

function EvidencePanel({ d, subjects, nameOf, isOwner, run, sb }: { d: Data; subjects: SubjectRef[]; nameOf: (t: string, id: string) => string; isOwner: boolean; run: Run; sb: Sb }) {
  const [about, setAbout] = useState("");
  const [kind, setKind] = useState<Evidence["kind"]>("measured");
  const [bearing, setBearing] = useState<Evidence["bearing"]>("supports");
  const [summary, setSummary] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [measures, setMeasures] = useState("");
  const [expires, setExpires] = useState("");
  const [confidence, setConfidence] = useState<Evidence["confidence"]>("low");
  const [limits, setLimits] = useState("");
  const parsed = parseMeasures(measures);
  const urlBad = url.trim() !== "" && !/^https:\/\//.test(url.trim());
  const submit = async () => {
    const [t, id] = about.split(":");
    const ok = await run("submit the evidence", sb.from("std_evidence").insert({ subject_type: t, subject_id: id, kind, bearing, summary: summary.trim(), source_url: url.trim() || null, source_title: title.trim() || null, source_date: date || null, measures: parsed.measures, expires_on: expires || null, confidence, limitations: limits.trim() || null }), "Submitted. It counts once another owner accepts it.");
    if (ok) { setSummary(""); setUrl(""); setTitle(""); setMeasures(""); setLimits(""); }
  };
  const review = (e: Evidence, status: "accepted" | "rejected") => run("review the evidence", sb.from("std_evidence").update({ review_status: status }).eq("id", e.id), status === "accepted" ? "Accepted." : "Rejected.");
  return (
    <div className="flex flex-col gap-3">
      <Group title="Submit evidence" note="It arrives unreviewed. Say what kind it is — illustrative material is labelled and never carries a pass.">
        <SubjectPick value={about} onChange={setAbout} subjects={subjects} />
        <label className="prod-f"><span>Kind</span><select value={kind} onChange={(e) => setKind(e.target.value as Evidence["kind"])}>{EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{EVIDENCE_KIND_WORD[k]}</option>)}</select></label>
        <label className="prod-f"><span>It</span><select value={bearing} onChange={(e) => setBearing(e.target.value as Evidence["bearing"])}><option value="supports">Supports meeting the Standard</option><option value="contradicts">Weighs against it</option><option value="neutral">Neither — context</option></select></label>
        <label className="prod-f"><span>What it shows</span><textarea value={summary} maxLength={1000} rows={2} onChange={(e) => setSummary(e.target.value)} /></label>
        <label className="prod-f"><span>Measurements (name=value, comma-separated)</span><input value={measures} placeholder="cct=2700, flicker_pct=0.5" onChange={(e) => setMeasures(e.target.value)} /></label>
        {parsed.bad.length > 0 && <Said as="p" className="vz-issue warn">Not read as measurements: {parsed.bad.join(", ")}</Said>}
        <label className="prod-f"><span>Source address (https)</span><input value={url} inputMode="url" onChange={(e) => setUrl(e.target.value)} /></label>
        {urlBad && <Said as="p" className="vz-issue warn">The address must start with https://</Said>}
        <label className="prod-f"><span>Source title</span><input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="prod-f"><span>Source date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="prod-f"><span>Expires</span><input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        </div>
        <label className="prod-f"><span>Confidence</span><select value={confidence} onChange={(e) => setConfidence(e.target.value as Evidence["confidence"])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label className="prod-f"><span>Limitations</span><textarea value={limits} maxLength={1000} rows={2} placeholder="What it doesn't cover — the sample, the conditions, who measured it" onChange={(e) => setLimits(e.target.value)} /></label>
        <button type="button" className="btn-sec btn-sm self-start" disabled={!about || !summary.trim() || urlBad} onClick={() => void submit()}>Submit for review</button>
      </Group>
      <Group title="All evidence" note={isOwner ? "Accept or reject what someone else submitted. Your own waits for another owner." : "Owners review evidence; nobody reviews their own."}>
        {d.evidence.length === 0 && <p className="vz-card-s">No evidence yet.</p>}
        {d.evidence.map((e) => { const st = evidenceState(e); return (
          <div key={e.id} className="vz-obs">
            <span>{e.summary}{Object.keys(e.measures ?? {}).length > 0 && <> · <b>{Object.entries(e.measures).map(([k, v]) => `${k} ${String(v)}`).join(", ")}</b></>}</span>
            <span className="vz-card-s">{nameOf(e.subject_type, e.subject_id)} · {e.bearing === "contradicts" ? "weighs against" : e.bearing === "neutral" ? "context" : "supports"} · confidence {e.confidence}{e.source_url ? <> · <a href={e.source_url} target="_blank" rel="noopener noreferrer">{e.source_title || "source"}</a></> : null}{e.source_date ? ` · ${e.source_date}` : ""}{e.expires_on ? ` · expires ${e.expires_on}` : ""}</span>
            {e.limitations && <span className="vz-card-s">Limitations: {e.limitations}</span>}
            <div className="flex flex-wrap items-center gap-2">
              <span className={st === "measured" || st === "observed" ? "k-tag ok" : st === "rejected" || st === "expired" ? "k-tag warn" : "k-tag"}>{STATE_WORD[st]}</span>
              {isOwner && e.review_status === "submitted" && (e.submitted_by === d.me
                ? <span className="vz-card-s">You submitted this — another owner reviews it.</span>
                : <><button type="button" className="btn-ter" onClick={() => void review(e, "accepted")}>Accept</button><button type="button" className="btn-ter" onClick={() => void review(e, "rejected")}>Reject</button></>)}
              {isOwner && e.review_status === "accepted" && e.submitted_by !== d.me && <button type="button" className="btn-ter" onClick={() => void review(e, "rejected")}>Reject — it marks what relied on it stale</button>}
            </div>
          </div>); })}
      </Group>
    </div>
  );
}

function Materials({ d, items, run, sb }: { d: Data; items: { id: string; label: string | null; kind: string; layoutName: string }[]; run: Run; sb: Sb }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("surface");
  const [maker, setMaker] = useState("");
  const [composition, setComposition] = useState("");
  const [watch, setWatch] = useState("");
  const [linkItem, setLinkItem] = useState("");
  const [linkMat, setLinkMat] = useState("");
  const summaryOf = (id: string) => d.summary.find((s) => s.subject_type === "material" && s.subject_id === id);
  const add = async () => {
    const ok = await run("add the material", sb.from("std_materials").insert({ name: name.trim(), category, maker: maker.trim() || null, composition: composition.trim() || null, watch_list: watch.split(",").map((x) => x.trim()).filter(Boolean) }), "Added to the registry.");
    if (ok) { setName(""); setMaker(""); setComposition(""); setWatch(""); }
  };
  return (
    <div className="flex flex-col gap-3">
      <Group title="Add a material" note="What it's made of, as the maker declares it. A watch-list substance opens a review — a question about exposure, not a verdict.">
        <label className="prod-f"><span>Name</span><input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></label>
        <label className="prod-f"><span>Category</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{["surface", "finish", "textile", "furniture", "fixture", "lighting", "equipment", "packaging", "ingredient", "other"].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>
        <label className="prod-f"><span>Maker</span><input value={maker} maxLength={160} onChange={(e) => setMaker(e.target.value)} /></label>
        <label className="prod-f"><span>Composition (as declared)</span><textarea value={composition} rows={2} maxLength={2000} onChange={(e) => setComposition(e.target.value)} /></label>
        <label className="prod-f"><span>Watch-list substances declared (comma-separated)</span><input value={watch} onChange={(e) => setWatch(e.target.value)} /></label>
        <button type="button" className="btn-sec btn-sm self-start" disabled={!name.trim()} onClick={() => void add()}>Add material</button>
      </Group>
      <Group title="What an object is made of" note="Changing an object's material is a substitution: its judgements, and its room's, go stale.">
        <label className="prod-f"><span>Object</span><select value={linkItem} onChange={(e) => setLinkItem(e.target.value)}><option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label || i.kind} · {i.layoutName}</option>)}</select></label>
        <label className="prod-f"><span>Material</span><select value={linkMat} onChange={(e) => setLinkMat(e.target.value)}><option value="">Choose…</option>{d.materials.filter((m) => !m.archived_at).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <button type="button" className="btn-sec btn-sm self-start" disabled={!linkItem || !linkMat} onClick={() => void run("link the material", sb.from("std_item_materials").insert({ item_id: linkItem, material_id: linkMat }), "Linked.")}>Link</button>
        {d.links.map((l) => { const i = items.find((x) => x.id === l.item_id); const m = d.materials.find((x) => x.id === l.material_id); return (
          <div key={l.id} className="vz-obs"><span>{i ? `${i.label || i.kind} · ${i.layoutName}` : "A removed object"} — {m?.name ?? "?"}</span>
            <button type="button" className="btn-ter self-start" onClick={() => void run("remove the link", sb.from("std_item_materials").delete().eq("id", l.id), "Removed — the object's judgements are stale.")}>Remove</button></div>); })}
      </Group>
      <Group title={`The registry — ${d.materials.length}`}>
        {d.materials.map((m) => { const w = summaryWords(summaryOf(m.id)); return (
          <div key={m.id} className="vz-obs"><span>{m.name}{m.maker ? ` · ${m.maker}` : ""}</span>
            <span className="vz-card-s">{m.category}{m.watch_list.length ? ` · declares ${m.watch_list.join(", ")}` : ""}{m.archived_at ? " · archived" : ""}</span>
            <span className={w.tag}>{w.word}</span></div>); })}
      </Group>
    </div>
  );
}

function Claims({ d, isOwner, run, sb }: { d: Data; isOwner: boolean; run: Run; sb: Sb }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Claim["kind"]>("aspiration");
  const [pick, setPick] = useState<Record<string, string>>({});
  const bad = isProhibited(text);
  return (
    <div className="flex flex-col gap-3">
      <Group title="Write a claim" note="Every claim starts unverified. An aspiration stays an aspiration; scientific and medical claims need measured or observed evidence.">
        <label className="prod-f"><span>The words</span><textarea value={text} rows={2} maxLength={600} onChange={(e) => setText(e.target.value)} /></label>
        {bad && <Said as="p" className="vz-issue warn">GT3 can never support this wording (for example toxin-free, detox, disease prevention, genome). It can be kept as an unverified hypothesis or aspiration only.</Said>}
        <label className="prod-f"><span>Kind</span><select value={kind} onChange={(e) => setKind(e.target.value as Claim["kind"])}><option value="aspiration">Aspiration — what we hope for</option><option value="marketing">Marketing</option><option value="scientific">Scientific</option><option value="medical">Medical</option></select></label>
        <button type="button" className="btn-sec btn-sm self-start" disabled={!text.trim()} onClick={async () => { if (await run("save the claim", sb.from("std_claims").insert({ text: text.trim(), kind, subject_type: "gt3" }), "Saved — unverified.")) setText(""); }}>Save claim</button>
      </Group>
      <Group title={`Claims — ${d.claims.length}`}>
        {d.claims.map((c) => (
          <div key={c.id} className="vz-obs">
            <span>{c.text}</span>
            <span className="vz-card-s">{c.kind}{isProhibited(c.text) ? " · prohibited wording — can't be supported" : ""}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className={c.status === "supported" ? "k-tag ok" : c.status === "not_supported" ? "k-tag warn" : "k-tag"}>{c.status === "supported" ? "Supported" : c.status === "not_supported" ? "Not supported" : "Unverified"}</span>
              {isOwner && c.status !== "supported" && c.kind !== "aspiration" && !isProhibited(c.text) && <>
                <select aria-label="Evidence that supports it" value={pick[c.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [c.id]: e.target.value }))}>
                  <option value="">Evidence…</option>
                  {d.evidence.filter((e) => canCarryPass(e) && (c.kind === "marketing" || e.kind === "measured" || e.kind === "observed")).map((e) => <option key={e.id} value={e.id}>{e.summary.slice(0, 60)}</option>)}
                </select>
                <button type="button" className="btn-ter" disabled={!pick[c.id]} onClick={() => void run("support the claim", sb.from("std_claims").update({ status: "supported", evidence_ids: [pick[c.id]] }).eq("id", c.id), "Supported.")}>Support</button>
              </>}
              {isOwner && c.status === "unverified" && <button type="button" className="btn-ter" onClick={() => void run("mark the claim", sb.from("std_claims").update({ status: "not_supported" }).eq("id", c.id), "Marked not supported.")}>Not supported</button>}
            </div>
          </div>))}
      </Group>
    </div>
  );
}

function Criteria({ d, subjects, isOwner, run, sb }: { d: Data; subjects: SubjectRef[]; isOwner: boolean; run: Run; sb: Sb }) {
  const [vid, setVid] = useState(d.versions[0]?.id ?? "");
  const v = d.versions.find((x) => x.id === vid) ?? null;
  const crits = d.criteria.filter((c) => c.version_id === v?.id);
  const [label, setLabel] = useState("");
  const [f, setF] = useState({ pillar: "light" as StdPillar, code: "", title: "", requirement: "", applies_to: "room" as Subject, severity: "medium" as Severity, measures: "", tp: false, evidence_needed: "" });
  const [assess, setAssess] = useState<Criterion | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Group title="Versions" note="Only owners write, approve and publish the Standard. A published version — and its criteria — never changes; a new version replaces it.">
        <div className="flex flex-wrap gap-2">{d.versions.map((x) => <button key={x.id} type="button" className={x.id === vid ? "btn-sec btn-sm" : "btn-ter"} aria-pressed={x.id === vid} onClick={() => setVid(x.id)}>{x.label} · {x.status}</button>)}</div>
        {isOwner && <div className="flex flex-wrap items-end gap-2">
          <label className="prod-f"><span>New version</span><input value={label} maxLength={40} placeholder="v1.0" onChange={(e) => setLabel(e.target.value)} /></label>
          <button type="button" className="btn-sec btn-sm" disabled={!label.trim()} onClick={async () => { if (await run("start the version", sb.from("std_versions").insert({ label: label.trim() }), "Draft started.")) setLabel(""); }}>Start a draft</button>
        </div>}
        {v && <p className="vz-card-s">{v.label} is {v.status}{v.published_at ? `, published ${v.published_at.slice(0, 10)}` : ""}. {crits.length} criteria.</p>}
        {isOwner && v?.status === "draft" && <button type="button" className="btn-pri self-start" disabled={!crits.length} onClick={() => void run("publish", sb.from("std_versions").update({ status: "published" }).eq("id", v.id), `${v.label} published. It can't change now.`)}>Publish {v.label}</button>}
        {isOwner && v?.status === "published" && <button type="button" className="btn-ter self-start" onClick={() => void run("retire", sb.from("std_versions").update({ status: "retired" }).eq("id", v.id), `${v.label} retired — kept as history.`)}>Retire {v.label}</button>}
      </Group>
      {isOwner && v?.status === "draft" && <Group title={`Add a criterion to ${v.label}`}>
        <div className="grid grid-cols-2 gap-2">
          <label className="prod-f"><span>Pillar</span><select value={f.pillar} onChange={(e) => setF({ ...f, pillar: e.target.value as StdPillar })}>{PILLARS.map((p) => <option key={p} value={p}>{PILLAR_WORD[p]}</option>)}</select></label>
          <label className="prod-f"><span>Code</span><input value={f.code} maxLength={20} placeholder="L1" onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <label className="prod-f"><span>Applies to</span><select value={f.applies_to} onChange={(e) => setF({ ...f, applies_to: e.target.value as Subject })}>{(["room", "object", "material"] as Subject[]).map((s) => <option key={s} value={s}>{SUBJECT_WORD[s]}</option>)}</select></label>
          <label className="prod-f"><span>Severity</span><select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as Severity })}>{(Object.keys(SEVERITY_WORD) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY_WORD[s]}</option>)}</select></label>
        </div>
        <label className="prod-f"><span>Title</span><input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="prod-f"><span>Requirement</span><textarea value={f.requirement} rows={3} maxLength={2000} onChange={(e) => setF({ ...f, requirement: e.target.value })} /></label>
        <label className="prod-f"><span>Measurements a pass needs (comma-separated)</span><input value={f.measures} placeholder="cct, cri, flicker_pct" onChange={(e) => setF({ ...f, measures: e.target.value })} /></label>
        {f.pillar === "light" && /^\s*(lumens|lm)?\s*$/i.test(f.measures) && f.measures.trim() !== "" && <Said as="p" className="vz-issue warn">Light can&apos;t be judged on lumens alone — add the other measurements.</Said>}
        <label className="prod-f"><span>Evidence it needs</span><input value={f.evidence_needed} maxLength={1000} onChange={(e) => setF({ ...f, evidence_needed: e.target.value })} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.tp} onChange={(e) => setF({ ...f, tp: e.target.checked })} /><span>Judged for a named task and population (ergonomics)</span></label>
        <button type="button" className="btn-sec btn-sm self-start" disabled={!f.code.trim() || !f.title.trim() || !f.requirement.trim()} onClick={async () => {
          const ok = await run("add the criterion", sb.from("std_criteria").insert({ version_id: v.id, pillar: f.pillar, code: f.code.trim(), title: f.title.trim(), requirement: f.requirement.trim(), applies_to: f.applies_to, severity: f.severity, required_measures: f.measures.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean), needs_task_population: f.tp, evidence_needed: f.evidence_needed.trim() || null, sort: crits.length + 1 }), "Criterion added.");
          if (ok) setF({ ...f, code: "", title: "", requirement: "", measures: "", evidence_needed: "" });
        }}>Add criterion</button>
      </Group>}
      {PILLARS.map((p) => { const rows = crits.filter((c) => c.pillar === p); if (!rows.length) return null; return (
        <Group key={p} title={PILLAR_WORD[p]}>
          {rows.map((c) => (
            <div key={c.id} className="vz-obs">
              <span><b>{c.code}</b> {c.title}</span>
              <span className="vz-card-s">{c.requirement}</span>
              <span className="vz-card-s">{SUBJECT_WORD[c.applies_to]} · {SEVERITY_WORD[c.severity]}{c.required_measures.length ? ` · needs ${c.required_measures.join(", ")}` : ""}{c.needs_task_population ? " · task and population named" : ""}</span>
              {isOwner && v?.status === "published" && <button type="button" className="btn-ter self-start" onClick={() => setAssess(c)}>Assess against {c.code}</button>}
            </div>))}
        </Group>); })}
      {assess && v && <Assess c={assess} version={v} d={d} subjects={subjects} run={run} sb={sb} onDone={() => setAssess(null)} />}
    </div>
  );
}

function Assess({ c, version, d, subjects, run, sb, onDone }: { c: Criterion; version: Version; d: Data; subjects: SubjectRef[]; run: Run; sb: Sb; onDone: () => void }) {
  const [about, setAbout] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("unknown");
  const [hazard, setHazard] = useState("");
  const [exposure, setExposure] = useState("");
  const [risk, setRisk] = useState<Assessment["risk"]>("unknown");
  const [task, setTask] = useState("");
  const [population, setPopulation] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [t, id] = about ? about.split(":") as [Subject, string] : [null, null];
  const pool = d.evidence.filter((e) => e.subject_type === t && e.subject_id === id);
  const against = pool.filter((e) => e.review_status === "accepted" && e.bearing === "contradicts" && (!e.criterion_id || e.criterion_id === c.id) && evidenceState(e) !== "expired").length;
  const blockers = outcome === "pass" || outcome === "conditional" ? passBlockers(outcome === "pass" ? c : { ...c, required_measures: [] }, pool.filter((e) => chosen.includes(e.id)), outcome === "pass" ? against : 0, task, population) : [];
  const current = d.assessments.find((a) => a.criterion_id === c.id && a.subject_type === t && a.subject_id === id);
  return (
    <Group title={`Assess ${c.code} — ${c.title}`} note={`Against ${version.label}. Hazard, exposure and risk are separate: a hazard without exposure isn't a risk, and unknown isn't safe.`}>
      <SubjectPick value={about} onChange={(v) => { setAbout(v); setChosen([]); }} subjects={subjects} only={c.applies_to} />
      {current && <p className="vz-card-s">Now: <span className={OUTCOME_TAG[current.outcome]}>{OUTCOME_WORD[current.outcome]}</span>{current.stale_at ? ` · stale — ${current.stale_reason}` : ""}. A new judgement replaces it; the old one stays in history.</p>}
      <label className="prod-f"><span>Outcome</span><select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>{(Object.keys(OUTCOME_WORD) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_WORD[o]}</option>)}</select></label>
      <fieldset className="flex flex-col gap-1 border-0 p-0 m-0"><legend className="vz-card-s mb-1">Evidence about it</legend>
        {pool.length === 0 && <span className="vz-card-s">None yet — submit evidence first, or record unknown.</span>}
        {pool.map((e) => { const st = evidenceState(e); return (
          <label key={e.id} className="flex items-center gap-2"><input type="checkbox" checked={chosen.includes(e.id)} onChange={(ev) => setChosen((x) => ev.target.checked ? [...x, e.id] : x.filter((y) => y !== e.id))} /><span>{e.summary.slice(0, 80)} · {STATE_WORD[st]}{e.bearing === "contradicts" ? " · weighs against" : ""}</span></label>); })}
      </fieldset>
      <label className="prod-f"><span>Hazard</span><input value={hazard} maxLength={600} placeholder="What could cause harm" onChange={(e) => setHazard(e.target.value)} /></label>
      <label className="prod-f"><span>Exposure</span><input value={exposure} maxLength={600} placeholder="Who meets it, how, how long" onChange={(e) => setExposure(e.target.value)} /></label>
      <label className="prod-f"><span>Risk</span><select value={risk} onChange={(e) => setRisk(e.target.value as Assessment["risk"])}><option value="unknown">Unknown</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      {c.needs_task_population && <>
        <label className="prod-f"><span>Task</span><input value={task} maxLength={300} placeholder="e.g. standing laptop work, 20 minutes" onChange={(e) => setTask(e.target.value)} /></label>
        <label className="prod-f"><span>Population</span><input value={population} maxLength={300} placeholder="e.g. adults 5'2&quot; to 6'4&quot;" onChange={(e) => setPopulation(e.target.value)} /></label>
      </>}
      {blockers.length > 0 && <Said as="p" className="vz-issue warn">{blockers.join(" ")}</Said>}
      <div className="flex gap-2">
        <button type="button" className="btn-sec btn-sm" disabled={!about || blockers.length > 0} onClick={async () => {
          if (await run("record the judgement", sb.from("std_assessments").insert({ version_id: version.id, criterion_id: c.id, subject_type: t!, subject_id: id!, outcome, hazard: hazard.trim() || null, exposure: exposure.trim() || null, risk, task: task.trim() || null, population: population.trim() || null, evidence_ids: chosen }), "Recorded.")) onDone();
        }}>Record</button>
        <button type="button" className="btn-ter" onClick={onDone}>Cancel</button>
      </div>
    </Group>
  );
}
