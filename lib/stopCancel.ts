// A CANCELED STOP, SAID (2026-10-12 — H5 of the customer frontend audit, release C1, approved; texting customers is
// decision 7). The words app/api/crew/stops/cancel sends when the crew calls a stop off (0391 cancel_stop), and the
// line Find Us shows in its place. Pure: the route reads, this says. The line, the day and the reason live in
// lib/stopLine (R3b), so Find Us loads them without the texts, the crew's toast and its refund list below.

import { canceledLine, stopDay, stopWhere as where, stopWhy as why, type CanceledStop } from "./stopLine";

export { canceledLine, stopDay, type CanceledStop };

/** How a cup was paid, as its customer is told what comes back (R9): a card — online or on the reader — is refunded;
 *  cash comes back at the window; covered (a free cup or credit, 0416) took nothing; null, nothing was paid. */
export type CupHow = "online" | "card_reader" | "cash" | "covered" | null;

/** To someone with a cup ordered for the stop. Their order is canceled with the stop, and they are told what becomes of
 *  what they paid — a card paid on the reader is a card too (R9: it was told "nothing was charged"). */
export function cupWords(s: CanceledStop, o: { cups: number; how: CupHow }): string {
  const order = `Your order of ${o.cups} ${o.cups === 1 ? "cup" : "cups"} is canceled`;
  const money = o.how === "online" || o.how === "card_reader" ? " — the crew is refunding your card in full, nothing for you to do."
    : o.how === "cash" ? " — the cash you paid comes back at the window."
    : ", and nothing was charged.";
  return `GT3: we've had to cancel ${where(s)} on ${stopDay(s.starts_at)}${why(s)}. ${order}${money}`;
}

/** To someone with a pack for the stop's day (no other stop left that day). They choose: move it, or cancel it. */
export function packWords(s: CanceledStop, p: { size: number; paid: boolean }): string {
  return `GT3: we've had to cancel the truck's stop on ${stopDay(s.starts_at)}${why(s)}. Your ${p.size}-pack for that day can move to another pickup day in the app (Your packs), or be canceled there${p.paid ? " for a refund" : ""}.`;
}

/** The crew's toast once a visit is called off (R3b): the cup orders canceled, the members told and the guests who read
 *  it on their order's page — "N told" counted the guests too, who have no address with us — the packs, the refunds. */
export function stopCanceledToast(d: { cups?: number; told?: number; paid?: number; packs?: number }): string {
  const cups = d.cups ?? 0, told = Math.min(d.told ?? 0, cups), guests = cups - told, packs = d.packs ?? 0;
  const parts: string[] = [];
  if (cups) parts.push(`${cups} cup ${cups === 1 ? "order" : "orders"} canceled — ${told} told${guests ? `, ${guests} ${guests === 1 ? "guest sees" : "guests see"} it on their order's page` : ""}`);
  if (packs) parts.push(`${packs} ${packs === 1 ? "pack" : "packs"} told`);
  return `Visit canceled${parts.length ? `. ${parts.join("; ")}` : ""}${d.paid ? `. Refund ${d.paid} in Square (it's in your alerts).` : "."}`;
}

/** The crew's one line (R9): the cup orders canceled and who was told, the packs told, how many cards to refund — each
 *  has its own flag in the inbox (0416), so the line counts them and lists none (a list was cut at 300 characters) — and
 *  the cups the database would not void, to void on the Pass, the first few by number. */
export function crewWords(s: CanceledStop, told: { cups: number; told?: number; refunds: number; packs: number; stuck?: string[] }): { title: string; body: string } {
  const members = typeof told.told === "number" ? Math.min(told.told, told.cups) : told.cups, guests = told.cups - members;
  const cups = told.cups
    ? `${told.cups} cup ${told.cups === 1 ? "order" : "orders"} canceled — ${members} told${guests ? `, ${guests} ${guests === 1 ? "guest sees" : "guests see"} it on their order's page` : ""}`
    : "no cup orders";
  const packs = told.packs ? `${told.packs} ${told.packs === 1 ? "pack" : "packs"} for the day told to move or cancel` : "no packs to tell";
  const refunds = told.refunds ? ` ${told.refunds} paid by card — each has its own refund flag in the inbox.` : "";
  const stuck = told.stuck ?? [];
  const shown = stuck.slice(0, 4).join(", ") + (stuck.length > 4 ? ` and ${stuck.length - 4} more` : "");
  const stuckLine = stuck.length ? ` ${stuck.length === 1 ? "One order" : `${stuck.length} orders`} couldn't be canceled here — void ${stuck.length === 1 ? "it" : "them"} on the Pass: ${shown}.` : "";
  return { title: `Canceled ${where(s)} · ${stopDay(s.starts_at)}`, body: `${cups}; ${packs}.${refunds}${stuckLine}` };
}
