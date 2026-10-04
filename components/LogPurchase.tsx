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

type DayChoice = "today" | "yesterday" | "pick";
const MARKET_KEY = "gt3-spend-market";

const readMarket = (): Market => {
  try { return toMarket(localStorage.getItem(MARKET_KEY) || FOUNDING_MARKET); } catch { return FOUNDING_MARKET; }
};

export default function LogPurchase({ onDone }: { onDone?: () => void }) {
  const { user } = useAuth();
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
  const [market, setMarket] = useState<Market>(readMarket);
  const [busy, setBusy] = useState(false);
  // The clock is read once, when the sheet opens: "today" means the day you opened it.
  const [now] = useState(() => new Date());

  // Categories in the order this business uses them: the last 90 days decide what comes first.
  useEffect(() => {
    if (!supabase) return;
    let gone = false;
    const since = dayKey(new Date(now.getTime() - 90 * 864e5));
    Promise.all([
      supabase.from("spend_categories").select("slug, label, sort, active, receipt_required_over_cents").order("sort"),
      supabase.from("expenses").select("category").gte("spent_on", since).is("voided_at", null).limit(500),
    ]).then(([c, e]) => {
      if (gone) return;
      // A FAILED READ IS NOT AN EMPTY LIST: with no categories there is nothing honest to offer.
      if (c.error) { setLoadErr(c.error.message); return; }
      setCats(categoryOrder((c.data as SpendCategory[]) ?? [], (e.data as { category: string }[]) ?? []));
    });
    return () => { gone = true; };
  }, [now]);

  const parsed = parseDollars(amount);
  const cents = "cents" in parsed && parsed.cents > 0 ? parsed.cents : 0;
  const spentOn = purchaseDay(day, picked, now);
  const ask = cats && cat ? receiptAsk(cents, cat, cats, !!file) : null;
  const ready = cents > 0 && !!cat && !!spentOn && !busy;

  const save = async () => {
    if (!supabase || !ready || !cat) return;
    setBusy(true);
    const { data, error } = await supabase.from("expenses").insert({
      amount_cents: cents, category: cat, description: what.trim() || null,
      spent_on: spentOn, market, created_by: user?.id ?? null,
    }).select("id, market").single();
    if (error || !data) { setBusy(false); toast(`Not logged — ${error?.message ?? "no row came back"}`, "error"); return; }
    try { localStorage.setItem(MARKET_KEY, market); } catch { /* a remembered city is a convenience */ }
    const label = categoryLabel(cat, cats ?? []);
    if (file) {
      const why = await attachReceipt(supabase, data as { id: string; market: string }, file);
      setBusy(false);
      // The purchase IS logged either way — say exactly which half did not land, and where to fix it.
      if (why) { toast(`Logged $${moneyPlain(cents)} to ${label}, but the receipt did not upload — ${why}. Add it from Money › Spend.`, "error"); onDone?.(); return; }
      toast(`Logged $${moneyPlain(cents)} to ${label}, with its receipt.`);
    } else {
      setBusy(false);
      toast(`Logged $${moneyPlain(cents)} to ${label}.`);
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

      {/* 2 · what it cost and what it was */}
      <label className="lp-f">
        <span>What it cost</span>
        <input className="note-in lp-amt" inputMode="decimal" placeholder="24.50" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,$]/g, ""))} aria-label="What it cost, in dollars" />
      </label>
      <label className="lp-f">
        <span>What was it <i>optional</i></span>
        <input className="note-in" placeholder="Restaurant Depot — cups and lids" value={what}
          onChange={(e) => setWhat(e.target.value)} aria-label="What was it" />
      </label>

      {/* 3 · where it goes — chosen, never defaulted */}
      <div className="lp-f" role="group" aria-label="Category">
        <span>Category</span>
        <div className="lp-chips">
          {cats.map((c) => (
            <button type="button" key={c.slug} className={`ts-chip${cat === c.slug ? " on" : ""}`}
              aria-pressed={cat === c.slug} onClick={() => setCat(c.slug)}>{categoryLabel(c.slug, cats)}</button>
          ))}
        </div>
      </div>

      {/* 4 · when, and for which city */}
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

      <button type="button" className="btn-pri lp-save" onClick={save} disabled={!ready}>
        {busy ? "Logging…" : cents > 0 && cat ? `Log $${moneyPlain(cents)} · ${categoryLabel(cat, cats)}` : "Log it"}
      </button>
      {!busy && (cents <= 0 || !cat) && (
        <p className="lp-need">{cents <= 0 ? "Enter what it cost." : "Pick a category."}</p>
      )}
    </div>
  );
}
