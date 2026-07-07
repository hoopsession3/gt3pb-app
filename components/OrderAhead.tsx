"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { SQUARE_APP_ID, SQUARE_LOCATION_ID, squareClientReady, squareWebSdkUrl } from "@/lib/square";
import {
  PRICING, PACK_SIZES, PACK_TAG, PACK_HINT, FLAVORS, FLAVOR_DESC,
  packTotal, perBottle, saveAmount, newGlassTotal, mixTotal, mixComplete, mixFitsOrReset, mixSummary,
  dollars, nextDrop, dropForStop, emptyMix, type GlassPath, type Mix, type Flavor,
} from "@/lib/orderAhead";
import { useSiteCopy } from "@/lib/copy";

// ORDER-AHEAD — customer reserve flow (reserve → details → confirmed). One-off Saturday-drop
// pre-orders: no subscription, no deposit, no recurring billing. All money math + the cutoff come
// from lib/orderAhead (the single source of truth); the server re-validates both in /api/reserve.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { Square?: any } }
function loadSquare(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.Square) return resolve(window.Square);
    const existing = document.querySelector<HTMLScriptElement>("script[data-square]");
    if (existing) { existing.addEventListener("load", () => resolve(window.Square)); existing.addEventListener("error", reject); return; }
    const s = document.createElement("script"); s.src = squareWebSdkUrl; s.async = true; s.dataset.square = "1";
    s.onload = () => resolve(window.Square); s.onerror = reject; document.head.appendChild(s);
  });
}
const dayName = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

type View = "reserve" | "details" | "confirmed";

export default function OrderAhead() {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const router = useRouter();
  const t = useSiteCopy();
  const [view, setView] = useState<View>("reserve");
  const [size, setSize] = useState<number>(6);
  const [glass, setGlass] = useState<GlassPath>("return");
  const [mix, setMix] = useState<Mix>(emptyMix());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [now, setNow] = useState<number>(0); // ticks the countdown; 0 until mounted (avoids SSR/clock mismatch)
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [conf, setConf] = useState<{ id: string; size: number; glass: GlassPath; mix: Mix; total: number; sat: Date; name: string; paid: boolean } | null>(null);
  const [stop, setStop] = useState<{ name: string | null; starts_at: string } | null>(null); // the truck's next stop = the pickup
  const cardRef = useRef<any>(null);

  useEffect(() => { setNow(Date.now()); const iv = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(iv); }, []);
  useEffect(() => { setName((n) => n || profile?.display_name || ""); }, [profile?.display_name]);
  // Pickup always follows the next scheduled stop. Load it; fall back to the Saturday drop if none.
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.from("stops").select("name, starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
      .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(1).maybeSingle()
      .then(({ data }) => { if (live && data) setStop(data as { name: string | null; starts_at: string }); });
    return () => { live = false; };
  }, []);

  const drop = useMemo(() => (stop?.starts_at ? dropForStop(stop.starts_at) : nextDrop(now ? new Date(now) : new Date())), [stop, now]);
  const total = packTotal(size, glass);
  const m = mixTotal(mix);
  const complete = mixComplete(mix, size);

  const countdown = useMemo(() => {
    if (!now) return "";
    const ms = drop.cutoff.getTime() - now; if (ms <= 0) return "";
    const h = Math.floor(ms / 36e5), d = Math.floor(h / 24);
    return d > 0 ? `Drop closes in ${d}d ${h % 24}h` : `Drop closes in ${h}h ${Math.floor((ms % 36e5) / 6e4)}m`;
  }, [drop, now]);

  // pack size change: an overfull mix resets (reference behavior, verified in lib/orderAhead)
  const pickSize = (s: number) => { setSize(s); setMix((prev) => mixFitsOrReset(prev, s)); };
  const stepFlavor = (f: Flavor, dir: 1 | -1) => setMix((prev) => {
    const next = prev[f] + dir;
    if (next < 0) return prev;
    if (dir > 0 && mixTotal(prev) >= size) return prev;
    return { ...prev, [f]: next };
  });

  // Square card mounts when we reach the details view.
  useEffect(() => {
    if (view !== "details" || !squareClientReady) return;
    let card: any, cancelled = false;
    (async () => {
      try {
        const Square = await loadSquare(); if (cancelled) return;
        const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        card = await payments.card(); await card.attach("#oa-card"); cardRef.current = card;
        if (!cancelled) setReady(true);
      } catch { if (!cancelled) setErr("Couldn't load the card form. Try again."); }
    })();
    return () => { cancelled = true; setReady(false); cardRef.current?.destroy?.(); cardRef.current = null; };
  }, [view]);

  // One submit path. sourceId = a Square card token (charge now); null = pre-order (pay at pickup).
  const submit = useCallback(async (sourceId: string | null) => {
    setErr("");
    if (!name.trim() || !phone.trim()) { setErr("Name and phone are required for the pickup text."); return; }
    setBusy(true);
    try {
      const accessToken = (await supabase?.auth.getSession())?.data.session?.access_token;
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ sourceId: sourceId ?? undefined, name: name.trim(), phone: phone.trim(), size, glass, mix, dropDate: drop.sat.toISOString() }),
      });
      const data = await res.json(); setBusy(false);
      if (!res.ok) { setErr(data.error || "Something went wrong — try again."); return; }
      setConf({ id: (data.id || data.ref || "").toString(), size, glass, mix: { ...mix }, total, sat: drop.sat, name: name.trim(), paid: !!data.paid });
      setView("confirmed");
    } catch { setBusy(false); setErr("Nothing was charged — try again."); }
  }, [name, phone, size, glass, mix, drop, total]);

  const pay = useCallback(async () => {
    setErr("");
    if (!name.trim() || !phone.trim()) { setErr("Name and phone are required for the pickup text."); return; }
    if (!cardRef.current) return;
    setBusy(true);
    let tok: string;
    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK") { setErr("Card details look off — check and retry."); setBusy(false); return; }
      tok = result.token;
    } catch { setErr("Payment failed — nothing was charged. Try again."); setBusy(false); return; }
    await submit(tok);
  }, [name, phone, submit]);

  const reset = () => { setMix(emptyMix()); setName(profile?.display_name || ""); setPhone(""); setErr(""); setConf(null); setView("reserve"); };

  return (
    <div className="oa">
      <div className="oa-card">
        {/* ============ RESERVE ============ */}
        {view === "reserve" && (
          <div className="oa-view on">
            <div className="oa-kicker">{t("reserve.kicker").toUpperCase()}</div>
            <div className="oa-head">{t("reserve.headline")}</div>
            <div className="oa-cutoff"><span className="oa-dot" /><span>{t("reserve.cutoff")
              .replace("{cutoff}", `${dayName(drop.cutoff)}, ${drop.cutoff.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`)
              .replace("{pickup}", `${dayName(drop.sat)}${stop?.name ? ` · ${stop.name}` : ""}`)}</span></div>
            {countdown && <div className="oa-count">{countdown}</div>}
            <div className="oa-fresh">{t("reserve.fresh")}</div>

            <div className="oa-slabel">How many bottles</div>
            <div className="oa-tiles">
              {PACK_SIZES.map((s) => (
                <button type="button" key={s} className={`oa-tile${size === s ? " sel" : ""}`} onClick={() => pickSize(s)}>
                  {PACK_TAG[s] && <span className="oa-tag">{PACK_TAG[s]}</span>}
                  <div className="oa-c">{s}</div><div className="oa-u">BOTTLES</div>
                  <div className="oa-p">{dollars(packTotal(s, glass))}</div>
                </button>
              ))}
            </div>
            <div className="oa-hint" dangerouslySetInnerHTML={{ __html: `≈ <b>${PACK_HINT[size]}</b>` }} />

            <div className="oa-slabel">Build your pack</div>
            <div className="oa-flavors">
              {FLAVORS.map((f) => (
                <div className="oa-frow" key={f}>
                  <div className="oa-fn">{f}</div><div className="oa-fd">{FLAVOR_DESC[f]}</div>
                  <div className="oa-step">
                    <button type="button" onClick={() => stepFlavor(f, -1)} disabled={mix[f] === 0} aria-label={`One less ${f}`}>−</button>
                    <span className="oa-n">{mix[f]}</span>
                    <button type="button" onClick={() => stepFlavor(f, 1)} disabled={m >= size} aria-label={`One more ${f}`}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className={`oa-fcount${m > size ? " bad" : ""}`}>
              {complete ? <><b>{m} / {size}</b> — pack complete</> : <><b>{m} / {size}</b> bottles picked</>}
            </div>

            <div className="oa-slabel">Your bottles</div>
            <div className="oa-pills">
              <button type="button" className={`oa-pill${glass === "return" ? " sel" : ""}`} onClick={() => setGlass("return")}>
                <div className="oa-pt">Bringing mine back</div><div className="oa-ps">Best price</div>
              </button>
              <button type="button" className={`oa-pill${glass === "new" ? " sel" : ""}`} onClick={() => setGlass("new")}>
                <div className="oa-pt">Need new</div><div className="oa-ps">$10 / bottle</div>
              </button>
            </div>

            <div className="oa-summary">
              <div className="oa-price-row">
                <span className="oa-big">{dollars(total)}</span>
                <span className="oa-per">${perBottle(size, glass).toFixed(2)} / bottle</span>
                {glass === "return" && <span className="oa-save">SAVE ${saveAmount(size)}</span>}
              </div>
              <div className="oa-subnote">
                {glass === "return"
                  ? "Vs. $10 a bottle new. Rinse your empties, bring them Saturday."
                  : <>New glass is $10 flat. <b>Bring bottles back next time</b> to unlock pack pricing.</>}
              </div>
            </div>

            {user ? (
              <>
                <button type="button" className="oa-cta" disabled={!complete} onClick={() => setView("details")}>
                  {complete ? `Reserve — ${dollars(total)} for ${dayName(drop.sat).split(",")[0]}` : "Pick your flavors"}
                </button>
                <div className="oa-window" style={{ whiteSpace: "pre-line" }}>{t("reserve.window")}</div>
              </>
            ) : (
              <>
                <button type="button" className="oa-cta" onClick={() => { try { sessionStorage.setItem("gt3-next", "/reserve"); } catch { /* ignore */ } router.push("/3mpire"); }}>Sign in to reserve — free to join</button>
                <div className="oa-window">Order-ahead is a member perk: reserve the drop, skip the line, and your reservations live in your account.<br />At the window: <b>$10 new · $8 bring-back</b> · single bottle <b>$10</b> — no sign-in needed.</div>
              </>
            )}
          </div>
        )}

        {/* ============ DETAILS ============ */}
        {view === "details" && (
          <div className="oa-view on">
            <button type="button" className="oa-back" onClick={() => setView("reserve")}>← Back</button>
            <div className="oa-kicker">ALMOST THERE</div>
            <div className="oa-head">Who&rsquo;s this drop for?</div>
            <div className="oa-field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" maxLength={80} /></div>
            <div className="oa-field"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="For pickup-day text" maxLength={40} /></div>

            <div className="oa-review">
              <div className="oa-rline"><span className="oa-rk">Pack</span><span className="oa-rv">{size} bottles</span></div>
              <div className="oa-rline"><span className="oa-rk">Flavors</span><span className="oa-rv">{mixSummary(mix)}</span></div>
              <div className="oa-rline"><span className="oa-rk">Glass</span><span className="oa-rv">{glass === "return" ? "Bringing bottles back" : "New glass"}</span></div>
              <div className="oa-rline"><span className="oa-rk">Pickup</span><span className="oa-rv">{dayName(drop.sat)}</span></div>
              <div className="oa-rline total"><span className="oa-rk">Total — one time</span><span className="oa-rv">{dollars(total)}</span></div>
            </div>

            {squareClientReady ? (
              <>
                <div className="oa-slabel">Card</div>
                <div id="oa-card" className="oa-sqwrap" />
                {err && <div className="oa-err">{err}</div>}
                <button type="button" className="oa-cta" onClick={pay} disabled={!ready || busy}>{busy ? "Charging…" : ready ? `Pay ${dollars(total)} with Square` : "Loading card…"}</button>
                <div className="oa-window">One-time payment. Nothing recurring, ever.</div>
              </>
            ) : (
              <>
                {err && <div className="oa-err">{err}</div>}
                <button type="button" className="oa-cta" onClick={() => submit(null)} disabled={busy}>{busy ? "Reserving…" : `Reserve ${dollars(total)} — pay at pickup`}</button>
                <div className="oa-window">Card checkout switches on soon. For now, reserve here and pay at the window on pickup day.</div>
              </>
            )}
          </div>
        )}

        {/* ============ CONFIRMED ============ */}
        {view === "confirmed" && conf && (
          <div className="oa-view on">
            <div className="oa-cicon">✓</div>
            <div className="oa-kicker">RESERVED</div>
            <div className="oa-head">See you {dayName(conf.sat).split(",")[0]}, {conf.name.split(" ")[0]}.</div>
            <div className="oa-review">
              {conf.id && <div className="oa-rline"><span className="oa-rk">Order</span><span className="oa-rv">#{conf.id.slice(0, 6).toUpperCase()}</span></div>}
              <div className="oa-rline"><span className="oa-rk">Pack</span><span className="oa-rv">{conf.size} — {mixSummary(conf.mix)}</span></div>
              <div className="oa-rline"><span className="oa-rk">Pickup</span><span className="oa-rv">{dayName(conf.sat)}</span></div>
              <div className="oa-rline total"><span className="oa-rk">{conf.paid ? "Paid" : "Pay at pickup"}</span><span className="oa-rv">{dollars(conf.total)}</span></div>
            </div>
            <div className="oa-remind">
              {conf.glass === "return"
                ? t("reserve.confirm_return").replace("{size}", String(conf.size))
                : t("reserve.confirm_new")}
            </div>
            <button type="button" className="oa-cta" style={{ marginTop: 18 }} onClick={reset}>Reserve another</button>
          </div>
        )}
      </div>
    </div>
  );
}
