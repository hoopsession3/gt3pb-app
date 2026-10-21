"use client";

import "@/components/nutrition/nutrition.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { authedFetch } from "@/lib/authedFetch";
import { PAY_DEADLINE_MS } from "@/lib/deadline";
import { squareClientReady } from "@/lib/square";
import { payErrorText } from "@/lib/idempotency";
import { haptic } from "@/lib/haptics";
import { isNativeApp, WEB_ORIGIN } from "@/lib/native";
import { buyLabel, COURSE_TIER } from "@/lib/nutritionBuy";
import PaymentCard, { type PaymentCardHandle } from "@/components/PaymentCard";
import AccountPill from "@/components/AccountPill";
import Said from "@/components/Said";
import { useIdemKey } from "@/components/useIdemKey";

// BUY GT3 NUTRITION (R46 — Ryan: "One-time buy"; $47, the founding price). The price is the catalog's (the one
// program_tier row, 0443), read here and charged by the server from the same row. A member signs in first — the course
// is kept on their account. One key is one charge (components/useIdemKey, as every card on the site). In the iPhone app
// the purchase is made on the web (a link out, opened in the browser sheet): a course is a digital good, and Apple's
// rules for those are the App Store's to say, so the app never takes a card for it.

type Product = { price_cents: number; blurb: string | null };

export default function CourseBuy({ owned, signedIn, onBought }: { owned: boolean; signedIn: boolean; onBought: () => void }) {
  const loader = useCallback(async (): Promise<Product | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.from("shop_products").select("price_cents, blurb")
      .eq("kind", "program_tier").eq("program_tier", COURSE_TIER).not("published_at", "is", null).is("archived_at", null)
      .order("sort").limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Product | null) ?? null;
  }, []);
  const board = useAsyncData<Product | null>(loader, []);
  const prod = board.data;

  const payRef = useRef<PaymentCardHandle>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const idem = useIdemKey("gt3-course-idem");
  useEffect(() => { if (err) haptic("error"); }, [err]);

  if (owned) return <p className="nu-buy-owned"><span aria-hidden="true">✓</span> GT3 Nutrition is yours — every lesson and every map.</p>;
  if (board.status === "error") return <p className="pr-note pr-note-err">Couldn&apos;t load the price. <button type="button" className="btn-ter" onClick={() => void board.reload()}>Try again</button></p>;
  if (!prod) return null;   // not on sale yet: the course page says what it holds, and nothing offers a sale that isn't there
  const label = buyLabel(prod.price_cents);

  if (done) return <Said as="p" className="nu-buy-owned">{done}</Said>;

  if (isNativeApp()) {
    return (
      <div className="nu-buy">
        <a href={`${WEB_ORIGIN}/primal#nu-pro`} className="btn-pri btn-wide" onClick={() => haptic("light")}>{label} on the web</a>
        <p className="nu-buy-fine">Bought on the web with the same account — it opens here the moment you&apos;re back.</p>
      </div>
    );
  }
  if (!signedIn) {
    return (
      <div className="nu-buy">
        <p className="nu-buy-fine">Sign in first — GT3 Nutrition is kept on your account.</p>
        <AccountPill />
      </div>
    );
  }
  if (!squareClientReady) return <p className="nu-buy-fine">Card checkout isn&apos;t switched on yet.</p>;

  const pay = async () => {
    if (!payRef.current) return;
    setBusy(true); setErr(null);
    const card = payRef.current;
    const attempt = await idem.begin({ course: COURSE_TIER, cents: prod.price_cents }, () => card.tokenize());
    if (!attempt.token) { setErr("Card details look off — check and try again."); setBusy(false); return; }
    idem.sent(attempt.key, true);
    try {
      const r = await authedFetch("/api/nutrition/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: attempt.token, idempotencyKey: attempt.key, expectedCents: prod.price_cents }),
      }, { deadlineMs: PAY_DEADLINE_MS });
      const data = await r.json();
      idem.settle(attempt.key, r.status, data);
      if (!r.ok) { setErr(payErrorText(data.error)); setBusy(false); return; }
      if (data.already) { setDone("You already have GT3 Nutrition — nothing was charged."); onBought(); return; }
      haptic("paid");
      setDone(data.warn || `It's yours — every lesson and every map.${data.emailed ? " Your receipt is in your email." : ""}`);
      onBought();
    } catch {
      idem.settle(attempt.key, null, null);
      setErr("We couldn't confirm the payment — tap the button to check on it. You won't be charged twice."); setBusy(false);
    }
  };

  return (
    <div className="nu-buy">
      {!open ? (
        <button type="button" className="btn-pri btn-wide" onClick={() => { haptic("light"); setOpen(true); }}>{label}</button>
      ) : (
        <>
          <PaymentCard ref={payRef} onReady={setReady} onError={(m) => setErr(m)} />
          {err && <div className="shop-err" role="alert">{err}</div>}
          <button type="button" className="btn-pri btn-wide mt-3" onClick={pay} disabled={!ready || busy}>
            {busy ? "Charging…" : idem.isOpen() ? "Check on my payment" : label}
          </button>
        </>
      )}
      <p className="nu-buy-fine">One time — no subscription. The founding price: every lesson added later is yours too.</p>
    </div>
  );
}
