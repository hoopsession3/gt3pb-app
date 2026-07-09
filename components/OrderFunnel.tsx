"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { usePayAtPickup } from "./usePayAtPickup";
import SignIn from "@/components/SignIn";
import OrderConfirm from "@/components/OrderConfirm";
import PaymentCard, { type PaymentCardHandle } from "./PaymentCard";
import MyPacks, { packMix, packDayLabel, type MyPack } from "./MyPacks";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { squareClientReady } from "@/lib/square";
import { haptic, HAPTIC } from "@/lib/haptics";
import {
  PACK_SIZES, PACK_TAG, PACK_HINT, FLAVOR_DESC,
  packTotal, perBottle, saveAmount, dropForStop, nextDrop, type GlassPath,
} from "@/lib/orderAhead";
import {
  quoteDelivery, deliverySlotChoices, zipInZone, maxRefills,
  DELIVERY_PACKS, DELIVERY_PRICING, SALTED_LATTE,
} from "@/lib/delivery";

// ORDER FUNNEL — one screen, two fulfillment modes. Pickup (Saturday truck-stop reserve →
// /api/reserve) and Delivery (Sunday prepaid → /api/delivery/checkout) were separate screens with
// separate carts; flipping mode meant re-entering the whole order. This unifies them: a segmented
// Pickup|Delivery toggle sits at the top, and the SHARED cart (flavor mix + bring-back preference)
// survives the flip — only the bottle count snaps to the target mode's nearest valid tier. The two
// backends stay exactly as they were (they ARE different fulfillment); only the UI is one.
// Both /reserve and /delivery render this; the toggle updates the URL in place (no remount).

type Mode = "pickup" | "delivery";
type Step = "start" | "size" | "build" | "glass" | "details" | "pay" | "done";
type Flav = "rise" | "flow" | "dusk";
const FLAVS: Flav[] = ["rise", "flow", "dusk"];
const FLAV_LABEL: Record<Flav, string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK" };
const FLAV_DESC: Record<Flav, string> = { rise: FLAVOR_DESC.RISE, flow: FLAVOR_DESC.FLOW, dusk: FLAVOR_DESC.DUSK };
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const dayName = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const PICKUP_TIERS = PACK_SIZES as readonly number[]; // [3, 6, 12]

export default function OrderFunnel({ initialMode }: { initialMode: Mode }) {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const payLater = usePayAtPickup();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>(initialMode === "delivery" ? "start" : "size");

  // ── shared cart (survives the mode flip) ──
  const [count, setCount] = useState<number | null>(initialMode === "pickup" ? 6 : null);
  const [mix, setMix] = useState<Record<Flav, number>>({ rise: 0, flow: 0, dusk: 0 });
  const [bringBack, setBringBack] = useState(true); // bring mine back (best price) vs need new

  // ── delivery-only ──
  const choices = useMemo(() => deliverySlotChoices(Date.now()), []);
  const [when, setWhen] = useState(0);
  const slot = choices[when];
  const [zip, setZip] = useState("");
  const [zone, setZone] = useState<"ask" | "in" | "out">("ask");
  const [wlEmail, setWlEmail] = useState("");
  const [wlSent, setWlSent] = useState(false);
  const [premiums, setPremiums] = useState<Record<string, number>>({});
  const [bulkItems, setBulkItems] = useState<{ slug: string; name: string }[]>([{ slug: SALTED_LATTE.key, name: SALTED_LATTE.label }]);
  const [refills, setRefills] = useState(0);
  const [ack, setAck] = useState(false);
  const [access, setAccess] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");

  // ── pickup-only ──
  const [stops, setStops] = useState<{ name: string | null; starts_at: string }[]>([]);
  const [stopIdx, setStopIdx] = useState(0);
  const [now, setNow] = useState(0);
  const [replacing, setReplacing] = useState<MyPack | null>(null);
  const [usual, setUsual] = useState<MyPack | null>(null);
  const [packsKey, setPacksKey] = useState("");

  // ── shared checkout ──
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ total: number; label?: string; warn?: string; paid: boolean; ref?: string } | null>(null);

  const perf = Object.values(premiums).reduce((s, n) => s + (n || 0), 0);
  const picked = mix.rise + mix.flow + mix.dusk + (mode === "delivery" ? perf : 0);
  const refillCap = count ? maxRefills(count, perf) : 0;
  const deliveryQuote = useMemo(
    () => (mode === "delivery" && count ? quoteDelivery(count, perf, bringBack ? refills : 0, "direct") : null),
    [mode, count, perf, bringBack, refills]
  );

  // pickup drop / countdown
  const stop = stops[stopIdx] ?? null;
  const drop = useMemo(() => (stop?.starts_at ? dropForStop(stop.starts_at) : nextDrop(now ? new Date(now) : new Date())), [stop, now]);
  const pickupTotalCents = count ? Math.round(packTotal(count, bringBack ? "return" : "new") * 100) : 0;
  const totalCents = mode === "delivery" ? (deliveryQuote?.totalCents ?? 0) : pickupTotalCents;
  const countdown = useMemo(() => {
    if (mode !== "pickup" || !now) return "";
    const ms = drop.cutoff.getTime() - now; if (ms <= 0) return "";
    const h = Math.floor(ms / 36e5), d = Math.floor(h / 24);
    return d > 0 ? `${d}d ${h % 24}h` : `${h}h ${Math.floor((ms % 36e5) / 6e4)}m`;
  }, [mode, drop, now]);

  // ── effects ──
  useEffect(() => { setNow(Date.now()); const iv = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(iv); }, []);
  useEffect(() => { setName((n) => n || profile?.display_name || ""); }, [profile?.display_name]);

  // delivery: dynamic premium adds (Money → Menu bulk-orderable). Falls back to Salted Latte.
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.from("products").select("slug, name").eq("bulk_orderable", true).eq("bulk_tier", "premium").eq("active", true).eq("sold_out", false).order("bulk_sort")
      .then(({ data }) => { if (live && data && data.length) setBulkItems(data as { slug: string; name: string }[]); });
    return () => { live = false; };
  }, []);

  // pickup: the next scheduled stops = the pickup choices (deduped by drop day, still open).
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.from("stops").select("name, starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
      .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(8)
      .then(({ data }) => {
        if (!live || !data) return;
        const seen = new Set<string>();
        const uniq = (data as { name: string | null; starts_at: string }[]).filter((st) => {
          if (dropForStop(st.starts_at).cutoff.getTime() <= Date.now()) return false;
          const k = new Date(st.starts_at).toISOString().slice(0, 10);
          if (seen.has(k)) return false; seen.add(k); return true;
        }).slice(0, 4);
        setStops(uniq);
      });
    return () => { live = false; };
  }, []);

  // pickup: "Your usual" — the member's most recent pack, one-tap reload.
  useEffect(() => {
    if (!supabase || !user) { setUsual(null); return; }
    supabase.from("drop_orders").select("*").eq("user_id", user.id).is("canceled_at", null)
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => setUsual((data?.[0] as MyPack) ?? null));
  }, [user, packsKey]);

  // Square card — mounted by the shared <PaymentCard> only while step==="pay" is in the tree; React's
  // own mount/unmount lifecycle handles attach/teardown across step changes, so no effect needed here.
  const paymentRef = useRef<PaymentCardHandle>(null);
  const [cardReady, setCardReady] = useState(false);

  // ── the toggle: preserve the cart, snap count, route sanely ──
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    haptic(HAPTIC.tap);
    const tiers = next === "pickup" ? PICKUP_TIERS : DELIVERY_PACKS;
    const need = mix.rise + mix.flow + mix.dusk + (next === "delivery" ? perf : 0);
    // Keep the count if it's already a valid tier; otherwise snap up to the smallest tier that still
    // holds the built mix (never smaller than what they've picked). Mix + bring-back are untouched.
    let nextCount = count;
    if (count == null || !tiers.includes(count)) {
      nextCount = tiers.find((t) => t >= Math.max(count ?? 0, need)) ?? tiers[tiers.length - 1];
    }
    if (next === "pickup") { setPremiums({}); setRefills(0); setAck(false); }
    setMode(next);
    setCount(nextCount);
    try { window.history.replaceState(null, "", next === "delivery" ? "/delivery" : "/reserve"); } catch { /* ignore */ }
    // Delivery can't be ordered without a verified zone. If we haven't checked one, land on the zone
    // hero (cart intact). Otherwise show size so the new tiers/pricing are visible with the mix kept.
    if (next === "delivery" && zone !== "in") { setStep("start"); return; }
    setStep((prev) => (prev === "details" || prev === "pay" || prev === "done" || prev === "start" ? "size" : prev));
  };

  // ── cart handlers ──
  const bump = (k: Flav, d: number) => { haptic(HAPTIC.tap); setMix((m) => ({ ...m, [k]: Math.max(0, m[k] + d) })); };
  const bumpPremium = (slug: string, d: number) => { haptic(HAPTIC.tap); setPremiums((m) => { const v = Math.max(0, (m[slug] || 0) + d); const n = { ...m, [slug]: v }; if (!v) delete n[slug]; return n; }); };
  const pickCount = (s: number) => {
    haptic(HAPTIC.tap);
    setCount(s);
    // an overfull mix resets when the pack shrinks below it (reference behavior)
    setMix((m) => (m.rise + m.flow + m.dusk + (mode === "delivery" ? perf : 0) > s ? { rise: 0, flow: 0, dusk: 0 } : m));
    if (mode === "delivery") setStep("build");
  };

  const checkZone = () => { if (zipInZone(zip)) { setZone("in"); setStep("size"); } else setZone("out"); };
  const joinWaitlist = async () => {
    const r = await fetch("/api/delivery/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zip, email: wlEmail }) });
    if (r.ok) { setWlSent(true); toast("You're on the list"); } else toast("Enter a ZIP and a real email", "error");
  };

  // pickup: change / reload
  const startChange = (p: MyPack) => {
    setMode("pickup"); setCount(p.size); setBringBack(p.glass === "return");
    const pm = packMix(p); setMix({ rise: pm.RISE || 0, flow: pm.FLOW || 0, dusk: pm.DUSK || 0 });
    setName(p.name); setPhone(p.phone ?? ""); setReplacing(p); setStep("size"); setErr("");
    try { document.getElementById("body")?.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* ignore */ }
  };
  const reorderUsual = () => {
    if (!usual) return; haptic(HAPTIC.tap);
    setCount(usual.size); setBringBack(usual.glass === "return");
    const pm = packMix(usual); setMix({ rise: pm.RISE || 0, flow: pm.FLOW || 0, dusk: pm.DUSK || 0 });
    setName((n) => n || usual.name); setPhone((p) => p || usual.phone || "");
    setReplacing(null); setErr(""); toast("Your usual — loaded");
    try { document.getElementById("body")?.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* ignore */ }
  };

  // ── submit ──
  const submitPickup = useCallback(async (sourceId: string | null) => {
    setErr("");
    if (!name.trim() || !phone.trim()) { setErr("Name and phone are required for the pickup text."); return; }
    if (!count) return;
    setBusy(true);
    try {
      const res = await authedFetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: sourceId ?? undefined, name: name.trim(), phone: phone.trim(), size: count, glass: (bringBack ? "return" : "new") as GlassPath, mix: { RISE: mix.rise, FLOW: mix.flow, DUSK: mix.dusk }, dropDate: drop.sat.toISOString() }),
      });
      const data = await res.json(); setBusy(false);
      if (!res.ok) { setErr(data.error || "Something went wrong — try again."); return; }
      haptic(HAPTIC.success);
      setDone({ total: pickupTotalCents, paid: !!data.paid, ref: (data.id || data.ref || "").toString(), label: dayName(drop.sat) });
      setStep("done");
      if (replacing && supabase) {
        const old = replacing; setReplacing(null);
        const { data: ok } = await supabase.rpc("cancel_any_order", { p_channel: "pickup", p_id: old.id });
        toast(ok === true ? "Pack updated — your old reservation was canceled" : "New pack is in, but the old one couldn't be canceled — cancel it under Your pack.", ok === true ? undefined : "error");
      }
      setPacksKey((k) => k + "x");
    } catch { setBusy(false); setErr("Nothing was charged — try again."); }
  }, [name, phone, count, bringBack, mix, drop, pickupTotalCents, replacing, toast]);

  const payDelivery = async () => {
    setErr("");
    if (!cardReady || !count || !deliveryQuote) return;
    setBusy(true);
    try {
      const result = await paymentRef.current!.tokenize();
      if (result.status !== "OK" || !result.token) { setErr("Card details look off — check and retry."); setBusy(false); return; }
      const res = await authedFetch("/api/delivery/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: result.token, name, phone, addressStreet: street, addressCity: city, addressZip: zip,
          accessInstructions: access, packSize: count, riseCount: mix.rise, flowCount: mix.flow, duskCount: mix.dusk,
          perfMix: premiums, refillCount: bringBack ? refills : 0, emptiesAck: ack, deliveryDate: slot.deliveryDateKey,
        }),
      });
      const data = await res.json(); setBusy(false);
      if (!res.ok) { setErr(data.error || "Payment failed"); return; }
      haptic(HAPTIC.success);
      setDone({ total: data.totalCents ?? deliveryQuote.totalCents, label: data.deliveryLabel, warn: data.warn, paid: true });
      setStep("done");
    } catch { setBusy(false); setErr("Payment service unavailable"); }
  };
  const payPickupCard = async () => {
    setErr("");
    if (!name.trim() || !phone.trim()) { setErr("Name and phone are required for the pickup text."); return; }
    if (!cardReady) return;
    setBusy(true);
    try {
      const result = await paymentRef.current!.tokenize();
      if (result.status !== "OK" || !result.token) { setErr("Card details look off — check and retry."); setBusy(false); return; }
      await submitPickup(result.token);
    } catch { setErr("Payment failed — nothing was charged. Try again."); setBusy(false); }
  };

  const resetOrder = () => { setMix({ rise: 0, flow: 0, dusk: 0 }); setPremiums({}); setRefills(0); setAck(false); setErr(""); setDone(null); setStep(mode === "delivery" ? "size" : "size"); };

  // step gating
  const buildReady = count != null && picked === count;
  const glassReady = mode === "delivery" ? bringBack !== null && !(bringBack && refills > 0 && !ack) : true;

  // back navigation per mode
  const goBack = () => {
    if (mode === "delivery") setStep(step === "size" ? "start" : step === "build" ? "size" : step === "glass" ? "build" : step === "details" ? "glass" : "details");
    else setStep(step === "build" ? "size" : step === "glass" ? "build" : step === "details" ? "glass" : "details");
  };

  // ── segmented toggle (shown through the shopping phase) ──
  const showToggle = step === "start" || step === "size" || step === "build" || step === "glass";
  const Toggle = (
    <div className="of-seg" role="tablist" aria-label="Fulfillment">
      <button type="button" role="tab" aria-selected={mode === "pickup"} className={mode === "pickup" ? "on" : ""} onClick={() => switchMode("pickup")}>
        <b>🏪 Pickup</b><span>Grab it at a truck stop</span>
      </button>
      <button type="button" role="tab" aria-selected={mode === "delivery"} className={mode === "delivery" ? "on" : ""} onClick={() => switchMode("delivery")}>
        <b>🚚 Delivery</b><span>Prepaid, to your door</span>
      </button>
    </div>
  );

  // deadline line
  const deadline = mode === "delivery"
    ? <>Drop closes <b>{slot.cutoffLabel}</b> · delivery <b>{slot.deliveryLabel}</b></>
    : <>Drop closes <b>{countdown ? `in ${countdown}` : `${dayName(drop.cutoff)}`}</b> · pickup <b>{dayName(drop.sat)}{stop?.name ? ` · ${stop.name}` : ""}</b></>;

  return (
    <div className="of">
      {showToggle && Toggle}

      {mode === "pickup" && step === "size" && (
        <>
          <MyPacks onChange={startChange} refreshKey={packsKey} />
          {replacing && (
            <div className="oa-editing">
              Editing your {replacing.size}-pack for {packDayLabel(replacing)} — reserving again replaces it.
              <button type="button" onClick={() => setReplacing(null)}>Keep it as is</button>
            </div>
          )}
          {usual && !replacing && (
            <button type="button" className="oa-usual" onClick={reorderUsual}>
              <span className="oa-usual-k">↺ Your usual</span>
              <span className="oa-usual-v">{usual.size} bottles · {usual.glass === "return" ? "bring-back" : "new glass"}</span>
              <span className="oa-usual-go">Load →</span>
            </button>
          )}
        </>
      )}

      {(step === "build" || step === "glass" || step === "details" || step === "pay") && (
        <div className="dl-deadline">{deadline}</div>
      )}

      {/* ── DELIVERY START: zone check ── */}
      {mode === "delivery" && step === "start" && (
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
            <input className="auth-input" inputMode="numeric" maxLength={5} placeholder="ZIP code" value={zip} onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setZone("ask"); }} aria-label="ZIP code" />
            <button type="button" className="handle" onClick={checkZone} disabled={zip.length !== 5}><span>Check</span></button>
          </div>
          {zone === "out" && (
            <div className="dl-out">
              <p className="dl-sub"><b>Not in our delivery zone yet.</b> Drop your email — or grab it at a truck stop instead.</p>
              {wlSent ? <p className="dl-sub ok">✓ You&rsquo;re on the list.</p> : (
                <div className="dl-ziprow">
                  <input className="auth-input" type="email" placeholder="you@email.com" value={wlEmail} onChange={(e) => setWlEmail(e.target.value)} aria-label="Email" />
                  <button type="button" className="handle" onClick={joinWaitlist}><span>Notify me</span></button>
                </div>
              )}
              <button type="button" className="oa-cta ghost" onClick={() => switchMode("pickup")}>Switch to pickup →</button>
            </div>
          )}
        </div>
      )}

      {/* ── SIZE ── */}
      {step === "size" && (
        <div className="dl-step">
          <h2 className="dl-h">{mode === "delivery" ? "We deliver to you. Pick a Sunday and a size." : "Order ahead. Pick a day and a size."}</h2>

          {mode === "delivery" ? (
            <>
              <div className="oa-slabel">Which Sunday</div>
              <div className="dl-days">
                {choices.map((c, i) => (
                  <button key={c.deliveryDateKey} type="button" className={`oa-day${when === i ? " sel" : ""}`} onClick={() => setWhen(i)}>
                    <b>{c.deliveryLabel.replace(", 5–8 AM", "")}</b>
                    <span>{i === 0 ? "this Sunday" : "next Sunday"} · order by {c.cutoffLabel.replace(", 6:00 PM", " 6 PM")}</span>
                  </button>
                ))}
              </div>
            </>
          ) : stops.length > 1 ? (
            <>
              <div className="oa-slabel">Pickup day — your call</div>
              <div className="dl-days">
                {stops.map((st, i) => {
                  const d = dropForStop(st.starts_at);
                  return (
                    <button key={st.starts_at} type="button" className={`oa-day${i === stopIdx ? " sel" : ""}`} onClick={() => setStopIdx(i)}>
                      <b>{dayName(d.sat)}</b>{st.name && <span>{st.name}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          <div className="oa-slabel">How many bottles</div>
          <div className="oa-tiles">
            {(mode === "delivery" ? DELIVERY_PACKS : PICKUP_TIERS).map((s) => (
              <button key={s} type="button" className={`oa-tile${count === s ? " sel" : ""}`} onClick={() => pickCount(s)}>
                {mode === "delivery" && s === 24 && <span className="oa-tag on">FREE DELIVERY</span>}
                {mode === "pickup" && PACK_TAG[s] && <span className="oa-tag">{PACK_TAG[s]}</span>}
                <div className="oa-c">{s}</div><div className="oa-u">BOTTLES</div>
                <div className="oa-p">{mode === "delivery" ? (s === 12 ? "starter" : s === 24 ? "stock up" : "bulk") : dollars(packTotal(s, bringBack ? "return" : "new") * 100)}</div>
              </button>
            ))}
          </div>
          {mode === "delivery"
            ? <p className="dl-note">Delivery {dollars(DELIVERY_PRICING.feeCents)} flat — free at {DELIVERY_PRICING.feeWaivedAt}+ bottles.</p>
            : <div className="dl-note" dangerouslySetInnerHTML={{ __html: count ? `≈ <b>${PACK_HINT[count]}</b>` : "" }} />}
          {mode === "pickup" && count != null && (
            <button type="button" className="oa-cta" disabled={!count} onClick={() => setStep("build")}>Build your pack →</button>
          )}
        </div>
      )}

      {/* ── BUILD (flavors + premium) ── */}
      {step === "build" && count && (
        <div className="dl-step">
          <h2 className="dl-h">Build your pack.</h2>
          <p className="dl-sub">Rise, Flow, Dusk — mix as you go. <b>{picked} / {count}</b> bottles picked.</p>
          {FLAVS.map((k) => (
            <div className="dl-ctr" key={k}>
              <span className="dl-ctr-n">{FLAV_LABEL[k]} <em>{FLAV_DESC[k]}</em></span>
              <div className="dl-ctr-b">
                <button type="button" onClick={() => bump(k, -1)} disabled={mix[k] === 0} aria-label={`Fewer ${k}`}>−</button>
                <b>{mix[k]}</b>
                <button type="button" onClick={() => bump(k, 1)} disabled={picked >= count} aria-label={`More ${k}`}>+</button>
              </div>
            </div>
          ))}
          {mode === "delivery" && bulkItems.length > 0 && (
            <div className="dl-perf">
              <div className="dl-ctr-n">PREMIUM <em>{dollars(SALTED_LATTE.price)} / bottle · always fresh</em></div>
              {bulkItems.map((it) => (
                <div className="dl-ctr sm" key={it.slug}>
                  <span className="dl-ctr-n">{it.name}</span>
                  <div className="dl-ctr-b">
                    <button type="button" onClick={() => bumpPremium(it.slug, -1)} disabled={!premiums[it.slug]} aria-label={`Fewer ${it.name}`}>−</button>
                    <b>{premiums[it.slug] || 0}</b>
                    <button type="button" onClick={() => bumpPremium(it.slug, 1)} disabled={picked >= count} aria-label={`More ${it.name}`}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="oa-cta" disabled={picked !== count} onClick={() => setStep("glass")}>
            {picked === count ? "Your bottles →" : `Pick ${count - picked} more`}
          </button>
        </div>
      )}

      {/* ── GLASS / bring-back vs new ── */}
      {step === "glass" && count && (
        <div className="dl-step">
          <h2 className="dl-h">Your bottles.</h2>
          {mode === "delivery" ? (
            <>
              <button type="button" className={`dl-card${bringBack ? " on" : ""}`} onClick={() => { setBringBack(true); setRefills((r) => Math.min(refillCap, r || refillCap)); }}>
                <b>Bringing mine back — best price</b>
                <span>Rinse your empties, set them out. We swap them for your new order. {dollars(DELIVERY_PRICING.refill)}/bottle instead of {dollars(DELIVERY_PRICING.fresh)}.</span>
              </button>
              {bringBack && (
                <div className="dl-loop">
                  <label className="dl-sub" htmlFor="of-ref">How many empties are you returning? <em>(up to {refillCap})</em></label>
                  <div className="dl-ctr-b lone">
                    <button type="button" onClick={() => setRefills((r) => Math.max(0, r - 1))} aria-label="Fewer">−</button>
                    <b id="of-ref">{refills}</b>
                    <button type="button" onClick={() => setRefills((r) => Math.min(refillCap, r + 1))} aria-label="More">+</button>
                  </div>
                  {refills > 0 && (
                    <>
                      <p className="dl-callout">Set your rinsed empties on the porch by <b>5 AM Sunday</b>. No empties out, no swap — you&rsquo;ll pick up at GT3PB instead.</p>
                      <label className="dl-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Got it — empties out by 5 AM Sunday.</span></label>
                    </>
                  )}
                </div>
              )}
              <button type="button" className={`dl-card${!bringBack ? " on" : ""}`} onClick={() => { setBringBack(false); setRefills(0); setAck(false); }}>
                <b>Need all new</b>
                <span>Sealed bottles delivered fresh. {dollars(DELIVERY_PRICING.fresh)}/bottle.</span>
              </button>
              {deliveryQuote && (
                <div className="dl-quote">
                  {deliveryQuote.refillCount > 0 && <span><b>{deliveryQuote.refillCount}</b> refills · {dollars(deliveryQuote.refillCount * DELIVERY_PRICING.refill)}</span>}
                  {deliveryQuote.newCount > 0 && <span><b>{deliveryQuote.newCount}</b> new · {dollars(deliveryQuote.newCount * DELIVERY_PRICING.fresh)}</span>}
                  {deliveryQuote.performanceCount > 0 && <span><b>{deliveryQuote.performanceCount}</b> {SALTED_LATTE.label} · {dollars(deliveryQuote.performanceCount * SALTED_LATTE.price)}</span>}
                  <span>delivery · {deliveryQuote.deliveryFeeCents === 0 ? "on us" : dollars(deliveryQuote.deliveryFeeCents)}</span>
                  <span className="dl-quote-t">total <b>{dollars(deliveryQuote.totalCents)}</b></span>
                </div>
              )}
            </>
          ) : (
            <>
              <button type="button" className={`dl-card${bringBack ? " on" : ""}`} onClick={() => setBringBack(true)}>
                <b>Bringing mine back — best price</b>
                <span>Pack pricing. Rinse your empties and bring them Saturday. ${perBottle(count, "return").toFixed(2)}/bottle.</span>
              </button>
              <button type="button" className={`dl-card${!bringBack ? " on" : ""}`} onClick={() => setBringBack(false)}>
                <b>Need new glass</b>
                <span>New sealed bottle, {dollars(1000)}/bottle flat. Bring them back next time to unlock pack pricing.</span>
              </button>
              <div className="dl-quote">
                <span><b>{count}</b> bottles · {mode === "pickup" && bringBack ? `save $${saveAmount(count)}` : "new glass"}</span>
                <span>${perBottle(count, bringBack ? "return" : "new").toFixed(2)} / bottle</span>
                <span className="dl-quote-t">total <b>{dollars(pickupTotalCents)}</b></span>
              </div>
            </>
          )}
          <button type="button" className="oa-cta" disabled={!glassReady} onClick={() => setStep("details")}>
            {mode === "delivery" ? "Delivery details →" : "Who's it for? →"}
          </button>
        </div>
      )}

      {/* ── DETAILS ── */}
      {step === "details" && (
        <div className="dl-step">
          <h2 className="dl-h">{mode === "delivery" ? "Where do we bring it?" : "Who's this drop for?"}</h2>
          {!user ? (
            <>
              <p className="dl-sub">Sign in so your order is yours to track and manage.</p>
              <SignIn />
            </>
          ) : mode === "delivery" ? (
            <>
              <input className="auth-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
              <input className="auth-input" placeholder="Phone (for delivery-day texts)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" />
              <input className="auth-input" placeholder="Street address" value={street} onChange={(e) => setStreet(e.target.value)} aria-label="Street address" />
              <div className="dl-ziprow">
                <input className="auth-input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City" />
                <input className="auth-input dl-zip" value={zip} readOnly aria-label="ZIP (from your zone check)" />
              </div>
              <input className="auth-input" placeholder="Gate code / access notes (optional)" value={access} onChange={(e) => setAccess(e.target.value)} aria-label="Access instructions" />
              <button type="button" className="oa-cta" disabled={!name.trim() || !street.trim() || !city.trim()} onClick={() => setStep("pay")}>Payment →</button>
            </>
          ) : (
            <>
              <input className="auth-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} aria-label="Name" />
              <input className="auth-input" placeholder="Phone (for pickup-day text)" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} aria-label="Phone" />
              <div className="dl-quote">
                <span>{count} bottles · {bringBack ? "bring-back" : "new glass"}</span>
                <span>pickup {dayName(drop.sat)}{stop?.name ? ` · ${stop.name}` : ""}</span>
                <span className="dl-quote-t">total <b>{dollars(pickupTotalCents)}</b></span>
              </div>
              <button type="button" className="oa-cta" disabled={!name.trim() || !phone.trim()} onClick={() => setStep("pay")}>Payment →</button>
            </>
          )}
        </div>
      )}

      {/* ── PAY ── */}
      {step === "pay" && (
        <div className="dl-step">
          <h2 className="dl-h">Lock it in.</h2>
          <div className="dl-quote">
            <span>{count} bottles{mode === "delivery" ? "" : ` · pickup ${dayName(drop.sat)}`}</span>
            <span className="dl-quote-t">total <b>{dollars(totalCents)}</b></span>
          </div>
          {squareClientReady ? (
            <>
              <p className="dl-sub">{mode === "delivery" ? "One charge now — nothing due at the door." : "Pay now, or reserve and pay at pickup."}</p>
              <PaymentCard ref={paymentRef} className="sq-card" onReady={setCardReady} onError={(m) => setErr(m ?? "")} />
              {err && <p className="dl-err" role="alert">{err}</p>}
              <button type="button" className="oa-cta" disabled={!cardReady || busy} onClick={mode === "delivery" ? payDelivery : payPickupCard}>
                {busy ? "Charging…" : `Pay ${dollars(totalCents)}`}
              </button>
              {mode === "pickup" && payLater.on && (
                <button type="button" className="oa-paylater" onClick={() => submitPickup(null)} disabled={busy}>
                  {busy ? "Reserving…" : "or reserve now — pay at pickup"}
                </button>
              )}
            </>
          ) : mode === "pickup" && payLater.on ? (
            <>
              {err && <p className="dl-err" role="alert">{err}</p>}
              <button type="button" className="oa-cta" onClick={() => submitPickup(null)} disabled={busy}>
                {busy ? "Reserving…" : `Reserve ${dollars(totalCents)} — pay at pickup`}
              </button>
              <p className="dl-sub">Reserve here and pay at the window on pickup day.</p>
            </>
          ) : (
            <p className="dl-sub">Checkout isn&rsquo;t switched on yet — card payments arrive with the Square keys.</p>
          )}
        </div>
      )}

      {/* ── DONE ── */}
      {step === "done" && done && (
        <OrderConfirm
          title={done.paid ? "You're in." : "You're reserved."}
          sub={mode === "delivery" ? "We'll be there before sunrise Sunday." : `See you ${dayName(drop.sat).split(",")[0]}${name ? `, ${name.split(" ")[0]}` : ""}.`}
          totalCents={done.total}
          warn={done.warn}
          rows={[
            { label: "Pack", value: `${count} bottles` },
            ...(mode === "delivery"
              ? [
                  { label: "Delivery", value: done.label ?? "" },
                  { label: "Address", value: `${street}, ${city} ${zip}` },
                  ...(bringBack && refills > 0 ? [{ label: "Empties", value: `${refills} out by 5 AM Sun` }] : []),
                  { label: "Fresh", value: "7 days from delivery" },
                ]
              : [
                  ...(done.ref ? [{ label: "Order", value: `#${done.ref.slice(0, 6).toUpperCase()}` }] : []),
                  { label: "Pickup", value: `${done.label}${stop?.name ? ` · ${stop.name}` : ""}` },
                  { label: done.paid ? "Paid" : "Pay at pickup", value: dollars(done.total) },
                ]),
          ]}
          ctaLabel={mode === "delivery" ? "Track it in your account" : "Reserve another"}
          onCta={mode === "delivery" ? () => router.push("/3mpire") : resetOrder}
        />
      )}

      {/* back — hidden on the first shopping step + on done */}
      {step !== "done" && !(mode === "delivery" && step === "start") && !(mode === "pickup" && step === "size") && (
        <button type="button" className="dl-back" onClick={goBack}>‹ Back</button>
      )}
    </div>
  );
}
