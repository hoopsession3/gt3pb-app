"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Icon from "@/components/Icon";
import { parseDollars } from "@/lib/wrap";
import { money, moneyPlain } from "@/lib/money";
import { localToday, dayKey } from "@/lib/dates";
import { MARKETS, MARKET_LABEL, FOUNDING_MARKET, toMarket, type Market } from "@/lib/markets";
import { categoryOrder, categoryLabel, receiptAsk, purchaseDay, type SpendCategory } from "@/lib/spend";
import { attachReceipt } from "@/lib/receipts";
import { homeMarket } from "@/lib/homeMarket";
import { rankSuppliers, supplierNamed, readVendorBook, type Supplier, type VendorRow, type RecentPurchase } from "@/lib/suppliers";
import { resolveSupplier, type VendorMatch } from "@/lib/vendorLink";
import { follow } from "@/lib/pickFill";
import { isStocked, orderShelves, unitCost, shelfQty, roundedLot, perUnitWords, qtyWords, type Shelf, type LotSeen } from "@/lib/receiving";
import { isMissingFunction } from "@/lib/schemaSkew";
import { useAsyncData } from "@/lib/useAsyncData";
import VendorResolve from "./VendorResolve";
import { useUnsaved } from "./Sheet";
import Button from "./Button";

// LOG A PURCHASE — the capture half of spend (2026-10-04).
//
// Ryan, looking at Money › Spend & budget: "Should you have an open field like this or should it be
// architected differently?" It was a five-field form parked under the month's report: amount,
// category (pre-set to "supplies"), what for, a vendor list that is really the venue list, and a
// city (pre-set to Greenville), with the receipt only attachable AFTER the row existed. Two jobs at
// two different moments were sharing one panel:
//
//   capture   at the register or the pump, receipt in hand, thumb only — THIS sheet, opened from the
//             quick-actions button anywhere in the console, or from the panel
//   review    at a desk, once a week — the panel (components/SpendBudget), which is now the month
//             and nothing else
//
// So the receipt comes FIRST (every category but marketing owes one at any amount — 0292's
// thresholds — and this is the only moment it is reliably in hand), nothing is pre-selected that a
// person did not choose (a default category files every other kind of purchase wrongly, silently),
// the day defaults to today with yesterday one tap away (spent_on is the date that counts; the old
// form could only ever say "today"), and the city is remembered per device instead of reset.
//
// WHO IT WAS BOUGHT FROM (2026-10-04, the form audit). The sheet had no supplier, and its placeholder
// taught typing one into the description ("Restaurant Depot — cups and lids") — how Sprouts receipt
// #840214 came to read "(no vendor linked)" and 0298 had to link it by hand. A purchase now names a
// vendor row: the suppliers this business buys from most come first (lib/suppliers), and a new one
// goes through the one vendor resolver, so a look-alike of a supplier already in the book is asked
// about instead of becoming a second spelling. expenses.vendor_id was always there; now it is written.
// A supplier whose purchases have only ever been one category starts the category there — said on
// the sheet, changed with a tap, and never over a category somebody chose. A device that has never
// logged a purchase starts in the city its person works from, not in Greenville.
//
// ONTO A SHELF (2026-10-05, 0347). A purchase of ingredients or supplies can go onto the shelf it
// was bought for: receive_lot puts a costed lot there — what a unit cost, from whom — and the
// restock on the shelf's ledger, in one act. Nothing in the app did that before: the shelf was counted
// by hand, and a batch costed out at $0.00 wherever nobody had priced a receipt by hand (0298). The
// shelves this supplier has filled come first (lib/receiving); nothing is chosen for you.

type DayChoice = "today" | "yesterday" | "pick";
const MARKET_KEY = "gt3-spend-market";

/** The city this device last logged a purchase in, else the one its person works from. */
const readMarket = (home: Market | null): Market => {
  try { return toMarket(localStorage.getItem(MARKET_KEY) || home || FOUNDING_MARKET); } catch { return home ?? FOUNDING_MARKET; }
};

/** Who it was bought from: a supplier on file (id), a name not on file yet (id null), or nobody. */
type From = { id: string | null; name: string };
const NOBODY: From = { id: null, name: "" };
/** A supplier settled for the save: its id (null for none), its name, and whether the save added it. */
type Settled = { id: string | null; name?: string; added?: boolean };
/** Chips shown before "More": the suppliers this business actually uses are rarely more than this. */
const SHOWN = 6;

export default function LogPurchase({ onDone }: { onDone?: () => void }) {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cats, setCats] = useState<SpendCategory[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [day, setDay] = useState<DayChoice>("today");
  const [picked, setPicked] = useState(localToday);
  // Mounted only when someone opens the sheet, never server-rendered, so the remembered city can be
  // read in the initializer instead of in an effect that renders twice.
  const [market, setMarket] = useState<Market>(() => readMarket(homeMarket(profile)));
  const [busy, setBusy] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [vendErr, setVendErr] = useState<string | null>(null);
  const [from, setFrom] = useState<From>(NOBODY);
  const [naming, setNaming] = useState(false);     // "Somewhere new" is open
  const [allShown, setAllShown] = useState(false);
  // The category a supplier's history filled in, and whose — so the sheet can say where it came from,
  // and a later supplier pick moves it only while nobody has chosen one (lib/pickFill.follow).
  const [catFrom, setCatFrom] = useState<{ slug: string; who: string } | null>(null);
  const [asking, setAsking] = useState<{ name: string; candidates: VendorMatch[] } | null>(null);
  // Onto a shelf: which one (by id, of this city's), and how much — in the shelf's own unit.
  const [shelfId, setShelfId] = useState("");
  const [qtyTyped, setQtyTyped] = useState("");
  // A purchase half entered — inside the quick-actions sheet — is asked about before the sheet goes.
  useUnsaved(!!amount.trim() || !!what.trim() || !!file || !!qtyTyped.trim());
  // The clock is read once, when the sheet opens: "today" means the day you opened it.
  const [now] = useState(() => new Date());

  // Categories in the order this business uses them: the last 90 days decide what comes first.
  useEffect(() => {
    if (!supabase) return;
    let gone = false;
    const since = dayKey(new Date(now.getTime() - 90 * 864e5));
    Promise.all([
      supabase.from("spend_categories").select("slug, label, sort, active, receipt_required_over_cents").order("sort"),
      supabase.from("expenses").select("category, vendor_id").gte("spent_on", since).is("voided_at", null).limit(500),
      readVendorBook(supabase),
    ]).then(([c, e, v]) => {
      if (gone) return;
      // A FAILED READ IS NOT AN EMPTY LIST: with no categories there is nothing honest to offer.
      if (c.error) { setLoadErr(c.error.message); return; }
      // The last 90 days only ORDER things. If that read fails, the lists still come, alphabetical
      // and with no usual category — which is true of a business with no history yet, not a lie.
      const recent = e.error ? [] : ((e.data as RecentPurchase[]) ?? []);
      setCats(categoryOrder((c.data as SpendCategory[]) ?? [], recent.map((r) => ({ category: r.category ?? "" }))));
      // The vendor book failing is said, and the purchase can still be logged — with a supplier typed
      // by name, which the resolver reads the book for itself, or with none.
      if (v.error) setVendErr(v.error.message);
      else setSuppliers(rankSuppliers((v.data as VendorRow[]) ?? [], recent));
    });
    return () => { gone = true; };
  }, [now]);

  const parsed = parseDollars(amount);
  const cents = "cents" in parsed && parsed.cents > 0 ? parsed.cents : 0;
  const spentOn = purchaseDay(day, picked, now);
  const ask = cats && cat ? receiptAsk(cents, cat, cats, !!file) : null;

  // This city's shelves, read once a stocked category is chosen — and the lots on them, to put the
  // shelves this supplier has filled first. A failed read is said; the purchase still logs.
  const stocked = isStocked(cat);
  const shelvesLoader = useCallback(async (): Promise<{ market: Market; shelves: Shelf[]; lots: LotSeen[] } | null> => {
    if (!supabase || !stocked) return null;
    const [sh, lo] = await Promise.all([
      supabase.from("inventory_items").select("id, name, unit, kind").eq("market", market).order("name"),
      supabase.from("inventory_lots").select("item_name, vendor_id").eq("market", market).not("vendor_id", "is", null).limit(500),
    ]);
    if (sh.error) throw new Error(sh.error.message);
    return { market, shelves: (sh.data as Shelf[]) ?? [], lots: lo.error ? [] : ((lo.data as LotSeen[]) ?? []) };
  }, [stocked, market]);
  const shelfRead = useAsyncData(shelvesLoader, [shelvesLoader]);
  // A shelf belongs to the city it was read for. useAsyncData keeps the last answer while the next one
  // loads, so after a city change the old city's shelves are still in hand: they are not offered, and
  // a shelf chosen among them is not carried over.
  const shelvesHere = shelfRead.data && shelfRead.data.market === market ? shelfRead.data : null;
  const shelvesFailed = !shelvesHere && !!shelfRead.error;
  const shelfChoices = shelvesHere ? orderShelves(shelvesHere.shelves, shelvesHere.lots, from.id, cat) : [];
  const shelf = stocked ? shelfChoices.find((x) => x.id === shelfId) ?? null : null;
  const qty = shelf ? shelfQty(qtyTyped) : null;
  const perUnit = qty ? unitCost(cents, qty) : null;
  const costedAt = qty ? roundedLot(cents, qty) : null;
  const ready = cents > 0 && !!cat && !!spentOn && !busy && (!shelf || qty !== null);

  // Pick a supplier from the list (or clear it). The category follows the supplier's usual one only
  // while it is empty or still holds what the previous supplier put there — a chosen one stays.
  const pickFrom = (s: Supplier | null) => {
    setFrom(s ? { id: s.id, name: s.name } : NOBODY);
    setNaming(false);
    const usual = s?.usual && cats?.some((c) => c.slug === s.usual) ? s.usual : null;
    // follow()'s own test: the field is the pick's while it is empty or still what the last pick put there.
    const owned = !(cat ?? "").trim() || (catFrom !== null && cat === catFrom.slug);
    setCat(follow(cat, catFrom?.slug, usual) || null);
    if (owned) setCatFrom(usual && s ? { slug: usual, who: s.name } : null);
  };
  const pickCat = (slug: string) => { setCat(slug); setCatFrom(null); };

  // `vendor` is the supplier once settled — its id (null for none), its name, and whether this save
  // added it to the book. Undefined means "settle it from the sheet first".
  const save = async (vendor?: Settled) => {
    if (!supabase || !ready || !cat) return;
    setBusy(true);
    let settled = vendor;
    if (settled === undefined) {
      const typed = from.id ? "" : from.name.trim();
      const known = typed ? supplierNamed(suppliers ?? [], typed) : null;
      if (from.id || !typed) settled = { id: from.id, name: from.name };
      else if (known) settled = { id: known.id, name: known.name };
      else {
        // A name not on the list goes through THE vendor resolver, as a supplier (lib/vendorLink
        // resolveSupplier): an exact match links, a look-alike is asked about, a clean miss becomes an
        // approved supplier in this city.
        const r = await resolveSupplier(typed, market, "a purchase");
        if (r.kind === "similar") { setBusy(false); setAsking({ name: typed, candidates: r.candidates }); return; }
        if (r.kind === "error") { setBusy(false); toast(`Not logged — couldn't add ${typed} as a supplier: ${r.message}`, "error"); return; }
        settled = { id: r.id, name: typed, added: r.created };
      }
    }
    const { data, error } = await supabase.from("expenses").insert({
      amount_cents: cents, category: cat, description: what.trim() || null,
      spent_on: spentOn, market, vendor_id: settled.id, created_by: user?.id ?? null,
    }).select("id, market").single();
    if (error || !data) { setBusy(false); toast(`Not logged — ${error?.message ?? "no row came back"}`, "error"); return; }
    try { localStorage.setItem(MARKET_KEY, market); } catch { /* a remembered city is a convenience */ }
    const label = categoryLabel(cat, cats ?? []);
    const at = settled.id && settled.name ? ` from ${settled.name}` : "";
    const added = settled.added ? ` ${settled.name} is in the vendor book now, as a supplier.` : "";
    // Onto the shelf, as a lot of this purchase. The purchase is logged whatever happens here, and
    // the toast says which half did not land.
    let onShelf = "";
    let shelfMissed = false;
    if (shelf && qty) {
      // arrives-with: 0347 — before it is pasted, PostgREST has no receive_lot in this shape, and the
      // step says so instead of reaching for 0293's, which would replace a hand-counted shelf.
      const { error: recvErr } = await supabase.rpc("receive_lot", {
        p_market: market, p_item: shelf.name, p_qty: qty, p_unit: shelf.unit, p_unit_cost_cents: perUnit,
        p_expense_id: (data as { id: string }).id, p_received_on: spentOn, p_vendor_id: settled.id,
      });
      shelfMissed = !!recvErr;
      onShelf = recvErr
        ? (isMissingFunction(recvErr)
            ? ` It isn't on ${shelf.name} yet — receiving onto a shelf arrives with the next database update.`
            : ` It isn't on ${shelf.name} — ${recvErr.message}.`)
        : ` Added ${qtyWords(qty, shelf.unit)} to ${shelf.name}.`;
    }
    if (file) {
      const why = await attachReceipt(supabase, data as { id: string; market: string }, file);
      setBusy(false);
      // The purchase IS logged either way — say exactly which half did not land, and where to fix it.
      if (why) { toast(`Logged $${moneyPlain(cents)}${at} to ${label}, but the receipt did not upload — ${why}. Add it from Money › Spend.${onShelf}${added}`, "error"); onDone?.(); return; }
      toast(`Logged $${moneyPlain(cents)}${at} to ${label}, with its receipt.${onShelf}${added}`, shelfMissed ? "error" : undefined);
    } else {
      setBusy(false);
      toast(`Logged $${moneyPlain(cents)}${at} to ${label}.${onShelf}${added}`, shelfMissed ? "error" : undefined);
    }
    window.dispatchEvent(new Event("gt3-spend-logged"));
    onDone?.();
  };

  if (loadErr) return <p className="cp-line dim">Could not load the spend categories — {loadErr}</p>;
  if (!cats) return <p className="cp-line dim">Loading…</p>;

  return (
    <div className="lp" data-testid="log-purchase">
      {/* 1 · the receipt, while it is in your hand */}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.currentTarget.value = ""; }} />
      {file ? (
        <div className="flex items-center gap-2 min-h-btn rounded-btn border border-line2 pl-3 pr-1 text-cream">
          <Icon name="check" size={16} />
          <span className="lp-receipt-name">{file.name}</span>
          <button type="button" className="lp-link" onClick={() => fileRef.current?.click()}>Change</button>
          <button type="button" className="lp-link" onClick={() => setFile(null)}>Remove</button>
        </div>
      ) : (
        <Button type="button" kind="secondary" wide onClick={() => fileRef.current?.click()}>
          <Icon name="plus" size={18} /> Photograph the receipt
        </Button>
      )}

      {/* 2 · what it cost */}
      <label className="lp-f">
        <span>What it cost</span>
        <input className="note-in lp-amt" inputMode="decimal" placeholder="24.50" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,$]/g, ""))} aria-label="What it cost, in dollars" />
      </label>
      {/* 3 · who it was bought from — a vendor row, not words in the description */}
      <div className="lp-f" role="group" aria-label="Bought from">
        <span>Bought from <i>optional</i></span>
        {vendErr && <p className="lp-note">{`Couldn't load the vendor book — ${vendErr}. Type the store and it is matched when you log, or leave it.`}</p>}
        <div className="lp-chips">
          {(allShown || !suppliers ? suppliers ?? [] : [
            ...suppliers.slice(0, SHOWN),
            // the one picked stays on screen even when it is past the first few
            ...suppliers.slice(SHOWN).filter((x) => x.id === from.id),
          ]).map((x) => (
            <button type="button" key={x.id} className={`ts-chip${from.id === x.id ? " on" : ""}`} aria-pressed={from.id === x.id}
              onClick={() => pickFrom(from.id === x.id ? null : x)}>{x.name}</button>
          ))}
          {!allShown && suppliers && suppliers.length > SHOWN && (
            <button type="button" className="ts-chip" onClick={() => setAllShown(true)}>{`+ ${suppliers.length - SHOWN} more`}</button>
          )}
          <button type="button" className={`ts-chip${naming || (!from.id && from.name) ? " on" : ""}`} aria-pressed={naming || (!from.id && !!from.name)}
            onClick={() => {
              if (naming || (!from.id && from.name)) { setNaming(false); setFrom(NOBODY); return; }
              if (from.id) pickFrom(null);
              setNaming(true);   // after pickFrom, which closes it
            }}>Somewhere new</button>
        </div>
        {(naming || (!from.id && from.name !== "")) && (
          <input className="note-in" value={from.name} autoFocus placeholder="The store or supplier — e.g. Costco"
            aria-label="Store or supplier name" onChange={(e) => setFrom({ id: null, name: e.target.value })} />
        )}
        {!from.id && from.name.trim() !== "" && (() => {
          const known = supplierNamed(suppliers ?? [], from.name);
          return <p className="lp-note">{known ? `That's ${known.name} — already in the vendor book.` : "New to the vendor book — it's added as a supplier when you log this, after a check for a look-alike."}</p>;
        })()}
      </div>

      {/* 4 · what it was — the thing, not the store */}
      <label className="lp-f">
        <span>What was it <i>optional</i></span>
        <input className="note-in" placeholder="Cups and lids, 16 oz" value={what}
          onChange={(e) => setWhat(e.target.value)} aria-label="What was it" />
      </label>

      {/* 5 · where it goes — chosen; a supplier's own history may start it, and says so */}
      <div className="lp-f" role="group" aria-label="Category">
        <span>Category</span>
        <div className="lp-chips">
          {cats.map((c) => (
            <button type="button" key={c.slug} className={`ts-chip${cat === c.slug ? " on" : ""}`}
              aria-pressed={cat === c.slug} onClick={() => pickCat(c.slug)}>{categoryLabel(c.slug, cats)}</button>
          ))}
        </div>
        {catFrom && cat === catFrom.slug && (
          <p className="lp-note">{`${categoryLabel(catFrom.slug, cats)} is what ${catFrom.who} usually is — tap another if this one wasn't.`}</p>
        )}
      </div>

      {/* 5b · onto a shelf — only for what is stock, and only when chosen */}
      {stocked && (
        <div className="lp-f" role="group" aria-label="Onto a shelf">
          <span>Onto a shelf <i>optional</i></span>
          {shelvesFailed ? (
            <p className="lp-note">{`Couldn't read ${MARKET_LABEL[market]}'s shelves — ${shelfRead.error?.message ?? "no answer"}. The purchase still logs; count the shelf later.`}</p>
          ) : (
            <select className="note-in" value={shelf ? shelf.id : ""} aria-label="Which shelf it goes onto"
              onChange={(e) => { setShelfId(e.target.value); setQtyTyped(""); }}>
              <option value="">{shelvesHere ? "Not onto a shelf" : `Reading ${MARKET_LABEL[market]}'s shelves…`}</option>
              {[
                { label: from.id ? `${from.name} has filled these` : "", rows: shelfChoices.filter((x) => x.filledBy) },
                { label: `${categoryLabel(cat, cats)} shelves`, rows: shelfChoices.filter((x) => !x.filledBy && x.fits) },
                { label: "Other shelves", rows: shelfChoices.filter((x) => !x.filledBy && !x.fits) },
              ].filter((g) => g.rows.length > 0).map((g) => (
                <optgroup key={g.label} label={g.label || "Shelves"}>
                  {g.rows.map((x) => <option key={x.id} value={x.id}>{x.unit ? `${x.name} (${x.unit})` : x.name}</option>)}
                </optgroup>
              ))}
            </select>
          )}
          {shelf && (
            <div className="lp-recv">
              <input className="note-in lp-qty" inputMode="decimal" value={qtyTyped} placeholder="How much"
                aria-label={`How much went onto the shelf, in ${shelf.unit ?? "units"}`}
                onChange={(e) => setQtyTyped(e.target.value.replace(/[^0-9.,]/g, ""))} />
              <span className="lp-unit">{shelf.unit ?? "units"}</span>
            </div>
          )}
          {shelf && qty !== null && (
            <p className="lp-note">{`${perUnit !== null && cents > 0 ? `${money(perUnit)} ${perUnitWords(shelf.unit)} — ` : ""}onto ${MARKET_LABEL[market]}'s ${shelf.name} as a delivery${from.name.trim() ? ` from ${from.name.trim()}` : ""}, added to what the shelf already holds.${costedAt !== null ? ` Costs are kept in whole cents, so this delivery is costed at ${money(costedAt)}, not ${money(cents)}.` : ""}`}</p>
          )}
        </div>
      )}

      {/* 6 · when, and for which city */}
      <div className="lp-f" role="group" aria-label="When">
        <span>When</span>
        <div className="lp-chips">
          <button type="button" className={`ts-chip${day === "today" ? " on" : ""}`} aria-pressed={day === "today"} onClick={() => setDay("today")}>Today</button>
          <button type="button" className={`ts-chip${day === "yesterday" ? " on" : ""}`} aria-pressed={day === "yesterday"} onClick={() => setDay("yesterday")}>Yesterday</button>
          <button type="button" className={`ts-chip${day === "pick" ? " on" : ""}`} aria-pressed={day === "pick"} onClick={() => setDay("pick")}>Another day</button>
        </div>
        {day === "pick" && (
          <input className="note-in lp-date" type="date" value={picked} max={purchaseDay("today", "", now)}
            onChange={(e) => setPicked(e.target.value)} aria-label="The day it was bought" />
        )}
      </div>
      {MARKETS.length > 1 && (
        <div className="lp-f" role="group" aria-label="City">
          <span>City</span>
          <div className="lp-chips">
            {MARKETS.map((m) => (
              <button type="button" key={m} className={`ts-chip${market === m ? " on" : ""}`} aria-pressed={market === m}
                onClick={() => setMarket(m)}>{MARKET_LABEL[m]}</button>
            ))}
          </div>
        </div>
      )}

      {ask && <p className="lp-ask">{ask}</p>}

      <button type="button" className="btn-pri btn-wide" onClick={() => save()} disabled={!ready}>
        {busy ? "Logging…" : cents > 0 && cat ? `Log $${moneyPlain(cents)} · ${categoryLabel(cat, cats)}` : "Log it"}
      </button>
      {!busy && (cents <= 0 || !cat || (shelf && qty === null)) && (
        <p className="lp-need">{cents <= 0 ? "Enter what it cost." : !cat ? "Pick a category." : "Say how much went onto the shelf — or choose Not onto a shelf."}</p>
      )}

      {asking && (
        <VendorResolve name={asking.name} candidates={asking.candidates} busy={busy}
          onUse={(c) => { setAsking(null); save({ id: c.id, name: c.name }); }}
          onCreateDistinct={async () => {
            const typed = asking.name;
            setAsking(null);
            setBusy(true);
            const r = await resolveSupplier(typed, market, "a purchase", { createDistinct: true });
            setBusy(false);
            if (r.kind === "linked" || r.kind === "created") save({ id: r.id, name: typed, added: r.created });
            else toast(`Not logged — couldn't add ${typed} as a supplier${r.kind === "error" ? `: ${r.message}` : ""}`, "error");
          }}
          onSkip={() => { setAsking(null); save({ id: null }); }}
          onClose={() => setAsking(null)} />
      )}
    </div>
  );
}
