"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Icon from "@/components/Icon";
import { parseDollars } from "@/lib/wrap";
import { moneyPlain } from "@/lib/money";
import { localToday, dayKey } from "@/lib/dates";
import { MARKETS, MARKET_LABEL, FOUNDING_MARKET, toMarket, type Market } from "@/lib/markets";
import { categoryOrder, categoryLabel, receiptAsk, purchaseDay, type SpendCategory } from "@/lib/spend";
import { attachReceipt } from "@/lib/receipts";
import { homeMarket } from "@/lib/homeMarket";
import { rankSuppliers, supplierNamed, type Supplier, type VendorRow, type RecentPurchase } from "@/lib/suppliers";
import { resolveVendor, type VendorMatch } from "@/lib/vendorLink";
import { follow } from "@/lib/pickFill";
import VendorResolve from "./VendorResolve";

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
      supabase.from("vendors").select("id, name, kind").is("archived_at", null).neq("status", "archived").order("name"),
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
  const ready = cents > 0 && !!cat && !!spentOn && !busy;

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
        // A name not on the list goes through THE vendor resolver (lib/vendorLink): an exact match
        // links, a look-alike is asked about, a clean miss becomes a supplier — approved, because a
        // purchase that happened is not a booking waiting on the owner.
        const r = await resolveVendor(typed, { status: "approved", source: "a purchase", extra: { kind: "supplier", market } });
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
    if (file) {
      const why = await attachReceipt(supabase, data as { id: string; market: string }, file);
      setBusy(false);
      // The purchase IS logged either way — say exactly which half did not land, and where to fix it.
      if (why) { toast(`Logged $${moneyPlain(cents)}${at} to ${label}, but the receipt did not upload — ${why}. Add it from Money › Spend.${added}`, "error"); onDone?.(); return; }
      toast(`Logged $${moneyPlain(cents)}${at} to ${label}, with its receipt.${added}`);
    } else {
      setBusy(false);
      toast(`Logged $${moneyPlain(cents)}${at} to ${label}.${added}`);
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
        <div className="btn-sec lp-receipt has">
          <Icon name="check" size={16} />
          <span className="lp-receipt-name">{file.name}</span>
          <button type="button" className="lp-link" onClick={() => fileRef.current?.click()}>Change</button>
          <button type="button" className="lp-link" onClick={() => setFile(null)}>Remove</button>
        </div>
      ) : (
        <button type="button" className="btn-sec lp-receipt" onClick={() => fileRef.current?.click()}>
          <Icon name="plus" size={18} /> Photograph the receipt
        </button>
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

      <button type="button" className="btn-pri lp-save" onClick={() => save()} disabled={!ready}>
        {busy ? "Logging…" : cents > 0 && cat ? `Log $${moneyPlain(cents)} · ${categoryLabel(cat, cats)}` : "Log it"}
      </button>
      {!busy && (cents <= 0 || !cat) && (
        <p className="lp-need">{cents <= 0 ? "Enter what it cost." : "Pick a category."}</p>
      )}

      {asking && (
        <VendorResolve name={asking.name} candidates={asking.candidates} busy={busy}
          onUse={(c) => { setAsking(null); save({ id: c.id, name: c.name }); }}
          onCreateDistinct={async () => {
            const typed = asking.name;
            setAsking(null);
            setBusy(true);
            const r = await resolveVendor(typed, { status: "approved", source: "a purchase", extra: { kind: "supplier", market }, decision: { createDistinct: true } });
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
