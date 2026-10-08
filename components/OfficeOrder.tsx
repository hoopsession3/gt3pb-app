"use client";

import { useState } from "react";
import Sheet, { CloseButton } from "@/components/Sheet";
import { edited } from "@/lib/formGuard";
import Gt3Mark from "@/components/Gt3Mark";
import Icon from "@/components/Icon";
import { useAuth } from "@/components/AuthProvider";
import { useCustomerKnown, useKnownField, invalidateCustomerKnown } from "@/components/useCustomerKnown";
import { useApp } from "@/components/AppProvider";
import { authedFetch } from "@/lib/authedFetch";
import { OFFICE, officeQuote, mondayLabel } from "@/lib/office";
import { useOfficeSettings } from "./useOfficeSettings";
import { zipMarket } from "@/lib/delivery";
import { marketServes } from "@/lib/markets";
import { money } from "@/lib/money";

// OFFICE DELIVERY — the B2B bulk order (amber gallon jugs, Monday 5–8 AM, 3-gal minimum). Purpose-built
// so it never entangles the residential pack cart. Books a business_order (0187); a standing toggle also
// creates/links a business_account for the weekly generator. Prepaid → we send a payment link; net terms
// → we invoice. Either way the operator confirms — no card is captured here. Raises a crew alert on book.

export default function OfficeOrder({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useApp();
  // An office that has ordered before starts from its account (lib/customerKnown, 2026-10-04): the
  // company, who to text, the door and the access notes from its last order there. Every field was
  // empty on every order, phone included — and phone is required on the prepaid path, so a returning
  // office was blocked until it retyped one. Each field is theirs the moment they type in it.
  const known = useCustomerKnown(!!user);
  const o = known?.office;
  const [company, setCompany] = useKnownField(o?.company);
  const [gallons, setGallons] = useState<number>(OFFICE.minGallons);
  const [headcount, setHeadcount] = useKnownField(o?.headcount);
  const [contact, setContact] = useKnownField(o?.contact || known?.fullName);
  const [phone, setPhone] = useKnownField(o?.phone || known?.phone);
  const [street, setStreet, fromAccount] = useKnownField(o?.street);
  const [city, setCity] = useKnownField(o?.city);
  const [zip, setZip] = useKnownField(o?.zip);
  const [access, setAccess] = useKnownField(o?.access);
  const [standing, setStanding] = useState(false);
  const [billing, setBilling] = useState<"prepaid" | "net15">("prepaid");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ gallons: number; date: string } | null>(null);

  const settings = useOfficeSettings();
  // Display-only quote: the price shown here is a preview. The server (/api/office) recomputes gallons,
  // per-gallon, and total from the live owner-set price and is the sole authority on what's charged —
  // a tampered client total can't reach business_orders.
  const q = officeQuote(gallons, { priceCents: settings.priceCents, minGallons: settings.minGallons });
  // Prepaid texts a secure payment link, so a phone is required on that path (no phone = no way to pay).
  const needsPhone = billing === "prepaid";
  // Same delivery-zone check the residential funnel already enforces before it lets anyone check out
  // (lib/delivery.zipInZone) — office had none at all, client or server, so a mistyped or
  // out-of-territory ZIP sailed straight through to a confirmed "you're on the Monday route" with
  // staff only discovering it was unreachable while planning the actual route.
  // Market-aware: any market that fulfils corporate delivery is in-zone, not just the founding one.
  // Mirrors the server check in /api/office exactly, so the button and the API agree.
  const zoneMarket = zipMarket(zip);
  const zoneOk = !!zoneMarket && marketServes(zoneMarket, "corporate");
  const ready = company.trim() && street.trim() && city.trim() && zip.trim().length >= 5 && zoneOk && gallons >= settings.minGallons && (!needsPhone || phone.trim().length > 0);

  const submit = async () => {
    if (busy) return;
    if (!user) { toast("Sign in to set up office delivery", "error"); return; }
    if (!ready) {
      if (zip.trim().length >= 5 && !zoneOk) { toast("That ZIP looks outside our delivery route — text us and we'll see what we can do", "error"); return; }
      toast(needsPhone && !phone.trim() ? "Add a phone — prepaid sends the payment link by text" : "Add your company and address first", "error");
      return;
    }
    setBusy(true);

    // The server route recomputes the price, re-checks the zone, handles the standing-account
    // create/link, writes business_orders with the service role, and raises the crew alert — the
    // browser no longer inserts (or prices) anything. The quote above is display only.
    try {
      const res = await authedFetch("/api/office", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, contact, phone, headcount, street, city, zip, access, gallons, standing, billing }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { toast(j.error || "Couldn't book it — try again", "error"); setBusy(false); return; }
      setBusy(false);
      invalidateCustomerKnown();   // the next order starts from this one
      setDone({ gallons: j.gallons, date: j.date });
    } catch {
      toast("Couldn't reach the server — check your connection", "error");
      setBusy(false);
    }
  };

  const header = (
    <div className="office-head">
      <span className="office-head-t"><Gt3Mark tone="cream" /> Office delivery</span>
      <CloseButton className="isheet-x" onClick={onClose} />
    </div>
  );
  // What the person typed over what we knew (useKnownField): leaving with it asks first — a pull on the
  // sheet is one flick, and an office order is a lot to type twice.
  const typed = edited(
    { company, headcount, contact, phone, street, city, zip, access },
    { company: o?.company, headcount: o?.headcount, contact: o?.contact || known?.fullName, phone: o?.phone || known?.phone, street: o?.street, city: o?.city, zip: o?.zip, access: o?.access },
    ["company", "headcount", "contact", "phone", "street", "city", "zip", "access"]);

  if (done) {
    return (
      <Sheet open onClose={onClose} label="Office delivery order" header={header} className="office-sheet">
        <div className="office-done">
          <div className="office-done-ic"><Icon name="jar" /></div>
          <h2>You&rsquo;re on the Monday route.</h2>
          <p>{done.gallons} gallons of cold-extract, <b>{mondayLabel(done.date)}, 5–8 AM</b>, in amber glass jugs. We&rsquo;ll {billing === "prepaid" ? "text a payment link to confirm" : "send an invoice"} and swap empties for full every week{standing ? "" : " (this order)"}.</p>
          <button type="button" className="handle" onClick={onClose}><span>Done</span></button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} label="Office delivery order" header={header} className="office-sheet" dirty={typed} dismissible={!busy} detents={false}
      footer={<button type="button" className="handle" onClick={submit} disabled={busy || !ready}><span>{busy ? "Booking…" : `Book ${q.gallons} gal · ${money(q.totalCents)}`}</span></button>}>

      <p className="office-lede">Fresh cold-extract for the whole team — <b>amber gallon jugs</b>, delivered <b>{OFFICE.windowLabel}</b>, empties swapped for full each week. 3-gallon minimum.</p>

      {/* gallons */}
      <div className="office-gal">
        <div className="office-gal-l"><span className="office-k">Gallons</span><span className="office-hint">~{q.gallons * 12}–{q.gallons * 16} cups · ~{money(Math.round(settings.priceCents / 14))}/cup</span></div>
        <div className="office-step">
          <button type="button" onClick={() => setGallons((g) => Math.max(settings.minGallons, g - 1))} aria-label="Fewer" disabled={gallons <= settings.minGallons}>−</button>
          <span className="office-gal-v">{q.gallons}</span>
          <button type="button" onClick={() => setGallons((g) => g + 1)} aria-label="More">+</button>
        </div>
      </div>
      {/* Was OFFICE.pricePerGallonCents (the static constant) sitting right next to a total computed
          from the LIVE settings.priceCents — arithmetic that visibly didn't add up the moment an
          owner changed the live price via Settings, on the primary booking screen a customer sees
          right before they commit. */}
      <div className="office-quote"><span>{q.gallons} gal × {money(settings.priceCents)}</span><b>{money(q.totalCents)}</b></div>

      {/* who + where */}
      <div className="office-fields">
        {fromAccount && <p className="known-note">From your office account — change anything that&apos;s different.</p>}
        <input className="auth-input" placeholder="Company / office name" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" maxLength={80} aria-label="Company" />
        <div className="office-two">
          <input className="auth-input" placeholder="Contact name" value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="name" maxLength={60} aria-label="Contact name" />
          <input className="auth-input" placeholder="# of people" inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Headcount" />
        </div>
        <input className="auth-input" placeholder="Phone (delivery-morning texts)" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} aria-label="Phone" />
        <p className="tel-consent">Your number gets delivery texts from GT3 only — never marketing. Reply STOP anytime.</p>
        <input className="auth-input" placeholder="Street address" value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="address-line1" maxLength={120} aria-label="Street" />
        <div className="office-two">
          <input className="auth-input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" maxLength={60} aria-label="City" />
          <input className="auth-input" inputMode="numeric" autoComplete="postal-code" maxLength={5} placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} aria-label="ZIP" />
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
