"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import AsyncSection from "@/components/AsyncSection";
import Said from "@/components/Said";
import { failureWords } from "@/lib/failureWords";
import { haptic } from "@/lib/haptics";
import { money } from "@/lib/money";
import {
  ALLERGENS, ALLERGEN_WORD, FOOD_STATUS_TAG, FOOD_STATUS_WORD, ingredientMargin, portionCost, undeclared,
  type Allergen, type Component, type FoodItem, type FoodRecipe,
} from "@/lib/food";

// PRIMAL FOOD — PLANNED (PF1, 0459). Owners and admins: a food idea, its recipe and what one portion costs. Nothing here is
// on the menu: the menu reads products, and food reaches it only when an owner takes an approved item live. Every price
// and cost is entered with where it came from, and every figure is a conditional projection.

type Data = { items: FoodItem[]; recipes: FoodRecipe[] };

async function readFood(): Promise<Data> {
  if (!supabase) throw new Error("Supabase client not configured");
  const [i, r] = await Promise.all([
    supabase.from("food_items").select("*").order("created_at"),
    supabase.from("food_recipes").select("*").order("version", { ascending: false }),
  ]);
  const err = i.error ?? r.error;
  if (err) throw new Error(err.message);
  return { items: (i.data ?? []) as FoodItem[], recipes: (r.data ?? []) as unknown as FoodRecipe[] };
}

export default function FoodLab({ isOwner }: { isOwner: boolean }) {
  const loader = useCallback(() => readFood(), []);
  const state = useAsyncData(loader, []);
  return (
    <div className="flex flex-col gap-3">
      <p id="vz-food" className="vz-sub">Primal Food — a planned expansion, not on the menu. GT3 opens with its drinks; food is weighed here first: what it is, what goes in it, what a portion costs. Every figure is a projection until an owner approves it.</p>
      <AsyncSection state={state} isEmpty={() => false} emptyTitle="Nothing yet" loadingLabel="Loading the food plan…" errorTitle="Couldn't load the food plan" errorSub="This is not an empty plan — we couldn't read it just now.">
        {(d) => <Body d={d} isOwner={isOwner} reload={state.reload} />}
      </AsyncSection>
    </div>
  );
}

function Body({ d, isOwner, reload }: { d: Data; isOwner: boolean; reload: () => void }) {
  const { toast } = useAppStable();
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(d.items[0]?.id ?? null);
  const run = async (what: string, p: PromiseLike<{ error: { message: string; code?: string } | null }>, done?: string) => {
    const { error } = await p;
    if (error) { toast(failureWords(error, `Couldn't ${what}`), "error"); haptic("error"); return false; }
    haptic("success"); if (done) toast(done); reload(); return true;
  };
  return (
    <div className="flex flex-col gap-3">
      <section className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label="A food idea">
        <b className="font-sans text-subhead">A food idea</b>
        <div className="flex flex-wrap items-end gap-2">
          <label className="prod-f"><span>Name</span><input value={name} maxLength={120} placeholder="e.g. Beef bowl" onChange={(e) => setName(e.target.value)} /></label>
          <button type="button" className="btn-sec btn-sm" disabled={!name.trim()} onClick={async () => { if (await run("add the idea", supabase!.from("food_items").insert({ name: name.trim(), status: "concept" }), "Added — a concept.")) setName(""); }}>Add</button>
        </div>
      </section>
      {d.items.length === 0 && <p className="vz-card-s">No food ideas yet.</p>}
      {d.items.map((it) => (
        <Item key={it.id} it={it} recipes={d.recipes.filter((r) => r.food_item_id === it.id)} isOwner={isOwner} open={open === it.id} onOpen={() => setOpen(open === it.id ? null : it.id)} run={run} />
      ))}
    </div>
  );
}

type Run = (what: string, p: PromiseLike<{ error: { message: string; code?: string } | null }>, done?: string) => Promise<boolean>;

function Item({ it, recipes, isOwner, open, onOpen, run }: { it: FoodItem; recipes: FoodRecipe[]; isOwner: boolean; open: boolean; onOpen: () => void; run: Run }) {
  const sb = supabase!;
  const current = recipes.find((r) => r.status === "approved") ?? recipes[0] ?? null;
  const cost = current ? portionCost(current) : null;
  const margin = cost ? ingredientMargin(it.target_price_cents, cost.ingredientCents) : null;
  const wrongLabel = cost ? undeclared(it, cost) : [];
  const [price, setPrice] = useState(it.target_price_cents != null ? String(it.target_price_cents / 100) : "");
  const [source, setSource] = useState(it.price_source ?? "");
  const [allergens, setAllergens] = useState<Allergen[]>(it.allergens);
  const cents = price.trim() ? Math.round(Number(price) * 100) : null;
  const priceBad = price.trim() !== "" && !(cents! > 0);
  return (
    <section className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label={it.name}>
      <button type="button" className="vz-more flex flex-wrap items-center justify-between gap-2 border-0 bg-transparent p-0 text-left" aria-expanded={open} onClick={onOpen}>
        <b className="font-sans text-subhead">{it.name}</b><span className={FOOD_STATUS_TAG[it.status]}>{FOOD_STATUS_WORD[it.status]}</span>
      </button>
      <p className="vz-card-s">
        {cost?.ingredientCents != null ? `Ingredients ${money(cost.ingredientCents)} a portion` : "Ingredient cost not known yet"}
        {it.target_price_cents != null ? ` · target ${money(it.target_price_cents)}` : " · no target price"}
        {margin ? ` · ${margin.pct}% left after ingredients` : ""}
      </p>
      {wrongLabel.length > 0 && <Said as="p" className="vz-issue warn">The recipe carries {wrongLabel.map((a) => ALLERGEN_WORD[a]).join(", ")} — the item doesn&apos;t declare it.</Said>}
      {open && <>
        <div className="grid grid-cols-2 gap-2">
          <label className="prod-f"><span>Target price ($)</span><input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="prod-f"><span>Where that price came from</span><input value={source} maxLength={300} placeholder="e.g. owner's assumption" onChange={(e) => setSource(e.target.value)} /></label>
        </div>
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1 border-0 p-0 m-0"><legend className="vz-card-s mb-1">Allergens it contains (the nine major)</legend>
          {ALLERGENS.map((a) => <label key={a} className="flex items-center gap-1.5"><input type="checkbox" checked={allergens.includes(a)} onChange={(e) => setAllergens(e.target.checked ? [...allergens, a] : allergens.filter((x) => x !== a))} /><span>{ALLERGEN_WORD[a]}</span></label>)}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-sec btn-sm" disabled={priceBad || (cents != null && !source.trim())} onClick={() => void run("save it", sb.from("food_items").update({ target_price_cents: cents, price_source: cents == null ? null : source.trim(), allergens }).eq("id", it.id), "Saved.")}>Save</button>
          {it.status === "concept" && <button type="button" className="btn-ter" onClick={() => void run("propose it", sb.from("food_items").update({ status: "proposed" }).eq("id", it.id), "Proposed — an owner approves it.")}>Propose</button>}
          {isOwner && it.status === "proposed" && <button type="button" className="btn-ter" onClick={() => void run("approve it", sb.from("food_items").update({ status: "approved" }).eq("id", it.id), "Approved — still not on the menu.")}>Approve — not on the menu</button>}
          {isOwner && (it.status === "proposed" || it.status === "approved") && <button type="button" className="btn-ter" onClick={() => void run("retire it", sb.from("food_items").update({ status: "retired" }).eq("id", it.id), "Retired.")}>Retire</button>}
        </div>
        <p className="vz-card-s">Going on the menu is a separate step, after an approved business plan — not from here.</p>
        <Recipes it={it} recipes={recipes} isOwner={isOwner} run={run} />
      </>}
    </section>
  );
}

function Recipes({ it, recipes, isOwner, run }: { it: FoodItem; recipes: FoodRecipe[]; isOwner: boolean; run: Run }) {
  const sb = supabase!;
  const next = (recipes[0]?.version ?? 0) + 1;
  const [portion, setPortion] = useState("");
  const [loss, setLoss] = useState("0");
  const [rows, setRows] = useState<Component[]>([{ name: "", raw_g: 0 }]);
  const put = (k: number, patch: Partial<Component>) => setRows((rs) => rs.map((r, j) => (j === k ? { ...r, ...patch } : r)));
  const clean = rows.filter((r) => r.name.trim() && Number(r.raw_g) > 0).map((r) => ({ ...r, name: r.name.trim(), cost_source: r.cost_source?.trim() || null }));
  const draft = portionCost({ portion_g: Number(portion) || 0, cook_loss_pct: Number(loss) || 0, components: clean });
  return (
    <div className="flex flex-col gap-2">
      <b className="font-sans text-subhead">Recipe</b>
      <p className="vz-card-s">GT3&apos;s own: owners and admins read it, nobody else, and it never ships in a page. An approved version never changes — a new version replaces it.</p>
      {recipes.map((r) => { const c = portionCost(r); return (
        <div key={r.id} className="vz-obs">
          <span><b>Version {r.version}</b> · {r.portion_g} g a portion · {c.ingredientCents != null ? `${money(c.ingredientCents)} in ingredients` : `cost unknown (${c.missing.join(", ") || "no components"})`}</span>
          <span className="vz-card-s">{r.components.map((x) => `${x.name} ${x.raw_g} g raw`).join(" · ")}{r.cook_loss_pct ? ` · ${r.cook_loss_pct}% cook loss` : ""}{c.yieldGap != null && Math.abs(c.yieldGap) > 10 ? ` · cooked it comes to ${c.cookedG} g, ${c.yieldGap > 0 ? "over" : "under"} the portion` : ""}</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className={r.status === "approved" ? "k-tag ok" : "k-tag"}>{r.status === "approved" ? "Approved" : r.status === "retired" ? "Retired" : "Draft"}</span>
            {isOwner && r.status === "draft" && <button type="button" className="btn-ter" disabled={!r.components.length} onClick={() => void run("approve the recipe", sb.from("food_recipes").update({ status: "approved" }).eq("id", r.id), "Recipe approved — it can't change now.")}>Approve version {r.version}</button>}
            {r.status === "draft" && <button type="button" className="btn-ter" onClick={() => void run("delete the draft", sb.from("food_recipes").delete().eq("id", r.id), "Draft deleted.")}>Delete draft</button>}
          </div>
        </div>); })}
      <fieldset className="flex flex-col gap-2 border-0 p-0 m-0"><legend className="vz-card-s mb-1">Write version {next} — components per portion, raw</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="prod-f"><span>Portion served (g)</span><input value={portion} inputMode="decimal" onChange={(e) => setPortion(e.target.value)} /></label>
          <label className="prod-f"><span>Cook loss (%)</span><input value={loss} inputMode="decimal" onChange={(e) => setLoss(e.target.value)} /></label>
        </div>
        {rows.map((r, k) => (
          <div key={k} className="grid grid-cols-2 gap-2">
            <label className="prod-f"><span>Component</span><input value={r.name} maxLength={80} onChange={(e) => put(k, { name: e.target.value })} /></label>
            <label className="prod-f"><span>Raw grams</span><input value={r.raw_g || ""} inputMode="decimal" onChange={(e) => put(k, { raw_g: Number(e.target.value) || 0 })} /></label>
            <label className="prod-f"><span>Cost per kg ($)</span><input value={r.cost_cents_per_kg != null ? String(r.cost_cents_per_kg / 100) : ""} inputMode="decimal" onChange={(e) => put(k, { cost_cents_per_kg: e.target.value.trim() ? Math.round(Number(e.target.value) * 100) : null })} /></label>
            <label className="prod-f"><span>Where that cost came from</span><input value={r.cost_source ?? ""} maxLength={200} placeholder="a quote, a receipt, a lot" onChange={(e) => put(k, { cost_source: e.target.value })} /></label>
          </div>
        ))}
        <button type="button" className="btn-ter self-start" onClick={() => setRows((rs) => [...rs, { name: "", raw_g: 0 }])}>Add a component</button>
        {clean.length > 0 && <p className="vz-card-s">{draft.rawG} g raw → {draft.cookedG} g cooked{draft.ingredientCents != null ? ` · ${money(draft.ingredientCents)} in ingredients` : ` · cost unknown until every component has a cost and its source${draft.missing.length ? ` (${draft.missing.join(", ")})` : ""}`}.</p>}
        <button type="button" className="btn-sec btn-sm self-start" disabled={!clean.length || !(Number(portion) > 0) || !(Number(loss) >= 0 && Number(loss) < 95)} onClick={async () => {
          if (await run("save the version", sb.from("food_recipes").insert({ food_item_id: it.id, version: next, portion_g: Number(portion), cook_loss_pct: Number(loss), components: clean }), `Version ${next} saved — a draft.`)) setRows([{ name: "", raw_g: 0 }]);
        }}>Save version {next} as a draft</button>
      </fieldset>
    </div>
  );
}

