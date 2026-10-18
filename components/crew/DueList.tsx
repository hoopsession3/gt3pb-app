"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { refreshLive, useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import { useMinute } from "@/lib/useMinute";
import { etDayKey } from "@/lib/dates";
import { OPEN_PANEL_EVENT, scrollToAnchor } from "@/lib/anchors";
import { InfoRow } from "@/components/kit";
import {
  CHANNEL_WORD, NO_FEEDS, dueLabel, dueLead, dueList, feedsWord,
  type CupIn, type DueFeeds, type DueRow, type OfficeFeed, type PickupFeed, type PorchFeed,
} from "@/lib/dueNext";
import { dropSlot } from "@/lib/liveOps";
import Said from "@/components/Said";

// DUE NEXT, AS ONE LIST (2026-10-11, the dispatch round). Above Live Ops' three cards: every pickup pack, porch, office
// stop and cup placed ahead, soonest first, one row each, in words (lib/dueNext says why, and why not all_orders). The
// cards hand their rows up as they read them (onRows), so the list and the cards cannot disagree, and no table is read
// twice; the cups placed ahead are read here — the Pass's own read, with the clock (a cup coming due changes nothing in
// the database, so the minute is what takes it off the list). A tap opens the row's card, at the row, and moves focus
// there; a cup opens the Pass.
//
// THE DROP IS ONE OF ITS ROWS (2026-10-12, the Live Ops round, approved). The pickup drop's card stood under this list,
// so on a quiet day "Nothing due next." sat directly over "Pickup drop · This Sat · no reservations yet". The card is a
// row of the list now (`drop`: DropOps' fold, drawn as a row — components/crew/FoldCard), placed by its day and time as
// every row is (lib/liveOps dropSlot) and ahead of its own packs. The list draws it from the first moment, because the
// card is what reads the drop (its rows are the pickups this list shows), and "Nothing due next." is said only of a list
// with no drop in it.

/** The three feeds the cards report, and a reporter for each that keeps the same object when nothing changed. */
export type CardFeeds = Omit<DueFeeds, "cup">;
export function useDueFeeds() {
  const [feeds, setFeeds] = useState<CardFeeds>({ pickup: NO_FEEDS.pickup, porch: NO_FEEDS.porch, office: NO_FEEDS.office });
  const report = useMemo(() => ({
    pickup: (v: PickupFeed) => setFeeds((f) => (f.pickup === v ? f : { ...f, pickup: v })),
    porch: (v: PorchFeed) => setFeeds((f) => (f.porch === v ? f : { ...f, porch: v })),
    office: (v: OfficeFeed) => setFeeds((f) => (f.office === v ? f : { ...f, office: v })),
  }), []);
  return { feeds, report };
}

/** How many rows show before "Show all": the next few things, with what is overdue — the oldest — first. */
const FIRST = 8;

// The row's own id is drawn once its card is open; until then there is nothing to focus. A card's own target is its
// header button (a tap on it is what opening means), and so is the drop's, which is a row of this list (its button is a
// .k-row); a row is a container the card marks tabIndex -1 and outline-none, so a screen reader lands on it and no ring
// is drawn round it.
function focusWhenThere(id: string) {
  const until = Date.now() + 3000;
  const tick = () => {
    const el = document.getElementById(id);
    const target = el?.classList.contains("mpanel") ? el.querySelector<HTMLElement>(".mpanel-h") : el?.querySelector<HTMLElement>(":scope > button.k-row") ?? el;
    if (target) { target.focus({ preventScroll: true }); return; }
    if (Date.now() < until) window.setTimeout(tick, 100);
  };
  window.setTimeout(tick, 100);
}

export default function DueList({ feeds, onOpenPass, drop }: { feeds: CardFeeds; onOpenPass: () => void; drop?: ReactNode }) {
  const now = useMinute();
  const [all, setAll] = useState(false);

  // Cups placed ahead whose time has not come (0343 ready_from) — what the Pass button says beside its count.
  const loader = useCallback(async (): Promise<CupIn[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("orders")
      .select("id, customer, items, status, ready_from, paid, payment_id, payment_status, collected_at")
      .neq("status", "void").neq("status", "done").gt("ready_from", new Date().toISOString())
      .order("ready_from").limit(50);
    if (error) throw new Error(error.message);
    return (data as CupIn[]) ?? [];
  }, []);
  const cups = useAsyncData(loader, []);
  useRealtimeTable("orders", cups.reload);

  // A read that failed — the first, or one since — is said, not shown as the cups an older read found.
  const cupFailed = cups.error !== null;
  const list = useMemo(() => dueList({ ...feeds, cup: { status: cupFailed ? "error" : cups.status, rows: cupFailed ? [] : cups.data ?? [] } }, now),
    [feeds, cupFailed, cups.status, cups.data, now]);
  const today = etDayKey(new Date(now));

  const open = (r: DueRow) => {
    if (!r.card) { onOpenPass(); return; }
    // The card opens on its id (components/crew/FoldCard), then the jump finds the row once it is drawn.
    window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: r.card }));
    scrollToAnchor(r.anchor ?? r.card);
    focusWhenThere(r.anchor ?? r.card);
  };

  // Quiet until something has been read; a read that failed says so, and is never "nothing due". The drop, when it is
  // one of the rows, is drawn from the start: it is the card that reads the pickups.
  if (!drop && list.rows.length === 0 && list.failed.length === 0 && list.loading.length > 0) return null;
  const shown = all ? list.rows : list.rows.slice(0, FIRST);
  const dropAt = drop ? dropSlot(shown, { day: feeds.pickup.day, at: feeds.pickup.at ? Date.parse(feeds.pickup.at) : null }) : -1;
  const rowOf = (r: DueRow) => (
    <div role="listitem" key={r.key}>
      <InfoRow
        lead={dueLead(r.day, today)}
        leadSub={r.time || undefined}
        name={r.who}
        nameExtra={<span className="k-tag txt">{CHANNEL_WORD[r.channel]}</span>}
        meta={<span className="flex flex-wrap items-center gap-1.5">
          <span>{r.count}</span>
          {r.flags.map((f) => <span key={f.word} className={`k-tag txt${f.tone === "crit" ? " crit" : f.tone === "warn" ? " warn" : ""}`}>{f.word}</span>)}
        </span>}
        onClick={() => open(r)}
        ariaLabel={dueLabel(r, today)}
      />
    </div>
  );
  return (
    <div className="mpanel px-3.5 pb-1">
      {list.failed.length > 0 && (
        <p className="load-failed">
          <Said as="span" assertive>Couldn&rsquo;t load {feedsWord(list.failed)} — this is not &ldquo;nothing due&rdquo;.</Said>{" "}
          <button type="button" className="btn-ter" onClick={() => { void refreshLive(); }}>Try again</button>
        </p>
      )}
      {list.rows.length === 0 && !drop ? (
        list.failed.length === 0 && <p className="load-failed">Nothing due next.</p>
      ) : (
        <div className="k-rows" role="list" aria-label="Due next, soonest first">
          {shown.slice(0, Math.max(dropAt, 0)).map(rowOf)}
          {drop && <div role="listitem" key="drop">{drop}</div>}
          {shown.slice(Math.max(dropAt, 0)).map(rowOf)}
        </div>
      )}
      {list.rows.length > FIRST && (
        <div className="pt-1 pb-2.5">
          <button type="button" className="btn-ter" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? `Show the first ${FIRST}` : `Show all ${list.rows.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
