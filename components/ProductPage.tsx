"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { haptic } from "@/lib/haptics";
import { useOptions } from "./useOptions";
import { withCurrent } from "@/lib/options";
import { drinkCogs, margin, shelfLabel, type InvCost } from "@/lib/cogs";
import { money } from "@/lib/money";
import { dayWithDate, etToday } from "@/lib/dates";
import { useConfirm } from "@/components/ConfirmSheet";
import Sheet, { CloseButton } from "./Sheet";
import {
  RECIPE_READ_FAILED, RECIPE_REREAD_FAILED, changedFields, conflictWords, draftOf, flipLine, flipsFrom, invalid, nameOf, patchOf,
  resetLine, saveVerdict, soldOutLine, switchSpoken, switchWords, upcomingMenus, valuesOf,
  type AuditRow, type CatalogProduct, type Draft, type Flip, type MenuLink, type MenuStop,
} from "@/lib/catalog";

// ONE PRODUCT, ITS OWN PAGE (2026-10-12, the Catalog round, approved). It was an expander inside the list: a card that
// opened in place under its row, its Save the one primary on the screen, its recipe read on open — and lost on the
// next read of the list, because the row copied every reload into its draft (`useEffect(() => { setD(p); }, [p])`), so
// an 86 on ANY other row wiped what was being typed here. The page holds four things, in the order they are reached for:
//   availability   the same switch as the row, the current 86 from the product (sold_out_at / sold_out_by, 0130), and the
//                  last few 86s from the change log (0260) — what the data holds, nothing inferred;
//   details        the expander's fields and its two refusals, unchanged (lib/catalog invalid);
//   where it is sold   on the menu (cups, at the truck and in the app), the delivery pack builder (bulk_orderable and its
//                  tier), and the event and stop menus that pour it (event_menu_items, 0173);
//   recipe & cost  product_components priced by lib/cogs, as the expander had it — and a read that failed says so.
// Saving is conditional on the version the page opened (products.updated_at): a save that would land on somebody else's
// newer change asks first. Who may edit is the database's (0351, 0382): owners and admins; nothing here decides it.

type Inv = InvCost & { unit: string | null; market?: string | null };
type Comp = { id: string; inventory_item_id: string; qty_per_serving: number | null; unit: string | null };
type Recipe = { comps: Comp[]; inv: Inv[] };
type History = { flips: Flip[]; names: Record<string, string> };

const NO_INV: Inv[] = [];
const NO_COMPS: Comp[] = [];
/** How many of a product's 86s the page reads back from the change log. */
const HISTORY_N = 6;
/** A person's first name, the change log's way (components/AuditTrail). */
const firstName = (n: string | null | undefined): string => (n || "").trim().split(/\s+/)[0] || "Staff";

export default function ProductPage({ p, gone, onClose, onFlip, onSaved, onDeleted }: {
  /** The newest version of the row the list has, an 86 on its way included. */
  p: CatalogProduct;
  /** The row left the list while the page was open (somebody deleted it). */
  gone: boolean;
  onClose: () => void;
  onFlip: (p: CatalogProduct) => void;
  /** The saved row, so the list shows it before it reads again. */
  onSaved: (row: CatalogProduct) => void;
  onDeleted: () => void;
}) {
  const { toast } = useApp();
  const confirm = useConfirm();
  const timings = useOptions("menu_timing");

  // WHAT IS TYPED SURVIVES A READ (2026-10-12). `base` is the version the draft started from; `draft` is what is typed.
  // A newer row arriving (an 86 from the Pass, a reload, somebody's save) is judged while rendering, against the row
  // last seen: if nothing this page shows moved, it only becomes the version a save goes over; if something did and
  // nothing is typed, the page shows it; if something did AND edits are typed, the edits stay, over the version they
  // started from — and Save asks (lib/catalog saveVerdict).
  const [base, setBase] = useState<CatalogProduct>(p);
  const [draft, setDraft] = useState<Draft>(() => draftOf(p));
  const [seen, setSeen] = useState(p);
  const values = valuesOf(draft);
  const dirty = changedFields(values, valuesOf(draftOf(base))).length > 0;
  if (seen !== p) {
    setSeen(p);
    const news = changedFields(valuesOf(draftOf(p)), valuesOf(draftOf(base))).length > 0;
    if (!news) setBase(p);
    else if (!dirty) { setBase(p); setDraft(draftOf(p)); }
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<CatalogProduct | null>(null);
  const title = nameOf({ name: draft.name });
  const whyNot = invalid(values);

  // ── the recipe ──
  const recipeLoader = useCallback(async (): Promise<Recipe> => {
    if (!supabase) return { comps: [], inv: [] };
    const [c, i] = await Promise.all([
      supabase.from("product_components").select("id, inventory_item_id, qty_per_serving, unit").eq("product_id", p.id),
      // unit_cost joins the existing select so the drink row can price its OWN recipe. It was the
      // only thing missing: lib/cogs already owns the math, the row already has the components,
      // and the cost still lived two panels away in the COGS calculator.
      supabase.from("inventory_items").select("id, name, unit, unit_cost, market").order("name"),
    ]);
    // A failed read is thrown, never kept as an empty list: an empty recipe reads as "this drink has no ingredients",
    // which is what COGS and the inventory deduction are built on (RECIPE_READ_FAILED says which it is).
    if (c.error) throw new Error(c.error.message);
    if (i.error) throw new Error(i.error.message);
    return { comps: (c.data as Comp[]) ?? [], inv: (i.data as Inv[]) ?? [] };
  }, [p.id]);
  const recipe = useAsyncData(recipeLoader, [recipeLoader]);
  // A recipe changed on another phone reads again here, and the recipe is on the app's refresh too (lib/realtime).
  // product_components is not in the realtime publication yet (0370 added products, not this table), so until it is,
  // the refresh — pull to refresh, coming back to the app — is what brings another phone's recipe edit.
  useRealtimeTable("product_components", recipe.reload);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set());
  const comps = useMemo(() => (recipe.data?.comps ?? NO_COMPS).filter((c) => !removing.has(c.id)), [recipe.data, removing]);
  const inv = recipe.data?.inv ?? NO_INV;
  const [addInv, setAddInv] = useState(""); const [addQty, setAddQty] = useState("");

  // ── the 86s ──
  const soldOutBy = p.sold_out_by ?? null;
  const historyLoader = useCallback(async (): Promise<History> => {
    if (!supabase) return { flips: [], names: {} };
    const { data, error } = await supabase.from("admin_audit")
      .select("created_at, actor, was86:old_row->sold_out, is86:new_row->sold_out")
      .eq("table_name", "products").eq("row_pk", p.id).ilike("summary", "%sold_out: %")
      .order("created_at", { ascending: false }).limit(HISTORY_N);
    if (error) throw new Error(error.message);
    const flips = flipsFrom(data as unknown as AuditRow[]);
    const ids = [...new Set([soldOutBy, ...flips.map((f) => f.actor)].filter((x): x is string => !!x))];
    const names: Record<string, string> = {};
    if (ids.length) {
      // A name is a courtesy: without it a line still says what and when, and "Staff" for who (as the change log does).
      const { data: people, error: noNames } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      if (!noNames) for (const r of (people ?? []) as { id: string; display_name: string | null }[]) names[r.id] = firstName(r.display_name);
    }
    return { flips, names };
  }, [p.id, soldOutBy]);
  // Read again whenever the 86 itself moves: the change log has a new line then.
  const history = useAsyncData(historyLoader, [historyLoader, p.sold_out, p.sold_out_at]);

  // ── the event and stop menus ──
  const menusLoader = useCallback(async (): Promise<MenuStop[]> => {
    if (!supabase || !p.slug) return [];
    const { data, error } = await supabase.from("event_menu_items")
      .select("event_id, stop_id, events(title, day, archived_at, completed_at), stops(name, starts_at, archived_at, completed_at)")
      .eq("product_slug", p.slug);
    if (error) throw new Error(error.message);
    return upcomingMenus(data as unknown as MenuLink[], etToday());
  }, [p.slug]);
  const menus = useAsyncData(menusLoader, [menusLoader]);

  // ── saving ──
  // THE VERSION IS THE CONDITION (2026-10-12). The last save used to win, with no word to whoever it overwrote. The
  // update now carries the version the page opened (`.eq("updated_at", …)`) and writes only what this page changed
  // (lib/catalog patchOf). Nothing matched means somebody wrote first: the row is read again and saveVerdict decides —
  // a newer change this page does not show (an 86) is saved over quietly; a change to what it shows is asked about.
  const save = async (over?: CatalogProduct) => {
    if (!supabase || busy) return;
    const patch = patchOf(draft, base);
    if (Object.keys(patch).length === 0) { setConflict(null); return; }
    setBusy(true);
    try {
      let against = over ?? base;
      for (let tries = 0; tries < 3; tries++) {
        const refused = invalid({ ...valuesOf(draftOf(against)), ...patch });
        if (refused) { toast(refused, "error"); return; }
        const { data, error } = await supabase.from("products").update(patch).eq("id", p.id).eq("updated_at", against.updated_at).select("*");
        if (error) { toast(`Couldn't save ${title} — ${error.message}`, "error"); return; }
        const row = (data as CatalogProduct[] | null)?.[0];
        if (row) { setBase(row); setDraft(draftOf(row)); setConflict(null); onSaved(row); toast("Saved"); return; }
        const now = await supabase.from("products").select("*").eq("id", p.id).maybeSingle();
        if (now.error) { toast(`Couldn't save ${title} — ${now.error.message}`, "error"); return; }
        const latest = (now.data as CatalogProduct | null) ?? null;
        const verdict = saveVerdict(against, latest);
        if (verdict === "gone" || !latest) { toast(`Couldn't save ${title} — someone deleted it`, "error"); return; }
        if (verdict === "save") { toast(`Couldn't save ${title} — the database didn't take the change`, "error"); return; }
        if (verdict === "ask") { haptic("warning"); setConflict(latest); return; }
        against = latest;   // rebase: the newer change was one this page does not show
      }
      toast(`Couldn't save ${title} — it kept changing while saving. Try again.`, "error");
    } finally {
      setBusy(false);
    }
  };
  // Reload: their version, and the edits typed over the old one dropped.
  const takeTheirs = () => {
    if (!conflict) return;
    setBase(conflict); setDraft(draftOf(conflict)); setConflict(null);
  };
  const del = async () => {
    if (!supabase) return;
    if (!(await confirm({ title: `Delete “${title}”?`, confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    // The expander said "Deleted" whatever the database answered.
    if (error) { toast(`Couldn't delete ${title} — ${error.message}`, "error"); return; }
    toast("Deleted"); onDeleted();
  };

  // ── the recipe's own writes ──
  const invName = (id: string) => inv.find((x) => x.id === id)?.name ?? "item";
  // What a person reads: the name, and its city when two cities stock one of that name (0347).
  const invLabel = (id: string) => { const it = inv.find((x) => x.id === id); return it ? shelfLabel(it, inv) : "item"; };
  const addComponent = async () => {
    if (!supabase || !addInv) return;
    const unit = inv.find((x) => x.id === addInv)?.unit ?? null;
    const { error } = await supabase.from("product_components").insert({ product_id: p.id, inventory_item_id: addInv, qty_per_serving: addQty ? Number(addQty) : null, unit });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setAddInv(""); setAddQty("");
    void recipe.reload();
  };
  const rmComponent = async (c: Comp) => {
    if (!supabase) return;
    setRemoving((s) => new Set(s).add(c.id));
    const { error } = await supabase.from("product_components").delete().eq("id", c.id);
    // A removal that did not happen puts the line back, and says so — it used to vanish either way.
    if (error) { setRemoving((s) => { const n = new Set(s); n.delete(c.id); return n; }); toast(`Couldn't remove ${invLabel(c.inventory_item_id)} — ${error.message}`, "error"); return; }
    void recipe.reload();
  };

  // WHAT THIS DRINK COSTS, computed where its recipe is edited. Same lib/cogs functions the COGS
  // calculator and Product economics use — not a second implementation, the same one. The point is
  // not to replace those panels (a calculator and a roll-up are real, separate jobs) but to stop
  // the price of a drink being a fact you have to leave the drink to learn.
  const invById = useMemo(() => new Map(inv.map((i) => [i.id, i as InvCost])), [inv]);
  const cogs = useMemo(
    () => drinkCogs(p.id, comps.map((c) => ({ ...c, product_id: p.id })), invById),
    [p.id, comps, invById]);
  const m = margin(values.price_cents, cogs.cents);

  const names = history.data?.names ?? {};
  const flips = history.data?.flips ?? [];
  const sold = soldOutLine(p, names);
  // Named as it was opened ("Someone changed RISE…"), not as it is being renamed here.
  const verdictWords = conflict ? conflictWords(nameOf(base), base, conflict, draft) : null;

  return (
    <Sheet open onClose={onClose} label={title} dirty={dirty && !gone} dismissible={!busy}
      header={<div className="cp-head"><b>{title}</b><CloseButton onClick={onClose} /></div>}
      footer={verdictWords ? (
        // The question, where Save was: who changed it, what each answer does — and the page stays open either way.
        <div role="alert">
          <p className="m-0 text-subhead font-semibold text-cream">{verdictWords.title}</p>
          <p className="cp-line dim mt-1">{verdictWords.body}</p>
          <div className="flex items-center justify-end gap-4 mt-3">
            <button type="button" className="btn-sec" onClick={takeTheirs} disabled={busy}>Reload</button>
            <button type="button" className="btn-pri" onClick={() => { void save(conflict ?? undefined); }} disabled={busy}>{busy ? "Saving…" : "Save anyway"}</button>
          </div>
        </div>
      ) : (
        <>
          {dirty && whyNot && <p className="cp-line dim mt-0 mb-2">{whyNot}</p>}
          {/* Save is the one true commit action on this page — the one .btn-pri, in the sheet's footer so a long
              recipe never scrolls it away. Off until something is typed (nothing to write), and while a refusal stands. */}
          <button type="button" className="btn-pri btn-wide" onClick={() => { void save(); }} disabled={busy || gone || !dirty || !!whyNot}>{busy ? "Saving…" : "Save"}</button>
        </>
      )}>
      {gone && <p className="adm-attn mt-0" role="alert"><b>Someone deleted this item.</b> What is typed here can&apos;t be saved.</p>}

      {/* availability ───────────────────────────────────────────────────────────────────────────── */}
      <div className="cp-block mt-0">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="cp-block-h"><span>Availability</span></div>
            <p className="cp-line mt-1">
              {!p.active ? "Off the menu — nobody can order it. Turn on “On the menu” below and save to sell it."
                : sold ?? "On sale on the live menu."}
            </p>
          </div>
          {p.active
            ? <AvailSwitch p={p} onFlip={() => onFlip(p)} />
            : <span className="w-30 shrink-0 flex justify-end" aria-hidden="true"><span className="k-tag txt">Off</span></span>}
        </div>
        {p.active && <p className="cp-line dim">{resetLine()}</p>}
        <div className="cp-block-h mt-3"><span>Recent 86s</span></div>
        {history.status === "loading" ? <p className="cp-line dim">Reading the change log…</p>
          : history.status === "error" ? (
            <p className="cp-line" role="alert">Couldn&apos;t read the 86 history — that is not the same as none.{" "}
              <button type="button" className="btn-ter" onClick={() => { void history.reload(); }}>Try again</button></p>
          ) : flips.length === 0 ? <p className="cp-line dim">No 86 in the change log yet.</p>
          : (
            <ul className="m-0 p-0 list-none">
              {flips.slice(0, 5).map((f) => <li key={`${f.at}-${f.to86}`} className="cp-line">{flipLine(f, names)}</li>)}
            </ul>
          )}
      </div>

      {/* details & price ────────────────────────────────────────────────────────────────────────── */}
      <div className="cp-block">
        <div className="cp-block-h"><span>Details &amp; price</span></div>
        <div className="prod-grid">
          <label className="prod-f"><span>Name</span><input value={draft.name} onChange={(e) => set("name", e.target.value)} /></label>
          {/* Dollars as typed, the house's money field (components/Field: text with the decimal keypad, never a spinner). */}
          <label className="prod-f"><span>Price ($)</span><input type="text" inputMode="decimal" value={draft.price} onChange={(e) => set("price", e.target.value)} /></label>
          <label className="prod-f"><span>Line</span><input value={draft.line} onChange={(e) => set("line", e.target.value)} /></label>
          {/* The placeholder used to read "BEFORE / DURING / AFTER" — when a placeholder has to
              enumerate the valid answers, the control is wrong. lib/menu.ts already types this
              as exactly those three. */}
          <label className="prod-f"><span>Timing</span>
            <select value={draft.timing} onChange={(e) => set("timing", e.target.value)}>
              <option value="">—</option>
              {withCurrent(timings, draft.timing).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
        </div>
        <label className="prod-f"><span>Description</span><textarea rows={2} value={draft.what} onChange={(e) => set("what", e.target.value)} /></label>
        <label className="prod-f"><span>Why</span><input value={draft.why} onChange={(e) => set("why", e.target.value)} /></label>
        <label className="prod-f"><span>Ingredients (comma)</span><input value={draft.ingredients} onChange={(e) => set("ingredients", e.target.value)} /></label>
        <label className="prod-f"><span>Free of (comma)</span><input value={draft.excludes} onChange={(e) => set("excludes", e.target.value)} /></label>
      </div>

      {/* where it is sold ───────────────────────────────────────────────────────────────────────── */}
      <div className="cp-block">
        <div className="cp-block-h"><span>Where it&apos;s sold</span></div>
        <SwitchRow label="On the menu" on={draft.active} onChange={(v) => set("active", v)}
          sub={draft.active ? "Cups, at the truck and in the app." : "Nobody can order it."} />
        {/* Bulk order = show this item in the delivery pack builder. 'brew' = the refillable
            daypart core (Loop $8 / new $10); 'premium' = a flat $14 add like the Salted Latte. */}
        <SwitchRow label="Available for bulk / delivery pack" on={draft.bulk_orderable} onChange={(v) => set("bulk_orderable", v)}
          sub={draft.bulk_orderable ? "In the delivery pack builder." : "Not in the delivery pack builder."} />
        {draft.bulk_orderable && (
          <label className="prod-f"><span>Bulk tier</span>
            <select value={draft.bulk_tier || "premium"} onChange={(e) => set("bulk_tier", e.target.value)}>
              <option value="premium">Premium add ($14)</option>
              <option value="brew">Brew (refillable core — Loop $8 / new $10)</option>
            </select>
          </label>
        )}
        {draft.bulk_orderable && base.bulk_price_cents != null && <p className="cp-line dim">Packs charge {money(base.bulk_price_cents)} a bottle for it.</p>}
        <div className="cp-block-h mt-3"><span>Event and stop menus</span></div>
        {menus.status === "loading" ? <p className="cp-line dim">Reading the event menus…</p>
          : menus.status === "error" ? (
            <p className="cp-line" role="alert">Couldn&apos;t read the event menus — this is not an empty list.{" "}
              <button type="button" className="btn-ter" onClick={() => { void menus.reload(); }}>Try again</button></p>
          ) : (menus.data ?? []).length === 0 ? <p className="cp-line dim">Not on an upcoming event or stop menu.</p>
          : (
            <ul className="m-0 p-0 list-none">
              {(menus.data ?? []).map((s) => (
                <li key={`${s.kind}-${s.id}`} className="cp-line">{s.name} <span className="dim">· {s.kind === "event" ? "event" : "truck stop"}{s.day ? `, ${dayWithDate(s.day)}` : ", no date yet"}</span></li>
              ))}
            </ul>
          )}
      </div>

      {/* recipe & cost ──────────────────────────────────────────────────────────────────────────── */}
      <div className="cp-block">
        <div className="cp-block-h"><span>Recipe &amp; cost</span></div>
        <p className="cp-line dim">The inventory one serving uses.</p>
        {recipe.status === "loading" ? <p className="cp-line dim">Reading the recipe…</p>
          : recipe.status === "error" ? (
            <p className="cp-line" role="alert">{RECIPE_READ_FAILED}{" "}
              <button type="button" className="btn-ter" onClick={() => { void recipe.reload(); }}>Try again</button></p>
          ) : (
            <>
              {recipe.error && (
                <p className="cp-line" role="alert">{RECIPE_REREAD_FAILED}{" "}
                  <button type="button" className="btn-ter" onClick={() => { void recipe.reload(); }}>Try again</button></p>
              )}
              {/* The cost of what is listed below, and what it leaves. An uncosted ingredient is
                  named rather than quietly treated as free — a margin that silently omits an input
                  reads as better than it is, which is the expensive direction to be wrong in. */}
              {cogs.hasRecipe && (
                <div className={`prod-cogs${cogs.uncosted > 0 ? " partial" : ""}`}>
                  <span>Cost <b>{money(cogs.cents)}</b></span>
                  {cogs.uncosted === 0 && values.price_cents > 0
                    ? <span>Margin <b>{money(m.profitCents)}</b> · {m.pct}%</span>
                    : cogs.uncosted > 0
                      ? <span className="prod-cogs-warn">{cogs.uncosted} ingredient{cogs.uncosted === 1 ? "" : "s"} have no unit cost — set it in Inventory</span>
                      : null}
                </div>
              )}
              {!cogs.hasRecipe && <p className="cp-line dim">No recipe yet — add what a serving uses below.</p>}
              {comps.map((c) => (
                <div key={c.id} className="prod-comp">
                  <span>{c.qty_per_serving ?? ""}{c.unit ? ` ${c.unit}` : ""} · {invLabel(c.inventory_item_id)}
                    {(() => { const ln = cogs.lines.find((l) => l.name === invName(c.inventory_item_id));
                      if (!ln) return null;
                      return ln.costed
                        ? <i className="prod-comp-c">{money(ln.costCents)}</i>
                        : <i className="prod-comp-c none">no cost set</i>; })()}
                  </span>
                  <button type="button" className="btn-ter shrink-0" onClick={() => { void rmComponent(c); }} aria-label={`Remove ${invLabel(c.inventory_item_id)} from the recipe`}>Remove</button>
                </div>
              ))}
              <div className="prod-addc">
                <select value={addInv} onChange={(e) => setAddInv(e.target.value)} aria-label="Inventory item to add"><option value="">+ inventory item…</option>{inv.map((i) => <option key={i.id} value={i.id}>{shelfLabel(i, inv)}</option>)}</select>
                <input type="number" step="0.1" value={addQty} onChange={(e) => setAddQty(e.target.value)} placeholder="qty" aria-label="Quantity per serving" className="max-w-20" />
                <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => { void addComponent(); }} disabled={!addInv}>Add</button>
              </div>
            </>
          )}
      </div>

      {/* Delete is destructive → .btn-del, red words (2026-10-09, the button round); it asks first. At the foot of the
          page, away from Save. */}
      {!gone && (
        <div className="mt-5 flex justify-center">
          <button type="button" className="btn-del" onClick={del}>Delete</button>
        </div>
      )}
    </Sheet>
  );
}

/** The row's availability switch, and the page's: "On sale" or "86'd" beside the kit's switch, one 44-point target.
 *  VoiceOver hears the product and its state as the name ("RISE, on sale") and what a double-tap does as the hint
 *  ("Double-tap to 86.") — the hint is a hidden element the switch is described by, so swiping past it reads nothing
 *  twice. On is "on sale"; the feel of an 86 is the Pass's (MenuManager flip). */
export function AvailSwitch({ p, onFlip }: { p: CatalogProduct; onFlip: () => void }) {
  const hintId = useId();
  const said = switchSpoken(nameOf(p), p.sold_out);
  return (
    <>
      <button type="button" role="switch" aria-checked={!p.sold_out} aria-label={said.label} aria-describedby={hintId} onClick={onFlip}
        className="w-30 shrink-0 min-h-11 inline-flex items-center justify-end gap-2 p-0 border-0 bg-transparent text-cream-muted [font:inherit] cursor-pointer appearance-none">
        {p.sold_out
          ? <span className="k-tag txt crit">{switchWords(true)}</span>
          : <span className="text-footnote font-semibold">{switchWords(false)}</span>}
        <span className={`k-switch${p.sold_out ? "" : " on"}`} aria-hidden="true"><span className="k-switch-k" /></span>
      </button>
      <span id={hintId} hidden>{said.hint}</span>
    </>
  );
}

/** A switch in the page's form, as iOS draws one in a form: the words are the row, the track rides at its end, and the
 *  whole row is the 44-point target (the expander's checkboxes were their label's height). Saved with Save. */
function SwitchRow({ label, sub, on, onChange }: { label: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  const subId = useId();
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} aria-describedby={subId} onClick={() => onChange(!on)}
      className="w-full min-h-11 mt-2 flex items-center gap-3 p-0 border-0 bg-transparent text-left text-cream [font:inherit] cursor-pointer appearance-none">
      <span className="flex-1 min-w-0">
        <span className="block text-subhead">{label}</span>
        <span id={subId} className="block text-footnote text-cream-muted">{sub}</span>
      </span>
      <span className={`k-switch${on ? " on" : ""}`} aria-hidden="true"><span className="k-switch-k" /></span>
    </button>
  );
}
