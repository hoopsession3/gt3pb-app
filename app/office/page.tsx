"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Gt3Mark from "@/components/Gt3Mark";
import Skeleton from "@/components/Skeleton";
import { supabase } from "@/lib/supabase";
import { OFFICE, officeQuote, mondayLabel } from "@/lib/office";

// OFFICE PORTAL — the B2B self-serve surface (Phase 3). A business account holder manages their
// standing weekly order (pause / resume / adjust gallons), sees upcoming Monday deliveries, their
// amber-jug balance, and invoices. Everything reads their own rows (RLS, 0187).
type Acct = { id: string; company: string; standing_active: boolean; standing_gallons: number | null; jug_balance: number; billing_terms: string };
type Ord = { id: string; delivery_date: string; gallons: number; total_cents: number; status: string; payment_status: string };
type Inv = { id: string; amount_cents: number; status: string; issued_at: string; terms: string };
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export default function OfficeScreen() {
  const { ready, user, enabled } = useAuth();
  const { toast } = useApp();
  const router = useRouter();
  const [acct, setAcct] = useState<Acct | null>(null);
  const [orders, setOrders] = useState<Ord[]>([]);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !user) return;
    const { data: a } = await supabase.from("business_accounts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const ac = (a as Acct) ?? null; setAcct(ac);
    if (ac) {
      const [o, i] = await Promise.all([
        supabase.from("business_orders").select("id, delivery_date, gallons, total_cents, status, payment_status").is("canceled_at", null).order("delivery_date", { ascending: false }).limit(12),
        supabase.from("invoices").select("id, amount_cents, status, issued_at, terms").eq("business_id", ac.id).order("issued_at", { ascending: false }).limit(8),
      ]);
      setOrders((o.data as Ord[]) ?? []); setInvoices((i.data as Inv[]) ?? []);
    }
    setLoaded(true);
  }, [user]);
  useEffect(() => { if (ready && user) load(); }, [ready, user, load]);

  const patch = async (p: Partial<Acct>) => {
    if (!supabase || !acct || busy) return; setBusy(true);
    setAcct((a) => (a ? { ...a, ...p } : a)); // optimistic
    const { error } = await supabase.from("business_accounts").update(p).eq("id", acct.id);
    setBusy(false);
    if (error) { toast("Couldn't save — try again", "error"); load(); }
  };
  const adjustGallons = (d: number) => { if (!acct) return; const g = Math.max(OFFICE.minGallons, (acct.standing_gallons ?? OFFICE.minGallons) + d); patch({ standing_gallons: g }); };

  if (!ready || (enabled && !loaded)) return <section className="screen" id="s-office"><div className="toprow"><div className="eyb">Office</div></div><Skeleton variant="card" count={1} /><Skeleton variant="row" count={3} /></section>;

  return (
    <section className="screen office-portal" id="s-office">
      <Watermark variant="landing" />
      <div className="toprow"><div className="mast-brand mast-dark"><Gt3Mark tone="cream" /><span className="pb">Office delivery</span></div><AccountPill /></div>

      {!acct ? (
        <div className="op-none">
          <div className="op-none-ic">🫙</div>
          <h1>Bring GT3 to the office.</h1>
          <p>Fresh cold-extract in amber gallon jugs, delivered Monday 5–8&nbsp;AM, empties swapped for full each week. 3-gallon minimum.</p>
          <button type="button" className="handle" onClick={() => router.push("/delivery")}><span>Set up office delivery →</span></button>
        </div>
      ) : (<>
        <h1 className="op-h">{acct.company}</h1>

        {/* standing control */}
        <div className="op-card">
          <div className="op-card-h"><span className="op-k">Standing weekly</span><button type="button" className={`op-switch${acct.standing_active ? " on" : ""}`} onClick={() => patch({ standing_active: !acct.standing_active })} aria-pressed={acct.standing_active} disabled={busy}><span className="op-switch-k" /></button></div>
          {acct.standing_active ? (
            <>
              <p className="op-sub">Every Monday — we brew Sunday night and deliver 5–8&nbsp;AM.</p>
              <div className="op-gal">
                <span className="op-k">Gallons / week</span>
                <div className="op-step">
                  <button type="button" onClick={() => adjustGallons(-1)} disabled={busy || (acct.standing_gallons ?? 3) <= OFFICE.minGallons} aria-label="Fewer">−</button>
                  <span className="op-gal-v">{acct.standing_gallons ?? OFFICE.minGallons}</span>
                  <button type="button" onClick={() => adjustGallons(1)} disabled={busy} aria-label="More">+</button>
                </div>
              </div>
              <div className="op-quote"><span>{acct.standing_gallons ?? 3} gal × {dollars(OFFICE.pricePerGallonCents)} · {acct.billing_terms === "prepaid" ? "prepaid" : "net terms"}</span><b>{dollars(officeQuote(acct.standing_gallons ?? 3).totalCents)}/wk</b></div>
            </>
          ) : <p className="op-sub">Paused — no weekly deliveries. Flip it back on anytime.</p>}
        </div>

        {/* jug balance */}
        <div className="op-jugs">
          <div><span className="op-k">Amber jugs with you</span><span className="op-jugs-sub">Empties swapped for full each delivery</span></div>
          <div className="op-jugs-v">{acct.jug_balance}</div>
        </div>

        {/* upcoming + recent orders */}
        {orders.length > 0 && (
          <div className="op-list">
            <div className="op-list-h">Deliveries</div>
            {orders.map((o) => (
              <div key={o.id} className="op-row">
                <div className="op-row-x"><b>{mondayLabel(o.delivery_date)}</b><span>{Math.round(o.gallons)} gal · {o.status === "delivered" ? "delivered" : "scheduled"}</span></div>
                <div className={`op-row-pay p-${o.payment_status}`}>{o.payment_status === "paid" ? "paid" : o.payment_status === "invoiced" ? "invoiced" : dollars(o.total_cents)}</div>
              </div>
            ))}
          </div>
        )}

        {/* invoices */}
        {invoices.length > 0 && (
          <div className="op-list">
            <div className="op-list-h">Invoices</div>
            {invoices.map((v) => (
              <div key={v.id} className="op-row">
                <div className="op-row-x"><b>{dollars(v.amount_cents)}</b><span>{new Date(v.issued_at).toLocaleDateString()} · {v.terms}</span></div>
                <div className={`op-row-pay p-${v.status === "paid" ? "paid" : "open"}`}>{v.status}</div>
              </div>
            ))}
          </div>
        )}

        <p className="op-fine">Questions or a one-off change? Text us — we confirm every route the Friday before.</p>
      </>)}
    </section>
  );
}
