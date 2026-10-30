"use client";

import "./menu.css";
import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import AsyncSection from "@/components/AsyncSection";
import { Segmented } from "@/components/controls";
import { failureWords } from "@/lib/failureWords";
import { haptic } from "@/lib/haptics";
import { money } from "@/lib/money";
import { isMissingRelation, isMissingTable } from "@/lib/schemaSkew";
import { drinkCogs, type Component, type InvCost } from "@/lib/cogs";
import { toInputs } from "@/lib/visionMoney";
import { FORMAT, type Plan } from "@/lib/visionPlans";
import type { Layout } from "@/lib/vision";
import {
  ASSORT_WORD, BASIS_WORD, CAPABILITIES, CAPABILITY_WORD, NO_ASSUMPTIONS, POUR_OZ, PROVIDES, STATUS_TAG, STATUS_WORD,
  contribution, perPour, readiness, standardStatus,
  type Assumptions, type AssortState, type Capability, type Outcome,
} from "@/lib/menuEconomics";

// MENU & ECONOMICS (MEN1, 0460). Owners and admins: what GT3 sells, why each belongs, what a serving earns, and where it
// can be served — from the one catalog (public.products), its bill of materials and the Primal Standard. A figure that
// isn't known is said to be unknown; contribution is never called profit; a recipe's contents never show here.

type Product = { id: string; slug: string; name: string; line: string | null; price_cents: number; active: boolean; sold_out: boolean | null; image_url: string | null; what: string | null; why: string | null; caffeine: boolean | null; contains: string[] | null; serving_oz: number | null; serving_basis: string | null };
type Crit = { id: string; code: string; title: string; mandatory: boolean; pillar: string };
type Assess = { criterion_id: string; subject_id: string; outcome: Outcome; stale_at: string | null; verification: "proposed" | "independent" | "self" | null; assessed_at: string | null };
type Assort = { id: string; plan_id: string; product_id: string; state: AssortState; reason: string | null; decided_at: string | null };
type Data = {
  products: Product[]; comps: Component[]; inv: InvCost[]; ua: Map<string, Assumptions>; req: { product_id: string; capability: Capability }[];
  assort: Assort[]; version: { id: string; label: string } | null; criteria: Crit[]; assess: Assess[]; money: Map<string, { cardFeePct: number | null; labourPerHour: number | null }>; recipes: Set<string>;
} | "missing";

const OUTCOME_WORD: Record<Outcome, string> = { pass: "Meets", conditional: "Conditional", fail: "Does not meet", unknown: "Unknown", not_applicable: "Not applicable" };

async function readMenu(): Promise<Data> {
  if (!supabase) throw new Error("Supabase client not configured");
  const sb = supabase;
  // arrives-with: 0460 — product_unit_assumptions, product_requirements, location_assortments: before 0460 the screen says so
  const [p, c, i, u, r, a, v, m, rec] = await Promise.all([
    sb.from("products").select("id, slug, name, line, price_cents, active, sold_out, image_url, what, why, caffeine, contains, serving_oz, serving_basis").order("sort"),
    sb.from("product_components").select("product_id, inventory_item_id, qty_per_serving, unit"),
    sb.from("inventory_items").select("id, name, unit_cost, unit"),
    sb.from("product_unit_assumptions").select("*"),
    sb.from("product_requirements").select("product_id, capability"),
    sb.from("location_assortments").select("id, plan_id, product_id, state, reason, decided_at"),
    sb.from("std_versions").select("id, label").eq("status", "published").order("published_at", { ascending: false }).limit(1),
    sb.from("vision_plan_money").select("plan_id, scenarios"),
    sb.from("brew_recipes").select("product_slug").is("archived_at", null),
  ]);
  const err = p.error ?? u.error ?? r.error ?? a.error;
  if (err && (isMissingTable(err) || isMissingRelation(err) || /serving_oz/.test(err.message))) return "missing";
  if (err) throw new Error(err.message);
  const version = (v.data?.[0] as { id: string; label: string } | undefined) ?? null;
  let criteria: Crit[] = [], assess: Assess[] = [];
  if (version) {
    const [cr, as] = await Promise.all([
      sb.from("std_criteria").select("id, code, title, mandatory, pillar").eq("version_id", version.id).eq("applies_to", "product").order("code"),
      sb.from("std_assessments").select("criterion_id, subject_id, outcome, stale_at, verification, assessed_at").eq("subject_type", "product").is("superseded_by", null),
    ]);
    criteria = (cr.data ?? []) as Crit[]; assess = (as.data ?? []) as Assess[];
  }
  const ua = new Map<string, Assumptions>();
  for (const row of (u.data ?? []) as (Assumptions & { product_id: string })[]) ua.set(row.product_id, { ...NO_ASSUMPTIONS, ...row, waste_pct: row.waste_pct == null ? null : Number(row.waste_pct), return_pct: row.return_pct == null ? null : Number(row.return_pct), loss_pct: row.loss_pct == null ? null : Number(row.loss_pct) });
  const moneyBy = new Map<string, { cardFeePct: number | null; labourPerHour: number | null }>();
  for (const row of (m.data ?? []) as { plan_id: string; scenarios: Record<string, unknown> | null }[]) {
    const base = toInputs((row.scenarios?.base as Record<string, unknown>) ?? null);
    moneyBy.set(row.plan_id, { cardFeePct: base.cardFeePct ?? null, labourPerHour: base.wageCents == null ? null : Math.round(base.wageCents * (1 + (base.laborBurdenPct ?? 0) / 100)) });
  }
  return {
    products: ((p.data ?? []) as Product[]).map((x) => ({ ...x, serving_oz: x.serving_oz == null ? null : Number(x.serving_oz) })),
    comps: (c.data ?? []) as Component[], inv: ((i.data ?? []) as InvCost[]).map((x) => ({ ...x, unit_cost: x.unit_cost == null ? null : Number(x.unit_cost) })),
    ua, req: (r.data ?? []) as { product_id: string; capability: Capability }[], assort: (a.data ?? []) as Assort[], version, criteria, assess, money: moneyBy,
    recipes: new Set(((rec.data ?? []) as { product_slug: string | null }[]).map((x) => x.product_slug ?? "").filter(Boolean)),
  };
}

type View = "menu" | "product" | "locations";
export default function MenuStudio({ plans, layouts, isOwner }: { plans: Plan[]; layouts: Layout[]; isOwner: boolean }) {
  const loader = useCallback(() => readMenu(), []);
  const state = useAsyncData(loader, []);
  return (
    <div className="flex flex-col gap-3">
      <p id="vz-menu" className="vz-sub">What GT3 sells, why each belongs, what a serving earns and where it can be served. Unknowns stay unknown; contribution isn&apos;t profit.</p>
      <AsyncSection state={state} isEmpty={() => false} emptyTitle="Nothing yet" loadingLabel="Loading the menu…" errorTitle="Couldn't load the menu" errorSub="This is not an empty menu — we couldn't read it just now.">
        {(d) => d === "missing" ? <p className="vz-sub">Menu &amp; economics arrives with the next database update (0460).</p> : <Body d={d} plans={plans} layouts={layouts} isOwner={isOwner} reload={state.reload} />}
      </AsyncSection>
    </div>
  );
}

function Body({ d, plans, layouts, isOwner, reload }: { d: Exclude<Data, "missing">; plans: Plan[]; layouts: Layout[]; isOwner: boolean; reload: () => void }) {
  const { toast } = useAppStable();
  const [view, setView] = useState<View>("menu");
  const [pick, setPick] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string>(plans.find((p) => p.layout_id)?.id ?? plans[0]?.id ?? "");
  const plan = plans.find((p) => p.id === planId) ?? null;
  const room = layouts.find((l) => l.id === plan?.layout_id) ?? null;
  const kinds = useMemo(() => (room?.items ?? []).map((i) => i.kind), [room]);
  const invById = useMemo(() => new Map(d.inv.map((x) => [x.id, x])), [d.inv]);
  const fees = d.money.get(planId) ?? { cardFeePct: null, labourPerHour: null };

  const facts = useMemo(() => new Map(d.products.map((p) => {
    const a = d.ua.get(p.id) ?? NO_ASSUMPTIONS;
    const econ = contribution({ priceCents: p.price_cents, ingredients: drinkCogs(p.id, d.comps, invById), a, cardFeePct: fees.cardFeePct, labourCentsPerHour: fees.labourPerHour });
    const std = standardStatus(d.criteria, d.assess.filter((x) => x.subject_id === p.id));
    const need = d.req.filter((r) => r.product_id === p.id).map((r) => r.capability);
    return [p.id, { a, econ, std, need, ready: readiness(need, kinds, std.status) }];
  })), [d, invById, fees.cardFeePct, fees.labourPerHour, kinds]);

  const run = async (what: string, p: PromiseLike<{ error: { message: string; code?: string } | null }>, done?: string) => {
    const { error } = await p;
    if (error) { toast(failureWords(error, `Couldn't ${what}`), "error"); haptic("error"); return false; }
    haptic("success"); if (done) toast(done); reload(); return true;
  };
  const open = (id: string) => { setPick(id); setView("product"); haptic("selection"); };
  const product = d.products.find((p) => p.id === pick) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Segmented label="Menu & economics" kind="choice" value={view} onChange={setView}
          options={[{ key: "menu", label: "Menu" }, { key: "product", label: "Product" }, { key: "locations", label: "Locations" }]} />
        {plans.length > 0 && (
          <label className="prod-f"><span>Location</span>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{FORMAT[p.format]?.mark} {p.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {view === "menu" && (
        <ul className="vz-menu-grid" aria-label="The menu">
          {d.products.filter((p) => p.active).map((p) => {
            const f = facts.get(p.id)!;
            return (
              <li key={p.id} className="flex"><button type="button" className="vz-card vz-menu-card w-full" onClick={() => open(p.id)} aria-label={`${p.name}, ${money(p.price_cents)} — ${STATUS_WORD[f.std.status]}. Open it.`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the product's own photo from the catalog (any host it was uploaded to); lazy, decorative beside its name */}
                {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="vz-menu-img" /> : <span className="vz-menu-noimg">No photo on file</span>}
                <span className="vz-card-t"><span>{p.name}</span></span>
                <span className="vz-card-s">{p.line ?? "—"} · {money(p.price_cents)} · {p.serving_oz ? `${p.serving_oz} oz` : "size unknown"}{p.caffeine ? " · caffeine" : ""}</span>
                <span className="flex flex-wrap gap-1">
                  <span className={STATUS_TAG[f.std.status]}>{STATUS_WORD[f.std.status]}</span>
                  <span className="k-tag">{f.econ.contributionCents == null ? "Contribution: incomplete" : `Contribution ${f.econ.marginPct}%${f.econ.complete ? "" : " · partial"}`}</span>
                </span>
              </button></li>
            );
          })}
        </ul>
      )}

      {view === "product" && (product ? <ProductView p={product} f={facts.get(product.id)!} d={d} plan={plan} room={room} kinds={kinds} fees={fees} /> : <p className="vz-sub">Pick a product on the Menu.</p>)}

      {view === "locations" && (
        <Locations d={d} plan={plan} room={room} facts={facts} isOwner={isOwner} run={run} onOpen={open} />
      )}
    </div>
  );
}

type Facts = { a: Assumptions; econ: ReturnType<typeof contribution>; std: ReturnType<typeof standardStatus>; need: Capability[]; ready: ReturnType<typeof readiness> };

function ProductView({ p, f, d, plan, room, kinds, fees }: { p: Product; f: Facts; d: Exclude<Data, "missing">; plan: Plan | null; room: Layout | null; kinds: string[]; fees: { cardFeePct: number | null; labourPerHour: number | null } }) {
  const mine = d.assess.filter((x) => x.subject_id === p.id);
  const by = new Map(mine.map((x) => [x.criterion_id, x]));
  const pour = (c: number | null) => (p.serving_oz && p.serving_oz !== POUR_OZ ? perPour(c, p.serving_oz) : null);
  return (
    <section className="vz-insp mpanel mb-0 flex flex-col gap-3 p-3.5" aria-label={`${p.name} — evidence and economics`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="font-sans text-subhead">{p.name}</b>
        <span className={STATUS_TAG[f.std.status]}>{STATUS_WORD[f.std.status]}</span>
      </div>
      <p className="vz-card-s">{p.line ?? "—"} · {money(p.price_cents)} · {p.serving_oz ? `${p.serving_oz} oz (${BASIS_WORD[(p.serving_basis as "actual") ?? "estimated"] ?? "said"})` : "selling size unknown"}{p.caffeine ? " · contains caffeine" : p.caffeine === false ? " · no caffeine" : ""}</p>
      <div>
        <b className="font-sans text-body">Why this belongs</b>
        <p className="vz-sub">{p.why || p.what || "Not written yet."}</p>
      </div>
      <details className="vz-help">
        <summary>Show the evidence</summary>
        <div className="flex flex-col gap-2 pt-2">
          <p className="vz-card-s">Primal Standard {d.version ? d.version.label : "— no published version"} · internal Primal qualification, not food-safety approval and not a health claim. The rule: a failed mandatory requirement → does not meet; nothing judged → not assessed; anything mandatory unjudged, unknown, stale or unverified → conditional; only all mandatory passed, current and verified → meets.</p>
          {!d.criteria.length && <p className="vz-card-s">No product requirements are written in the published Standard yet — every product is Not assessed until they are.</p>}
          {d.criteria.map((c) => {
            const a = by.get(c.id);
            return <p key={c.id} className="vz-card-s"><b>{c.code}</b> {c.title}{c.mandatory ? " (mandatory)" : ""} — {a ? `${OUTCOME_WORD[a.outcome]}${a.stale_at ? ", stale" : ""}${a.verification === "proposed" ? ", proposed" : ""}` : "not judged"}</p>;
          })}
          {f.std.open.length > 0 && <p className="vz-card-s">Open: {f.std.open.join("; ")}.</p>}
        </div>
      </details>

      <div className="flex flex-col gap-1" aria-label="Contribution per serving">
        <b className="font-sans text-body">A serving&apos;s contribution{plan ? ` · ${plan.name}` : ""}</b>
        <table className="vz-econ">
          <tbody>
            <tr><th scope="row">Price</th><td>{money(p.price_cents)}</td><td className="vz-card-s">Menu</td></tr>
            {f.econ.lines.map((l) => (
              <tr key={l.key}><th scope="row">{l.label}</th><td>{l.cents == null ? "Unknown" : `− ${money(l.cents)}`}</td><td className="vz-card-s">{BASIS_WORD[l.basis as "actual"] ?? l.basis}{l.note ? ` · ${l.note}` : ""}</td></tr>
            ))}
            <tr className="vz-econ-total"><th scope="row">Contribution</th><td>{f.econ.contributionCents == null ? "Incomplete" : money(f.econ.contributionCents)}</td><td className="vz-card-s">{f.econ.marginPct == null ? "" : `${f.econ.marginPct}% of price`}{f.econ.complete ? "" : " · before what's unknown"}</td></tr>
            {pour(f.econ.contributionCents) != null && <tr><th scope="row">Per {POUR_OZ} oz pour</th><td>{money(pour(f.econ.contributionCents)!)}</td><td className="vz-card-s">from a {p.serving_oz} oz serving</td></tr>}
          </tbody>
        </table>
        {f.econ.missing.length > 0 && <p className="vz-card-s">Unknown: {f.econ.missing.join(", ")}.</p>}
        <p className="vz-card-s">Contribution isn&apos;t gross profit, operating profit or cash: rent, salaries and equipment sit below it.{fees.cardFeePct == null ? " Card fees come from the location's plan — this one doesn't say." : ""}{f.a.source ? ` Assumptions: ${f.a.source}${f.a.as_of ? `, as of ${f.a.as_of}` : ""}.` : " No assumptions entered yet."}</p>
        <p className="vz-card-s">Recipe: {d.recipes.has(p.slug) ? "on file (its contents stay in the cookbook)" : "none on file"} · recipes are not versioned yet.</p>
      </div>

      <div className="flex flex-col gap-1" aria-label="What it needs">
        <b className="font-sans text-body">What it needs{room ? ` · in ${room.name}` : ""}</b>
        {!f.need.length && <p className="vz-card-s">Its requirements aren&apos;t written yet, so no room can be said to serve it.</p>}
        {f.need.map((c) => {
          const objs = (room?.items ?? []).filter((i) => (PROVIDES[i.kind] ?? []).includes(c));
          return <p key={c} className="vz-card-s">{CAPABILITY_WORD[c]} — {objs.length ? `drawn: ${objs.map((o) => o.label || o.kind).join(", ")}` : "not in the room"}</p>;
        })}
        {f.need.length > 0 && <p className="vz-card-s">A drawn object means the room is designed for it — not that it is installed, working or permitted. Still to confirm: {f.ready.otherGates.join("; ")}.</p>}
        {!room && <p className="vz-card-s">This location has no room drawn{kinds.length ? "" : " yet"}.</p>}
      </div>
    </section>
  );
}

type Run = (what: string, p: PromiseLike<{ error: { message: string; code?: string } | null }>, done?: string) => Promise<boolean>;
function Locations({ d, plan, room, facts, isOwner, run, onOpen }: { d: Exclude<Data, "missing">; plan: Plan | null; room: Layout | null; facts: Map<string, Facts>; isOwner: boolean; run: Run; onOpen: (id: string) => void }) {
  const [add, setAdd] = useState("");
  if (!plan) return <p className="vz-sub">No location plans yet — add one under Plans.</p>;
  const rows = d.assort.filter((a) => a.plan_id === plan.id);
  const offered = new Set(rows.map((r) => r.product_id));
  const sb = supabase!;
  const setState = (r: Assort, state: AssortState, reason: string | null = r.reason) =>
    run("change it", sb.from("location_assortments").update({ state, reason }).eq("id", r.id), `${ASSORT_WORD[state]}.`);
  return (
    <section className="flex flex-col gap-2" aria-label={`${plan.name} — its assortment`}>
      <p className="vz-card-s">{FORMAT[plan.format]?.name ?? plan.format} · phase {plan.phase}. A planned assortment is a scenario until an owner approves it.{room ? ` Room: ${room.name}.` : " No room drawn — equipment can't be checked."}</p>
      {rows.length === 0 && <p className="vz-card-s">Nothing planned for this location yet.</p>}
      {rows.map((r) => {
        const p = d.products.find((x) => x.id === r.product_id); const f = facts.get(r.product_id);
        if (!p || !f) return null;
        return (
          <div key={r.id} className="vz-insp mpanel mb-0 flex flex-col gap-1 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="btn-ter" onClick={() => onOpen(p.id)}>{p.name}</button>
              <span className="k-tag">{ASSORT_WORD[r.state]}</span>
            </div>
            {r.reason && <p className="vz-card-s">{r.reason}</p>}
            {f.ready.gaps.map((g) => <p key={g} className="vz-issue warn">{g}</p>)}
            {!f.need.length && <p className="vz-card-s">Its requirements aren&apos;t written yet.</p>}
            <p className="vz-card-s">Also to confirm: {f.ready.otherGates.join("; ")}.</p>
            <div className="flex flex-wrap gap-2">
              {r.state === "planned" && isOwner && <button type="button" className="btn-sec btn-sm" onClick={() => void setState(r, "approved")}>Approve to offer</button>}
              {r.state === "approved" && isOwner && <button type="button" className="btn-sec btn-sm" disabled={f.ready.gaps.length > 0} title={f.ready.gaps.length ? "The room is missing what it needs" : undefined} onClick={() => void setState(r, "ready")}>Mark ready</button>}
              {(r.state === "approved" || r.state === "ready") && <TakeOff onSave={(why) => setState(r, "unavailable", why)} />}
              {r.state === "unavailable" && isOwner && <button type="button" className="btn-ter" onClick={() => void setState(r, "approved")}>Back on offer</button>}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-end gap-2">
        <label className="prod-f"><span>Plan a product here</span>
          <select value={add} onChange={(e) => setAdd(e.target.value)}>
            <option value="">Choose…</option>
            {d.products.filter((p) => p.active && !offered.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="button" className="btn-sec btn-sm" disabled={!add} onClick={async () => { if (await run("plan it", sb.from("location_assortments").insert({ plan_id: plan.id, product_id: add }), "Planned — a scenario until an owner approves it.")) setAdd(""); }}>Add</button>
      </div>
      <p className="vz-card-s">Capabilities a room can provide: {CAPABILITIES.map((c) => CAPABILITY_WORD[c]).join(", ")}.</p>
    </section>
  );
}

/** Temporarily unavailable, with the reason said in place (no browser dialog): the database refuses it without one. */
function TakeOff({ onSave }: { onSave: (why: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  if (!open) return <button type="button" className="btn-ter" onClick={() => setOpen(true)}>Temporarily unavailable</button>;
  return (
    <span className="flex flex-wrap items-end gap-2">
      <label className="prod-f"><span>Why it&apos;s unavailable</span><input value={why} maxLength={500} placeholder="e.g. the reach-in is out" onChange={(e) => setWhy(e.target.value)} /></label>
      <button type="button" className="btn-sec btn-sm" disabled={!why.trim()} onClick={async () => { if (await onSave(why.trim())) { setOpen(false); setWhy(""); } }}>Save</button>
      <button type="button" className="btn-ter" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}
