// ONE HOME (2026-10-09, round 2 of the UX plan, approved by Ryan: "Yes, in this order"; the three
// numbers "Sales, margin, next-drop orders"). My Day opened on 31 tasks — 25 of them late, the oldest
// by 99 days — and the bell counted every unanswered alert, so neither ever reached zero and neither
// meant anything. Command, beside it, put twelve numbers at equal weight. The home now answers two
// questions in one look: how are we doing (three numbers, each with its change and its cause) and
// what's next (at most three things due today). Everything else is one tap down, and nothing is
// deleted to get there.
//
// 2026-10-12 (the My Day audit, approved): the numbers went to Money alone, and the home's questions are
// the person's — what needs me, what should I do next, what's coming — answered by the head's four states,
// the fixed rank and Coming up, below. Only what's yours is on it (lib/obligations obligationFor).
//
// The rules live here, apart from the screens, so the smoke suite can hold them to their word.
import { dayKey, etDayKey, addDays, weekdayOf, dayFromKey } from "./dates";
import { etDayStart } from "./etDay";
import { dueWord, daysBetween } from "./dayWords";

/** A task more than this many days late is stale: it folds into one row instead of leading the day. */
export const STALE_DAYS = 14;
/** The home leads with at most this many rows (since 2026-10-12, in the fixed rank below). */
export const TODAY_MAX = 3;

export type HomeItem = {
  key: string;
  title: string;
  sub: string;
  /** the due day minus today, in whole days: negative is late, 0 is today, null has no date */
  daysOut: number | null;
  critical: boolean;
  /** mine: a task assigned to you · owed: a deadline that is yours (lib/obligations obligationFor) · upkeep:
   *  equipment · rule: a compliance rule to confirm with its authority. ("team", somebody else's late task,
   *  left with "only what's yours", 2026-10-12: the team's late work is Command's.) */
  kind: "mine" | "owed" | "upkeep" | "rule";
  /** the event or stop it belongs to — its name, and its day minus today — when it belongs to one (2026-10-12) */
  op?: { name: string; daysOut: number } | null;
};

export type HomeSplit<T extends HomeItem = HomeItem> = {
  next: T[];          // tiers 1–5, in rank order: what the list leads with
  shown: T[];         // the rows the list leads with: at most TODAY_MAX of next — or, with next empty, the first to decide
  due: T[];           // of next, everything due today or late: the head's count and the "due" sheet, in rank order
  moreToday: number;  // due, but not among shown
  stale: T[];         // tier 6: late by more than STALE_DAYS, newest-due first — "to decide"
  moreStale: number;  // stale, but not among shown: the one "N more to decide" row
  upkeep: T[];        // equipment upkeep due or late, whatever its age: one row on the home
  rules: T[];         // compliance rules to confirm with the authority: one row on the home, never "due today"
  later: number;      // not ranked: dated more than SOON_DAYS ahead with no event near, or not dated at all
  total: number;      // every item — all of them the viewer's (2026-10-12): the count on "All tasks"
};

/** Where one item goes on the home by its date alone. Equipment is decided by splitHome, not here. */
export function homeBucket(daysOut: number | null): "today" | "stale" | "later" {
  if (daysOut === null || daysOut > 0) return "later";
  return daysOut < -STALE_DAYS ? "stale" : "today";
}

// ── WHAT'S NEXT, BY A FIXED RANK (2026-10-12, the My Day audit, approved) ─────────────────────────
// "Next:" appeared only when nothing was due today, and only from things dated after it: the late were
// never named, a task due in two days was invisible until its day, and a critical task with no date of
// its own fell into "later" even with its event three days off. The list leads with the viewer's work
// in six tiers, fixed and explainable, and each row says in words which tier put it there:
//   1  belongs to an event or stop OP_DAYS days away or less         "for Sat · ISI Elite Training"
//   2  critical, and due today or late by STALE_DAYS or less          "critical"
//   3  due today                                                      "due today"
//   4  late by STALE_DAYS or less                                     "3 days late"
//   5  due in the next SOON_DAYS days                                 "due Wed"
//   6  late by more than STALE_DAYS — a decision now, not a chore      "to decide"
// Inside a tier, a task assigned to you comes before a deadline you own, then the earliest due; tier 6
// newest-due first (the freshest of the old is the likeliest still to matter). Age orders a tier and
// never lifts anything out of one: forty days late stays under something due in two days. Equipment and
// compliance rules are not ranked — they keep their own rows (2026-10-10).
export const OP_DAYS = 3;
export const SOON_DAYS = 2;
export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

/** The tier an item stands in, or null when it is not ranked (equipment, a rule, or nothing near). */
export function homeTier(i: HomeItem): Tier | null {
  if (i.kind === "upkeep" || i.kind === "rule") return null;
  if (i.op && i.op.daysOut >= 0 && i.op.daysOut <= OP_DAYS) return 1;
  const d = i.daysOut;
  if (d === null || d > SOON_DAYS) return null;
  if (homeBucket(d) === "stale") return 6;
  if (d <= 0 && i.critical) return 2;
  if (d === 0) return 3;
  if (d < 0) return 4;
  return 5;
}

const FAR = 1e6;
/** The fixed order: tier; then assigned to you before what you own; then the earliest due — tier 6 newest-due first. */
export function rankHome(a: HomeItem, b: HomeItem): number {
  const ta = homeTier(a) ?? 7, tb = homeTier(b) ?? 7;
  if (ta !== tb) return ta - tb;
  const assigned = Number(b.kind === "mine") - Number(a.kind === "mine");
  if (assigned) return assigned;
  const da = a.daysOut ?? a.op?.daysOut ?? FAR, db = b.daysOut ?? b.op?.daysOut ?? FAR;
  return ta === 6 ? db - da : da - db;
}

/** "today" · "tomorrow" · "Sat" — a day up to a week ahead, in words a phone's row has room for. */
function aheadWord(daysOut: number, today: string): string {
  if (daysOut === 0) return "today";
  if (daysOut === 1) return "tomorrow";
  return weekdayOf(addDays(today, daysOut), "short");
}

/** Why a row stands where it does, in words: the tier that put it there. Null for what is not ranked. */
export function reasonWords(i: HomeItem, today: string): string | null {
  switch (homeTier(i)) {
    case 1: return `for ${aheadWord(i.op!.daysOut, today)} · ${i.op!.name}`;
    case 2: return "critical";
    case 3: return "due today";
    case 4: return dueWord(i.daysOut as number);
    case 5: return `due ${aheadWord(i.daysOut as number, today)}`;
    case 6: return "to decide";
    default: return null;
  }
}

/** The age beside a row ("3 days late"), unless its reason already says when — tiers 3 to 5, or tier 1 dated by its event. */
export function ageWords(i: HomeItem): string | null {
  if (i.daysOut === null) return null;
  const t = homeTier(i);
  if (t === 3 || t === 4 || t === 5) return null;
  if (t === 1 && i.daysOut === i.op?.daysOut) return null;
  return dueWord(i.daysOut);
}

// COMPLIANCE IS NOT TODAY'S WORK (2026-10-10, Ryan: "the my day still doesn't make sense"). Every one of the
// six things under "To do · 6 due" on his My Day was a compliance rule nobody had confirmed with its authority
// — ServSafe, the mobile-setup authorization, the temporary permit — because v_obligations dates a rule with no
// confirmation "today" (0330: coalesce(verified_on + 365, current_date)). So they were due today every day,
// and the day's real work could never reach the top three. They are one row now, like equipment: counted,
// one tap from the list, each opening the rule where it is confirmed.
//
// THE REST TO DECIDE IS ONE ROW (2026-10-12, the My Day audit, approved). The work more than two weeks late
// sat in a chip, "2+ weeks late · 11", beside the equipment's. When nothing nearer is waiting the newest of it
// leads the list, "To decide", and the rest is one row — "10 more to decide" — that opens the sheet it always
// opened, with its bulk Done and Move to next week. Nothing is closed, moved or reassigned without a tap.
export function splitHome<T extends HomeItem>(items: readonly T[]): HomeSplit<T> {
  const upkeep = items.filter((i) => i.kind === "upkeep").sort((a, b) => (a.daysOut ?? 0) - (b.daysOut ?? 0));
  const rules = items.filter((i) => i.kind === "rule");
  const ranked = items.filter((i) => homeTier(i) !== null).sort(rankHome);
  const next = ranked.filter((i) => homeTier(i) !== 6);
  const stale = ranked.filter((i) => homeTier(i) === 6);
  const shown = next.length ? next.slice(0, TODAY_MAX) : stale.slice(0, 1);
  const due = next.filter((i) => i.daysOut !== null && i.daysOut <= 0);
  return {
    next,
    shown,
    due,
    moreToday: due.filter((i) => !shown.includes(i)).length,
    stale,
    moreStale: stale.filter((i) => !shown.includes(i)).length,
    upkeep,
    rules,
    later: items.filter((i) => i.kind !== "upkeep" && i.kind !== "rule" && homeTier(i) === null).length,
    total: items.length,
  };
}

// THE DAY COUNTS DOWN, AND ENDS (2026-10-10, My Day 10). "6 due" never said whether a morning was going well,
// and an empty list said "Nothing due today." — the same words for a clear day and a finished one. The head
// counts what was done today beside what is left, and a finished day says so, with what comes next.
/** The head's words: what is done today beside what is left. */
export function dayCount(done: number, toGo: number): string {
  if (toGo > 0) return done > 0 ? `${done} done · ${toGo} to go` : `${toGo} due`;
  return done > 0 ? `${done} done` : "Clear";
}

// THE HEAD SAYS WHAT'S TRUE (2026-10-12, the My Day audit, approved). It said "Clear", in the green done
// style, over eleven things more than two weeks late: it counted only what was due today or late by two
// weeks or less, and called everything else nothing. Four states now, each in its own tone:
//   due today, or late by STALE_DAYS or less        "3 due" · "1 done · 2 to go"        plain, as before
//   nothing due, but work of yours older than that   "Nothing due · 11 to decide"       warning — never green
//   nothing due or to decide; equipment, compliance,  "Nothing due"                      plain
//     bookings or restock waiting (or not readable)
//   nothing waiting at all                           "Clear"                            green
// A day with work done says so in place of "Nothing due": "4 done · 11 to decide", "4 done".
export type HeadTone = "plain" | "warn" | "ok";
export function dayHead(h: { done: number; due: number; decide: number; waiting: number; unread?: boolean }): { words: string; tone: HeadTone } {
  if (h.due > 0) return { words: dayCount(h.done, h.due), tone: "plain" };
  const lead = h.done > 0 ? `${h.done} done` : "Nothing due";
  if (h.decide > 0) return { words: `${lead} · ${h.decide} to decide`, tone: "warn" };
  if (h.waiting > 0 || h.unread) return { words: lead, tone: "plain" };
  return { words: dayCount(h.done, 0), tone: "ok" };
}

/** The first dated thing after today — what a finished day points to. Equipment and compliance have rows of their own. */
export function nextUp<T extends HomeItem>(items: readonly T[]): T | null {
  const ahead = items.filter((i) => (i.kind === "mine" || i.kind === "owed") && i.daysOut !== null && i.daysOut > 0);
  ahead.sort((a, b) => (a.daysOut as number) - (b.daysOut as number) || Number(b.critical) - Number(a.critical) || Number(b.kind === "mine") - Number(a.kind === "mine"));
  return ahead[0] ?? null;
}

// ── COMING UP (2026-10-12, the My Day audit, approved) ───────────────────────────────────────────
// My Day answered "what needs me" and "what next", and "what's coming?" nowhere: a task due in two days
// was invisible until its day, and an event someone was crewing on Saturday showed nowhere on their home
// until Saturday's op card. Coming up is one line per commitment in the next COMING_DAYS days that
// involves the viewer — an event or stop they are on the crew of (event_staff), an event or stop they
// have work for (their tasks for it are counted on its line, not listed), or a dated task of theirs
// that belongs to neither — each opening its record. At most COMING_MAX lines; read only: Plan is still
// the record, and nothing here writes. Today's own are the op card's and To do's, so the window starts
// tomorrow.
//
// The approved brief said stops have no crew list, so a stop would show only through a task. They do —
// event_staff.stop_id, 0094, staffed from Prep like an event — so a stop someone is crewing shows the same
// way an event does. Where nobody crews stops, nothing changes.
export const COMING_DAYS = 7;
export const COMING_MAX = 3;
type OpKind = "event" | "stop";
export type ComingTask = { id: string; source: "event" | "todo"; title: string; day: string | null; op: { kind: OpKind; id: string | null; name: string; day: string | null } | null };
export type ComingStaff = { kind: OpKind; id: string; name: string; day: string | null; role: string | null };
export type ComingLine =
  | { kind: "op"; op: OpKind; id: string; title: string; day: string; staffed: boolean; role: string | null; tasks: number }
  | { kind: "task"; id: string; source: "event" | "todo"; title: string; day: string; opName: string | null };

/** The commitments of the next COMING_DAYS days that involve the viewer: the first COMING_MAX in day order, and how many in all. */
export function comingUp(today: string, tasks: readonly ComingTask[], staffed: readonly ComingStaff[]): { lines: ComingLine[]; total: number } {
  const last = addDays(today, COMING_DAYS);
  const inWindow = (d: string | null): d is string => !!d && d > today && d <= last;
  const ops = new Map<string, Extract<ComingLine, { kind: "op" }>>();
  for (const s of staffed) {
    if (inWindow(s.day)) ops.set(`${s.kind}:${s.id}`, { kind: "op", op: s.kind, id: s.id, title: s.name, day: s.day, staffed: true, role: s.role, tasks: 0 });
  }
  const own: ComingLine[] = [];
  for (const t of tasks) {
    const op = t.op;
    if (op && op.id && inWindow(op.day)) {
      const key = `${op.kind}:${op.id}`;
      const line = ops.get(key) ?? { kind: "op" as const, op: op.kind, id: op.id, title: op.name, day: op.day, staffed: false, role: null, tasks: 0 };
      line.tasks++;
      ops.set(key, line);
    } else if (inWindow(t.day)) own.push({ kind: "task", id: t.id, source: t.source, title: t.title, day: t.day, opName: op?.name ?? null });
  }
  const all = [...ops.values(), ...own].sort((a, b) => a.day.localeCompare(b.day) || Number(b.kind === "op") - Number(a.kind === "op") || a.title.localeCompare(b.title));
  return { lines: all.slice(0, COMING_MAX), total: all.length };
}

const WHEN_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
/** "Tomorrow" · "Sat" inside the week · "Mon, Oct 19" a week out, when "Mon" would read as today. */
export function comingWhen(day: string, today: string): string {
  const n = daysBetween(today, day);
  if (n === 1) return "Tomorrow";
  if (n > 1 && n < 7) return weekdayOf(day, "short");
  return WHEN_FMT.format(dayFromKey(day));
}

/** A Coming up line in words: when, and what it is to you. */
export function comingWords(l: ComingLine, today: string): { when: string; sub: string } {
  const when = comingWhen(l.day, today);
  if (l.kind === "task") return { when, sub: [l.source === "todo" ? "To-do" : "Task", l.opName ? `for ${l.opName}` : null].filter(Boolean).join(" · ") };
  const crew = !l.staffed ? null : l.role === "manager" ? "you're managing it" : l.role ? `you're on the crew · ${l.role}` : "you're on the crew";
  const work = l.tasks ? `${l.tasks} ${l.tasks === 1 ? "task" : "tasks"} of yours` : null;
  return { when, sub: [l.op === "stop" ? "Truck stop" : "Event", crew, work].filter(Boolean).join(" · ") };
}

// ── THE NUMBERS ────────────────────────────────────────────────────────────────────────────────
// Each one carries its change against the week before and what moved it, or it says why it cannot.
// A number with no comparison is trivia; a comparison with no cause leaves the reader to guess.

export const CHANNEL_WORDS = {
  square_walkup: "Walk-ups",
  cup: "Cup orders",
  packs: "Drop packs",
  delivery: "Delivery",
  office: "Office",
  // THE SHOP IS A CHANNEL (2026-10-12, 0384). Its Square payments matched no app order, so report_sales filed them as
  // walk-ups and a good week of merch read here as "Walk-ups +$…". A report from before 0384 has no shop key: zero.
  shop: "Shop",
} as const;
export type Channel = keyof typeof CHANNEL_WORDS;
export type Channels = Partial<Record<Channel, number>>;

/** Whole-percent change from the week before; null when the week before had nothing to compare with. */
export function pctChange(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev <= 0) return null;
  return Math.round(((now - prev) / prev) * 100);
}

/** "Up 18% on the week before" · "Down 4% on the week before" · "Level with the week before" · "Nothing to compare yet". */
export function changeWords(pct: number | null): string {
  if (pct === null) return "Nothing to compare yet";
  if (pct === 0) return "Level with the week before";
  return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% on the week before`;
}

/**
 * The channel that moved the most between the two weeks. report_sales has no offset, so the week
 * before is the 14-day report less the 7-day one: the same reconciled revenue, one week back.
 */
export function channelDriver(ch7: Channels, ch14: Channels): { channel: Channel; label: string; deltaCents: number } | null {
  let best: { channel: Channel; label: string; deltaCents: number } | null = null;
  for (const channel of Object.keys(CHANNEL_WORDS) as Channel[]) {
    const now = Number(ch7[channel] ?? 0);
    const prev = Number(ch14[channel] ?? 0) - now;
    const deltaCents = now - prev;
    if (!best || Math.abs(deltaCents) > Math.abs(best.deltaCents)) best = { channel, label: CHANNEL_WORDS[channel], deltaCents };
  }
  return best && best.deltaCents !== 0 ? best : null;
}

/**
 * Margin after ingredients — the catalog's blended cost of goods, the same estimate Reports prints —
 * and after the fixed costs of the events held that week (booth, transport, permit, consumables:
 * report_events). An estimate, and the screen says so.
 */
export function estMargin(revenueCents: number, cogsPct: number, fixedCents: number): number {
  return Math.round(revenueCents * (1 - cogsPct)) - fixedCents;
}

// WHAT AN ESTIMATE RESTS ON (2026-10-12, 0384). A margin is revenue less the menu's blended cost of goods
// (catalog_cogs_pct), and the blend is 30% by assumption until some product has a recipe — so a guessed 30% read exactly
// like a measured one. report_sales says which now (cogs_basis); these are its words, one home for Sales and the home.
export type CostBasis = { products: number; costed: number; assumed: boolean };

const costedOf = (b: CostBasis): string => {
  const of = Math.max(0, Number(b.products) || 0);
  const n = Math.min(of, Math.max(0, Number(b.costed) || 0));
  return `${n} of ${of} product${of === 1 ? "" : "s"} costed`;
};

/** "assumed 30%" · "estimate · 3 of 9 products costed" — or "" for a report from before 0384, which cannot say. */
export function costBasisWords(basis: CostBasis | null | undefined, cogsPct: number): string {
  if (!basis || typeof basis !== "object") return "";
  return basis.assumed ? `assumed ${Math.round(cogsPct * 100)}%` : `estimate · ${costedOf(basis)}`;
}

/** The home's margin cause when no event cost leads it: "ingredients at 27% of sales · 3 of 9 products costed",
 *  "ingredients at 30% of sales, assumed" — or, from a report before 0384, the percentage alone. */
export function ingredientWords(cogsPct: number, basis?: CostBasis | null): string {
  const at = `ingredients at ${Math.round(cogsPct * 100)}% of sales`;
  if (!basis || typeof basis !== "object") return at;
  return basis.assumed ? `${at}, assumed` : `${at} · ${costedOf(basis)}`;
}

// AN AVERAGE IS ONE CHANNEL'S (2026-10-12, 0384). Sales printed "N orders · $X avg" with N the cup orders and $X all
// revenue over N — every walk-up, pack, delivery, office and shop dollar divided by the cups — so the average grew
// whenever anything but cups sold. An average is a channel's revenue over that channel's own orders (report_sales'
// orders_by_channel), and a channel whose count the report does not give has no average rather than a borrowed one.
export type ChannelRow = { channel: Channel; label: string; cents: number; orders: number | null; avgCents: number | null };

/** The channels that took money or orders, biggest first, each with its own orders and its own average. */
export function channelRows(byChannel: Channels, orders: Channels): ChannelRow[] {
  return (Object.keys(CHANNEL_WORDS) as Channel[])
    .map((channel) => {
      const cents = Number(byChannel[channel] ?? 0) || 0;
      const raw = orders[channel];
      const n = raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
      return { channel, label: CHANNEL_WORDS[channel], cents, orders: n, avgCents: n !== null && n > 0 ? Math.round(cents / n) : null };
    })
    .filter((r) => r.cents !== 0 || (r.orders ?? 0) > 0)
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
}

/**
 * The last drop's orders that were in by the same distance from its day as now is from this one —
 * a drop fills all week, so its final count is no yardstick on a Monday.
 */
export function samePoint(prev: readonly { created_at: string }[], prevDropISO: string, dropISO: string, now: Date): number {
  const lead = new Date(`${dropISO}T12:00:00`).getTime() - now.getTime();
  const cut = new Date(`${prevDropISO}T12:00:00`).getTime() - lead;
  return prev.filter((o) => new Date(o.created_at).getTime() <= cut).length;
}

/** "3 more than the last drop had by now" · "2 fewer than the last drop had by now" · "Level with the last drop by now". */
export function paceWords(now: number, then: number): string {
  const d = now - then;
  if (d === 0) return "Level with the last drop by now";
  return `${Math.abs(d)} ${d > 0 ? "more" : "fewer"} than the last drop had by now`;
}

/** The biggest entry of a count, or null when every count is zero. */
export function topOf<K extends string>(counts: Partial<Record<K, number>>): [K, number] | null {
  let best: [K, number] | null = null;
  for (const [k, n] of Object.entries(counts) as [K, number][]) if (n > 0 && (!best || n > best[1])) best = [k, n];
  return best;
}

// ── THE BELL ───────────────────────────────────────────────────────────────────────────────────
// It counted every unanswered alert of the last thirty, so it read the same at 7 AM as at 11 PM and
// never reached zero. It counts what was true today: an alert first raised today, or a standing
// condition seen again today (0327's last_seen_at). The inbox behind it still lists them all.
export function flagIsToday(f: { created_at: string; last_seen_at: string | null }, todayKey: string): boolean {
  return dayKey(new Date(f.last_seen_at ?? f.created_at)) === todayKey;
}

// ── THE DAY'S RHYTHM: ONE DAY, AND ON THE REFRESH (2026-10-12, the My Day audit) ──────────────────
// The chips under today's op — its stops, the drop, the porches, the brews — were read once, when My Day
// opened. A stop added, a drop order taken or a brew started from another phone showed nothing until the
// screen was opened again: pull to refresh, coming back after 30 s and the day turning all skipped it,
// because only a loader handed to useRealtimeTable is the app's refresh (lib/realtime). And the four
// reads asked two different days: stops and brews the phone's (localToday), drops and porches the
// market's (etToday). A phone left on Pacific time read Monday's stops beside Tuesday's drop for three
// hours every evening. One day now, the market's — the day drop_date and delivery_date are written in —
// and the four tables wake the loader.
/** The tables My Day's rhythm reads: registered with the app's refresh, as DayHeadline is for events. */
export const RHYTHM_TABLES: string[] = ["stops", "drop_orders", "delivery_orders", "brew_batches"];

/** The market's day the rhythm reads (America/New_York), and the instants a stop that starts that day falls between. */
export function rhythmDay(now: Date = new Date()): { day: string; from: string; to: string } {
  const day = etDayKey(now);
  return { day, from: etDayStart(day).toISOString(), to: etDayStart(addDays(day, 1)).toISOString() };
}
