"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet, { CloseButton } from "./Sheet";
import Icon from "./Icon";
import { RecordLink } from "./RecordSheet";
import { moneyPlain } from "@/lib/money";
import { authedFetch } from "@/lib/authedFetch";
import {
  APLIIQ_PENDING, SHOP_STATUS_META, SQUARE_TRANSACTIONS, ageLabel, isShopStatus, marginPct, money,
  moveVerb, moveWarning, needsReason, nextStatuses, shipLine, statusLabel, waitingOn,
} from "@/lib/shopOrder";
import Button from "./Button";

// ONE SHOP ORDER, WHOLE (0313).
//
// The audit's first item: shop_orders was the only entity in this app with NO interface at all. A
// customer could buy something, be charged, get a confirmation and get tracking, and nobody on the
// crew could look at the order. /api/shop/checkout's own error path says "It's paid and queued —
// submit it by hand", and there was no queue to submit it from.
//
// So: the order, and the one place it is acted on. Ordered by what a person needs in the moment —
// who it is and what they bought, then what is owed and by whom, then the money, then the paper
// trail. The controls come after the facts, never before them.
//
// THE SENTENCE THIS SCREEN WILL NOT BLUR: recording a refund does not issue one. Card data never
// touches this app by design; refunds happen in Square. /api/orders/cancel already had to be
// corrected for telling customers "your refund is on the way" when all it had done was raise a
// staff alert — so the confirm here says what it does and what it does not, and the Square link
// sits next to the button rather than three screens away.

type Order = {
  id: string; created_at: string; status: string;
  customer_id: string | null; who: string; email: string | null;
  ship_name: string | null; ship_address: unknown;
  subtotal_cents: number | null; total_cents: number | null; refund_amount_cents: number | null;
  payment_id: string | null; apliiq_order_id: string | null; note: string | null;
  status_note: string | null; status_changed_at: string | null;
  item_count: number | null; unit_count: number | null; items: string | null;
  cost_cents: number | null; margin_cents: number | null;
  carrier: string | null; tracking_number: string | null; tracking_url: string | null;
  shipped_at: string | null;
  age_hours: number | null;
};
type Line = {
  id: string; title: string; qty: number; unit_cents: number; cost_cents: number | null;
  line_cents: number; line_cost_cents: number | null; variant: unknown;
  image_url: string | null; product_archived: boolean; product_unlinked: boolean;
};
type Msg = {
  id: string; kind: string; status: "sent" | "failed"; detail: string | null;
  to_address: string; created_at: string; sent_by: string | null;
};
type Data = { order: Order | null; lines: Line[]; msgs: Msg[]; msgsError: string | null };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** {size,color} → "M · Black". Anything else renders as nothing rather than as JSON. */
const variantLine = (v: unknown): string => {
  if (!v || typeof v !== "object") return "";
  return Object.values(v as Record<string, unknown>)
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => (x as string).trim())
    .join(" · ");
};

export default function ShopOrderRecord({ orderId, onClose, onChanged }: {
  orderId: string; onClose: () => void; onChanged?: () => void;
}) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [resendTo, setResendTo] = useState("");
  const [resending, setResending] = useState(false);
  const [move, setMove] = useState<string | null>(null);   // the status being confirmed
  const [why, setWhy] = useState("");
  const [amt, setAmt] = useState("");

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { order: null, lines: [], msgs: [], msgsError: null };
    const [o, l, m] = await Promise.all([
      supabase.from("v_shop_orders").select("*").eq("id", orderId).maybeSingle(),
      supabase.from("v_shop_order_items").select("*").eq("order_id", orderId).order("title"),
      // What this customer has actually been told. Before 0326 there was no answer to that at all,
      // which is how a paid order went a whole evening with nobody knowing its receipt never sent.
      supabase.from("customer_messages").select("id, kind, status, detail, to_address, created_at, sent_by")
        .eq("order_id", orderId).order("created_at", { ascending: false }).limit(12),
    ]);
    if (o.error) throw new Error(o.error.message);
    // A FAILED READ IS NOT AN EMPTY LIST. I wrote `msgs: m.data ?? []` first, which renders "No
    // message has been sent about this order" when the read FAILED — and the deploy window where
    // 0326 has not been pasted into the SQL editor yet is exactly when that happens. Telling an
    // operator nothing was sent, when the truth is nobody could look, is the defect this panel was
    // built to end. It is reported instead.
    return {
      order: (o.data as Order) ?? null,
      lines: (l.data as Line[]) ?? [],
      msgs: (m.data as Msg[]) ?? [],
      msgsError: m.error ? m.error.message : null,
    };
  }, [orderId]);
  const state = useAsyncData<Data>(loader, [orderId]);
  const reload = state.reload;

  const cancelMove = () => { setMove(null); setWhy(""); setAmt(""); };
  const [sending, setSending] = useState(false);

  // SEND IT TO THE PRINTER (0335). Not a status move — it is an HTTP call to Apliiq that RESULTS in
  // one, so it goes through /api/shop/resubmit rather than set_shop_order_status. The route holds
  // the claim that stops two clicks becoming two caps; this only has to not fight it.
  //
  // `sending` is its own flag, not `busy`: they guard different things, and sharing one would let a
  // half-finished status move grey out the send button for reasons a person cannot see.
  const sendToPrinter = async () => {
    if (sending) return;
    setSending(true);
    let r: { ok?: boolean; error?: string; apliiqOrderId?: string } | null = null;
    try {
      const res = await authedFetch("/api/shop/resubmit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      r = await res.json().catch(() => null);
    } catch { /* reported below — a thrown fetch and a refused send read the same to an operator */ }
    setSending(false);
    // A FAILED READ IS NOT A FAILED SEND. If we cannot tell what happened, say exactly that and tell
    // them to look before retrying: the retry is what makes a second cap.
    if (!r) { toast("No answer from the server — check the order before sending again.", "error"); return; }
    if (!r.ok) { toast(r.error || "Could not send it.", "error"); return; }
    toast(`At the printer — their order ${r.apliiqOrderId}.`);
    reload(); onChanged?.();
  };

  const apply = async (to: string, total: number | null) => {
    if (!supabase || busy) return;
    if (needsReason(to) && !why.trim()) { toast("Say why — it goes on the record.", "error"); return; }
    // A typed dollar amount, converted once, here. An empty box means "all of it", which is what
    // the function defaults to — so don't send 0 and have it refuse.
    let cents: number | null = null;
    if (to === "refunded" && amt.trim()) {
      const n = Math.round(Number(amt.replace(/[^0-9.]/g, "")) * 100);
      if (!Number.isFinite(n) || n <= 0) { toast("That refund amount doesn't read as money.", "error"); return; }
      if (total != null && n > total) { toast(`That's more than the ${money(total)} this order charged.`, "error"); return; }
      cents = n;
    }
    setBusy(true);
    const { error } = await supabase.rpc("set_shop_order_status", {
      p_order: orderId, p_status: to,
      p_note: why.trim() || null,
      p_refund_cents: cents,
    });
    setBusy(false);
    // supabase-js resolves with { error } rather than throwing — surface the database's own sentence
    // instead of a generic failure, because those sentences are written to be read by this crew.
    if (error) { toast(error.message, "error"); return; }
    toast(`${statusLabel(to)}.`);
    cancelMove(); reload(); onChanged?.();
  };

  return (
    <Sheet open onClose={onClose} label="Shop order"
      header={<div className="cp-head">
        <b>Shop order</b>
        <CloseButton onClick={onClose} />
      </div>}>
      <AsyncSection state={state} isEmpty={({ order }) => !order}
        emptyTitle="No such order" emptySub="It may have been removed, or the link is stale."
        loadingLabel="Loading…" errorTitle="Couldn't load this order">
        {({ order, lines, msgs, msgsError }) => {
          const o = order!;
          const meta = isShopStatus(o.status) ? SHOP_STATUS_META[o.status] : null;
          const owed = waitingOn(o.status);
          const moves = nextStatuses(o.status);
          const pct = marginPct(o.margin_cents, o.total_cents);
          const addr = shipLine(o.ship_address);
          const age = ageLabel(o.age_hours);

          return (
            <>
              {/* who, and what state it is in ───────────────────────────────────────────── */}
              <div className="so-id">
                <div className="cp-id-t">
                  <b>
                    <RecordLink kind="customer" id={o.customer_id}>{o.who}</RecordLink>
                  </b>
                  <span>{o.email || "no email on the order"}{age ? ` · ${age} old` : ""}</span>
                </div>
                <span className={`so-pill so-${owed}`}>{statusLabel(o.status)}</span>
              </div>
              {meta && <p className="so-means">{meta.means}</p>}

              {/* what they bought ──────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Ordered</span>
                  <b>{money(o.total_cents)}</b>
                </div>
                <div className="so-lines">
                  {lines.length === 0 && <p className="cp-line dim">No lines on this order — that should not happen; check the checkout log.</p>}
                  {lines.map((l) => {
                    const v = variantLine(l.variant);
                    return (
                      <div className="so-line" key={l.id}>
                        {l.image_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img className="so-thumb" src={l.image_url} alt="" loading="lazy" />
                          : <span className="so-thumb ph" aria-hidden="true" />}
                        <span className="so-line-b">
                          <b>{l.qty}× {l.title}</b>
                          <i>
                            {v || `${money(l.unit_cents)} each`}
                            {l.product_archived ? " · archived since" : ""}
                            {l.product_unlinked ? " · no longer in the catalog" : ""}
                          </i>
                        </span>
                        <span className="so-line-m">{money(l.line_cents)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* where it goes ─────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h"><span>Ship to</span><b>{o.ship_name || o.who}</b></div>
                <p className="cp-line">{addr || <span className="dim">No address on this order.</span>}</p>
                {o.tracking_number ? (
                  <p className="cp-line">
                    <b>{o.carrier || "Carrier"}</b> {o.tracking_number}
                    {o.shipped_at ? ` · sent ${when(o.shipped_at)}` : ""}
                    {o.tracking_url && <> — <a href={o.tracking_url} target="_blank" rel="noreferrer">track it <Icon name="externalLink" /></a></>}
                  </p>
                ) : (
                  <p className="cp-line dim">No tracking yet.</p>
                )}
              </div>

              {/* the money ─────────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h"><span>Money</span><b>{money(o.total_cents)}</b></div>
                <p className="cp-line">
                  Cost {o.cost_cents == null ? <i className="dim">unknown</i> : <b>{money(o.cost_cents)}</b>}
                  {" · "}
                  Margin {o.margin_cents == null
                    ? <i className="dim">unknown — no cost on these lines</i>
                    : <b>{money(o.margin_cents)}{pct != null ? ` (${pct}%)` : ""}</b>}
                </p>
                {o.refund_amount_cents != null && (
                  <p className="cp-line"><b>{money(o.refund_amount_cents)}</b> refunded.</p>
                )}
                <a className="cp-go" href={SQUARE_TRANSACTIONS} target="_blank" rel="noreferrer">
                  Find it in Square{o.payment_id ? ` · ${o.payment_id.slice(-8)}` : ""} <Icon name="externalLink" />
                </a>
                {/* An accepted order waits in Apliiq's PENDING tab, not their orders list — the first
                    cap was invisible on /verified/orders for nine months of filter while sitting in
                    pending the whole time, blocked, with this app saying there was nothing to do. */}
                {(o.status === "submitted" || o.status === "in_production") && (
                  <a className="cp-go" href={APLIIQ_PENDING} target="_blank" rel="noreferrer">
                    Check it in Apliiq · pending orders <Icon name="externalLink" />
                  </a>
                )}
              </div>

              {/* what has been said about it ───────────────────────────────────────────── */}
              {(o.status_note || o.note) && (
                <div className="cp-block">
                  <div className="cp-block-h"><span>On the record</span><b>{when(o.status_changed_at)}</b></div>
                  {o.status_note && <p className="cp-line">{o.status_note}</p>}
                  {o.note && <p className="cp-line dim" style={{ whiteSpace: "pre-line" }}>{o.note}</p>}
                </div>
              )}

              {/* ── WHAT THE CUSTOMER WAS TOLD ──────────────────────────────────────────
                  On 2026-09-29 a paid order sat all evening with nobody able to say whether its
                  receipt had gone out. This block is that answer, and the button beside it sends
                  the SAME receipt again — rebuilt from this order through lib/receipt, never
                  retyped, so the second copy cannot disagree with the first. */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>What we&apos;ve told them</span>
                  <b className={msgs.some((m) => m.status === "sent") ? "dim" : ""}>
                    {msgsError ? "can't tell" : msgs.length === 0 ? "nothing yet" : msgs.some((m) => m.status === "sent") ? "in touch" : "nothing reached them"}
                  </b>
                </div>
                {msgsError
                  ? <p className="cp-line"><b className="bad">Couldn&apos;t read the message log</b> — so this order may well have been emailed and we cannot see it. {msgsError}</p>
                  : msgs.length === 0
                  ? <p className="cp-line dim">No message has been sent about this order.</p>
                  : msgs.map((m) => (
                    <div className="cp-line" key={m.id}>
                      <b className={m.status === "failed" ? "bad" : ""}>{m.status === "sent" ? "Sent" : "Failed"}</b>
                      {" · "}{m.kind.replace(/_/g, " ")}{" · "}{m.to_address}
                      {m.sent_by ? " · by hand" : ""}
                      {" · "}{new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {m.status === "failed" && m.detail ? <><br /><span className="dim">{m.detail}</span></> : null}
                    </div>
                  ))}
                <div className="so-resend">
                  <input className="auth-input" type="email" inputMode="email" placeholder={o.email || "email address"}
                    value={resendTo} onChange={(e) => setResendTo(e.target.value)}
                    aria-label="Send the receipt to a different address" />
                  <button type="button" className="btn-sec" disabled={resending} onClick={async () => {
                    setResending(true);
                    try {
                      const r = await authedFetch("/api/shop/receipt", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: o.id, to: resendTo.trim() || undefined }),
                      });
                      const j = await r.json();
                      if (!r.ok || !j.ok) toast(j.error || "Couldn't send it.", "error");
                      else if (j.sent) { toast(`Receipt sent to ${j.to}.`); setResendTo(""); }
                      // The provider's own words, not a shrug. This is the line that was missing.
                      else toast(`Not sent — ${j.detail || j.result}`, "error");
                    } catch { toast("Couldn't reach the server.", "error"); }
                    setResending(false); reload();
                  }}>{resending ? "Sending…" : "Send the receipt"}</button>
                </div>
              </div>

              {/* and only now, the controls ────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Move it along</span>
                  <b className={owed === "us" ? "" : "dim"}>
                    {owed === "us" ? "waiting on us" : owed === "nobody" ? "closed" : `waiting on the ${owed}`}
                  </b>
                </div>

                {/* THE BUTTON THAT DID NOT EXIST. Shown on exactly the condition the database
                    claim enforces: money collected, nothing at the printer yet. Once Apliiq has an
                    id it disappears — the order is being made, and the only thing a second press
                    could achieve is a second cap and a second charge. */}
                {!o.apliiq_order_id && (o.status === "paid" || o.status === "needs_fulfillment") && (
                  <div className="so-send">
                    <Button type="button" kind="primary" wide disabled={sending} onClick={sendToPrinter}>
                      {sending ? "Sending…" : "Send to printer"}
                    </Button>
                    <p className="so-warn">
                      This places the order at Apliiq and charges the card on file there. Their
                      shipping update comes back to this order automatically — which is why this
                      button exists instead of typing it into their dashboard.
                    </p>
                  </div>
                )}

                {moves.length === 0 ? (
                  <p className="cp-line dim">This order is {statusLabel(o.status).toLowerCase()}. Nothing moves it from here.</p>
                ) : move ? (
                  <div className="so-confirm">
                    <b>{moveVerb(move)}?</b>
                    {moveWarning(move) && <p className="so-warn">{moveWarning(move)}</p>}
                    {needsReason(move) && (
                      <label className="prod-f">
                        <span>Why (goes on the record)</span>
                        <input value={why} onChange={(e) => setWhy(e.target.value)} disabled={busy}
                               placeholder={move === "refunded" ? "refunded in Square, ref …" : "printer discontinued the blank"} />
                      </label>
                    )}
                    {move === "refunded" && (
                      <label className="prod-f">
                        <span>Amount — leave blank for the whole {money(o.total_cents)}</span>
                        <input value={amt} onChange={(e) => setAmt(e.target.value)} disabled={busy}
                               inputMode="decimal" placeholder={moneyPlain(o.total_cents)} />
                      </label>
                    )}
                    <div className="so-confirm-b">
                      <Button type="button" kind="primary" disabled={busy}
                              onClick={() => apply(move, o.total_cents)}>
                        {busy ? "…" : moveVerb(move)}
                      </Button>
                      <Button type="button" kind="quiet" disabled={busy} onClick={cancelMove}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="so-moves">
                    {moves.map((m) => (
                      <button type="button" key={m}
                              className={`so-move${needsReason(m) ? " grave" : ""}`}
                              onClick={() => { setMove(m); setWhy(""); setAmt(""); }}>
                        {moveVerb(m)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <p className="so-foot">
                Placed {when(o.created_at)}
                {o.apliiq_order_id ? ` · printer ref ${o.apliiq_order_id}` : ""}
              </p>
            </>
          );
        }}
      </AsyncSection>
    </Sheet>
  );
}
