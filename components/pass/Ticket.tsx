"use client";

import { memo } from "react";
import LongPress, { type MenuItem } from "@/components/LongPress";
import Icon from "@/components/Icon";
import { money } from "@/lib/money";
import { canCollect, canUndo, isSettled, passWord, viaOf, VIA_CHIP, VIA_UNDO } from "@/lib/collect";
import { ticketNo } from "@/lib/orderStatus";
import { ACT_CLASS, PREV, ago, itemLines, ticketAge } from "@/lib/passBoard";
import type { Order } from "@/lib/db";
import { useSecond } from "./clock";

// ONE TICKET (2026-10-11, the KDS program, wave 2: out of app/crew/page.tsx). One ticket, one next action; aging colour
// signals pressure; Void is demoted to a guarded overflow — never under the operator's thumb.
//
// DRAWN WHEN IT CHANGES, NOT EVERY SECOND. A ticket is drawn again only when its order, its flash or what this viewer may
// do with it changes: the board hands every ticket the same `act` (its buttons' callbacks, made once), and the times on it
// — its age, its time in stage — are small labels that read the Pass's shared second themselves (./clock useSecond).
//
// AT ARM'S LENGTH (2026-10-11). On a wide Pass (an iPad on the counter, a desk) the ticket is read from a step back: its
// number in the display face at 28, the name at 20, each drink on a line of its own at 17 (ThePass's frame, app/tailwind.css
// THE PASS AT ARM'S LENGTH). On a phone it keeps the kit's steps. A late ticket says "late" beside its age; the money says
// PAID or UNPAID in words; a ticket waiting on its stop says when it is for — none of it by colour alone.

/** What a ticket's buttons do: the board's, made once and handed to every ticket. */
export type TicketActs = {
  advance: (o: Order) => unknown;
  recall: (o: Order) => unknown;
  collect: (o: Order) => unknown;
  undoTake: (o: Order) => unknown;
  voidOrder: (o: Order) => unknown;
};

/** How long the ticket has waited, from when its clock started (lib/ordering) — or, placed ahead, when it is for. */
function Age({ o }: { o: Order }) {
  const a = ticketAge(o, useSecond());
  return <span className={`adm-age shrink-0 ${a.sev}`}>{a.text}{a.late && <> late</>}</span>;
}
/** "3m" since `iso`, ticking. */
function Since({ iso }: { iso: string }) {
  return <>{ago(iso, useSecond())}</>;
}
/** The drinks: one line on a phone ("2× RISE · FLOW"), a line each at arm's length. */
// The Catalog's names (R2): a drink added or renamed there prints as the menu says it. `nameOf` comes in as a prop from the
// board, so a toast or a cart change elsewhere in the app never re-renders a memoized ticket.
function Items({ items, nameOf }: { items: readonly string[]; nameOf: (id: string) => string }) {
  return (
    <div className="adm-items">
      {itemLines(items, nameOf).map((l, i) => (
        <span key={l.key} className="pass-item">{i > 0 && <span className="pass-sep"> · </span>}{l.qty > 1 ? `${l.qty}× ` : ""}{l.name}</span>
      ))}
    </div>
  );
}
/** The ticket's number and the guest's name — the two things called across a counter. */
function Who({ o }: { o: Order }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="pass-no">{ticketNo(o.id)}</span>
      <b className="min-w-0 truncate">{o.customer ?? "Guest"}</b>
    </span>
  );
}

export const Ticket = memo(function Ticket({ o, action, flash, me, admin, act, nameOf }: {
  o: Order; action: string; flash: boolean; me: string | null; admin: boolean; act: TicketActs; nameOf: (id: string) => string;
}) {
  // A LONG PRESS ON A TICKET (2026-10-08, the navigation round, approved): its next step, back a stage,
  // the money, and Void — the ticket's own buttons, by name, without aiming at a 44pt corner mid-rush.
  const items: MenuItem[] = [
    { key: "next", label: action, icon: "arrowRight", run: () => { void act.advance(o); } },
    ...(PREV[o.status] ? [{ key: "back", label: "Move back a stage", icon: "chevronLeft", run: () => { void act.recall(o); } } satisfies MenuItem] : []),
    ...(canCollect(o) ? [{ key: "collect", label: `Collect ${money(o.total_cents)}`, run: () => { void act.collect(o); } }] : []),
    ...(canUndo(o, me, admin) ? [{ key: "undo", label: `Undo ${VIA_UNDO[viaOf(o) ?? "card_reader"]}`, run: () => { void act.undoTake(o); } }] : []),
    { key: "void", label: "Void order", icon: "close", danger: true, run: () => { void act.voidOrder(o); } },
  ];
  return (
    <LongPress title={`${o.customer ?? "Guest"} · ${ticketNo(o.id)}`} items={items}>{(press) => (
      <div {...press.bind} className={`adm-order pressable st-${o.status}${flash ? " flash" : ""}`}
        role="group" aria-label={`${o.customer ?? "Guest"}, ${ticketNo(o.id)}`} tabIndex={-1} data-ticket={o.id}>
        {/* ⋯ IS THE TICKET'S MENU (2026-10-11) — the one the long press raises: next, back, the money, and
            Void (which still asks). It went straight to Void, the one step that cannot be taken back. */}
        <button type="button" className="adm-act-more" onClick={press.show} aria-haspopup="dialog" aria-label={`Actions for ${o.customer ?? "this order"}`}><Icon name="more" /></button>
        <div className="adm-order-top pr-10">
          <Who o={o} />
          <Age o={o} />
        </div>
        <Items items={o.items} nameOf={nameOf} />
        {o.eta_status && (
          <span className={`kds-eta ${o.eta_status}`}>
            {o.eta_status === "outside" ? <><Icon name="pin" /> OUTSIDE — call the name</> : o.eta_status === "on_way" ? "🏃 On the way" : <><Icon name="clock" /> Running late</>}
          </span>
        )}
        <div className="meta">{money(o.total_cents)} · <span className={isSettled(o) ? "kds-paid" : "unp"}>{passWord(o)}</span> · <span className="kds-stagetime"><Since iso={o.status_changed_at} /> in stage</span></div>
        <div className="adm-actions-row">
          {PREV[o.status] && <button className="k-icon-btn lg shrink-0" onClick={() => act.recall(o)} aria-label="Move back a stage">↩</button>}
          {canCollect(o) && <button type="button" className="btn-sec shrink-0" onClick={() => act.collect(o)}>Collect {money(o.total_cents)}</button>}
          {canUndo(o, me, admin) && (
            <button type="button" className="btn-sec shrink-0 text-ok border-ok" onClick={() => act.undoTake(o)} aria-label={`Undo ${VIA_UNDO[viaOf(o) ?? "card_reader"]} from ${o.customer ?? "Guest"}`}>
              {VIA_CHIP[viaOf(o) ?? "card_reader"]} <Icon name="check" />
            </button>
          )}
          <button className={`adm-act ${ACT_CLASS[o.status]}`} onClick={() => act.advance(o)}>{action}</button>
        </div>
      </div>
    )}</LongPress>
  );
});

/** A ticket picked up in the last half hour, in the tray (the board holds only those — lib/passBoard canRecall): bring it
 *  back to ready — one tap — and the money. */
export const DoneTicket = memo(function DoneTicket({ o, me, admin, act, nameOf }: { o: Order; me: string | null; admin: boolean; act: TicketActs; nameOf: (id: string) => string }) {
  const items: MenuItem[] = [
    { key: "recall", label: "Bring it back to ready", icon: "chevronLeft", run: () => { void act.recall(o); } },
    ...(canCollect(o) ? [{ key: "collect", label: `Collect ${money(o.total_cents)}`, run: () => { void act.collect(o); } } satisfies MenuItem] : []),
    ...(canUndo(o, me, admin) ? [{ key: "undo", label: `Undo ${VIA_UNDO[viaOf(o) ?? "card_reader"]}`, run: () => { void act.undoTake(o); } } satisfies MenuItem] : []),
  ];
  return (
    <LongPress title={`${o.customer ?? "Guest"} · ${ticketNo(o.id)}`} items={items}>{(press) => (
      <div {...press.bind} className="adm-order pressable st-done"
        role="group" aria-label={`${o.customer ?? "Guest"}, ${ticketNo(o.id)}, picked up`} tabIndex={-1} data-ticket={o.id}>
        <div className="adm-order-top">
          <Who o={o} />
          <span className="adm-age calm">picked up <Since iso={o.status_changed_at} /> ago</span>
        </div>
        <Items items={o.items} nameOf={nameOf} />
        <div className="meta">{money(o.total_cents)} · <span className={isSettled(o) ? "kds-paid" : "unp"}>{passWord(o, true)}</span></div>
        <div className="adm-actions-row">
          <button type="button" className="btn-sec shrink-0" onClick={() => act.recall(o)} aria-label={`Bring ${o.customer ?? "order"} back to ready`}>↩ Recall</button>
          {/* Handed over unpaid and settled a minute later — a regular squaring up — is
              still money taken at the window, and this tray is where that order still is. */}
          {canCollect(o) && <button type="button" className="btn-sec shrink-0" onClick={() => act.collect(o)}>Collect {money(o.total_cents)}</button>}
          {canUndo(o, me, admin) && (
            <button type="button" className="btn-sec shrink-0 text-ok border-ok" onClick={() => act.undoTake(o)} aria-label={`Undo ${VIA_UNDO[viaOf(o) ?? "card_reader"]} from ${o.customer ?? "Guest"}`}>
              {VIA_CHIP[viaOf(o) ?? "card_reader"]} <Icon name="check" />
            </button>
          )}
        </div>
      </div>
    )}</LongPress>
  );
});
