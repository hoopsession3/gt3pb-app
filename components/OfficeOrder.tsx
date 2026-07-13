"use client";

import { useState } from "react";
import Sheet from "@/components/Sheet";
import Gt3Mark from "@/components/Gt3Mark";
import { useAuth } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { OFFICE, officeQuote, nextMondayKey, mondayLabel } from "@/lib/office";
import { useOfficeSettings } from "./useOfficeSettings";

// OFFICE DELIVERY — the B2B bulk order (amber gallon jugs, Monday 5–8 AM, 3-gal minimum). Purpose-built
// so it never entangles the residential pack cart. Books a business_order (0187); a standing toggle also
// creates/links a business_account for the weekly generator. Prepaid → we send a payment link; net terms
// → we invoice. Either way the operator confirms — no card is captured here. Raises a crew alert on book.
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export default function OfficeOrder({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [company, setCompany] = useState("");
  const [gallons, setGallons] = useState<number>(OFFICE.minGallons);
  const [headcount, setHeadcount] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [access, setAccess] = useState("");
  const [standing, setStanding] = useState(false);
  const [billing, setBilling] = useState<"prepaid" | "net15">("prepaid");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ gallons: number; date: string } | null>(null);

  const settings = useOfficeSettings();
  const q = officeQuote(gallons, { priceCents: settings.priceCents, minGallons: settings.minGallons });
  const dateKey = nextMondayKey();
  // Prepaid texts a secure payment link, so a phone is required on that path (no phone = no way to pay).
  const needsPhone = billing === "prepaid";
  const ready = company.trim() && street.trim() && city.trim() && zip.trim().length >= 5 && gallons >= settings.minGallons && (!needsPhone || phone.trim().length > 0);

  const submit = async () => {
    if (busy) return;
    if (!supabase || !user) { toast("Sign in to set up office delivery", "error"); return; }
    if (!ready) { toast(needsPhone && !phone.trim() ? "Add a phone — prepaid sends the payment link by text" : "Add your company and address first", "error"); return; }
    setBusy(true);

    // A standing account (weekly Mondays) is created/linked so the generator can refill it (P2).
    let businessId: string | null = null;
    if (standing) {
      const { data: acct } = await supabase.from("business_accounts").insert({
        user_id: user.id, company: company.trim(), contact_name: contact.trim() || null, contact_phone: phone.trim() || null,
        contact_email: user.email ?? null, address_street: street.trim(), address_city: city.trim(), address_zip: zip.trim(),
        headcount: headcount ? Math.max(0, parseInt(headcount) || 0) : null, billing_terms: billing,
        standing_active: true, standing_gallons: q.gallons,
      }).select("id").single();
      businessId = acct?.id ?? null;
    }

    const { data: order, error } = await supabase.from("business_orders").insert({
      business_id: businessId, user_id: user.id, company: company.trim(),
      contact_name: contact.trim() || null, contact_phone: phone.trim() || null,
      address_street: street.trim(), address_city: city.trim(), address_zip: zip.trim(),
      access_instructions: access.trim() || null, delivery_date: dateKey, delivery_window: OFFICE.window,
      // Record the SAME per-gallon price the quote charged (the live_status override, 0189) — not the
      // hardcoded OFFICE constant, which drifted from settings.priceCents and mis-recorded the price.
      gallons: q.gallons, price_per_gallon_cents: settings.priceCents,
      subtotal_cents: q.subtotalCents, delivery_fee_cents: q.deliveryFeeCents, tax_cents: q.taxCents, total_cents: q.totalCents,
      billing_terms: billing, standing,
    }).select("id").single();

    if (error) { toast(`Couldn't book it — ${error.message}`, "error"); setBusy(false); return; }

    // Tell the crew a new office order landed (same alerts spine as every other order).
    await raiseAlertClient({
      severity: "important", category: "order", kind: "office_order_new", subjectId: order?.id,
      title: `New office order — ${company.trim()}`,
      body: `${q.gallons} gal · ${mondayLabel(dateKey)} 5–8 AM · ${billing === "prepaid" ? "prepaid" : "invoice"}${standing ? " · standing weekly" : ""}. ${dollars(q.totalCents)}. ${phone.trim()}`.trim(),
      link: "/crew?s=now",
    });

    setBusy(false);
    setDone({ gallons: q.gallons, date: dateKey });
  };

  const header = (
    <div className="office-head">
      <span className="office-head-t"><Gt3Mark tone="cream" /> Office delivery</span>
      <button type="button" className="isheet-x" onClick={onClose} aria-label="Close">✕</button>
    </div>
  );

  if (done) {
    return (
      <Sheet open onClose={onClose} label="Office delivery order" header={header} className="office-sheet">
        <div className="office-done">
          <div className="office-done-ic">🫙</div>
          <h2>You&rsquo;re on the Monday route.</h2>
          <p>{done.gallons} gallons of cold-extract, <b>{mondayLabel(done.date)}, 5–8 AM</b>, in amber glass jugs. We&rsquo;ll {billing === "prepaid" ? "text a payment link to confirm" : "send an invoice"} and swap empties for full every week{standing ? "" : " (this order)"}.</p>
          <button type="button" className="handle" onClick={onClose}><span>Done</span></button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} label="Office delivery order" header={header} className="office-sheet"
      footer={<button type="button" className="handle" onClick={submit} disabled={busy || !ready}><span>{busy ? "Booking…" : `Book ${q.gallons} gal · ${dollars(q.totalCents)}`}</span></button>}>

      <p className="office-lede">Fresh cold-extract for the whole team — <b>amber gallon jugs</b>, delivered <b>{OFFICE.windowLabel}</b>, empties swapped for full each week. 3-gallon minimum.</p>

      {/* gallons */}
      <div className="office-gal">
        <div className="office-gal-l"><span className="office-k">Gallons</span><span className="office-hint">~{q.gallons * 12}–{q.gallons * 16} cups · ~{dollars(Math.round(OFFICE.pricePerGallonCents / 14))}/cup</span></div>
        <div className="office-step">
          <button type="button" onClick={() => setGallons((g) => Math.max(settings.minGallons, g - 1))} aria-label="Fewer" disabled={gallons <= settings.minGallons}>−</button>
          <span className="office-gal-v">{q.gallons}</span>
          <button type="button" onClick={() => setGallons((g) => g + 1)} aria-label="More">+</button>
        </div>
      </div>
      <div className="office-quote"><span>{q.gallons} gal × {dollars(OFFICE.pricePerGallonCents)}</span><b>{dollars(q.totalCents)}</b></div>

      {/* who + where */}
      <div className="office-fields">
        <input className="auth-input" placeholder="Company / office name" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={80} aria-label="Company" />
        <div className="office-two">
          <input className="auth-input" placeholder="Contact name" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={60} aria-label="Contact name" />
          <input className="auth-input" placeholder="# of people" inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Headcount" />
        </div>
        <input className="auth-input" placeholder="Phone (delivery-morning texts)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} aria-label="Phone" />
        <input className="auth-input" placeholder="Street address" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={120} aria-label="Street" />
        <div className="office-two">
          <input className="auth-input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} aria-label="City" />
          <input className="auth-input" inputMode="numeric" maxLength={5} placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} aria-label="ZIP" />
        </div>
        <input className="auth-input" placeholder="Suite / access notes (optional)" value={access} onChange={(e) => setAccess(e.target.value)} maxLength={200} aria-label="Access" />
      </div>

      {/* standing */}
      <button type="button" className={`office-toggle${standing ? " on" : ""}`} onClick={() => setStanding((s) => !s)} aria-pressed={standing}>
        <span className="office-toggle-x"><b>Standing weekly</b><span>Same drop every Monday — pause anytime</span></span>
        <span className="office-toggle-track"><span className="office-toggle-knob" /></span>
      </button>

      {/* billing */}
      <div className="office-bill">
        <span className="office-k">Billing</span>
        <div className="office-seg">
          <button type="button" className={billing === "prepaid" ? "on" : ""} onClick={() => setBilling("prepaid")}>Prepaid · payment link</button>
          <button type="button" className={billing === "net15" ? "on" : ""} onClick={() => setBilling("net15")}>Invoice · net 15</button>
        </div>
      </div>
      <p className="office-fine">No card captured here — we confirm the order and {billing === "prepaid" ? "text a secure payment link" : "send an invoice on net-15 terms"}. Cancel or change anytime before Monday.</p>
    </Sheet>
  );
}
