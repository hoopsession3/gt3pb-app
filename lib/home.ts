// ONE HOME (2026-10-09, round 2 of the UX plan, approved by Ryan: "Yes, in this order"; the three
// numbers "Sales, margin, next-drop orders"). My Day opened on 31 tasks — 25 of them late, the oldest
// by 99 days — and the bell counted every unanswered alert, so neither ever reached zero and neither
// meant anything. Command, beside it, put twelve numbers at equal weight. The home now answers two
// questions in one look: how are we doing (three numbers, each with its change and its cause) and
// what's next (at most three things due today). Everything else is one tap down, and nothing is
// deleted to get there.
//
// The rules live here, apart from the screens, so the smoke suite can hold them to their word.
import { dayKey } from "./dates";

/** A task more than this many days late is stale: it folds into one row instead of leading the day. */
export const STALE_DAYS = 14;
/** The home shows at most this many things due today. */
export const TODAY_MAX = 3;

export type HomeItem = {
  key: string;
  title: string;
  sub: string;
  /** the due day minus today, in whole days: negative is late, 0 is today, null has no date */
  daysOut: number | null;
  critical: boolean;
  /** mine: your own task · owed: a deadline you can act on · team: somebody else's late task · upkeep: equipment ·
   *  rule: a compliance rule to confirm with its authority */
  kind: "mine" | "owed" | "team" | "upkeep" | "rule";
};

export type HomeSplit<T extends HomeItem = HomeItem> = {
  today: T[];        // at most TODAY_MAX, in rank order
  due: T[];          // every item due today or late by STALE_DAYS or less, in rank order
  moreToday: number;        // due today or late, past the first TODAY_MAX
  stale: T[];               // late by more than STALE_DAYS
  upkeep: T[];              // equipment upkeep due or late, whatever its age: one row on the home
  rules: T[];               // compliance rules to confirm with the authority: one row on the home, never "due today"
  later: number;            // dated after today, or not dated at all
  total: number;
};

/** Where one item goes on the home. Equipment is decided by splitHome, not here. */
export function homeBucket(daysOut: number | null): "today" | "stale" | "later" {
  if (daysOut === null || daysOut > 0) return "later";
  return daysOut < -STALE_DAYS ? "stale" : "today";
}

/** Today's order: critical first, then your own before the team's and the deadlines, then the latest. */
export function rankToday(a: HomeItem, b: HomeItem): number {
  return Number(b.critical) - Number(a.critical)
    || Number(b.kind === "mine") - Number(a.kind === "mine")
    || (a.daysOut ?? 0) - (b.daysOut ?? 0);
}

// COMPLIANCE IS NOT TODAY'S WORK (2026-10-10, Ryan: "the my day still doesn't make sense"). Every one of the
// six things under "To do · 6 due" on his My Day was a compliance rule nobody had confirmed with its authority
// — ServSafe, the mobile-setup authorization, the temporary permit — because v_obligations dates a rule with no
// confirmation "today" (0330: coalesce(verified_on + 365, current_date)). So they were due today every day,
// and the day's real work could never reach the top three. They are one row now, like equipment: counted,
// one tap from the list, each opening the rule where it is confirmed.
export function splitHome<T extends HomeItem>(items: readonly T[]): HomeSplit<T> {
  const upkeep = items.filter((i) => i.kind === "upkeep").sort(rankToday);
  const rules = items.filter((i) => i.kind === "rule");
  const rest = items.filter((i) => i.kind !== "upkeep" && i.kind !== "rule");
  const due = rest.filter((i) => homeBucket(i.daysOut) === "today").sort(rankToday);
  const stale = rest.filter((i) => homeBucket(i.daysOut) === "stale").sort(rankToday);
  return {
    today: due.slice(0, TODAY_MAX),
    due,
    moreToday: Math.max(0, due.length - TODAY_MAX),
    stale,
    upkeep,
    rules,
    later: rest.filter((i) => homeBucket(i.daysOut) === "later").length,
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
/** The first dated thing after today — what a finished day points to. Equipment and compliance have rows of their own. */
export function nextUp<T extends HomeItem>(items: readonly T[]): T | null {
  const ahead = items.filter((i) => (i.kind === "mine" || i.kind === "owed" || i.kind === "team") && i.daysOut !== null && i.daysOut > 0);
  ahead.sort((a, b) => (a.daysOut as number) - (b.daysOut as number) || Number(b.critical) - Number(a.critical) || Number(b.kind === "mine") - Number(a.kind === "mine"));
  return ahead[0] ?? null;
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
