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
import { orderLine, orderTag, stepOf } from "@/lib/orderWords";
import { etDay } from "@/lib/today";
import { holdTicket, isTicket, ticketPath, useHeldTickets } from "@/lib/tickets";
import { useAsyncData } from "@/lib/useAsyncData";
import { refusalText } from "@/lib/refusal";

// THE TICKET (2026-10-13, R3b of the customer audit — board 09 "Every order gets a ticket", approved). One order, to
// whoever holds its link: a guest who paid had the "Order in." screen and nothing after it; a member had the bar and
// Today. This is the order's own page, signed in or not — its number, where it is, what was in it and what was paid,
// the stop and its window — read through order_ticket (0395), which shows that one order and nothing else. It updates
// itself while the order is in progress and the page is in front of someone, and it tells the truck you're on your way.
// The words are the order's everywhere (lib/orderWords). The phone keeps the link (lib/tickets): /order with none lists
// the ones it holds.

type Line = { slug: string; name?: string; qty: number; unit_cents: number };
type Ticket = {
  no: string; status: string; items: string[]; lines: Line[] | null; total_cents: number; tip_cents: number; paid: boolean;
  card: string | null; refunded_cents: number; refund_pending: boolean;
  placed_at: string; moved_at: string | null; ready_from: string | null; eta: "on_way" | "outside" | "late" | null;
  for: string | null;
  stop: { name: string; place: string | null; starts_at: string | null; ends_at: string | null; canceled: boolean; cancel_reason: string | null } | null;
};
const ACTIVE = new Set(["new", "preparing", "ready"]);

export default function OrderPage() {
  return <Suspense fallback={<section className="screen" id="s-ticket" />}><TicketScreen /></Suspense>;
}

function TicketScreen() {
  const t = useSearchParams().get("t") ?? "";
  return isTicket(t) ? <TicketView t={t} /> : <Held />;
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

function TicketView({ t }: { t: string }) {
  const router = useRouter();
  const { nameOf, toast } = useApp();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  // arrives-with: 0395 — until it is pasted the view is not there (PGRST202), and the page says it can't open the order.
  const { data: tk, error, reload } = useAsyncData<Ticket>(async () => {
    if (!supabase) throw new Error("We couldn't open this order just now — try again in a minute.");
    const { data, error: e } = await supabase.rpc("order_ticket", { p_ticket: t });
    if (e) throw new Error(refusalText(e) ?? "We couldn't open this order just now — try again in a minute.");
    return data as Ticket;
  }, [t]);
  const err = !tk && error ? error.message : null;
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
  useEffect(() => { if (no) holdTicket(t, no); }, [t, no]);

  if (err) {
    return (
      <section className="screen" id="s-ticket">
        <Watermark variant="landing" />
        <Masthead eyebrow="Your order" right={<div className="mast-right"><AccountPill /></div>} />
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
  const tag = refundedAll ? "Refunded" : refunded > 0 ? "Partly refunded" : canceled ? orderTag("void") : tk.paid ? "Paid" : `${money(total)} at the window`;
  const moneyBack = refundedAll ? "Refunded in full." : tk.refund_pending ? "The refund is on its way to your card." : "The crew is refunding your card in full.";
  const note = canceled
    ? tk.stop?.canceled
      ? `${tk.stop.name} was called off${tk.stop.cancel_reason ? ` — ${tk.stop.cancel_reason}` : ""}. ${tk.paid ? moneyBack : "Nothing was charged."}`
      : tk.paid ? moneyBack : "Nothing was charged."
    : tk.status === "done" ? "Thanks for coming by." : "This page updates itself while you wait. Keep the link to come back to it.";
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
  const share = async () => {
    const url = `${publicOrigin()}${ticketPath(t)}`;
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
    ? tk.lines.map((l) => [`${l.name ?? nameOf(l.slug)}${l.qty > 1 ? ` ×${l.qty}` : ""}`, l.unit_cents * l.qty])
    : [...tk.items.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map<string, number>())].map(([s, q]) => [`${nameOf(s)}${q > 1 ? ` ×${q}` : ""}`, null]);
  const receiptLine = (k: string, v: string, strong?: boolean) => (
    <div key={k} className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "text-callout font-bold text-cream" : "text-subhead text-cream-muted"}`}>
      <span className="min-w-0">{k}</span><span className="whitespace-nowrap font-mono">{v}</span>
    </div>
  );

  return (
    <section className="screen" id="s-ticket">
      <Watermark variant="landing" />
      <Masthead eyebrow="Your order" right={<div className="mast-right"><AccountPill /></div>} />
      <h1 className="k-title lg">{tk.no}</h1>
      {sub && <p className="k-sub">{sub}</p>}
      <div className="k-card mt-5 flex flex-col gap-3" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow live={active}>{line}</Eyebrow>
          <span className={`k-tag ${canceled || refunded > 0 ? "crit" : tk.paid ? "ok" : "gold"}`}>{tag}</span>
        </div>
        {!canceled && <OrderSteps at={stepOf(tk.status)} />}
        <p className="k-rsub whitespace-normal">{note}</p>
        {active && <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tell the truck">{eta("on_way")}{eta("outside")}</div>}
        <div className="flex items-center justify-between gap-3">
          {active
            ? <button type="button" className="btn-ter" disabled={busy} aria-pressed={tk.eta === "late"} onClick={() => { void setEta("late"); }}>{tk.eta === "late" ? `${ETA_WORDS.late} ✓` : ETA_WORDS.late}</button>
            : <span />}
          <button type="button" className="btn-ter" onClick={() => { void share(); }}><Icon name="link" /> Share link</button>
        </div>
      </div>

      <SectionHeader label="Receipt" annotation={`${etDay(tk.placed_at)}, ${clockTime(tk.placed_at)}`} />
      <div className="mt-2">
        {rows.map(([k, c]) => receiptLine(k, c === null ? "" : money(c)))}
        {tk.tip_cents > 0 && receiptLine("Tip", money(tk.tip_cents))}
        <div className="my-1 border-t border-line" />
        {receiptLine(canceled && !tk.paid ? "Nothing charged" : tk.paid ? (tk.card ? `Paid · ${tk.card}` : "Paid") : "Due at the window", money(total), true)}
        {refunded > 0 && receiptLine("Refunded", `−${money(refunded)}`, true)}
      </div>
      {tk.stop && !tk.stop.canceled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-footnote text-cream-muted">{tk.stop.name}{tk.stop.starts_at ? ` · ${etDay(tk.stop.starts_at)} ${timeRange(tk.stop.starts_at, tk.stop.ends_at)}` : ""}</span>
          {tk.stop.place && <button type="button" className="k-chip sm" onClick={() => openAddress(tk.stop!.place!)}><Icon name="pin" /> Directions</button>}
        </div>
      )}

      <div className="k-rows mt-4">
        {!user && (
          <InfoRow lead="Card" leadSub="10 → 1" name="Every cup earns a stamp" sub={<span className="whitespace-normal">Join, and your next cups count toward a free one</span>}
            bodyClick={() => router.push("/3mpire")} ariaLabel="Join to earn stamps" trailing={<span className="text-cream-dim"><Icon name="chevronRight" /></span>} />
        )}
        <InfoRow lead="Packs" leadSub="3·6·12" name="Saturday's drop" sub={<span className="whitespace-normal">Bottles brewed to order</span>}
          bodyClick={() => router.push("/reserve")} ariaLabel="Saturday's drop" trailing={<Link href="/reserve" className="k-chip sm">Reserve</Link>} />
      </div>
      <ClosingBeat />
    </section>
  );
}
