"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet, { CloseButton } from "./Sheet";
import Icon from "./Icon";
import { RecordLink } from "./RecordSheet";
import {
  SHOP_STATUS_META, SQUARE_TRANSACTIONS, ageLabel, isShopStatus, marginPct, money,
  moveVerb, moveWarning, needsReason, nextStatuses, shipLine, statusLabel, waitingOn,
} from "@/lib/shopOrder";

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
type Data = { order: Order | null; lines: Line[] };

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
  const [move, setMove] = useState<string | null>(null);   // the status being confirmed
  const [why, setWhy] = useState("");
  const [amt, setAmt] = useState("");

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { order: null, lines: [] };
    const [o, l] = await Promise.all([
      supabase.from("v_shop_orders").select("*").eq("id", orderId).maybeSingle(),
      supabase.from("v_shop_order_items").select("*").eq("order_id", orderId).order("title"),
    ]);
    if (o.error) throw new Error(o.error.message);
    return { order: (o.data as Order) ?? null, lines: (l.data as Line[]) ?? [] };
  }, [orderId]);
  const state = useAsyncData<Data>(loader, [orderId]);
  const reload = state.reload;

  const cancelMove = () => { setMove(null); setWhy(""); setAmt(""); };

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
        {({ order, lines }) => {
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
              </div>

              {/* what has been said about it ───────────────────────────────────────────── */}
              {(o.status_note || o.note) && (
                <div className="cp-block">
                  <div className="cp-block-h"><span>On the record</span><b>{when(o.status_changed_at)}</b></div>
                  {o.status_note && <p className="cp-line">{o.status_note}</p>}
                  {o.note && <p className="cp-line dim" style={{ whiteSpace: "pre-line" }}>{o.note}</p>}
                </div>
              )}

              {/* and only now, the controls ────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Move it along</span>
                  <b className={owed === "us" ? "" : "dim"}>
                    {owed === "us" ? "waiting on us" : owed === "nobody" ? "closed" : `waiting on the ${owed}`}
                  </b>
                </div>

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
                               inputMode="decimal" placeholder={((o.total_cents ?? 0) / 100).toFixed(2)} />
                      </label>
                    )}
                    <div className="so-confirm-b">
                      <button type="button" className="so-go" disabled={busy}
                              onClick={() => apply(move, o.total_cents)}>
                        {busy ? "…" : moveVerb(move)}
                      </button>
                      <button type="button" className="note-arch" disabled={busy} onClick={cancelMove}>Cancel</button>
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
