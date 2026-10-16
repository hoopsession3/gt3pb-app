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
  moveVerb, moveWarning, needsReason, nextStatuses, refundLeft, shipLine, statusLabel, waitingOn,
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
  // 0417: a send still out (marked before it left), or one that got no clear answer from Apliiq.
  apliiq_submit_started_at?: string | null; apliiq_submit_unknown_at?: string | null;
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
// `at`: when this read was made — a send still out is judged by it, never by a clock read while drawing.
type Data = { order: Order | null; lines: Line[]; msgs: Msg[]; msgsError: string | null; at: number };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** What the printer has been asked, and whether it answered (0417): nothing waiting, a send still out (marked within the
 *  claim's two minutes), or a send with no clear answer — Apliiq may have it, and the crew looks before anything else. */
export function printerAsk(o: { apliiq_order_id?: string | null; apliiq_submit_unknown_at?: string | null; apliiq_submit_started_at?: string | null }, nowMs: number): "none" | "out" | "unclear" {
  if (o.apliiq_order_id || !o.apliiq_submit_unknown_at) return "none";
  const started = o.apliiq_submit_started_at ? Date.parse(o.apliiq_submit_started_at) : NaN;
  return Number.isFinite(started) && nowMs - started < 120_000 ? "out" : "unclear";
}

/** An Apliiq order id as typed: a leading # and spaces dropped. The database checks the rest (shop_apliiq_checked). */
const apliiqIdTyped = (v: string) => v.trim().replace(/^#\s*/, "");

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
  const [theirId, setTheirId] = useState("");   // Apliiq's order id, typed: an unclear send found there, or a move to sent
  const [checking, setChecking] = useState(false);

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { order: null, lines: [], msgs: [], msgsError: null, at: Date.now() };
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
      at: Date.now(),
    };
  }, [orderId]);
  const state = useAsyncData<Data>(loader, [orderId]);
  const reload = state.reload;

  const cancelMove = () => { setMove(null); setWhy(""); setAmt(""); setTheirId(""); };
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
    let r: { ok?: boolean; error?: string; apliiqOrderId?: string; unclear?: boolean } | null = null;
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
    if (!r) { toast("No answer from the server — check the order before sending again.", "error"); reload(); return; }
    // No clear answer (0417): the order now asks the crew to look in Apliiq — shown by reloading it.
    if (!r.ok) { toast(r.error || "Could not send it.", "error"); if (r.unclear) { reload(); onChanged?.(); } return; }
    toast(`At the printer — their order ${r.apliiqOrderId}.`);
    reload(); onChanged?.();
  };

  // WHAT THE CREW FOUND AT APLIIQ (0417 shop_apliiq_checked): their order id — it is at the printer, and Send goes away —
  // or none: it isn't there, and it can be sent again. Also how an order placed by hand gets its id, so the shipping
  // update finds it (/api/apliiq/fulfillment matches on it) and 'sent' is true of it (0334).
  const sayChecked = async (found: string | null) => {
    if (!supabase || checking) return;
    const id = found == null ? null : apliiqIdTyped(found);
    if (found != null && !id) { toast("Type Apliiq's order id — it's on the order in their pending list.", "error"); return; }
    setChecking(true);
    const { error } = await supabase.rpc("shop_apliiq_checked", { p_order: orderId, p_apliiq_id: id });
    setChecking(false);
    if (error) { toast(error.message, "error"); return; }
    toast(id ? `At the printer — their order ${id}.` : "Cleared — it can be sent to the printer again.");
    cancelMove(); reload(); onChanged?.();
  };

  const apply = async (to: string, o: Order) => {
    if (!supabase || busy) return;
    // Sent to the printer by hand: said with their id, the one way 'sent' can be true of it (0334) and the shipping update
    // can find it — not a status the database would refuse without one.
    if (to === "submitted" && !o.apliiq_order_id) { await sayChecked(theirId); return; }
    if (needsReason(to) && !why.trim()) { toast("Say why — it goes on the record.", "error"); return; }
    // A typed dollar amount, converted once, here. An empty box means "all that's left", which is what
    // the function defaults to — so don't send 0 and have it refuse. Less than what's left is a part
    // (0417): recorded, and the order stays where it is.
    const left = refundLeft(o);
    let cents: number | null = null;
    if (to === "refunded" && amt.trim()) {
      const n = Math.round(Number(amt.replace(/[^0-9.]/g, "")) * 100);
      if (!Number.isFinite(n) || n <= 0) { toast("That refund amount doesn't read as money.", "error"); return; }
      if (left != null && n > left) { toast(`That's more than the ${money(left)} still on this order.`, "error"); return; }
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
    const part = to === "refunded" && cents != null && left != null && cents < left;
    toast(part ? `${money(cents)} refund recorded — the order stays ${statusLabel(o.status).toLowerCase()}, ${money(left! - cents!)} still on it.` : `${statusLabel(to)}.`);
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
        {({ order, lines, msgs, msgsError, at }) => {
          const o = order!;
          const meta = isShopStatus(o.status) ? SHOP_STATUS_META[o.status] : null;
          const owed = waitingOn(o.status);
          const moves = nextStatuses(o.status);
          const pct = marginPct(o.margin_cents, o.total_cents);
          const addr = shipLine(o.ship_address);
          const age = ageLabel(o.age_hours);
          const left = refundLeft(o);
          const ask = printerAsk(o, at);

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
                {o.refund_amount_cents != null && o.refund_amount_cents > 0 && (
                  <p className="cp-line">
                    <b>{money(o.refund_amount_cents)}</b> refunded
                    {o.status !== "refunded" && left != null && left > 0 ? <> · <b>{money(left)}</b> still on the order</> : null}.
                  </p>
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
                {/* NO CLEAR ANSWER IS NOT "NOT SENT" (0417). A send still out, or one Apliiq never
                    answered clearly, takes the button's place: the order may be at the printer, and
                    a second press would be a second cap. The crew looks, then says what they found. */}
                {ask === "out" ? (
                  <div className="so-send" role="status">
                    <p className="so-warn"><b>Being sent to Apliiq now</b> — waiting for its answer.</p>
                    <Button type="button" kind="quiet" onClick={reload}>Refresh</Button>
                  </div>
                ) : ask === "unclear" ? (
                  <div className="so-send">
                    <p className="so-warn">
                      <b>No clear answer from Apliiq</b> when this was sent{o.apliiq_submit_unknown_at ? ` (${when(o.apliiq_submit_unknown_at)})` : ""}.
                      They may have it — look in their pending orders before anything else. Sending it
                      again before that could print and charge a second one.
                    </p>
                    <a className="cp-go" href={APLIIQ_PENDING} target="_blank" rel="noreferrer">
                      Look in Apliiq · pending orders <Icon name="externalLink" />
                    </a>
                    <label className="prod-f">
                      <span>Their order id, if it&apos;s there</span>
                      <input value={theirId} onChange={(e) => setTheirId(e.target.value)} disabled={checking}
                             autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="e.g. 4471023" />
                    </label>
                    <div className="so-confirm-b">
                      <Button type="button" kind="primary" disabled={checking || !apliiqIdTyped(theirId)} onClick={() => sayChecked(theirId)}>
                        {checking ? "…" : "It's at Apliiq"}
                      </Button>
                      <Button type="button" kind="quiet" disabled={checking} onClick={() => sayChecked(null)}>
                        Not there — clear to send again
                      </Button>
                    </div>
                  </div>
                ) : !o.apliiq_order_id && (o.status === "paid" || o.status === "needs_fulfillment") && (
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
                        <span>Amount — leave blank for all that&apos;s left ({money(left)}). Less keeps the order open.</span>
                        <input value={amt} onChange={(e) => setAmt(e.target.value)} disabled={busy}
                               inputMode="decimal" placeholder={moneyPlain(left)} />
                      </label>
                    )}
                    {move === "submitted" && !o.apliiq_order_id && (
                      <label className="prod-f">
                        <span>Apliiq&apos;s order id — from their pending orders</span>
                        <input value={theirId} onChange={(e) => setTheirId(e.target.value)} disabled={busy || checking}
                               autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="e.g. 4471023" />
                      </label>
                    )}
                    <div className="so-confirm-b">
                      <Button type="button" kind="primary" disabled={busy || checking || (move === "submitted" && !o.apliiq_order_id && !apliiqIdTyped(theirId))}
                              onClick={() => apply(move, o)}>
                        {busy || checking ? "…" : moveVerb(move)}
                      </Button>
                      <Button type="button" kind="quiet" disabled={busy} onClick={cancelMove}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="so-moves">
                    {moves.map((m) => (
                      <button type="button" key={m}
                              className={needsReason(m) ? "btn-del" : "btn-sec btn-sm"}
                              onClick={() => { setMove(m); setWhy(""); setAmt(""); setTheirId(""); }}>
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
