"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { OFFICE } from "@/lib/office";
import { moneyPlain } from "@/lib/money";

// Owner editor for office delivery pricing (0189) — the two knobs that used to be hardcoded. Writes
// the live_status singleton (id=1); the office order flow reads them live via useOfficeSettings.
export default function OfficeSettings() {
  const { toast } = useApp();
  const [price, setPrice] = useState("");   // dollars/gal
  const [min, setMin] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // THE PRICE KEEPS ITS CENTS, AND A FAILED READ SAVES NOTHING (2026-10-06, the settings round). The box
  // was filled with toFixed(0): a price of $42.50 read "43", and Save wrote $43.00 back. moneyPlain is
  // the amount as an input holds it (lib/money). And a refused read filled the boxes with the defaults,
  // so one Save put them over the real prices: now it says so and offers nothing to save.
  useEffect(() => {
    if (!supabase) return;
    supabase.from("live_status").select("office_price_cents, office_min_gallons").eq("id", 1).maybeSingle().then(({ data, error }) => {
      if (error) { setFailed(true); return; }
      const d = data as { office_price_cents?: number; office_min_gallons?: number } | null;
      setPrice(moneyPlain(d?.office_price_cents ?? OFFICE.pricePerGallonCents));
      setMin(String(d?.office_min_gallons ?? OFFICE.minGallons));
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    if (!supabase || busy) return;
    const cents = Math.round(parseFloat(price) * 100);
    // Never under 3 (2026-10-07, 0354): every office order is checked against gallons >= 3 (0187), so
    // a minimum of 1 or 2 saved here made every booking fail. The database refuses it now too.
    const mn = Math.max(3, parseInt(min, 10) || OFFICE.minGallons);
    if (!Number.isFinite(cents) || cents <= 0) { toast("Enter a valid price per gallon", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("live_status").update({ office_price_cents: cents, office_min_gallons: mn }).eq("id", 1);
    setBusy(false);
    toast(error ? "Couldn't save — try again" : "Office pricing updated", error ? "error" : undefined);
  };

  if (failed) return <div className="dp-err" role="alert">Couldn&rsquo;t read the office prices, so they can&rsquo;t be changed right now. Close this and open it again to retry.</div>;
  if (!loaded) return null;
  return (
    <div className="ofset">
      <label className="ofset-f"><span>Price per gallon ($)</span><input className="note-in" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
      <label className="ofset-f"><span>Minimum gallons per order</span><input className="note-in" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} /></label>
      <p className="ofset-note">Applies to new office quotes and to every weekly order made from now on, so the price clients see is the price they&rsquo;re billed. Orders already made keep their price. The minimum is never under 3 gallons. Delivery zones are still code-managed — ask to make those editable next.</p>
      {/* .btn-sec, not .btn-pri: on its own this is the only action on this small form, but this
          Panel is a sibling of BroadcastEditor/FounderDigest on the same Settings screen and Panels
          there open independently (more than one can be visible at once). BroadcastEditor's
          "Go live" claims the screen's one true .btn-pri (see its comment); this stays .btn-sec.
          The two .note-in fields above aren't part of this migration — .btn-pri/.btn-sec/.btn-ter
          is a documented button-only tier system, there's no corresponding input class to move to. */}
      <button type="button" className="btn-sec" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save pricing"}</button>
    </div>
  );
}
