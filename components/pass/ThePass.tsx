"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import { useCollectSheet } from "@/components/CollectSheet";
import { Segmented } from "@/components/controls";
import DropOps from "@/components/DropOps";
import EightySix from "@/components/EightySix";
import EmptyState from "@/components/EmptyState";
import Icon from "@/components/Icon";
import PourFill from "@/components/PourFill";
import Sheet, { CloseButton } from "@/components/Sheet";
import { queueOrderStatus, queueCollectCup, isNetworkError } from "@/components/offline";
import { canCollect, collectPayment, undoCollection, collectedPatch, undonePatch, paidHow, viaOf, VIA_LABEL, VIA_UNDO, type CollectVia } from "@/lib/collect";
import { authedFetch } from "@/lib/authedFetch";
import { clockTime } from "@/lib/dates";
import { haptic } from "@/lib/haptics";
import { unlockAudio } from "@/lib/chime";
import { money } from "@/lib/money";
import { setOrderStatus, movedTo, movedLine } from "@/lib/orderStatus";
import { notifyVoid } from "@/lib/voidNotice";
import { setPassMuted } from "@/lib/passSound";
import { canOf } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import {
  NEXT, PREV, STAGES, TRAY_SHOWN, lateOf, nextBoardChange, passLanes, laneOf, canRecall, laneName, isHere, somewhereLive,
  moreLine, elsewhereLine, type Lanes, type Scope,
} from "@/lib/passBoard";
import type { Order } from "@/lib/db";
import { DoneTicket, Ticket, type TicketActs } from "./Ticket";
import { usePassBoard, usePassScope, setPassScope } from "./usePassBoard";
import { useBoardNow } from "./clock";
import { useFollowFocus } from "./focus";

// THE PASS (2026-10-11, the KDS program, wave 2). The crew console's service screen, in a module of its own: it was the
// Kitchen function and the service-mode block inside app/crew/page.tsx, 6,500 lines that held everything else too. The
// page keeps only the mount (Live Ops' `svc`: Escape, the wake lock, leaving Live Ops); this file is the screen —
// the bar, the board and the rail beside it. Ticket.tsx draws one ticket; usePassBoard.ts holds the board and keeps it
// true; lib/passBoard.ts is the rules, run by scripts/pass.test.mjs.
//
// THE BOARD AT ARM'S LENGTH (2026-10-11). On a wide Pass — 900 points across, an iPad on its side or a desk — New, In
// progress and Ready stand side by side, each scrolling on its own under its heading, with pickups and the 86 board in a
// rail beside them; the type is set to be read from a step back. A phone keeps the stacked list, the rail under it, and
// the 86 board one tap away in the bar. The width is the Pass's own (a container query on its frame), not the window's:
// app/tailwind.css, THE PASS AT ARM'S LENGTH, holds the layout.

/** SERVICE MODE — the KDS as ONE working surface: the pass is the board, and the rail keeps pickups and the 86 board in
 *  reach without ever leaving the screen — 86ing a flavor mid-rush is a tap, not an exit.
 *  Exit with the button or Esc; leaving the Now section exits too.
 *  ITS OWN BELL (2026-10-11, the KDS audit): the Pass covers the header, and with it the bell — a refund
 *  to make or a paid order that didn't record went unseen on the one phone working the pass. The same
 *  count, the same inbox, above the Pass: the page hands it in (`bell`), with today's critical alert strip (`strip`). */
export default function ThePass({ bell, strip, canPlan, onExit }: { bell: ReactNode; strip: ReactNode; canPlan: boolean; onExit: () => void }) {
  // 86 ONE TAP AWAY ON A PHONE (2026-10-11). On a phone the rail is under the whole board, so running out of a flavor
  // meant scrolling past every ticket or leaving the Pass. The bar's "86 board" opens it in a sheet — and goes where the
  // rail is beside the board (pass-narrow).
  const [eightySix, setEightySix] = useState(false);
  return (
    <div className="svc-full text-cream pass-frame" role="dialog" aria-modal="true" aria-label="The Pass">
      <div className="svc-bar">
        <b>The Pass</b>
        <span className="flex items-center gap-2">
          <button type="button" className="btn-ter pass-narrow" onClick={() => setEightySix(true)} aria-haspopup="dialog">86 board</button>
          {bell}
          <button type="button" className="btn-ter" onClick={onExit}><Icon name="close" /> Exit</button>
        </span>
      </div>
      <div className="pass-grid">
        {/* Today's critical alert, named, one tap to the inbox — the strip that led Live Ops, on the screen the
            crew is working. Nothing at all when there is none. */}
        <div className="pass-main">{strip}<PassBoard /></div>
        <aside className="pass-rail" aria-label="Pickups & sold-out">
          <DropOps canPlan={canPlan} />
          <EightySix />
        </aside>
      </div>
      {eightySix && (
        <Sheet open onClose={() => setEightySix(false)} label="86 board"
          header={<div className="acs-head"><CloseButton onClick={() => setEightySix(false)} className="isheet-x" /></div>}>
          <EightySix />
        </Sheet>
      )}
    </div>
  );
}

/** A lane's heading: its name, its count — in its accessible name too — and the fold. */
function LaneHead({ lane, label, n, folded, onFold }: { lane: keyof Lanes; label: string; n: number; folded: boolean; onFold: () => void }) {
  return (
    <div role="heading" aria-level={3}>
      <button type="button" className="kds-stage-h min-h-11" onClick={onFold} aria-expanded={!folded} aria-label={laneName(lane, n)}>
        <span className={`kds-caret${folded ? " col" : ""}`} aria-hidden="true">›</span>
        <span className="kds-stage-name">{label}</span>
        <span className="kds-stage-n">{n}</span>
      </button>
    </div>
  );
}

/** The board: the lanes, their tickets, and what the board says about itself. */
function PassBoard() {
  const confirm = useConfirm();
  const { toast, nameOf } = useApp();
  const { user, profile } = useAuth();
  const me = user?.id ?? null;
  const admin = canOf(profile).admin;
  const [askCollect, collectSheet] = useCollectSheet();
  const { orders: all, flash, said, muted, boardAt, down, live, more, here, apply, load, showMore } = usePassBoard();
  const scope: Scope = usePassScope();
  const toggleMute = () => { setPassMuted(!muted); unlockAudio(); };
  // HERE OR EVERYWHERE (2026-10-11). With a stop or an event live, this phone can show only the orders sold there — and
  // says how many it leaves out, one tap from all of them. Nothing live: every order, whatever was chosen.
  const narrowed = scope === "here" && somewhereLive(here);
  const orders = useMemo(() => (narrowed ? all.filter((o) => isHere(o, here)) : all), [all, narrowed, here]);
  const elsewhere = narrowed ? all.filter((o) => o.status !== "done" && !isHere(o, here)).length : 0;
  // The board's clock strikes only when the board changes with the time — a ticket placed ahead coming due, a ticket
  // turning late (lib/passBoard nextBoardChange) — so the board is not drawn again every second; its labels tick alone.
  const now = useBoardNow((at) => nextBoardChange(orders, at));
  const lanes = useMemo(() => passLanes(orders, now), [orders, now]);
  const { board, onFocus, arm, land } = useFollowFocus(all);

  // Instant: patch local state synchronously, fire the write, no refetch on success.
  const move = useCallback(async (o: Order, to: Order["status"] | null) => {
    if (!to || !supabase) return;
    land(o, laneOf(o, Date.now()));
    apply({ ...o, status: to, status_changed_at: new Date().toISOString() } as Order, false);
    haptic("medium");
    // Definer RPC so a 'server' can advance status without table-wide write access — from the status
    // this ticket showed when it was tapped (lib/orderStatus: a tap on a board that is behind no longer
    // lands over an order somebody else moved).
    const { error } = await setOrderStatus(supabase, o.id, to, o.status);
    if (!error) {
      // READY REACHES THE CUSTOMER ONCE (2026-10-11). Told off-app (SMS/email, env-gated server-side)
      // once the move is saved, and only for a move forward into Ready: it went before the write had
      // landed, and again on a recall from Picked up — and /api/notify sends whatever it is asked.
      // Fire-and-forget: the board never waits on a notification provider. A move parked with no
      // signal sends nothing, now or when the queue replays it (components/offlineReplay), as before.
      if (to === "ready" && (o.status === "new" || o.status === "preparing")) {
        void (async () => {
          try {
            await authedFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "order_ready", id: o.id }) });
          } catch { /* best-effort */ }
        })();
      }
      return;
    }
    // No signal ≠ stop service: keep the optimistic board, park the write for replay
    // (coalesced per order — the final state wins), and say so calmly.
    if (isNetworkError(error.message)) { queueOrderStatus(o.id, to, o.status); toast("No signal — saved, will sync", "info"); return; }
    // Somebody moved it first (the other phone, a replay): say where it is and read the board again — news, not an error.
    const now = movedTo(error);
    toast(now === null ? `Couldn't update — ${error.message}` : movedLine(o.id, now), now === null ? "error" : "info");
    load();
  }, [apply, toast, load, land]);
  // ── MONEY AT THE WINDOW (2026-10-04, 0341) ─────────────────────────────────────────────────────
  // "UNPAID · collect at pickup" was a sentence with nothing behind it: nothing in the app could
  // mark a pay-at-pickup order paid. Taking it is instant like a move — the ticket says PAID the
  // moment the crew taps and the database answers after — and with no signal the tap is parked and
  // replayed, because the till does not wait for bars. Returns the row as now painted, or null.
  const takeMoney = useCallback(async (o: Order, via: CollectVia): Promise<Order | null> => {
    if (!supabase) return null;
    const paidRow = { ...o, ...collectedPatch(o, via, new Date().toISOString(), me) } as Order;
    apply(paidRow, false);
    haptic("paid");
    const res = await collectPayment(supabase, "cup", o.id, via);
    if (res.error) {
      if (isNetworkError(res.error)) { queueCollectCup(o.id, via); toast(`No signal — ${VIA_LABEL[via].toLowerCase()} saved, will sync`, "info"); return paidRow; }
      apply(o, false);
      toast(`Couldn't record it — ${res.error}`, "error"); load(); return null;
    }
    if (res.already) { toast(`${o.customer ?? "Guest"} had already paid — nothing taken`); load(); }
    return paidRow;
  }, [apply, me, toast, load]);
  const collect = useCallback(async (o: Order) => {
    const how = await askCollect({ who: o.customer ?? "Guest", cents: o.total_cents });
    if (how && how !== "unpaid") await takeMoney(o, how);
  }, [askCollect, takeMoney]);
  // A wrong tap is put right by the one who made it, inside the hour (or an admin) — the database's
  // rule (staff_undo_collection), mirrored by canUndo so the button is only where it will work.
  const undoTake = useCallback(async (o: Order) => {
    if (!supabase) return;
    const via = viaOf(o) ?? "card_reader";
    if (!(await confirm({ title: `Undo ${VIA_UNDO[via]} — ${money(o.total_cents)} from ${o.customer ?? "Guest"}?`, body: "Only if it wasn't settled that way. You can collect it again after.", confirmLabel: "Undo it" }))) return;
    apply({ ...o, ...undonePatch(o) } as Order, false);
    const res = await undoCollection(supabase, "cup", o.id);
    if (res.error) {
      apply(o, false);
      toast(isNetworkError(res.error) ? "No signal — undo it once you're back online" : `Couldn't undo it — ${res.error}`, "error");
      return;
    }
    toast(res.already ? "Nothing to undo — it wasn't taken at the window" : `${o.customer ?? "Guest"} — back to unpaid`);
  }, [confirm, apply, toast]);
  // Handing it over is when the money is asked about: an order still owed does not leave the window
  // without the question. The third answer, handing it over unpaid, is there and says what it is.
  const advance = useCallback(async (o: Order) => {
    const to = NEXT[o.status];
    if (to === "done" && canCollect(o)) {
      const how = await askCollect({ who: o.customer ?? "Guest", cents: o.total_cents, handOff: true });
      if (!how) return;
      const row = how === "unpaid" ? o : await takeMoney(o, how);
      if (!row) return;
      return move(row, to);
    }
    return move(o, to);
  }, [askCollect, takeMoney, move]);
  // ↩ takes a ticket back a stage; on a picked-up ticket it is Recall — done → ready, from the status it showed.
  const recall = useCallback((o: Order) => move(o, PREV[o.status]), [move]);
  // Voiding a paid order is a refund somebody has to make. It used to say only "This can't be
  // undone" — about an order a card had paid for — and flag nobody. The flag is the database's now (0416,
  // refund_flag_order): raised by the void itself, under the order's lock, from the row as it is — so a void made with no
  // signal is flagged when it lands, and one made just after another phone took the money on the reader is flagged too.
  // This says what the crew is about to do; it raises nothing.
  const voidOrder = useCallback(async (o: Order) => {
    const how = paidHow(o);
    // All of what was paid — the drinks and the tip (R7): the refund the crew makes is the amount said here.
    const amt = money(o.total_cents + (o.tip_cents ?? 0));
    const body = how === "cash" ? `They paid ${amt} cash — hand it back. This can't be undone.`
      : how === "card_reader" ? `They paid ${amt} on the card reader — refund it in Square; the inbox gets a flag. This can't be undone.`
      : how === "covered" ? "It was covered by a free cup or credit — no money to give back. This can't be undone."
      : how ? `They paid ${amt} online — refund it in Square; the inbox gets a flag. This can't be undone.`
      : "Nothing was paid. This can't be undone.";
    if (!(await confirm({ title: `Void ${o.customer ?? "this order"}?`, body, confirmLabel: "Void order", danger: true }))) return;
    if (!supabase) return;
    land(o, laneOf(o, Date.now()));
    apply(o, true);
    const { error } = await setOrderStatus(supabase, o.id, "void", o.status);
    if (error) {
      // No signal: the void waits in the queue, and the replay sends it — its refund flag with it (the database's), and
      // the member's email once it has landed (components/offlineReplay).
      if (isNetworkError(error.message)) { queueOrderStatus(o.id, "void", o.status); toast("No signal — void saved, will sync", "info"); return; }
      // Moved on before the void landed (picked up meanwhile): nothing was voided, so there is no refund to flag.
      const now = movedTo(error);
      toast(now === null ? `Couldn't void — ${error.message}` : movedLine(o.id, now), now === null ? "error" : "info");
      load(); return;
    }
    // The member is told (R7): the push says it (supabase/functions/push), and this sends the email /api/orders/cancel sends
    // when they cancel it themselves. Fire-and-forget, after the void has landed, as Ready's notice is.
    if (o.user_id) notifyVoid(o.id);
  }, [confirm, apply, toast, load, land]);
  // Every ticket's buttons, made once: a ticket is drawn again when its order changes, not when the board does. Each
  // first notes whether focus is on the ticket, so it can follow the ticket wherever it goes (./focus).
  const act = useMemo<TicketActs>(() => ({
    advance: (o) => { arm(o); return advance(o); },
    recall: (o) => { arm(o); return recall(o); },
    collect,
    undoTake,
    voidOrder: (o) => { arm(o); return voidOrder(o); },
  }), [arm, advance, recall, collect, undoTake, voidOrder]);

  // Scheduled is folded until opened; the tray shows the last few picked up until opened.
  const [folded, setFolded] = useState<Set<string>>(() => new Set(["scheduled"]));
  const [trayOpen, setTrayOpen] = useState(false);
  const toggle = (k: string) => setFolded((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const active = orders.filter((o) => o.status !== "done");
  const done = lanes.done.filter((o) => canRecall(o, now));
  // A ticket's clock starts when its order can be made (lib/ordering, 0343): placed ahead of a stop,
  // that is the stop's opening — not 7am, three hours before the truck could have made it.
  const late = lateOf(active, now);
  const tickets = (list: Order[], action: string) => list.map((o) => <Ticket key={o.id} o={o} action={action} flash={flash.has(o.id)} me={me} admin={admin} act={act} nameOf={nameOf} />);

  return (
    <div className="adm-sec pass-board" id="kitchen-pass" ref={board} tabIndex={-1} onFocus={onFocus}>
      {/* Service mode's .svc-bar already renders "The Pass" directly above the board — a SectionHeader here only
          repeated it, so it's cut. The controls the board has of its own — Here or All, the feed's word, the count, the
          bell — sit right-aligned, and wrap on a phone rather than run off it. */}
      <div className="flex flex-wrap justify-end items-center gap-2">
        {somewhereLive(here) && (
          <Segmented kind="choice" size="sm" label="Show orders" value={scope} onChange={setPassScope}
            options={[{ key: "all", label: "All" }, { key: "here", label: "Here", title: "Only what is sold at the live stop or event" }]} />
        )}
        {/* The feed down while reads still land: a quiet word beside the count, not a banner — the reconcile keeps the board. */}
        {!live && !down && <span className="k-count soon" role="status">Reconnecting…</span>}
        {active.length > 0 && <span className="k-count">{active.length} active</span>}
        <button type="button" className={`k-chip sm${muted ? " on" : ""}`} onClick={toggleMute} aria-pressed={muted}>{muted ? "🔇 Muted" : <><Icon name="bell" /> Sound</>}</button>
      </div>

      {/* A read that failed says so in words, and how old the board under it is — never a raw "Backend error". */}
      {down && (
        <div className="adm-attn" role="status">
          <b>{down === "auth" ? "Signed out" : "Can't reach the pass"}</b>
          {boardAt > 0 ? ` — showing the board from ${clockTime(new Date(boardAt).toISOString())}.` : "."}{" "}
          {down === "auth" ? "Sign in again to see new orders." : down === "net" && boardAt > 0 ? "Taps still work and will sync when the signal returns." : "Reconnecting…"}
        </div>
      )}
      {late.length > 0 && (
        <div className="adm-attn" role="alert">
          <b>{late.length} guest{late.length === 1 ? "" : "s"}</b> past 8 min — step over and reassure.
        </div>
      )}
      {/* NEVER AN OPEN ORDER HIDDEN IN SILENCE (2026-10-11): the read stops at OPEN_CAP open tickets, and "Here" leaves out
          what was sold elsewhere — each says how many, one tap from the rest. */}
      {more > 0 && (
        <div className="adm-attn" role="status">
          <b>{moreLine(more)}</b> not on the board yet. <button type="button" className="btn-ter" onClick={showMore}>Show them</button>
        </div>
      )}
      {elsewhere > 0 && (
        <div className="adm-attn" role="status">
          <b>{elsewhereLine(elsewhere)}</b> not shown. <button type="button" className="btn-ter" onClick={() => setPassScope("all")}>Show all</button>
        </div>
      )}

      {/* No board yet: the pass is loading, not clear. */}
      {boardAt === 0 && !down && <PourFill label="Loading the pass…" />}
      {boardAt > 0 && (
        <div className="pass-cols">
          {STAGES.map((st) => {
            const list = lanes[st.key as "new" | "preparing" | "ready"];
            const isCol = folded.has(st.key);
            return (
              <div className="kds-stage pass-lane" key={st.key} data-lane={st.key}>
                <LaneHead lane={st.key as keyof Lanes} label={st.label} n={list.length} folded={isCol} onFold={() => toggle(st.key)} />
                <div className="pass-list">
                  {!isCol && list.length === 0 && <div className="kds-empty">Nothing here.</div>}
                  {!isCol && tickets(list, st.action)}
                  {/* Placed ahead and waiting on its stop: under New, folded, soonest first, each saying when it is for. */}
                  {st.key === "new" && lanes.scheduled.length > 0 && (
                    <div className="kds-stage" data-lane="scheduled">
                      <LaneHead lane="scheduled" label="Scheduled" n={lanes.scheduled.length} folded={folded.has("scheduled")} onFold={() => toggle("scheduled")} />
                      {!folded.has("scheduled") && tickets(lanes.scheduled, st.action)}
                    </div>
                  )}
                  {/* Picked up in the last half hour, under Ready: the last few in reach, Recall one tap on each. */}
                  {st.key === "ready" && done.length > 0 && (
                    <div className="kds-stage" data-lane="done">
                      <LaneHead lane="done" label="Just completed" n={done.length} folded={!trayOpen} onFold={() => setTrayOpen((v) => !v)} />
                      {(trayOpen ? done : done.slice(0, TRAY_SHOWN)).map((o) => <DoneTicket key={o.id} o={o} me={me} admin={admin} act={act} nameOf={nameOf} />)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Clear only when a board read now says so — not before the first read, and not over a read that failed. */}
      {boardAt > 0 && !down && active.length === 0 && done.length === 0 && <EmptyState title="The pass is clear" sub="New orders arrive here in realtime." />}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{said.text && <span key={said.n}>{said.text}</span>}</div>
      {collectSheet}
    </div>
  );
}
