"use client";

import "./library.css";
import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import AsyncSection from "@/components/AsyncSection";
import Said from "@/components/Said";
import Sheet, { CloseButton, useUnsaved } from "@/components/Sheet";
import { Segmented } from "@/components/controls";
import { failureWords } from "@/lib/failureWords";
import type { Database } from "@/lib/database.types";
import { Ask, DraftCard } from "./LibraryIntake";
import { CATALOG, PILLAR_WORD, type Pillar } from "@/lib/vision";
import { moneyRound } from "@/lib/money";
import {
  CATEGORIES, CATEGORY_WORD, NEEDS_REASON, STATUSES, STATUS_MEANS, STATUS_WORD,
  FLAG_WORD, compareRows, costWords, filterAssets, nextSteps, sizeWords, specReady, toAsset,
  type Asset, type Category, type CostBasis, type Filter, type Status,
} from "@/lib/experienceLibrary";

// THE EXPERIENCE LIBRARY (IMS5b, 0461). Owners and admins: everything GT3 might place in a location, one list — the
// Standard's material registry — each with what it is, its size, cost (with its basis), how it's installed and kept,
// the pillars it's meant to serve (intent), and where it stands under the Standard. Unknown is never approved: the
// database refuses qualified or approved while its judgement is incomplete, and only an owner approves. Nothing here is
// a certification — certifications are evidence, judged in The Standard.

type Spec = { id: string; name: string; notes: string | null; status: "draft" | "approved" | "retired"; decided_at: string | null };
type SpecItem = { id: string; spec_id: string; material_id: string; qty: number | null; unit: string | null };
type Hist = { material_id: string; from_status: string | null; to_status: Status; reason: string | null; changed_at: string };
type Data = { assets: Asset[]; specs: Spec[]; items: SpecItem[]; hist: Hist[]; pending: Map<string, number> };

async function readLibrary(): Promise<Data> {
  if (!supabase) throw new Error("Supabase client not configured");
  const sb = supabase;
  // 0461 is applied (2026-10-31): the library's columns and tables are always there.
  const [m, s, i, h, pf] = await Promise.all([
    sb.from("std_materials").select("*").order("name"),
    sb.from("std_specs").select("id, name, notes, status, decided_at").order("created_at"),
    sb.from("std_spec_items").select("id, spec_id, material_id, qty, unit"),
    sb.from("std_material_status").select("material_id, from_status, to_status, reason, changed_at").order("changed_at", { ascending: false }).limit(500),
    sb.from("std_asset_facts").select("material_id").eq("review", "pending").limit(5000),   // 0462: what research found, still to decide
  ]);
  const err = s.error ?? i.error ?? h.error ?? m.error ?? pf.error;
  if (err) throw new Error(err.message);
  const rows = (m.data ?? []) as Record<string, unknown>[];
  return { assets: rows.map(toAsset), specs: (s.data ?? []) as Spec[], items: ((i.data ?? []) as SpecItem[]).map((x) => ({ ...x, qty: x.qty == null ? null : Number(x.qty) })), hist: (h.data ?? []) as Hist[],
    pending: ((pf.data ?? []) as { material_id: string }[]).reduce((mp, r) => mp.set(r.material_id, (mp.get(r.material_id) ?? 0) + 1), new Map<string, number>()) };
}

const PILLARS: Pillar[] = ["movement", "stillness", "light", "fuel"];

export default function Library({ isOwner }: { isOwner: boolean }) {
  const state = useAsyncData(readLibrary, []);
  const [view, setView] = useState<"assets" | "specs">("assets");
  return (
    <section className="flex flex-col gap-3" aria-label="The experience library">
      <AsyncSection state={state} isEmpty={() => false} emptyTitle="Nothing yet" loadingLabel="Opening the library…" errorTitle="Couldn't open the library" errorSub="This is not an empty library — it couldn't be read just now.">
        {(d) => (
          <>
            <Segmented label="Library" kind="choice" value={view} onChange={setView} options={[{ key: "assets", label: `Assets · ${d.assets.filter((a) => !a.archived_at).length}` }, { key: "specs", label: `Location specs · ${d.specs.length}` }]} />
            {view === "assets" ? <Assets d={d} isOwner={isOwner} reload={state.reload} /> : <Specs d={d} isOwner={isOwner} reload={state.reload} />}
          </>
        )}
      </AsyncSection>
    </section>
  );
}

// DISCOVER (IMS6 A3): one search, the categories as chips, a Filters action; then the assets as cards — a picture (only a
// source's own, said as theirs) or an honest placeholder, the name, the category, a short status.
// INSPECT (IMS7-A): a sheet over the library — full height on a phone, so the list is where it was when you close it
// (inline above the grid, a phone lost its place: about 5,000 points of scrolling back) — titled with the asset and its
// status, in three parts: OVERVIEW (what it is, size, makings, intent, status, what the Standard still needs, cost with
// its basis) · REVIEW (n), only when research left findings to decide, never opened for you · MANAGE (the full form, the
// status steps, the record, the specs).
function Assets({ d, isOwner, reload }: { d: Data; isOwner: boolean; reload: () => void }) {
  const [f, setF] = useState<Filter>({});
  const [open, setOpen] = useState<string | null>(null);
  const [part, setPart] = useState<Part>("overview");
  const [pick, setPick] = useState<string[]>([]);
  const [adding, setAdding] = useState<"ask" | "manual" | null>(null);
  const [filters, setFilters] = useState(false);
  const list = useMemo(() => filterAssets(d.assets, f), [d.assets, f]);
  const shown = d.assets.find((a) => a.id === open) ?? null;
  const compared = pick.map((id) => d.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
  const present = useMemo(() => CATEGORIES.filter(([k]) => d.assets.some((a) => a.category === k && !a.archived_at)), [d.assets]);
  const active = [f.status && `Status: ${STATUS_WORD[f.status]}`, f.pillar && `Pillar: ${PILLAR_WORD[f.pillar]}`].filter(Boolean) as string[];
  const openOne = (id: string, to: Part = "overview") => { setOpen(id); setPart(to); };
  return (
    <div className="flex flex-col gap-3">
      <div className="xl-bar">
        <label className="prod-f xl-search"><span className="sr-only">Find an asset</span><input type="search" value={f.text ?? ""} placeholder="Search the library" aria-label="Search the library" onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
        <button type="button" className="btn-sec btn-sm" aria-expanded={filters} onClick={() => setFilters(!filters)}>Filters{active.length ? ` · ${active.length}` : ""}</button>
        <button type="button" className="btn-pri btn-sm" onClick={() => setAdding(adding ? null : "ask")}>Add an asset</button>
      </div>
      {present.length > 0 && (
        <div className="xl-chips" role="group" aria-label="Categories">
          <button type="button" className={`k-chip${!f.category ? " on" : ""}`} aria-pressed={!f.category} onClick={() => setF({ ...f, category: "" })}>All</button>
          {present.map(([k, w]) => <button key={k} type="button" className={`k-chip${f.category === k ? " on" : ""}`} aria-pressed={f.category === k} onClick={() => setF({ ...f, category: f.category === k ? "" : k })}>{w}</button>)}
        </div>
      )}
      {filters && (
        <div className="mpanel p-3 xl-filters" role="group" aria-label="Filters">
          <label className="prod-f"><span>Status</span><select value={f.status ?? ""} onChange={(e) => setF({ ...f, status: e.target.value as Status | "" })}><option value="">Any</option>{STATUSES.map((st) => <option key={st} value={st}>{STATUS_WORD[st]}</option>)}</select></label>
          <label className="prod-f"><span>Pillar (intent)</span><select value={f.pillar ?? ""} onChange={(e) => setF({ ...f, pillar: e.target.value as Pillar | "" })}><option value="">Any</option>{PILLARS.map((p) => <option key={p} value={p}>{PILLAR_WORD[p]}</option>)}</select></label>
        </div>
      )}
      {(active.length > 0 || f.category || f.text) && (
        <div className="flex flex-wrap gap-2 items-center">
          <Said as="span" className="vz-card-s">{list.length} shown{active.length ? ` · ${active.join(" · ")}` : ""}</Said>
          <button type="button" className="btn-ter btn-sm" onClick={() => setF({})}>Reset</button>
        </div>
      )}
      {adding === "ask" && <Ask onManual={() => setAdding("manual")} onDone={(id) => { if (id) { setAdding(null); openOne(id); } reload(); }} />}
      {adding === "manual" && <AddAsset onDone={(id) => { setAdding(null); if (id) { openOne(id, "manage"); reload(); } }} />}
      {shown && <Inspector a={shown} d={d} isOwner={isOwner} part={part} setPart={setPart} reload={reload} onClose={() => setOpen(null)}
        compare={{ on: pick.includes(shown.id), full: !pick.includes(shown.id) && pick.length >= 3, toggle: () => setPick(pick.includes(shown.id) ? pick.filter((x) => x !== shown.id) : [...pick, shown.id]) }} />}
      {compared.length >= 2 && <Compare list={compared} />}
      {compared.length === 1 && <span className="vz-card-s">1 in the comparison — open another and press Compare.</span>}
      {!list.length ? <p className="vz-card-s">{d.assets.length ? "Nothing matches." : "The library is empty. Add the first asset: paste its link, describe it, or upload its spec sheet."}</p> : (
        <ul className="xl-cards" aria-label="Assets">
          {list.map((a) => (
            <li key={a.id}>
              <button type="button" className="xl-card mpanel" aria-current={open === a.id ? "true" : undefined} onClick={() => openOne(a.id)} aria-label={`${a.name}, ${CATEGORY_WORD[a.category]}, ${STATUS_WORD[a.status]}${d.pending.get(a.id) ? `, ${d.pending.get(a.id)} to decide` : ""}`}>
                <Picture a={a} />
                <span className="xl-card-t">{a.name}</span>
                <span className="vz-card-s">{CATEGORY_WORD[a.category]}</span>
                <span className="xl-card-f"><span className={`k-chip xl-st xl-st-${a.status}`}>{STATUS_WORD[a.status]}</span>{d.pending.get(a.id) ? <span className="vz-card-s">{d.pending.get(a.id)} to decide</span> : null}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="vz-card-s">Unknown is never approved. Nothing here is a certification.</p>
    </div>
  );
}

/** An asset's picture: its accepted https image, loaded lazily at card size — or an honest placeholder. */
function Picture({ a, big = false }: { a: Asset; big?: boolean }) {
  return a.image_url
    // eslint-disable-next-line @next/next/no-img-element -- a source's own picture on any host (CSP img-src https:); lazy, at card size
    ? <img className={big ? "xl-img xl-img-big" : "xl-img"} src={a.image_url} alt={`${a.name} — image from its source`} loading="lazy" decoding="async" />
    : <span className={big ? "xl-ph xl-img-big" : "xl-ph"} aria-hidden="true"><span>{CATEGORY_WORD[a.category].slice(0, 2).toUpperCase()}</span></span>;
}

type Part = "overview" | "review" | "manage";

/** The inspector: the asset in a sheet, in three parts. Review is offered only when there are findings to decide, and is
 *  never the part it opens on. */
function Inspector({ a, d, isOwner, part, setPart, reload, onClose, compare }: { a: Asset; d: Data; isOwner: boolean; part: Part; setPart: (p: Part) => void;
  reload: () => void; onClose: () => void; compare: { on: boolean; full: boolean; toggle: () => void } }) {
  const pending = d.pending.get(a.id) ?? 0;
  const loadB = useCallback(async () => { if (!supabase) return [] as string[]; const { data, error } = await supabase.rpc("std_material_blockers", { p_id: a.id }); if (error) throw new Error(error.message); return (data ?? []) as string[]; }, [a.id]);
  const blockers = useAsyncData(loadB, [a.id, a.status]);
  const shown: Part = part === "review" && !pending ? "overview" : part;
  const parts = [{ key: "overview" as const, label: "Overview" }, ...(pending ? [{ key: "review" as const, label: `Review · ${pending}` }] : []), { key: "manage" as const, label: "Manage" }];
  return (
    <Sheet open onClose={onClose} label={a.name} className="xl-sheet"
      header={<div className="cp-head xl-sheet-head"><div className="flex flex-col min-w-0"><b>{a.name}</b><span className="vz-card-s">{CATEGORY_WORD[a.category]} · {STATUS_WORD[a.status]}</span></div><CloseButton onClick={onClose} /></div>}>
      <div className="flex flex-col gap-3">
        <Segmented label={`${a.name} — part`} kind="choice" value={shown} onChange={setPart} options={parts} />
        {shown === "overview" && <Inspect a={a} blockers={blockers} pending={pending} onReview={() => setPart("review")} />}
        {shown === "review" && <DraftCard material={a.id} name={a.name} category={a.category} missingEvidence={blockers.data ?? []} onChanged={reload} />}
        {shown === "manage" && <Detail a={a} d={d} isOwner={isOwner} reload={reload} />}
        <button type="button" className="btn-sec btn-sm self-start" aria-pressed={compare.on} disabled={compare.full} onClick={compare.toggle}>{compare.on ? "In the comparison" : compare.full ? "Comparing 3 already" : "Compare"}</button>
      </div>
    </Sheet>
  );
}

function Inspect({ a, blockers, pending, onReview }: { a: Asset; blockers: { data?: string[] | null; error?: unknown }; pending: number; onReview: () => void }) {
  return (
    <div className="xl-inspect">
      <figure className="xl-hero"><Picture a={a} big /><figcaption className="vz-card-s">{a.image_url ? "The source's picture — not verified as this exact product." : "No picture yet — a placeholder, not the product."}</figcaption></figure>
      <dl className="xl-specs">
        <dt>Status</dt><dd>{STATUS_WORD[a.status]} — {STATUS_MEANS[a.status]}{a.status_reason ? ` (${a.status_reason})` : ""}</dd>
        <dt>Evidence</dt><dd>{blockers.error ? "Couldn't read the Standard's judgement just now." : !blockers.data ? "Reading…" : blockers.data.length ? blockers.data.join(" ") : "The Standard's judgement is complete."}</dd>
        <dt>Size</dt><dd>{sizeWords(a)}</dd>
        <dt>Made of</dt><dd>{a.composition ?? "Not said"}{a.finishes ? ` · ${a.finishes}` : ""}</dd>
        <dt>Meant to serve</dt><dd>{a.pillars.length ? `${a.pillars.map((p) => PILLAR_WORD[p]).join(", ")} (intent, not an assessment)` : "Not said"}</dd>
        <dt>Cost</dt><dd>{costWords(a)}{a.cost_source ? ` — ${a.cost_source}` : ""}</dd>
        <dt>Supplier</dt><dd>{a.supplier ?? "Not known"}</dd>
      </dl>
      {pending > 0 && <button type="button" className="btn-sec btn-sm self-start" onClick={onReview}>{pending} finding{pending === 1 ? "" : "s"} to decide</button>}
    </div>
  );
}

function Compare({ list }: { list: Asset[] }) {
  const rows = compareRows(list);
  return (
    <div className="xl-compare mpanel p-3" role="region" aria-label="Compared side by side">
      <table>
        <thead><tr><th scope="col">Side by side</th>{list.map((a) => <th key={a.id} scope="col">{a.name}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th>{r.values.map((v, k) => <td key={k}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function AddAsset({ onDone }: { onDone: (id: string | null) => void }) {
  const { toast } = useAppStable();
  const [name, setName] = useState(""), [cat, setCat] = useState<Category>("furniture");
  const save = async () => {
    if (!supabase || !name.trim()) return;
    const { data, error } = await supabase.from("std_materials").insert({ name: name.trim(), category: cat }).select("id").single();
    if (error) { toast(failureWords(error, "Couldn't add it"), "error"); return; }
    toast(`${name.trim()} added as a candidate.`); onDone(String((data as { id: string }).id));
  };
  return (
    <div className="mpanel p-3 flex flex-col gap-2">
      <b className="font-sans">A new asset starts as a candidate</b>
      <label className="prod-f"><span>Name</span><input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></label>
      <label className="prod-f"><span>Category</span><select value={cat} onChange={(e) => setCat(e.target.value as Category)}>{CATEGORIES.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></label>
      <div className="flex gap-2"><button type="button" className="btn-pri btn-sm" disabled={!name.trim()} onClick={() => void save()}>Add</button><button type="button" className="btn-ter btn-sm" onClick={() => onDone(null)}>Cancel</button></div>
    </div>
  );
}

type Draft = Partial<Record<keyof Asset, string>>;
const FIELDS: { k: keyof Asset; label: string; long?: boolean; num?: boolean }[] = [
  { k: "maker", label: "Maker" }, { k: "product_ref", label: "Model / product" }, { k: "supplier", label: "Supplier" },
  { k: "supplier_url", label: "Supplier page (https)" }, { k: "w_in", label: "Width (in)", num: true }, { k: "d_in", label: "Depth (in)", num: true },
  { k: "h_in", label: "Height (in)", num: true }, { k: "composition", label: "Made of", long: true }, { k: "finishes", label: "Finishes" },
  { k: "install_notes", label: "How it's installed", long: true }, { k: "maintenance_notes", label: "How it's kept", long: true },
  { k: "image_url", label: "Picture (https link)" },
];

function Detail({ a, d, isOwner, reload }: { a: Asset; d: Data; isOwner: boolean; reload: () => void }) {
  const { toast } = useAppStable();
  const [draft, setDraft] = useState<Draft>({});
  const [cost, setCost] = useState({ dollars: a.cost_cents == null ? "" : String(a.cost_cents / 100), unit: a.cost_unit ?? "", basis: (a.cost_basis ?? "") as CostBasis | "", source: a.cost_source ?? "", as_of: a.cost_as_of ?? "" });
  const [pillars, setPillars] = useState<Pillar[]>(a.pillars);
  // 0470: a cost recorded as actual before the four bases waits for a person to say what it is — choosing its basis here is that.
  const [basisSaid, setBasisSaid] = useState(false);
  const [kind, setKind] = useState(a.studio_kind ?? "");
  const [to, setTo] = useState<Status | "">(""), [reason, setReason] = useState("");
  const loadB = useCallback(async () => { if (!supabase) return [] as string[]; const { data, error } = await supabase.rpc("std_material_blockers", { p_id: a.id }); if (error) throw new Error(error.message); return (data ?? []) as string[]; }, [a.id]);
  const blockers = useAsyncData(loadB, [a.id, a.status]);
  const hist = d.hist.filter((h) => h.material_id === a.id);
  // In the inspector's sheet, closing with something typed and not saved asks first (Sheet's useUnsaved).
  const costWas = { dollars: a.cost_cents == null ? "" : String(a.cost_cents / 100), unit: a.cost_unit ?? "", basis: a.cost_basis ?? "", source: a.cost_source ?? "", as_of: a.cost_as_of ?? "" };
  useUnsaved(Object.keys(draft).length > 0 || JSON.stringify(cost) !== JSON.stringify(costWas) || pillars.join() !== a.pillars.join() || kind !== (a.studio_kind ?? "") || !!to || !!reason.trim());
  const val = (k: keyof Asset) => (k in draft ? draft[k]! : a[k] == null ? "" : String(a[k]));
  const save = async () => {
    if (!supabase) return;
    // Said before it's sent (IMS7): a size is a positive number of inches up to 200′ and a cost isn't negative — the
    // database refuses anything else too (0461's checks); this says why in words instead of a refusal.
    const badSize = FIELDS.filter((f) => f.num && f.k in draft && draft[f.k]!.trim() !== "").find((f) => { const n = Number(draft[f.k]!.trim()); return !Number.isFinite(n) || n <= 0 || n > 2400; });
    if (badSize) { toast(`${badSize.label}: a size is a positive number of inches, up to 2400 (200′).`, "error"); return; }
    if (cost.dollars.trim() !== "" && (!Number.isFinite(Number(cost.dollars)) || Number(cost.dollars) < 0)) { toast("Cost: a dollar amount, not negative.", "error"); return; }
    const patch: Record<string, string | number | string[] | null> = {};
    for (const [k, v] of Object.entries(draft)) { const f = FIELDS.find((x) => x.k === k); patch[k] = v.trim() === "" ? null : f?.num ? Number(v) : v.trim(); }
    const c = cost.dollars.trim() === "" ? null : Math.round(Number(cost.dollars) * 100);
    Object.assign(patch, { cost_cents: c, cost_unit: cost.unit.trim() || null, cost_basis: cost.basis || null, ...(basisSaid ? { cost_basis_flag: null } : {}), cost_source: cost.source.trim() || null, cost_as_of: cost.as_of || null, pillars, studio_kind: kind || null });
    const { error } = await supabase.from("std_materials").update(patch as Database["public"]["Tables"]["std_materials"]["Update"]).eq("id", a.id);
    if (error) { toast(failureWords(error, "Couldn't save it"), "error"); return; }
    setDraft({}); toast("Saved."); reload();
  };
  const step = async () => {
    if (!supabase || !to) return;
    const { error } = await supabase.from("std_materials").update({ status: to, status_reason: reason.trim() || null }).eq("id", a.id);
    if (error) { toast(failureWords(error, "Couldn't change its status"), "error"); return; }
    setTo(""); setReason(""); toast(`${a.name}: ${STATUS_WORD[to]}.`); reload();
  };
  const steps = nextSteps(a, { isOwner, blockers: blockers.data ?? ["Reading the Standard's judgement…"] });
  const chosen = steps.find((x) => x.to === to);
  const staleApproved = a.status === "approved" && (blockers.data?.length ?? 0) > 0;
  return (
    <div className="xl-detail flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <b className="font-sans">{STATUS_WORD[a.status]}</b>
        <span className="vz-card-s">{STATUS_MEANS[a.status]}{a.status_reason ? ` — ${a.status_reason}` : ""}</span>
        {staleApproved && <span className="xl-warn" role="note">Approved, but its judgement is no longer complete: {blockers.data?.join(" ")} Reassess it under The Standard.</span>}
        {!!blockers.data?.length && a.status !== "approved" && <span className="vz-card-s">Before it can be qualified: {blockers.data.join(" ")}</span>}
        {a.watch_list.length > 0 && <span className="xl-warn" role="note">Declares watch-list substances: {a.watch_list.join(", ")}. A match is a review, not a verdict.</span>}
      </div>
      <div className="xl-grid">
        {FIELDS.map((f) => (
          <label key={f.k} className="prod-f"><span>{f.label}</span>
            {f.long ? <textarea rows={2} value={val(f.k)} maxLength={1000} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
              : <input inputMode={f.num ? "decimal" : "text"} value={val(f.k)} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />}
          </label>
        ))}
        <label className="prod-f"><span>Placed in the Studio as</span><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Not a Studio object</option>{CATALOG.map((k) => <option key={k.kind} value={k.kind}>{k.name}</option>)}</select></label>
      </div>
      <fieldset className="xl-cost"><legend className="font-sans font-bold">Cost — said with its basis and source</legend>
        {a.cost_basis_flag && <span className="xl-warn" role="note">This cost was {FLAG_WORD[a.cost_basis_flag]}: choose its basis below and save.</span>}
        <label className="prod-f"><span>Dollars</span><input inputMode="decimal" value={cost.dollars} onChange={(e) => setCost({ ...cost, dollars: e.target.value })} /></label>
        <label className="prod-f"><span>Per</span><input value={cost.unit} placeholder="each, sq ft, gallon…" maxLength={40} onChange={(e) => setCost({ ...cost, unit: e.target.value })} /></label>
        <label className="prod-f"><span>Basis</span><select value={cost.basis} onChange={(e) => { setCost({ ...cost, basis: e.target.value as CostBasis | "" }); setBasisSaid(true); }}><option value="">Not said</option><option value="estimated">Estimated</option><option value="listed">Listed (a published price)</option><option value="quoted">Quoted (offered to GT3)</option><option value="actual">Actual (paid)</option><option value="scenario">Scenario</option></select></label>
        <label className="prod-f"><span>Source</span><input value={cost.source} maxLength={300} placeholder="Quote, invoice, catalog page…" onChange={(e) => setCost({ ...cost, source: e.target.value })} /></label>
        <label className="prod-f"><span>True as of</span><input type="date" value={cost.as_of} onChange={(e) => setCost({ ...cost, as_of: e.target.value })} /></label>
      </fieldset>
      <fieldset className="xl-pillars"><legend className="font-sans font-bold">Meant to serve — intent, not an assessment</legend>
        {PILLARS.map((p) => <label key={p} className="k-chip"><input type="checkbox" checked={pillars.includes(p)} onChange={(e) => setPillars(e.target.checked ? [...pillars, p] : pillars.filter((x) => x !== p))} /> {PILLAR_WORD[p]}</label>)}
      </fieldset>
      <button type="button" className="btn-pri btn-sm self-start" onClick={() => void save()}>Save details</button>
      <div className="xl-step flex flex-col gap-2">
        <b className="font-sans">Change its status</b>
        <label className="prod-f"><span>To</span><select value={to} onChange={(e) => setTo(e.target.value as Status | "")}><option value="">Choose…</option>{steps.map((x) => <option key={x.to} value={x.to}>{STATUS_WORD[x.to]}{x.ready ? "" : " — not yet"}</option>)}</select></label>
        {chosen && !chosen.ready && <span className="vz-card-s">{chosen.why}</span>}
        {to && <label className="prod-f"><span>Why{NEEDS_REASON.includes(to) ? "" : " (optional)"}</span><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>}
        <button type="button" className="btn-sec btn-sm self-start" disabled={!chosen?.ready || (NEEDS_REASON.includes(to as Status) && !reason.trim())} onClick={() => void step()}>Change status</button>
      </div>
      {hist.length > 0 && (
        <details><summary className="font-sans font-bold cursor-pointer py-2">Its record · {hist.length}</summary>
          <ol className="xl-hist">{hist.map((h, k) => <li key={k}><span className="vz-card-s">{new Date(h.changed_at).toLocaleDateString()}</span> {h.from_status ? `${STATUS_WORD[h.from_status as Status] ?? h.from_status} → ` : ""}{STATUS_WORD[h.to_status]}{h.reason ? ` — ${h.reason}` : ""}</li>)}</ol>
        </details>
      )}
      <AddToSpec a={a} d={d} reload={reload} />
    </div>
  );
}

function AddToSpec({ a, d, reload }: { a: Asset; d: Data; reload: () => void }) {
  const { toast } = useAppStable();
  const drafts = d.specs.filter((s) => s.status === "draft" && !d.items.some((i) => i.spec_id === s.id && i.material_id === a.id));
  const [spec, setSpec] = useState("");
  if (!drafts.length) return null;
  const add = async () => {
    if (!supabase || !spec) return;
    const { error } = await supabase.from("std_spec_items").insert({ spec_id: spec, material_id: a.id });
    if (error) { toast(failureWords(error, "Couldn't add it to the spec"), "error"); return; }
    toast("Added to the spec."); setSpec(""); reload();
  };
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <label className="prod-f"><span>Add to a draft spec</span><select value={spec} onChange={(e) => setSpec(e.target.value)}><option value="">Choose…</option>{drafts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <button type="button" className="btn-sec btn-sm" disabled={!spec} onClick={() => void add()}>Add</button>
    </div>
  );
}

function Specs({ d, isOwner, reload }: { d: Data; isOwner: boolean; reload: () => void }) {
  const { toast } = useAppStable();
  const [name, setName] = useState("");
  const byId = new Map(d.assets.map((a) => [a.id, a]));
  const make = async () => {
    if (!supabase || !name.trim()) return;
    const { error } = await supabase.from("std_specs").insert({ name: name.trim() });
    if (error) { toast(failureWords(error, "Couldn't make the spec"), "error"); return; }
    setName(""); reload();
  };
  const decide = async (s: Spec, status: Spec["status"]) => {
    if (!supabase) return;
    const { error } = await supabase.from("std_specs").update({ status }).eq("id", s.id);
    if (error) { toast(failureWords(error, "Couldn't change the spec"), "error"); return; }
    toast(`${s.name}: ${status}.`); reload();
  };
  const takeOff = async (id: string) => { if (!supabase) return; const { error } = await supabase.from("std_spec_items").delete().eq("id", id); if (error) toast(failureWords(error, "Couldn't take it off"), "error"); else reload(); };
  return (
    <div className="flex flex-col gap-3">
      <p className="vz-card-s">A location spec is a reusable list of library assets. An owner approves it, and only when every asset on it is approved; an approved spec keeps its list.</p>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="prod-f"><span>A new spec</span><input value={name} maxLength={160} placeholder="Stillness corner — v1" onChange={(e) => setName(e.target.value)} /></label>
        <button type="button" className="btn-pri btn-sm" disabled={!name.trim()} onClick={() => void make()}>Make it</button>
      </div>
      {!d.specs.length && <p className="vz-card-s">No specs yet.</p>}
      {d.specs.map((s) => {
        const items = d.items.filter((i) => i.spec_id === s.id).map((i) => ({ ...i, asset: byId.get(i.material_id) }));
        const ready = specReady(items.map((i) => ({ status: i.asset?.status ?? "candidate" })));
        const cents = items.reduce((t, i) => (i.asset?.cost_cents == null ? t : t + i.asset.cost_cents * (i.qty ?? 1)), 0);
        const unknown = items.filter((i) => i.asset?.cost_cents == null).length;
        return (
          <div key={s.id} className="mpanel p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2"><b className="font-sans">{s.name}</b><span className={`k-chip xl-st xl-st-${s.status === "approved" ? "approved" : "candidate"}`}>{s.status === "draft" ? "Draft" : s.status === "approved" ? "Approved" : "Retired"}</span></div>
            <ul className="xl-hist">{items.map((i) => (
              <li key={i.id}>{i.asset?.name ?? "An asset"} · {i.asset ? STATUS_WORD[i.asset.status] : "—"}{i.qty ? ` · ${i.qty} ${i.unit ?? ""}` : ""}
                {s.status === "draft" && <button type="button" className="btn-ter btn-sm" onClick={() => void takeOff(i.id)} aria-label={`Take ${i.asset?.name ?? "it"} off ${s.name}`}>Take off</button>}</li>
            ))}</ul>
            <span className="vz-card-s">{items.length ? `Listed cost ${moneyRound(cents)}${unknown ? ` — ${unknown} not known, not counted` : ""}. Each asset's cost has its own basis.` : "Add assets from the list (open one, Add to a draft spec)."}</span>
            {s.status === "draft" && (isOwner ? (
              <div className="flex flex-wrap gap-2 items-center"><button type="button" className="btn-sec btn-sm" disabled={!ready.ready} onClick={() => void decide(s, "approved")}>Approve the spec</button>{!ready.ready && <span className="vz-card-s">{ready.why}</span>}</div>
            ) : <span className="vz-card-s">An owner approves a spec. {ready.why ?? "Every asset on it is approved."}</span>)}
            {s.status === "approved" && isOwner && <button type="button" className="btn-ter btn-sm self-start" onClick={() => void decide(s, "retired")}>Retire it</button>}
          </div>
        );
      })}
    </div>
  );
}
