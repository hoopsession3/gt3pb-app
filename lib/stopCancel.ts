// A CANCELED STOP, SAID (2026-10-12 — H5 of the customer frontend audit, release C1, approved; texting customers is
// decision 7). The words app/api/crew/stops/cancel sends when the crew calls a stop off (0391 cancel_stop), and the
// line Find Us shows in its place. Pure: the route reads, this says.

import { money } from "./money";

export type CanceledStop = { name: string | null; starts_at: string | null; cancel_reason: string | null };

/** "Sat 10/17" in the stop's own clock (stops are Eastern). */
export function stopDay(startsAt: string | null): string {
  if (!startsAt) return "its day";
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "its day";
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const md = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" });
  return `${wd} ${md}`;
}

const why = (s: CanceledStop) => (s.cancel_reason?.trim() ? ` — ${s.cancel_reason.trim()}` : "");
const where = (s: CanceledStop) => s.name?.trim() || "the truck's stop";

/** To someone with a cup ordered for the stop. Their order is canceled with the stop; a paid one is refunded by the crew. */
export function cupWords(s: CanceledStop, o: { cups: number; paid: boolean }): string {
  const order = `Your order of ${o.cups} ${o.cups === 1 ? "cup" : "cups"} is canceled`;
  return `GT3: we've had to cancel ${where(s)} on ${stopDay(s.starts_at)}${why(s)}. ${order}${o.paid ? " — the crew is refunding your card in full, nothing for you to do." : ", and nothing was charged."}`;
}

/** To someone with a pack for the stop's day (no other stop left that day). They choose: move it, or cancel it. */
export function packWords(s: CanceledStop, p: { size: number; paid: boolean }): string {
  return `GT3: we've had to cancel the truck's stop on ${stopDay(s.starts_at)}${why(s)}. Your ${p.size}-pack for that day can move to another pickup day in the app (Your packs), or be canceled there${p.paid ? " for a refund" : ""}.`;
}

/** Find Us, in the stop's place: "Canceled · WineXpress · Sat 10/17 — Rained out". */
export function canceledLine(s: CanceledStop): string {
  return `${where(s)} · ${stopDay(s.starts_at)}${why(s)}`;
}

/** The crew's one line: who was told, and the paid pre-orders to refund in Square — each by the number the window
 *  calls ("#4F2A", R3b) and the Square reference to find it by. */
/** The crew's toast once a visit is called off (R3b): the cup orders canceled, the members told and the guests who read
 *  it on their order's page — "N told" counted the guests too, who have no address with us — the packs, the refunds. */
export function stopCanceledToast(d: { cups?: number; told?: number; paid?: number; packs?: number }): string {
  const cups = d.cups ?? 0, told = Math.min(d.told ?? 0, cups), guests = cups - told, packs = d.packs ?? 0;
  const parts: string[] = [];
  if (cups) parts.push(`${cups} cup ${cups === 1 ? "order" : "orders"} canceled — ${told} told${guests ? `, ${guests} ${guests === 1 ? "guest sees" : "guests see"} it on their order's page` : ""}`);
  if (packs) parts.push(`${packs} ${packs === 1 ? "pack" : "packs"} told`);
  return `Visit canceled${parts.length ? `. ${parts.join("; ")}` : ""}${d.paid ? `. Refund ${d.paid} in Square (it's in your alerts).` : "."}`;
}

export function crewWords(s: CanceledStop, told: { cups: number; told?: number; paidCups: { no?: string; ref: string; cents: number }[]; packs: number }): { title: string; body: string } {
  const refunds = told.paidCups.length
    ? ` Refund ${told.paidCups.length} paid ${told.paidCups.length === 1 ? "order" : "orders"} in Square, in full (the tip too): ${told.paidCups.map((p) => `${p.no ? `${p.no} (Square …${p.ref})` : p.ref} — ${money(p.cents)} of drinks`).join(", ")}.`
    : "";
  const members = typeof told.told === "number" ? Math.min(told.told, told.cups) : told.cups, guests = told.cups - members;
  const cups = told.cups
    ? `${told.cups} cup ${told.cups === 1 ? "order" : "orders"} canceled — ${members} told${guests ? `, ${guests} ${guests === 1 ? "guest sees" : "guests see"} it on their order's page` : ""}`
    : "no cup orders";
  const packs = told.packs ? `${told.packs} ${told.packs === 1 ? "pack" : "packs"} for the day told to move or cancel` : "no packs to tell";
  return { title: `Canceled ${where(s)} · ${stopDay(s.starts_at)}`, body: `${cups}; ${packs}.${refunds}` };
}
