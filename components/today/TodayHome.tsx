"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth, isStaff, type Profile } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import { useApp } from "@/components/AppProvider";
import { Masthead, InfoRow, ClosingBeat } from "@/components/kit";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import MemberInbox, { useHasActiveOrder } from "@/components/MemberInbox";
import MemberCard from "@/components/MemberCard";
import Sheet from "@/components/Sheet";
import Watermark from "@/components/Watermark";
import EditableCopy from "@/components/EditableCopy";
import EditCopyPill from "@/components/EditCopyPill";
import { useOrderingOpen } from "@/components/useOrderingOpen";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useMyActiveOrders, useOrderActions, ETA_WORDS } from "@/components/useMyOrders";
import { useCupAvailability } from "@/components/useCupAvailability";
import { authedFetch } from "@/lib/authedFetch";
import { fillCopy } from "@/lib/copy";
import { clockTime, etWhen, timeRange } from "@/lib/dates";
import { cardOf, freeWords, STAMP_GOAL } from "@/lib/loyalty";
import { CUP_MARKETS } from "@/lib/markets";
import { openAddress } from "@/lib/maps";
import { money } from "@/lib/money";
import { closedWords, readyWords, waitingToOpen, type Ordering } from "@/lib/ordering";
import { isSettled } from "@/lib/settled";
import { supabase } from "@/lib/supabase";
import { readMode } from "@/lib/mode";
import type { Order } from "@/lib/db";
import { drinksWords, etDay, orderable, orderNo, stepOf, todayLead, usualOf, type TodayLead } from "@/lib/today";
import { orderLine, orderTag } from "@/lib/orderWords";
import OrderSteps from "@/components/today/OrderSteps";
import Eyebrow from "@/components/today/Eyebrow";

// TODAY, BY STATE (2026-10-13, R3 of the customer audit — boards 03–06, approved). The page leads with what is true now —
// the order being made, the usual one tap from a priced checkout, or the truck off and when cup orders open — and the
// card, the packs and the stack are a row each under it (lib/today decides; this draws). The TODAY eyebrow went: the
// tab already says it.

type T = (k: string) => string;

function firstName(profile: Profile | null, email?: string | null) {
  const n = profile?.display_name || (email ? email.split("@")[0] : "");
  const f = (n || "there").split(" ")[0];
  return f.charAt(0).toUpperCase() + f.slice(1);
}
// The clock is read in the browser only (the server's would be UTC and the HTML would not match, React #418).
const greet = (d: Date) => (d.getHours() < 12 ? "Morning" : d.getHours() < 18 ? "Afternoon" : "Evening");
// The day is the truck's, Eastern (R7), as every stop's day under it is (etDay): a phone in another time zone dated the
// page by its own day while the stops under it went by the truck's.
const shortDay = (d: Date) => etDay(d.toISOString());

/** The member's usual: the drinks of their last order that was picked up (lib/today usualOf). undefined while read —
 *  and when the read failed (R7): a failed read is not "no orders yet", which offered a returning member their first cup. */
function useUsual(): string[] | null | undefined {
  const { user } = useAuth();
  const [usual, setUsual] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    if (!supabase || !user) return;
    let alive = true;
    supabase.from("orders").select("id, items, status, created_at").eq("user_id", user.id).eq("status", "done")
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data, error }) => { if (alive && !error) setUsual(usualOf((data ?? []) as Order[])); });
    return () => { alive = false; };
  }, [user]);
  return supabase && user ? usual : null;
}

/** What the server would charge for these drinks — the quote checkout shows and Pay holds to (C2). null until it
 *  answers, and when it cannot: the button then names the drinks without a price rather than guess one. */
function useQuote(items: readonly string[], on: boolean): number | null {
  const key = items.join(",");
  const [q, setQ] = useState<{ key: string; cents: number } | null>(null);
  useEffect(() => {
    if (!on || !key) return;
    let alive = true;
    authedFetch("/api/checkout/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: key.split(",") }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.subtotalCents === "number") setQ({ key, cents: d.subtotalCents }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [on, key]);
  return on && q && q.key === key ? q.cents : null;
}

// ── THE ORDER BEING MADE ──────────────────────────────────────────────────────────────────────────────────────
function MakingCard({ order, more, stale, reload }: { order: Order; more: number; stale: boolean; reload: () => void }) {
  const { nameOf } = useApp();
  const { setEta, etaBusy, cancel, canceling } = useOrderActions(order, reload);
  const paid = isSettled(order);
  const ahead = order.status === "new" && !!order.ready_from && waitingToOpen(order);
  // The words are the order's everywhere its customer reads it (lib/orderWords): the bar, the toast, the push.
  const tag = orderTag(order.status, ahead);
  const line = orderLine(order.status, ahead ? readyWords({ state: "ahead", readyFrom: order.ready_from! }) : null);
  // What the card was charged, or is due: the drinks and the tip (R7) — the order page and the receipt say the same.
  const total = typeof order.total_cents === "number" ? money(order.total_cents + (order.tip_cents ?? 0)) : null;
  // Paid at the window, the order is the crew's to cancel: the database refuses it from a phone (0341).
  const canCancel = order.status === "new" && !order.collected_at;
  const eta = (k: "on_way" | "outside") => (
    <Button kind="secondary" wide disabled={etaBusy} aria-pressed={order.eta_status === k} onClick={() => { void setEta(k); }}>
      {order.eta_status === k && <Icon name="check" />} {ETA_WORDS[k]}
    </Button>
  );
  return (
    <div className="k-card mt-5 flex flex-col gap-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow live>Order {orderNo(order.id)}</Eyebrow>
        <span className={`k-tag ${order.status === "new" ? "gold" : "ok"}`}>{tag}</span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-title2 font-bold text-cream">{drinksWords(order.items, nameOf)}</div>
          <p className="k-rsub whitespace-normal">{line}{more > 0 ? ` +${more} more on the way.` : ""}{stale ? " Offline — the last we heard." : ""}</p>
        </div>
        {total && <span className="whitespace-nowrap font-mono text-subhead text-cream-muted">{paid ? `Paid ${total}` : `${total} at the window`}</span>}
      </div>
      <OrderSteps at={stepOf(order.status)} />
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tell the truck">
        {eta("on_way")}
        {eta("outside")}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn-ter" disabled={etaBusy} aria-pressed={order.eta_status === "late"} onClick={() => { void setEta("late"); }}>
          {order.eta_status === "late" ? `${ETA_WORDS.late} ✓` : ETA_WORDS.late}
        </button>
        {canCancel && <button type="button" className="btn-del" onClick={() => { void cancel(); }} disabled={canceling}>{canceling ? "Canceling…" : "Cancel order"}</button>}
      </div>
    </div>
  );
}

// ── THE LEAD: what the member can do now ───────────────────────────────────────────────────────────────────────
function Lead({ lead, usual, stopMenu, t }: { lead: Exclude<TodayLead<Order>, { kind: "making" }>; usual: string[] | null | undefined; stopMenu: ReadonlySet<string> | null; t: T }) {
  const router = useRouter();
  const { profile } = useAuth();
  const { menu, nameOf, reorder } = useApp();
  const { soldOut } = useCupAvailability();
  const onMenu = new Set(menu.map((d) => d.slug));
  // A free cup ready is said where the usual is priced (R7): it is given at the window, so this price does not take it off.
  const free = cardOf(profile?.points).free;
  const can = usual ? orderable(usual, onMenu, soldOut, stopMenu) : [];
  const cents = useQuote(can, lead.kind === "open" && can.length > 0);
  const menuChip = <Link href="/menu" className="k-chip sm">{t("today.see_menu")}</Link>;

  if (lead.kind === "open") {
    const s = lead.stop;
    const eyebrow = lead.pouring
      ? (s?.name ? `Live · ${s.name}${s.ends_at ? ` · till ${clockTime(s.ends_at)}` : ""}` : "Live now")
      : `Pre-order${s?.name ? ` · ${s.name}` : ""}${s?.starts_at ? ` · ${etWhen(s.starts_at).replace(/^today at /, "")}` : ""}`;
    const when = lead.pouring || !lead.readyFrom ? t("today.again_now") : `made when we open, ${etWhen(lead.readyFrom)}`;
    return (
      <div className="mt-5 flex flex-col gap-2.5">
        <Eyebrow live={lead.pouring}>{eyebrow}</Eyebrow>
        {can.length > 0 ? (
          <>
            <Button kind="primary" wide onClick={() => reorder(can)}>
              {t("today.again")} · {drinksWords(can, nameOf)}{cents !== null ? ` · ${money(cents)}` : ""}
            </Button>
            <div className="flex items-baseline justify-between gap-3">
              <span className="k-rsub whitespace-normal">{t("today.usual_label")} · {when}</span>
              <Link href="/menu" className="btn-ter whitespace-nowrap">{t("today.change")}</Link>
            </div>
            {free > 0 && <p className="k-rsub whitespace-normal"><span className="k-tag gold fill">On us</span> {fillCopy(t("today.free_at_window"), { ready: freeWords(free) })}</p>}
          </>
        ) : (
          <>
            {/* "Your first cup" only to someone with none (null); a usual not known — still read, or a read that failed — is
                the menu, claiming nothing (R7). */}
            <Button kind="primary" wide onClick={() => router.push("/menu")}>{usual === null ? t("today.first_cta") : t("today.see_menu")}</Button>
            {usual !== undefined && <EditableCopy k={usual ? "today.usual_out" : "today.first_sub"} value={t(usual ? "today.usual_out" : "today.first_sub")} as="p" className="k-rsub whitespace-normal" />}
          </>
        )}
      </div>
    );
  }

  if (lead.kind === "closing") {
    return (
      <div className="mt-5 flex flex-col gap-2.5">
        {/* Packing up, said as that (R7): this state comes with the switch off too — a stop under way nobody flipped live —
            and Find Us says Live only while the switch is on. Walk-ups are the line below. */}
        <Eyebrow>{lead.stop?.name ? `Packing up · ${lead.stop.name}` : "Packing up"}</Eyebrow>
        <p className="k-rsub whitespace-normal">{closedWords({ state: "closing", open: false, stop: lead.stop, opensAt: null, readyFrom: null }, { closing: t("findus.cta_closed") })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/truck" className="k-chip sm"><Icon name="pin" /> {t("today.find_us")}</Link>
          {menuChip}
        </div>
      </div>
    );
  }

  if (lead.kind === "later") {
    const s = lead.stop;
    const opens = lead.opensAt
      ? `Cup orders open ${etWhen(lead.opensAt)}.${can.length ? ` ${t("today.usual_then")}` : ""}`
      : "Cup orders open when the truck goes live.";
    return (
      <div className="mt-5 flex flex-col gap-2.5">
        <Eyebrow>{t("today.off_eyebrow")}</Eyebrow>
        {s && (
          <div>
            <div className="font-display text-title2 leading-tight text-cream">{s.name || "The next stop"}</div>
            <div className="mt-1 text-callout font-semibold text-cream">{[etDay(s.starts_at), timeRange(s.starts_at, s.ends_at)].filter(Boolean).join(" · ")}</div>
            {s.where && <div className="text-subhead text-cream-muted">{s.where.replace(/\s+\d{5}(?:-\d{4})?\s*$/, "")}</div>}
          </div>
        )}
        <p className="k-rsub whitespace-normal">{opens}</p>
        {s && lead.opensAt && <RemindMe stopId={s.id} opensAt={lead.opensAt} stopName={s.name} where={s.where ?? null} t={t} />}
        <div className="flex flex-wrap items-center gap-2">
          {(s?.to || s?.where) && <button type="button" className="k-chip sm" onClick={() => openAddress((s.to || s.where)!)}><Icon name="pin" /> {t("today.directions")}</button>}
          {menuChip}
        </div>
      </div>
    );
  }

  if (lead.kind === "none") {
    return (
      <div className="mt-5 flex flex-col gap-2.5">
        <Eyebrow>{t("today.none_eyebrow")}</Eyebrow>
        <EditableCopy k="today.none_title" value={t("today.none_title")} as="div" className="font-display text-title2 leading-tight text-cream" />
        <p className="k-rsub whitespace-normal">{closedWords({ state: "none", open: false, stop: null, opensAt: null, readyFrom: null })}</p>
        <div className="flex flex-wrap items-center gap-2">{menuChip}</div>
      </div>
    );
  }

  // Not read yet, or not readable: the usual, as Today always offered it, claiming nothing about the truck — checkout
  // and Pay decide (they read the truck themselves).
  if (!can.length) return <div className="mt-5" />;
  return (
    <div className="k-rows mt-5">
      <InfoRow lead={t("today.usual_lead")} leadSub={t("today.usual_leadsub")} name={drinksWords(can, nameOf)} sub={t("today.usual_sub")}
        trailing={<span className="k-chip">{t("today.usual_cta")}</span>} onClick={() => reorder(can)} ariaLabel={`Order your usual again: ${drinksWords(can, nameOf)}`} />
    </div>
  );
}

// ── THE ROWS: the card, the packs, the stack ──────────────────────────────────────────────────────────────────
// The stack loads when it is opened (R4: two questions, the Catalog's drinks, a button that follows the truck).
const DailyStack = dynamic(() => import("@/components/DailyStack"));
// Loaded only for the truck-off lead, where it is drawn (its alerts code is not every member's Today).
const RemindMe = dynamic(() => import("./RemindMe"));
const CrewWelcomeRow = dynamic(() => import("@/components/CrewWelcomeRow"));

function MiniStamps({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: STAMP_GOAL }).map((_, i) => (
        <span key={i} className={`block size-2 rounded-full ${i < n ? "bg-red" : "border border-line2"}`} />
      ))}
    </span>
  );
}

function Rows({ t, quiet, first, ordering, stopMenu }: { t: T; quiet: boolean; first: boolean; ordering: Ordering | null; stopMenu: ReadonlySet<string> | null }) {
  const { profile } = useAuth();
  const router = useRouter();
  const hasPack = useHasActiveOrder();
  const [card, setCard] = useState(false);
  const [stack, setStack] = useState(false);
  const c = cardOf(profile?.points);
  const near = c.free === 0 && c.toNext <= 2;
  const cardName = c.free > 0
    ? <>{fillCopy(t(c.free === 1 ? "stamp.badge_earned_one" : "stamp.badge_earned_other"), { count: String(c.free) })} <span className="k-tag gold fill">On us</span></>
    : c.stamps === 0 ? t("today.card_empty")
    : fillCopy(t(near ? "stamp.foot_near" : "stamp.foot_progress"), { count: String(c.toNext) });
  const cardSub = c.free > 0 ? <span className="whitespace-normal">{t("stamp.foot_full")}</span> : c.stamps === 0 ? t("stamp.badge_default") : <MiniStamps n={c.stamps} />;
  return (
    <>
      <div className="k-rows mt-3">
        {profile && (
          <InfoRow lead={t("stamp.kicker")} leadSub={`${c.stamps}/${STAMP_GOAL}`} name={cardName} sub={cardSub}
            trailing={<span className="text-cream-dim"><Icon name="chevronRight" /></span>} onClick={() => setCard(true)} ariaLabel={t("stamp.open_cta")} />
        )}
        {/* Not to someone with a pack or a delivery already coming (it is in Your stuff, above). With no cup to sell, the
            packs step up a notch. */}
        {!hasPack && (
          <InfoRow lead={t("today.packs_lead")} leadSub="3·6·12" name={t("today.packs_name")} sub={<span className="whitespace-normal">{t("today.packs_sub")}</span>}
            bodyClick={() => router.push("/reserve")} ariaLabel={t("today.packs_name")}
            trailing={<Link href="/reserve" className={`k-chip sm${quiet ? " on" : ""}`}>{t("today.packs_cta")}</Link>} />
        )}
        <InfoRow lead={t("today.stack_lead")} name={first ? t("today.stack_first") : t("home.dialed_title")}
          sub={<span className="whitespace-normal">{first ? t("today.stack_first_sub") : t("home.dialed_sub")}</span>}
          trailing={<span className="text-cream-dim"><Icon name="chevronRight" /></span>} onClick={() => setStack(true)} />
      </div>
      {profile && <MemberCard open={card} onClose={() => setCard(false)} />}
      {stack && (
        <Sheet open={stack} onClose={() => setStack(false)} label={t("home.dialed_title")} header={<h2 className="k-title">{t("home.dialed_title")}</h2>}>
          <EditableCopy k="stack.intro" value={t("stack.intro")} as="p" className="mx-0.5 mt-1 mb-4 text-subhead text-cream-muted" />
          <DailyStack ordering={ordering} stopMenu={stopMenu} />
        </Sheet>
      )}
    </>
  );
}

// ── THE PAGE ─────────────────────────────────────────────────────────────────────────────────────────────────
export default function TodayHome({ t }: { t: T }) {
  const { user, profile } = useAuth();
  const name = firstName(profile, user?.email);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const [sideChosen] = useState(() => readMode() !== null);
  const { orders, stale, reload } = useMyActiveOrders();
  const usual = useUsual();
  const { market } = useViewerMarket(CUP_MARKETS);
  const oo = useOrderingOpen(true, market);
  const lead = todayLead(orders, oo.checked ? oo.ordering : null);
  // Until the truck is read the lead keeps its room (no jump when it lands); after three seconds without an answer the
  // page offers the usual, claiming nothing.
  const [waited, setWaited] = useState(false);
  useEffect(() => { const id = setTimeout(() => setWaited(true), 3000); return () => clearTimeout(id); }, []);
  // The usual is read too before the lead is drawn: a returning member is never offered "your first cup" for a moment.
  const holding = (lead.kind === "unknown" && !waited) || (lead.kind !== "making" && usual === undefined && !waited);

  return (
    <section className="screen" id="s-today">
      <Watermark variant="landing" />
      <Masthead right={<div className="mast-right"><EditCopyPill group="Home · signed-in" /><AccountPill /></div>} />
      <div className="mt-6 flex items-baseline justify-between gap-3">
        <h1 className="k-title">{now ? `${greet(now)}, ` : ""}{name}.</h1>
        {now && <span className="whitespace-nowrap font-mono text-caption uppercase tracking-eyebrow text-cream-dim">{shortDay(now)}</span>}
      </div>

      {isStaff(profile) && !sideChosen && <CrewWelcomeRow />}

      {lead.kind === "making"
        ? <MakingCard order={lead.order} more={lead.more} stale={stale} reload={reload} />
        : holding ? <div className="mt-5 min-h-[132px]" aria-busy="true" />
        : <Lead lead={lead} usual={usual} stopMenu={oo.stopMenu} t={t} />}

      <MemberInbox />
      <Rows t={t} quiet={lead.kind === "later" || lead.kind === "none" || lead.kind === "closing"} first={usual === null}
        ordering={oo.checked ? oo.ordering : null} stopMenu={oo.stopMenu} />

      <ClosingBeat />
    </section>
  );
}
