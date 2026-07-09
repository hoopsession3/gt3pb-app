"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import SignIn from "@/components/SignIn";
import { supabase } from "@/lib/supabase";
import { SQUARE_APP_ID, SQUARE_LOCATION_ID, squareClientReady, squareWebSdkUrl } from "@/lib/square";
import { haptic, HAPTIC } from "@/lib/haptics";
import {
  quoteDelivery, deliverySlotChoices, zipInZone, maxRefills,
  DELIVERY_PACKS, DELIVERY_PRICING, SALTED_LATTE,
} from "@/lib/delivery";

// SUNDAY DELIVERY — the debrief's 6-step flow on the house patterns: the Reserve flow's pack
// builder mechanics, the Checkout sheet's Square card mount, lib/delivery as the one money truth
// (the API re-derives everything — this screen is honesty, not enforcement). Voice 2 throughout.
// Steps: zone → size → build → return → details → pay → done.

type Step = "zone" | "size" | "build" | "return" | "details" | "pay" | "done";
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const BASE_LABEL: Record<"rise" | "flow" | "dusk", string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK" };

export default function DeliveryPage() {
  const { toast } = useApp();
  const { user, enabled } = useAuth();
  const router = useRouter();
  const choices = useMemo(() => deliverySlotChoices(Date.now()), []);
  const [when, setWhen] = useState(0); // 0 = this Sunday, 1 = next
  const slot = choices[when];

  const [step, setStep] = useState<Step>("zone");
  const [zip, setZip] = useState("");
  const [zoneState, setZoneState] = useState<"ask" | "in" | "out">("ask");
  const [wlEmail, setWlEmail] = useState("");
  const [wlSent, setWlSent] = useState(false);

  const [pack, setPack] = useState<number | null>(null);
  const [mix, setMix] = useState<Record<"rise" | "flow" | "dusk", number>>({ rise: 0, flow: 0, dusk: 0 });
  // The $14 premium adds are DYNAMIC — whatever the owner flags bulk-orderable (Money → Menu).
  // Falls back to the static Salted Latte until 0144's bulk columns land, so the flow never breaks.
  const [bulkItems, setBulkItems] = useState<{ slug: string; name: string }[]>([{ slug: SALTED_LATTE.key, name: SALTED_LATTE.label }]);
  const [premiums, setPremiums] = useState<Record<string, number>>({}); // slug → count
  const perf = Object.values(premiums).reduce((s, n) => s + (n || 0), 0);
  const picked = mix.rise + mix.flow + mix.dusk + perf;
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.from("products").select("slug, name").eq("bulk_orderable", true).eq("bulk_tier", "premium").eq("active", true).eq("sold_out", false).order("bulk_sort")
      .then(({ data }) => { if (live && data && data.length) setBulkItems(data as { slug: string; name: string }[]); });
    return () => { live = false; };
  }, []);

  const [path, setPath] = useState<"loop" | "new" | null>(null);
  const [refills, setRefills] = useState(0);
  const [ack, setAck] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [access, setAccess] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ label: string; total: number; warn?: string } | null>(null);

  const quote = useMemo(
    () => (pack ? quoteDelivery(pack, perf, path === "loop" ? refills : 0, "direct") : null),
    [pack, perf, path, refills]
  );
  const refillCap = pack ? maxRefills(pack, perf) : 0;

  // Square card mount — same lifecycle as the checkout sheet.
  const cardRef = useRef<{ tokenize: () => Promise<{ status: string; token?: string }>; destroy?: () => void } | null>(null);
  const [cardReady, setCardReady] = useState(false);
  // The card mount must survive the SDK loading a beat late: keep re-attempting the WHOLE attach
  // (payments → card → attach) until window.Square exists and the iframe mounts — the old version
  // bailed once and never retried. And surface any Square error instead of leaving a silent blank box.
  useEffect(() => {
    if (step !== "pay" || !squareClientReady) return;
    let dead = false;
    let attaching = false;
    let polls = 0;
    let iv: ReturnType<typeof setInterval> | undefined;
    const tryMount = async (): Promise<boolean> => {
      if (dead || cardRef.current || attaching) return true;
      const Square = (window as unknown as { Square?: { payments: (a: string, l: string) => { card: () => Promise<{ attach: (sel: string) => Promise<void>; tokenize: () => Promise<{ status: string; token?: string }>; destroy?: () => void }> } } }).Square;
      if (!Square) return false; // SDK script still loading — keep polling
      attaching = true;
      try {
        const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        const card = await payments.card();
        if (dead) { card.destroy?.(); return true; }
        await card.attach("#dl-card");
        cardRef.current = card;
        setCardReady(true);
        setErr("");
        return true;
      } catch (e) {
        setErr(`Card form couldn't load — ${e instanceof Error ? e.message : "Square error"}. Retrying…`);
        return false;
      } finally {
        attaching = false;
      }
    };
    (async () => {
      if (await tryMount()) return;
      iv = setInterval(async () => {
        polls += 1;
        if (dead || cardRef.current) { if (iv) clearInterval(iv); return; }
        if (await tryMount()) { if (iv) clearInterval(iv); return; }
        if (polls >= 25) { // ~7.5s — the SDK never showed up
          if (iv) clearInterval(iv);
          if (!cardRef.current) setErr("Card form didn't load. Refresh and try again — if it keeps happening, tell us.");
        }
      }, 300);
    })();
    return () => { dead = true; if (iv) clearInterval(iv); cardRef.current?.destroy?.(); cardRef.current = null; setCardReady(false); };
  }, [step]);

  const bump = (k: "rise" | "flow" | "dusk", d: number) => {
    haptic(HAPTIC.tap);
    setMix((m) => ({ ...m, [k]: Math.max(0, m[k] + d) }));
  };
  const bumpPremium = (slug: string, d: number) => { haptic(HAPTIC.tap); setPremiums((m) => { const v = Math.max(0, (m[slug] || 0) + d); const n = { ...m, [slug]: v }; if (!v) delete n[slug]; return n; }); };

  const checkZone = () => {
    if (zipInZone(zip)) { setZoneState("in"); setStep("size"); }
    else setZoneState("out");
  };
  const joinWaitlist = async () => {
    const r = await fetch("/api/delivery/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zip, email: wlEmail }) });
    if (r.ok) { setWlSent(true); toast("You're on the list"); } else toast("Enter a ZIP and a real email", "error");
  };

  const pay = async () => {
    setErr("");
    if (!cardRef.current || !pack || !quote) return;
    setBusy(true);
    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK" || !result.token) { setErr("Card details look off — check and retry."); setBusy(false); return; }
      const accessToken = (await supabase?.auth.getSession())?.data.session?.access_token;
      const res = await fetch("/api/delivery/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({
          sourceId: result.token, name, phone, addressStreet: street, addressCity: city, addressZip: zip,
          accessInstructions: access, packSize: pack, riseCount: mix.rise, flowCount: mix.flow, duskCount: mix.dusk,
          perfMix: premiums, refillCount: path === "loop" ? refills : 0, emptiesAck: ack, deliveryDate: slot.deliveryDateKey,
        }),
      });
      const data = await res.json();
      setBusy(false);
      if (!res.ok) { setErr(data.error || "Payment failed"); return; }
      haptic(HAPTIC.success);
      setDone({ label: data.deliveryLabel, total: data.totalCents ?? quote.totalCents, warn: data.warn });
      setStep("done");
    } catch { setBusy(false); setErr("Payment service unavailable"); }
  };

  if (!enabled) return null;

  return (
    <section className="screen" id="s-delivery">
      {squareClientReady && <Script src={squareWebSdkUrl} strategy="afterInteractive" />}
      <div className="toprow">
        <div className="eyb">Sunday Delivery</div>
        <AccountPill />
      </div>

      {/* Mode banner — DELIVERY (prepaid, to your door), clearly distinct from pickup. Kept short:
          the hero owns the timing pitch, so the banner is just mode + the prepaid fact. */}
      <div className="oa-mode">
        <span className="oa-mode-b">🚚 Delivery</span>
        <span className="oa-mode-s">Prepaid — brought to your door.</span>
        <button type="button" className="oa-mode-alt" onClick={() => router.push("/reserve")}>Rather pick up? →</button>
      </div>

      {/* the deadline line — the one fact the build steps need. Not on the landing (hero carries the
          timing), not on size (the day picker shows each Sunday's cutoff), not on done (order's placed). */}
      {(step === "build" || step === "return" || step === "details" || step === "pay") && (
        <div className="dl-deadline">Drop closes <b>{slot.cutoffLabel}</b> · delivery <b>{slot.deliveryLabel}</b></div>
      )}

      {step === "zone" && (
        <div className="dl-step">
          <div className="dl-hero">
            <h2 className="dl-h dl-h-xl">Your week, <em>delivered.</em></h2>
            <p className="dl-sub">Cold-extracted Rise, Flow &amp; Dusk &mdash; on your porch by sunrise Sunday. Smooth, low-acid, and perfect for 7 days.</p>
            <div className="dl-tiers">
              <span><b>{dollars(DELIVERY_PRICING.refill)}</b> swap your empties</span>
              <span><b>{dollars(DELIVERY_PRICING.fresh)}</b> new bottle</span>
              <span><b>{dollars(SALTED_LATTE.price)}</b> {bulkItems[0]?.name ?? SALTED_LATTE.label}</span>
            </div>
          </div>
          <p className="dl-sub dl-zlead">Enter your ZIP &mdash; we&rsquo;ll check your porch.</p>
          <div className="dl-ziprow dl-ziprow-xl">
            <input className="auth-input" inputMode="numeric" maxLength={5} placeholder="ZIP code" value={zip} onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setZoneState("ask"); }} aria-label="ZIP code" />
            <button type="button" className="handle" onClick={checkZone} disabled={zip.length !== 5}><span>Check</span></button>
          </div>
          {zoneState === "out" && (
            <div className="dl-out">
              <p className="dl-sub"><b>Not in our zone yet.</b> Drop your email — we&rsquo;ll tell you when we&rsquo;re coming.</p>
              {wlSent ? <p className="dl-sub ok">✓ You&rsquo;re on the list.</p> : (
                <div className="dl-ziprow">
                  <input className="auth-input" type="email" placeholder="you@email.com" value={wlEmail} onChange={(e) => setWlEmail(e.target.value)} aria-label="Email" />
                  <button type="button" className="handle" onClick={joinWaitlist}><span>Notify me</span></button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === "size" && (
        <div className="dl-step">
          <h2 className="dl-h">We deliver to you. Pick a Sunday and a size.</h2>

          <div className="oa-slabel">Which Sunday</div>
          <div className="dl-days">
            {choices.map((c, i) => (
              <button key={c.deliveryDateKey} type="button" className={`oa-day${when === i ? " sel" : ""}`} onClick={() => setWhen(i)}>
                <b>{c.deliveryLabel.replace(", 5–8 AM", "")}</b>
                <span>{i === 0 ? "this Sunday" : "next Sunday"} · order by {c.cutoffLabel.replace(", 6:00 PM", " 6 PM")}</span>
              </button>
            ))}
          </div>

          <div className="oa-slabel">How many bottles</div>
          <div className="oa-tiles">
            {DELIVERY_PACKS.map((s) => (
              <button key={s} type="button" className={`oa-tile${pack === s ? " sel" : ""}`} onClick={() => { setPack(s); setStep("build"); }}>
                {s === 24 && <span className="oa-tag on">FREE DELIVERY</span>}
                <div className="oa-c">{s}</div><div className="oa-u">BOTTLES</div>
                <div className="oa-p">{s === 12 ? "starter" : s === 24 ? "stock up" : "bulk"}</div>
              </button>
            ))}
          </div>
          <p className="dl-note">Delivery {dollars(DELIVERY_PRICING.feeCents)} flat — free at {DELIVERY_PRICING.feeWaivedAt}+ bottles.</p>
        </div>
      )}

      {step === "build" && pack && (
        <div className="dl-step">
          <h2 className="dl-h">Build your pack.</h2>
          <p className="dl-sub">Rise, Flow, Dusk — mix as you go. <b>{picked} / {pack}</b> bottles picked.</p>
          {(["rise", "flow", "dusk"] as const).map((k) => (
            <div className="dl-ctr" key={k}>
              <span className="dl-ctr-n">{BASE_LABEL[k]}</span>
              <div className="dl-ctr-b">
                <button type="button" onClick={() => bump(k, -1)} disabled={mix[k] === 0} aria-label={`Fewer ${k}`}>−</button>
                <b>{mix[k]}</b>
                <button type="button" onClick={() => bump(k, 1)} disabled={picked >= pack} aria-label={`More ${k}`}>+</button>
              </div>
            </div>
          ))}
          {bulkItems.length > 0 && (
            <div className="dl-perf">
              <div className="dl-ctr-n">PREMIUM <em>{dollars(SALTED_LATTE.price)} / bottle · always fresh</em></div>
              {bulkItems.map((it) => (
                <div className="dl-ctr sm" key={it.slug}>
                  <span className="dl-ctr-n">{it.name}</span>
                  <div className="dl-ctr-b">
                    <button type="button" onClick={() => bumpPremium(it.slug, -1)} disabled={!premiums[it.slug]} aria-label={`Fewer ${it.name}`}>−</button>
                    <b>{premiums[it.slug] || 0}</b>
                    <button type="button" onClick={() => bumpPremium(it.slug, 1)} disabled={picked >= pack} aria-label={`More ${it.name}`}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="oa-cta" disabled={picked !== pack} onClick={() => setStep("return")}>
            {picked === pack ? "Bottles →" : `Pick ${pack - picked} more`}
          </button>
        </div>
      )}

      {step === "return" && pack && quote && (
        <div className="dl-step">
          <h2 className="dl-h">Your bottles.</h2>
          <button type="button" className={`dl-card${path === "loop" ? " on" : ""}`} onClick={() => { setPath("loop"); setRefills(Math.min(refillCap, refills || refillCap)); }}>
            <b>Bringing mine back — best price</b>
            <span>Rinse your empties, set them out. We swap them for your new order. {dollars(DELIVERY_PRICING.refill)}/bottle instead of {dollars(DELIVERY_PRICING.fresh)}.</span>
          </button>
          {path === "loop" && (
            <div className="dl-loop">
              <label className="dl-sub" htmlFor="dl-ref">How many empties are you returning? <em>(up to {refillCap})</em></label>
              <div className="dl-ctr-b lone">
                <button type="button" onClick={() => setRefills((r) => Math.max(0, r - 1))} aria-label="Fewer">−</button>
                <b id="dl-ref">{refills}</b>
                <button type="button" onClick={() => setRefills((r) => Math.min(refillCap, r + 1))} aria-label="More">+</button>
              </div>
              {refills > 0 && (
                <>
                  <p className="dl-callout">Set your rinsed empties on the porch by <b>5 AM Sunday</b>. No empties out, no swap — you&rsquo;ll pick up at GT3PB instead.</p>
                  <label className="dl-ack">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>Got it — empties out by 5 AM Sunday.</span>
                  </label>
                </>
              )}
            </div>
          )}
          <button type="button" className={`dl-card${path === "new" ? " on" : ""}`} onClick={() => { setPath("new"); setRefills(0); setAck(false); }}>
            <b>Need all new</b>
            <span>Sealed bottles delivered fresh. {dollars(DELIVERY_PRICING.fresh)}/bottle.</span>
          </button>
          <div className="dl-quote">
            {quote.refillCount > 0 && <span><b>{quote.refillCount}</b> refills · {dollars(quote.refillCount * DELIVERY_PRICING.refill)}</span>}
            {quote.newCount > 0 && <span><b>{quote.newCount}</b> new · {dollars(quote.newCount * DELIVERY_PRICING.fresh)}</span>}
            {quote.performanceCount > 0 && <span><b>{quote.performanceCount}</b> {SALTED_LATTE.label} · {dollars(quote.performanceCount * SALTED_LATTE.price)}</span>}
            <span>delivery · {quote.deliveryFeeCents === 0 ? "on us" : dollars(quote.deliveryFeeCents)}</span>
            <span className="dl-quote-t">total <b>{dollars(quote.totalCents)}</b></span>
          </div>
          <button type="button" className="oa-cta" disabled={!path || (path === "loop" && refills > 0 && !ack)} onClick={() => setStep("details")}>
            Delivery details →
          </button>
        </div>
      )}

      {step === "details" && (
        <div className="dl-step">
          <h2 className="dl-h">Where do we bring it?</h2>
          {!user ? (
            <>
              <p className="dl-sub">Sign in so your order is yours to track and manage.</p>
              <SignIn />
            </>
          ) : (
            <>
              <input className="auth-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
              <input className="auth-input" placeholder="Phone (for delivery-day texts)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" />
              <input className="auth-input" placeholder="Street address" value={street} onChange={(e) => setStreet(e.target.value)} aria-label="Street address" />
              <div className="dl-ziprow">
                <input className="auth-input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City" />
                <input className="auth-input dl-zip" value={zip} readOnly aria-label="ZIP (from your zone check)" />
              </div>
              <input className="auth-input" placeholder="Gate code / access notes (optional)" value={access} onChange={(e) => setAccess(e.target.value)} aria-label="Access instructions" />
              <button type="button" className="oa-cta" disabled={!name.trim() || !street.trim() || !city.trim()} onClick={() => setStep("pay")}>
                Payment →
              </button>
            </>
          )}
        </div>
      )}

      {step === "pay" && quote && (
        <div className="dl-step">
          <h2 className="dl-h">Lock it in.</h2>
          <div className="dl-quote">
            <span>{pack} bottles</span>
            <span className="dl-quote-t">total <b>{dollars(quote.totalCents)}</b></span>
          </div>
          {/* Delivery is always paid on order — card required, no cash on delivery. */}
          {squareClientReady ? (
            <>
              <p className="dl-sub">One charge now — nothing due at the door.</p>
              <div id="dl-card" className="sq-card" />
              {err && <p className="dl-err" role="alert">{err}</p>}
              <button type="button" className="oa-cta" disabled={!cardReady || busy} onClick={pay}>
                {busy ? "Charging…" : `Pay ${dollars(quote.totalCents)}`}
              </button>
            </>
          ) : (
            <p className="dl-sub">Checkout isn&rsquo;t switched on yet — card payments arrive with the Square keys.</p>
          )}
        </div>
      )}

      {step === "done" && done && (
        <div className="dl-step">
          <h2 className="dl-h">You&rsquo;re in. We&rsquo;ll be there before sunrise Sunday.</h2>
          <div className="dl-quote">
            <span>{pack} bottles · paid <b>{dollars(done.total)}</b></span>
            <span>{done.label}</span>
            <span>{street}, {city} {zip}</span>
            {refills > 0 && <span>Rinse and set out <b>{refills} empties</b> on the porch before 5 AM Sunday.</span>}
            <span>Fresh 7 days from delivery.</span>
          </div>
          {done.warn && <p className="dl-err" role="alert">{done.warn}</p>}
          <button type="button" className="handle" onClick={() => router.push("/3mpire")}><span>Track it in your account</span></button>
          <div className="signoff">Pure Signal. No Noise.</div>
        </div>
      )}

      {step !== "zone" && step !== "done" && (
        <button type="button" className="dl-back" onClick={() => setStep(step === "size" ? "zone" : step === "build" ? "size" : step === "return" ? "build" : step === "details" ? "return" : "details")}>‹ Back</button>
      )}
    </section>
  );
}
