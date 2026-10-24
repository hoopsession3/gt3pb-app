// EVERY ORDER, BY THE DAY IT WAS BOUGHT (R51 — Ryan, 2026-10-24: "pull orders and attach orders based on the date of
// purchase", and "best practice for all you mentioned if something is missing").
//
// The console had five order lists and no one list of orders: Order history was the truck's cups alone, done or void,
// in the order they were FINISHED; the shop's orders lived in their own panel; drop pickups, deliveries and office
// orders each on their own board; and a customer's record read all_orders, which has no shop orders at all. Here every
// channel — cup, pickup, delivery, office, shop — is one kind of line, dated by the day it was bought (created_at, the
// purchase), in the business's day (America/New_York), newest first, grouped under that day with the day's count and
// total. A read that is refused is said, never shown as an empty day.
import type { SupabaseClient } from "@supabase/supabase-js";
import { etDayKey } from "./dates";
import { statusLabel } from "./shopOrder";
import { STATUS_WORD } from "./orderStatus";
import { ledgerWord } from "./collect";
import { isSettled, type Collectable } from "./settled";

export type Channel = "cup" | "pickup" | "delivery" | "office" | "shop";
export const CHANNELS: readonly Channel[] = ["cup", "pickup", "delivery", "office", "shop"];
export const CHANNEL_WORD: Record<Channel, string> = { cup: "Cup", pickup: "Pickup", delivery: "Delivery", office: "Office", shop: "Shop" };

export type LedgerLine = {
  channel: Channel;
  id: string;
  /** The purchase: when the order was placed (created_at). */
  at: string;
  /** The business day it was bought on, America/New_York, "YYYY-MM-DD". */
  day: string;
  who: string;
  customerId: string | null;
  totalCents: number;
  /** How it was paid, the accountant's words (lib/collect ledgerWord for the window's channels). */
  paid: string;
  /** Money taken for it (counted in a customer's lifetime). */
  isPaid: boolean;
  /** Where the order is, in words. */
  state: string;
  canceled: boolean;
};

const FULFILL: Record<string, string> = { placed: "Placed", in_prep: "In progress", fulfilled: "Fulfilled", canceled: "Canceled", ready: "Ready" };
const PAY: Record<string, string> = { paid: "Paid", pending: "Due", failed: "Failed", refunded: "Refunded", partially_refunded: "Part refunded", unpaid: "Due" };
const payWord = (s: string | null | undefined) => (s ? PAY[s] ?? s : "Due");
// The accountant's words (lib/collect), begun with a capital like every other channel's ("Paid online", "Cash at the window").
const ledger = (r: Row) => { const w = ledgerWord(r as Collectable); return w.charAt(0).toUpperCase() + w.slice(1); };

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** One table's row as a line. Pure, so the rules are tested without a database. */
export function toLine(channel: Channel, r: Row): LedgerLine {
  const at = str(r.created_at) ?? new Date(0).toISOString();
  const canceledAt = str(r.canceled_at);
  const base = { channel, id: String(r.id), at, day: etDayKey(new Date(at)), customerId: str(r.customer_id), totalCents: num(r.total_cents) };
  switch (channel) {
    case "cup": {
      const status = str(r.status) ?? "";
      return { ...base, who: str(r.customer) ?? "Guest", paid: ledger(r), isPaid: isSettled(r as Collectable), state: STATUS_WORD[status] ?? (status || "—"), canceled: status === "void" };
    }
    case "pickup":
      return { ...base, who: str(r.name) ?? "Guest", paid: ledger(r), isPaid: isSettled(r as Collectable),
        state: canceledAt ? "Canceled" : r.picked_up ? "Picked up" : FULFILL[str(r.fulfillment_status) ?? ""] ?? "Placed", canceled: !!canceledAt };
    case "delivery":
      return { ...base, who: str(r.name) ?? "Guest", paid: payWord(str(r.payment_status)), isPaid: str(r.payment_status) === "paid",
        state: canceledAt ? "Canceled" : FULFILL[str(r.fulfillment_status) ?? ""] ?? (str(r.status) ?? "Placed"), canceled: !!canceledAt };
    case "office":
      return { ...base, who: str(r.company) ?? "Office", paid: payWord(str(r.payment_status)), isPaid: str(r.payment_status) === "paid",
        state: canceledAt ? "Canceled" : str(r.status) === "delivered" ? "Delivered" : "Booked", canceled: !!canceledAt };
    case "shop": {
      const s = str(r.status);
      return { ...base, who: str(r.ship_name) ?? str(r.email) ?? "Shop customer", paid: s === "refunded" ? "Refunded" : "Paid", isPaid: s !== "refunded" && s !== "canceled", state: statusLabel(s), canceled: s === "canceled" || s === "refunded" };
    }
  }
}

/** The days, newest first, each with its lines (newest first), its count and its total of what wasn't canceled. */
export type Day = { day: string; lines: LedgerLine[]; count: number; totalCents: number };
export function byDay(lines: readonly LedgerLine[]): Day[] {
  const m = new Map<string, LedgerLine[]>();
  for (const l of [...lines].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))) m.set(l.day, [...(m.get(l.day) ?? []), l]);
  return [...m].map(([day, ls]) => ({ day, lines: ls, count: ls.length, totalCents: ls.filter((l) => !l.canceled).reduce((s, l) => s + l.totalCents, 0) }));
}

/** The line's money and where it is, said once ("Paid · Shipped"; a shop order just paid is "Paid", not "Paid · Paid"). */
export const lineWords = (l: LedgerLine): string => (l.state === l.paid ? l.paid : `${l.paid} · ${l.state}`);

/** Every typed word in the line: who, channel, state, paid, the order's number, the amount. */
export function lineMatches(l: LedgerLine, q: string, moneyText: (c: number) => string): boolean {
  const terms = q.toLowerCase().replace(/#/g, "").split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${l.who} ${CHANNEL_WORD[l.channel]} ${l.state} ${l.paid} ${l.id.slice(0, 4)} ${moneyText(l.totalCents)}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

const SELECT: Record<Channel, { table: string; cols: string }> = {
  cup: { table: "orders", cols: "id, customer, customer_id, total_cents, status, paid, payment_id, payment_status, collected_via, collected_at, created_at" },
  pickup: { table: "drop_orders", cols: "id, name, customer_id, total_cents, paid, payment_id, payment_status, collected_via, collected_at, fulfillment_status, picked_up, canceled_at, created_at" },
  delivery: { table: "delivery_orders", cols: "id, name, customer_id, total_cents, payment_status, fulfillment_status, status, canceled_at, created_at" },
  office: { table: "business_orders", cols: "id, company, customer_id, total_cents, payment_status, status, canceled_at, created_at" },
  shop: { table: "shop_orders", cols: "id, ship_name, email, customer_id, total_cents, status, created_at" },
};

/**
 * Read the ledger: every channel bought from `fromIso` up to `toIso` (or one customer's, all time). Each channel is read
 * on its own; one that fails is named in `failed` and the rest still show — never a blank day for a refused read.
 */
export async function readLedger(sb: SupabaseClient, opts: { fromIso?: string; toIso?: string; customerId?: string; limit?: number }): Promise<{ lines: LedgerLine[]; failed: Channel[] }> {
  const limit = opts.limit ?? 500;
  const res = await Promise.all(CHANNELS.map(async (ch) => {
    let q = sb.from(SELECT[ch].table).select(SELECT[ch].cols).order("created_at", { ascending: false }).limit(limit);
    if (opts.fromIso) q = q.gte("created_at", opts.fromIso);
    if (opts.toIso) q = q.lt("created_at", opts.toIso);
    if (opts.customerId) q = q.eq("customer_id", opts.customerId);
    const { data, error } = await q;
    return { ch, rows: error ? null : ((data ?? []) as unknown as Row[]) };
  }));
  return {
    lines: res.flatMap((r) => (r.rows ?? []).map((row) => toLine(r.ch, row))).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    failed: res.filter((r) => r.rows === null).map((r) => r.ch),
  };
}

/** A day's heading: "Today · Fri, Oct 24", "Yesterday · Thu, Oct 23", "Mon, Oct 20" — and the year when it isn't this one. */
export function dayHead(key: string, todayKey: string): string {
  const d = new Date(`${key}T12:00:00`);
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  const y = new Date(`${todayKey}T12:00:00`); y.setDate(y.getDate() - 1);
  const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  return key === todayKey ? `Today · ${date}` : key === yKey ? `Yesterday · ${date}` : date;
}

/** The window a range names, as ET day keys (from, through) — "today", the last 7/30/90 days, or two days typed. */
export type Range = "today" | "7" | "30" | "90" | "custom";
export function rangeDays(r: Range, todayKey: string, custom?: { from: string; to: string }): { from: string; through: string } {
  const back = (n: number) => { const d = new Date(`${todayKey}T12:00:00`); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  if (r === "custom" && custom?.from && custom?.to) return custom.from <= custom.to ? { from: custom.from, through: custom.to } : { from: custom.to, through: custom.from };
  if (r === "today") return { from: todayKey, through: todayKey };
  const n = r === "custom" ? 30 : Number(r);
  return { from: back(n - 1), through: todayKey };
}
