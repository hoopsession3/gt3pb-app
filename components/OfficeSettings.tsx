"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { OFFICE } from "@/lib/office";

// Owner editor for office delivery pricing (0189) — the two knobs that used to be hardcoded. Writes
// the live_status singleton (id=1); the office order flow reads them live via useOfficeSettings.
export default function OfficeSettings() {
  const { toast } = useApp();
  const [price, setPrice] = useState("");   // dollars/gal
  const [min, setMin] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("live_status").select("office_price_cents, office_min_gallons").eq("id", 1).maybeSingle().then(({ data }) => {
      const d = data as { office_price_cents?: number; office_min_gallons?: number } | null;
      setPrice((((d?.office_price_cents ?? OFFICE.pricePerGallonCents) / 100)).toFixed(0));
      setMin(String(d?.office_min_gallons ?? OFFICE.minGallons));
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    if (!supabase || busy) return;
    const cents = Math.round(parseFloat(price) * 100);
    const mn = Math.max(1, parseInt(min, 10) || OFFICE.minGallons);
    if (!Number.isFinite(cents) || cents <= 0) { toast("Enter a valid price per gallon", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("live_status").update({ office_price_cents: cents, office_min_gallons: mn }).eq("id", 1);
    setBusy(false);
    toast(error ? "Couldn't save — try again" : "Office pricing updated", error ? "error" : undefined);
  };

  if (!loaded) return null;
  return (
    <div className="ofset">
      <label className="ofset-f"><span>Price per gallon ($)</span><input className="note-in" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
      <label className="ofset-f"><span>Minimum gallons per order</span><input className="note-in" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} /></label>
      <p className="ofset-note">Applies to new office quotes. Booked orders keep their locked-in price. Delivery zones are still code-managed — ask to make those editable next.</p>
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
