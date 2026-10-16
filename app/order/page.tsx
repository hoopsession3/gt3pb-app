"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import Watermark from "@/components/Watermark";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import Eyebrow from "@/components/today/Eyebrow";
import OrderSteps from "@/components/today/OrderSteps";
import { ETA_WORDS } from "@/components/useMyOrders";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/money";
import { clockTime, timeRange } from "@/lib/dates";
import { openAddress } from "@/lib/maps";
import { shareLink } from "@/lib/deviceActions";
import { publicOrigin } from "@/lib/native";
import { readyWords, waitingToOpen } from "@/lib/ordering";
import { cancelWords, orderLine, orderTag, stepOf } from "@/lib/orderWords";
import { useConfirm } from "@/components/ConfirmSheet";
import { drinksWords, etDay } from "@/lib/today";
import { holdTicket, isTicket, sharePath, ticketPath, useHeldTickets } from "@/lib/tickets";
import { apiUrl } from "@/lib/native";
import { canceledHere } from "@/lib/activeOrder";
import { useAsyncData } from "@/lib/useAsyncData";
import { refusalText } from "@/lib/refusal";

// THE TICKET (2026-10-13, R3b of the customer audit — board 09 "Every order gets a ticket", approved). One order, to
// whoever holds its link: a guest who paid had the "Order in." screen and nothing after it; a member had the bar and
// Today. This is the order's own page, signed in or not — its number, where it is, what was in it and what was paid,
// the stop and its window — read through order_ticket (0395), which shows that one order and nothing else. It updates
// itself while the order is in progress and the page is in front of someone, and it tells the truck you're on your way.
// The words are the order's everywhere (lib/orderWords). The phone keeps the link (lib/tickets): /order with none lists
// the ones it holds.
//
// SHARED, IT SHOWS; IT DOES NOT CHANGE (2026-10-15, R7 of the customer re-audit — 0413). Share link sent the ticket
// itself, and the ticket is the key: whoever it reached could cancel the order, tell the truck they were outside, and
// read the card's last four. Share link sends the order's shared link now (/order?s=…, order_shared): where it is, its
// drinks, what is due at the window — no Cancel, no "I'm outside", nothing about the card or the tip, and the phone it
// reaches does not keep it. And Cancel here tells a member by email, as the app's cancel does (/api/orders/ticket-cancel).

type Line = { slug: string; name?: string; qty: number; unit_cents?: number };
type Ticket = {
  no: string; status: string; items: string[]; lines: Line[] | null; total_cents: number; tip_cents: number; paid: boolean;
  card: string | null; refunded_cents: number; refund_pending: boolean;
  at_window?: boolean;   // paid at the window (0396): the crew's to cancel there
  placed_at: string; moved_at: string | null; ready_from: string | null; eta: "on_way" | "outside" | "late" | null;
  for: string | null;
  stop: { name: string; place: string | null; starts_at: string | null; ends_at: string | null; canceled: boolean; cancel_reason: string | null } | null;
  share?: string | null;   // the key of its shared link (0413) — the ticket's own view carries it; a shared view does not
  due_cents?: number;      // a shared view's "due at the window" (0413), in place of the money it does not show
};
const ACTIVE = new Set(["new", "preparing", "ready"]);

export default function OrderPage() {
  return <Suspense fallback={<section className="screen" id="s-ticket" />}><TicketScreen /></Suspense>;
}

function TicketScreen() {
  const params = useSearchParams();
  const t = params.get("t") ?? "", s = params.get("s") ?? "";
  return isTicket(t) ? <TicketView t={t} /> : isTicket(s) ? <TicketView t={s} shared /> : <Held />;
}

// No ticket in the address: the ones this phone holds, or how to find one.
function Held() {
  const held = useHeldTickets();
  return (
    <section className="screen" id="s-ticket">
      <Watermark variant="landing" />
      <Masthead eyebrow="Your order" right={<div className="mast-right"><AccountPill /></div>} />
      <h1 className="k-title lg">Your orders</h1>
      {held === null ? <div className="mt-5 min-h-[120px]" aria-busy="true" /> : held.length ? (
        <div className="k-rows mt-5">
          {held.map((h) => (
            <InfoRow key={h.t} lead="Order" name={h.no} sub={`Placed ${etDay(new Date(h.at).toISOString())}, ${clockTime(new Date(h.at).toISOString())}`}
              bodyClick={() => { window.location.assign(ticketPath(h.t)); }} ariaLabel={`Order ${h.no}`}
              trailing={<span className="text-cream-dim"><Icon name="chevronRight" /></span>} />
          ))}
        </div>
      ) : (
        <p className="k-sub mt-3">The link from your checkout opens your order here. It stays on this phone for two days.</p>
      )}
      <div className="mt-5 flex gap-2"><Link href="/menu" className="k-chip sm">See the menu</Link></div>
      <ClosingBeat />
    </section>
  );
}

function TicketView({ t, shared = false }: { t: string; shared?: boolean }) {
  const router = useRouter();
  const { nameOf, toast } = useApp();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  // arrives-with: 0395 — until it is pasted the view is not there (PGRST202), and the page says it can't open the order.
  // A shared link (0413) reads order_shared — only after 0413 is there is a shared link to open.
  const ticket = useAsyncData<Ticket>(async () => {
    if (!supabase) throw new Error("We couldn't open this order just now — try again in a minute.");
    const { data, error: e } = shared
      ? await supabase.rpc("order_shared", { p_share: t })
      : await supabase.rpc("order_ticket", { p_ticket: t });
    if (e) throw new Error(refusalText(e) ?? "We couldn't open this order just now — try again in a minute.");
    const d = data as Ticket;
    // A shared view carries no card, tip or refunds: the page reads it as nothing of each, and what is due as its total.
    return shared ? { ...d, total_cents: d.due_cents ?? 0, tip_cents: 0, card: null, refunded_cents: 0, refund_pending: false, eta: null, at_window: false } : d;
  }, [t, shared]);
  const tk = ticket.data, reload = ticket.reload;
  // A first read that failed says so in the order's place. A later one that failed keeps the order on screen and says it
  // is the last word heard, as Today's card does — a guest at the truck on a bad signal is not shown a stale step as news.
  const err = ticket.status === "error" ? ticket.error?.message ?? "We couldn't open this order just now — try again in a minute." : null;
  const stale = !!tk && !!ticket.error;
  // It updates itself while the order is in progress — every 15 seconds the page is in front of someone, and on return.
  const live = !!tk && ACTIVE.has(tk.status);
  useEffect(() => {
    if (!live) return;
    const tick = () => { if (document.visibilityState === "visible") void reload(); };
    const id = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [live, reload]);
  // The phone keeps the link, so the order is not lost with the tab (lib/tickets).
  const no = tk?.no ?? null;
  useEffect(() => { if (no && !shared) holdTicket(t, no); }, [t, no, shared]);

  if (err) {
    return (
      <section className="screen" id="s-ticket">
        <Watermark variant="landing" />
        <Masthead eyebrow={shared ? "A shared order" : "Your order"} right={<div className="mast-right"><AccountPill /></div>} />
        <h1 className="k-title lg">Can&apos;t open it</h1>
        <p className="k-sub" role="alert">{err}</p>
        <div className="mt-5 flex gap-2"><Link href="/order" className="k-chip sm">Your orders</Link><Link href="/menu" className="k-chip sm">See the menu</Link></div>
        <ClosingBeat />
      </section>
    );
  }
  if (!tk) return <section className="screen" id="s-ticket"><div className="mt-24 min-h-[320px]" aria-busy="true" /></section>;

  const active = ACTIVE.has(tk.status), canceled = tk.status === "void";
  const ahead = tk.status === "new" && waitingToOpen({ created_at: tk.placed_at, ready_from: tk.ready_from });
  const total = tk.total_cents + (tk.tip_cents || 0);
  const line = orderLine(tk.status, ahead ? readyWords({ state: "ahead", readyFrom: tk.ready_from }) : null);
  // What Square has given back is a fact it reports (0330, through the view), never this page's guess.
  const refunded = tk.refunded_cents || 0, refundedAll = tk.paid && refunded >= total && total > 0;
  // The card is Today's card (R3): the state in the order's word on the tag, the drinks, the line and the money beside
  // it, the four steps. Its tag says the state once; the money says the money — a canceled order's tag is not repeated.
  const tag = orderTag(tk.status, ahead);
  // A canceled order that was never charged says so once, in its line ("Nothing was charged.") — the money column is empty.
  const paidWords = shared ? (canceled ? null : tk.paid ? "Paid" : `${money(total)} at the window`)
    : refundedAll ? `Refunded ${money(refunded)}` : canceled && !tk.paid ? null : tk.paid ? `Paid ${money(total)}` : `${money(total)} at the window`;
  const moneyBack = refundedAll ? "Refunded in full." : tk.refund_pending || refunded > 0 ? "The refund is on its way to your card." : "The crew is refunding your card in full.";
  // Money back on an order that was made (a drink remade, a charge fixed) is said too — Square's word, not ours.
  const backOnCard = !canceled && !refundedAll && refunded > 0 ? `${money(refunded)} went back to your card. ` : !canceled && tk.refund_pending ? "A refund is on its way to your card. " : "";
  const note = canceled && shared
    ? `This order was canceled${tk.stop?.canceled ? ` — ${tk.stop.name} was called off` : ""}.`
    : canceled
    ? tk.stop?.canceled
      ? `${tk.stop.name} was called off${tk.stop.cancel_reason ? ` — ${tk.stop.cancel_reason}` : ""}. ${tk.paid ? moneyBack : "Nothing was charged."}`
      : tk.paid ? moneyBack : "Nothing was charged."
    : shared
      ? `Shared with you. ${tk.status === "done" ? "It's been picked up." : "This page updates itself while the order is in — only the phone that placed it can change it."}`
      : `${refundedAll ? "Refunded in full. " : backOnCard}${tk.status === "done" ? "Thanks for coming by." : "This page updates itself while you wait — keep the link to come back to it."}`;
  const sub = [tk.for && `For ${tk.for}`, tk.stop && `pickup at the ${tk.stop.name} window`].filter(Boolean).join(" · ");

  const setEta = async (k: "on_way" | "outside" | "late") => {
    if (!supabase || busy) return;
    setBusy(true);
    const next = tk.eta === k ? null : k;
    const { data, error } = await supabase.rpc("ticket_eta", { p_ticket: t, p_eta: next });
    setBusy(false);
    if (error || data === false) { toast(refusalText(error) ?? (error ? "Couldn't tell the truck — try again." : "That order is past telling the truck."), "error"); void reload(); return; }
    void reload();
    if (next) toast(`Told the truck: ${ETA_WORDS[next]}`);
  };
  // Take it back while it is In (0396, cancel_by_ticket): the member's rule, by the ticket — not once it is being made,
  // and not once paid at the window, which is the crew's to cancel there. It says what happened in the order's words.
  // arrives-with: 0396 — until it is pasted the function is not there, and the answer is the "try again" line.
  const canCancel = !shared && tk.status === "new" && !tk.at_window;
  const cancel = async () => {
    if (busy) return;
    if (!(await confirm({ title: "Cancel this order?", body: tk.paid ? "We'll flag all of it — the tip too — for a refund, and the crew will process it." : undefined, confirmLabel: "Cancel order", cancelLabel: "Keep order", danger: true }))) return;
    setBusy(true);
    canceledHere(t);   // the page's own answer says it; a member's realtime toast does not repeat it (keyed by the order below)
    // Through the server (R7): the same cancel, by the same ticket, and a member is told by email.
    let res: { ok?: boolean; outcome?: string; now?: string; paid?: boolean; error?: string } | null = null;
    try {
      const r = await fetch(apiUrl("/api/orders/ticket-cancel"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: t }) });
      res = await r.json();
    } catch { res = null; }
    setBusy(false);
    const words = cancelWords(res && (res.ok || res.outcome) ? res : null);
    // The server's own words when it refused (a ticket it doesn't know, a pause after too many tries), else the cancel's.
    toast((res?.outcome === "not_found" || res?.outcome === "error") && res.error ? res.error : words.text, words.ok ? "info" : "error");
    void reload();
  };
  // Share link sends the shared view (0413), never the ticket. Before 0413 there is none to send, and no Share link.
  const shareKey = shared ? t : tk.share ?? null;
  const share = async () => {
    if (!shareKey) return;
    const url = `${publicOrigin()}${sharePath(shareKey)}`;
    const how = await shareLink({ title: `GT3 order ${tk.no}`, text: `GT3 order ${tk.no}`, url });
    if (how === "done" || how === "cancelled") return;
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast(url); }
  };
  const eta = (k: "on_way" | "outside") => (
    <Button kind="secondary" wide disabled={busy} aria-pressed={tk.eta === k} onClick={() => { void setEta(k); }}>
      {tk.eta === k && <Icon name="check" />} {ETA_WORDS[k]}
    </Button>
  );
  const rows: [string, number | null][] = tk.lines?.length
    ? tk.lines.map((l) => [`${l.name ?? nameOf(l.slug)}${l.qty > 1 ? ` ×${l.qty}` : ""}`, typeof l.unit_cents === "number" ? l.unit_cents * l.qty : null])
    : [...tk.items.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map<string, number>())].map(([s, q]) => [`${nameOf(s)}${q > 1 ? ` ×${q}` : ""}`, null]);
  const receiptLine = (k: string, v: string, strong?: boolean) => (
    <div key={k} className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "text-callout font-bold text-cream" : "text-subhead text-cream-muted"}`}>
      <span className="min-w-0">{k}</span><span className="whitespace-nowrap font-mono">{v}</span>
    </div>
  );

  return (
    <section className="screen" id="s-ticket">
      <Watermark variant="landing" />
      <Masthead eyebrow={shared ? "A shared order" : "Your order"} right={<div className="mast-right"><AccountPill /></div>} />
      <h1 className="k-title lg">{tk.no}</h1>
      {sub && <p className="k-sub">{sub}</p>}
      <div className="k-card mt-5 flex flex-col gap-3" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow live={active}>{drinksWords(tk.items, nameOf)}</Eyebrow>
          <span className={`k-tag ${canceled ? "crit" : tk.status === "new" ? "gold" : "ok"}`}>{tag}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <p className="k-rsub min-w-0 whitespace-normal">{canceled ? note : line}{stale ? " Offline — the last we heard." : ""}</p>
          {paidWords && <span className="whitespace-nowrap font-mono text-subhead text-cream-muted">{paidWords}</span>}
        </div>
        {!canceled && <OrderSteps at={stepOf(tk.status)} />}
        {active && !shared && <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tell the truck">{eta("on_way")}{eta("outside")}</div>}
        {/* Running late and Share link are for an order still to be picked up or kept as a receipt — a canceled one
            has neither (R3c: canceling from this page made that the common way to see one). */}
        {!canceled && (
          <div className="flex items-center justify-between gap-3">
            {active && !shared
              ? <button type="button" className="btn-ter" disabled={busy} aria-pressed={tk.eta === "late"} onClick={() => { void setEta("late"); }}>{tk.eta === "late" ? `${ETA_WORDS.late} ✓` : ETA_WORDS.late}</button>
              : <span />}
            {shareKey && <button type="button" className="btn-ter" onClick={() => { void share(); }}><Icon name="link" /> Share link</button>}
          </div>
        )}
        {!canceled && <p className="text-footnote text-cream-dim">{note}</p>}
      </div>
      {/* The destructive way out sits apart, under the card, as an order screen's does. */}
      {canCancel && <div className="mt-3 flex justify-center"><button type="button" className="btn-del" disabled={busy} onClick={() => { void cancel(); }}>{busy ? "Canceling…" : "Cancel order"}</button></div>}

      <SectionHeader label="Receipt" annotation={`${etDay(tk.placed_at)}, ${clockTime(tk.placed_at)}`} />
      <div className="mt-2">
        {rows.map(([k, c]) => receiptLine(k, c === null ? "" : money(c)))}
        {tk.tip_cents > 0 && receiptLine("Tip", money(tk.tip_cents))}
        <div className="my-1 border-t border-line" />
        {shared
          ? receiptLine(canceled ? "Canceled" : tk.paid ? "Paid" : "Due at the window", tk.paid || canceled ? "" : money(total), true)
          : receiptLine(canceled && !tk.paid ? "Nothing charged" : tk.paid ? (tk.card ? `Paid · ${tk.card}` : "Paid") : "Due at the window", money(canceled && !tk.paid ? 0 : total), true)}
        {refunded > 0 && receiptLine("Refunded", `−${money(refunded)}`, true)}
      </div>
      {tk.stop && !tk.stop.canceled && !canceled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-footnote text-cream-muted">{tk.stop.name}{tk.stop.starts_at ? ` · ${etDay(tk.stop.starts_at)} ${timeRange(tk.stop.starts_at, tk.stop.ends_at)}` : ""}</span>
          {tk.stop.place && <button type="button" className="k-chip sm" onClick={() => openAddress(tk.stop!.place!)}><Icon name="pin" /> Directions</button>}
        </div>
      )}

      <div className="k-rows mt-4">
        {!user && (
          <InfoRow lead="Card" name="Every cup earns a stamp" sub={<span className="whitespace-normal">Join, and your next cups count toward a free one</span>}
            bodyClick={() => router.push("/3mpire")} ariaLabel="Join to earn stamps" trailing={<span className="text-cream-dim"><Icon name="chevronRight" /></span>} />
        )}
        <InfoRow lead="Packs" leadSub="3·6·12" name="The next drop" sub={<span className="whitespace-normal">Bottles brewed to order</span>}
          bodyClick={() => router.push("/reserve")} ariaLabel="Packs for the next drop" trailing={<Link href="/reserve" className="k-chip sm">Reserve</Link>} />
      </div>
      <ClosingBeat />
    </section>
  );
}
