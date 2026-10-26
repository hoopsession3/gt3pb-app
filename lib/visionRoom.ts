// WHAT THE ROOM CAN DO, IN MONEY (R55, phase C — Ryan, 2026-10-25: "when I move a counter, change the number of taps,
// add seating, reposition a pickup shelf… recalculate estimated throughput… identify service bottlenecks… estimate
// staffing… calculate potential sales capacity… show the estimated financial impact of the design change. Support
// peak-hour, normal-hour and low-demand scenarios. Distinguish simulated outcomes from observed real-world performance").
//
// Pure. The room's capacity is read off what's in it: each order counter or walk-up window is a register taking an order
// in `serveSec` seconds (timed on the truck, or the 45-second assumption the screen labels as one); the seats turn over
// in the average stay. The demand comes from the plan's money: orders a day ÷ hours open is the average hour; the peak
// and the slow hour are that times factors Ryan sets — or that GT3's own sales show (its busiest hour against its
// average selling hour), offered as evidence. Where an hour's demand is more than the counter can take, the gap is said
// in orders and in sales the room can't take at the plan's average order — capacity, not a guess at who walks out.
import { kindOf, type Layout } from "./vision";
import { DEFAULTS } from "./visionFlow";
import { dollars } from "./finance";

export const ASSUMED_SERVE_SEC = DEFAULTS.serveSec;

export type Capacity = { registers: number; perRegisterPerHour: number; counterPerHour: number; seats: number; seatTurnsPerHour: number | null; taps: number; pickup: number };
/** What the room's layout can serve, at `serveSec` seconds an order and an average stay of `stayMin` minutes. */
export function capacity(layout: Pick<Layout, "items">, serveSec = ASSUMED_SERVE_SEC, stayMin: number | null = null): Capacity {
  const registers = layout.items.filter((i) => i.kind === "order_counter" || i.kind === "walk_up").length;
  const seats = layout.items.reduce((n, i) => n + (kindOf(i.kind).seats ?? 0), 0);
  const per = 3600 / Math.max(5, serveSec);
  return {
    registers, perRegisterPerHour: Math.round(per), counterPerHour: Math.round(per * registers), seats,
    seatTurnsPerHour: stayMin && stayMin > 0 ? Math.round((seats * 60) / stayMin) : null,
    taps: layout.items.filter((i) => i.kind === "tap_tower").length,
    pickup: layout.items.filter((i) => i.kind === "pickup_shelf").length,
  };
}

export type HourKind = "slow" | "normal" | "peak";
export const HOUR_WORD: Record<HourKind, string> = { slow: "A slow hour", normal: "An average hour", peak: "The peak hour" };
export type Hours = Partial<Record<HourKind, number>>;
/** The plan's hours: the average from its own orders a day and hours open; the peak and the slow hour by Ryan's factors. */
export function hours(ordersPerDay: number | null, hoursOpen: number | null, peakFactor: number | null, slowFactor: number | null): Hours {
  if (!ordersPerDay || !hoursOpen) return {};
  const avg = ordersPerDay / hoursOpen;
  return { normal: avg, ...(peakFactor ? { peak: avg * peakFactor } : {}), ...(slowFactor ? { slow: avg * slowFactor } : {}) };
}

export type HourCheck = { kind: HourKind; demand: number; capacity: number; fits: boolean; overBy: number; salesShortCents: number | null; registersNeeded: number; staffNeeded: number };
/** Each hour against the counter: does it fit, by how much it doesn't, the sales the room can't take in that hour at the
 *  average order, and the people it takes — one at each register in use, one at the bar or the pickup when there is one. */
export function checkHours(h: Hours, cap: Capacity, aovCents: number | null): HourCheck[] {
  return (["slow", "normal", "peak"] as HourKind[]).filter((k) => h[k] != null).map((k) => {
    const demand = h[k]!, over = Math.max(0, demand - cap.counterPerHour);
    const registersNeeded = Math.min(cap.registers, Math.max(1, Math.ceil(demand / Math.max(1, cap.perRegisterPerHour))));
    return { kind: k, demand, capacity: cap.counterPerHour, fits: over === 0, overBy: over, salesShortCents: aovCents != null ? over * aovCents : null,
      registersNeeded, staffNeeded: registersNeeded + (cap.taps + cap.pickup > 0 ? 1 : 0) };
  });
}

/** A change to the room, in capacity: before and after — what moving, adding or taking out a thing does. */
export type RoomDiff = { counterPerHour: [number, number]; registers: [number, number]; seats: [number, number]; says: string[] };
export function roomDiff(before: Pick<Layout, "items">, after: Pick<Layout, "items">, serveSec = ASSUMED_SERVE_SEC, h: Hours = {}, aovCents: number | null = null): RoomDiff {
  const a = capacity(before, serveSec), b = capacity(after, serveSec);
  const says: string[] = [];
  if (b.registers !== a.registers) says.push(`${b.registers > a.registers ? "Another" : "One fewer"} register: the counter serves about ${b.counterPerHour} an hour (it was ${a.counterPerHour}).`);
  if (b.seats !== a.seats) says.push(`${b.seats > a.seats ? "More" : "Fewer"} seats: ${b.seats} (it was ${a.seats}).`);
  if (h.peak != null) {
    const short = (c: Capacity) => Math.max(0, h.peak! - c.counterPerHour);
    const was = short(a), now = short(b);
    if (was !== now) says.push(now === 0 ? `The peak hour fits now${aovCents != null && was > 0 ? ` — up to ${dollars(was * aovCents)} an hour the room couldn't take before` : ""}.`
      : `At the peak, ${Math.round(now)} orders an hour are past what the counter can take${aovCents != null ? ` (${dollars(now * aovCents)} of sales)` : ""} — it was ${Math.round(was)}.`);
  }
  return { counterPerHour: [a.counterPerHour, b.counterPerHour], registers: [a.registers, b.registers], seats: [a.seats, b.seats], says };
}

/** GT3's own hours — evidence for the peak: in its sales, the busiest single hour against the average hour it sold in.
 *  Lines carry the purchase time (ISO); the hour is the business's (America/New_York). */
export function observedHours(lines: readonly { at: string; channel: string; isPaid: boolean; canceled: boolean }[], channel?: string): { sellingHours: number; avgPerHour: number | null; peakHour: number | null; peakFactor: number | null } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const by = new Map<string, number>();
  for (const l of lines) {
    if (!l.isPaid || l.canceled || (channel && l.channel !== channel)) continue;
    const k = fmt.format(new Date(l.at));
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  if (!by.size) return { sellingHours: 0, avgPerHour: null, peakHour: null, peakFactor: null };
  const counts = [...by.values()], total = counts.reduce((n, x) => n + x, 0), avg = total / counts.length, peak = Math.max(...counts);
  return { sellingHours: counts.length, avgPerHour: Math.round(avg * 10) / 10, peakHour: peak, peakFactor: Math.round((peak / avg) * 10) / 10 };
}
