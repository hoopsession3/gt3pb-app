// WHAT A SIGNED-IN CUSTOMER HAS ALREADY TOLD US (2026-10-04, the form audit).
//
// Ryan: "auto fill where applicable, example, name for order, auto populate with users name if
// signed in". Every customer form started empty but one, and that one (the cup checkout) knew only
// profiles.display_name — usually the first name typed at sign-up, sometimes nothing. Meanwhile the
// customer's own rows already held the rest: the name and phone on their customer record, the
// address their last delivery went to, the address their last tee shipped to, the phone on their
// last pack, their office account. The weekly delivery — a repeat purchase — was retyped every week.
//
// This is the one place that decides which of those a form starts from, and in what order. It is
// pure: lib/customerKnownRead does the reading, and only for someone signed in. A guest is helped by
// the browser instead — every customer field says what it is (autoComplete), so the phone's own
// saved name, number and address fill it, and nothing about a guest is kept by this app.
//
// The rules:
//   · a name to CALL at the window: what they asked to be called (display_name), then the name on
//     their record, then the names on their orders, then their email's handle;
//   · a FULL name for a parcel or a door: the fullest one on file — the last shipping label first,
//     because a person types their whole name for a parcel — preferring any name with a surname;
//   · a phone: their record, then their last pack, their last delivery, their office account;
//   · an address: where their last tee shipped, else where their last delivery went;
//   · the office: their office account, with the access notes from their last office order.
// Nothing is guessed: a value either came from a row of theirs, or the field starts empty.

import { stateCode } from "./usAddress";
import { MARKET_REGION, isMarket, type Market } from "./markets";
import { zipMarket } from "./delivery";

type S = string | null | undefined;
export type KnownRows = {
  email?: S;
  displayName?: S;
  market?: S;
  customer?: { name?: S; phone?: S; email?: S } | null;
  lastCup?: { customer?: S } | null;
  lastShop?: { ship_name?: S; ship_address?: unknown } | null;
  lastDelivery?: { name?: S; phone?: S; address_street?: S; address_city?: S; address_zip?: S; access_instructions?: S } | null;
  lastPack?: { name?: S; phone?: S } | null;
  business?: { company?: S; contact_name?: S; contact_phone?: S; contact_email?: S; address_street?: S; address_city?: S; address_zip?: S; headcount?: number | null } | null;
  lastOffice?: { access_instructions?: S; address_street?: S } | null;
};

export type KnownAddress = { street: string; city: string; state: string; zip: string };
export type Known = {
  callName: string;
  fullName: string;
  phone: string;
  email: string;
  /** Where a parcel goes: the last one shipped, else the last delivery's door. */
  ship: KnownAddress | null;
  /** The last delivery's door, with its access notes. */
  delivery: { street: string; city: string; zip: string; access: string } | null;
  office: { company: string; contact: string; phone: string; street: string; city: string; zip: string; access: string; headcount: string } | null;
  market: Market | null;
  /** Where the address came from, for the line that says so. */
  shipFrom: "shop" | "delivery" | null;
};

const t = (v: S): string => String(v ?? "").trim();
const first = (...vs: S[]): string => { for (const v of vs) { const x = t(v); if (x) return x; } return ""; };
const looksLikeEmail = (v: string) => /@/.test(v);

/** "pat.example42@x.com" → "Pat Example". The last resort for a name — better than nothing at the window. */
export function nameFromEmail(email: S): string {
  const handle = t(email).split("@")[0] ?? "";
  return handle.split(/[._\-+]+/).map((w) => w.replace(/\d+/g, "")).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

const STATE_OF: Partial<Record<Market, string>> = Object.fromEntries(
  Object.entries(MARKET_REGION).map(([m, region]) => [m, stateCode(region.split(",").pop()) ?? ""]),
);

function addressFrom(raw: unknown): KnownAddress | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const street = t(a.street as S), city = t(a.city as S), zip = t(a.zip as S);
  if (!street || !city) return null;
  return { street, city, state: stateCode(a.state as S) ?? "", zip };
}

/** The fullest of several names for one person: the first with a surname, else the first at all.
 *  An email is not a name. Used for a parcel's label here and for the name on an offer letter. */
export function fullestName(...vs: S[]): string {
  const names = vs.map(t).filter((n) => n && !looksLikeEmail(n));
  return names.find((n) => /\S\s+\S/.test(n)) ?? names[0] ?? "";
}

export function knownFrom(r: KnownRows): Known {
  const display = t(r.displayName);
  const orderNames = [r.lastShop?.ship_name, r.customer?.name, r.lastDelivery?.name, r.lastPack?.name, r.lastCup?.customer];
  const callName = first(looksLikeEmail(display) ? "" : display, r.customer?.name, r.lastCup?.customer, r.lastPack?.name, r.lastDelivery?.name) || nameFromEmail(r.email);
  const fullName = fullestName(...orderNames, display) || nameFromEmail(r.email);
  const phone = first(r.customer?.phone, r.lastPack?.phone, r.lastDelivery?.phone, r.business?.contact_phone);
  const email = first(r.email, r.customer?.email, r.business?.contact_email);

  const d = r.lastDelivery;
  const delivery = d && t(d.address_street) && t(d.address_city)
    ? { street: t(d.address_street), city: t(d.address_city), zip: t(d.address_zip), access: t(d.access_instructions) }
    : null;
  const shipped = addressFrom(r.lastShop?.ship_address);
  const deliveryMarket = delivery ? zipMarket(delivery.zip) : null;
  const ship: KnownAddress | null = shipped
    ?? (delivery ? { street: delivery.street, city: delivery.city, zip: delivery.zip, state: deliveryMarket ? STATE_OF[deliveryMarket] ?? "" : "" } : null);

  const b = r.business;
  const office = b && t(b.company)
    ? {
        company: t(b.company), contact: first(b.contact_name, fullName), phone: first(b.contact_phone, phone),
        street: t(b.address_street), city: t(b.address_city), zip: t(b.address_zip),
        // The notes belong to the door they were written for.
        access: r.lastOffice && t(r.lastOffice.address_street).toLowerCase() === t(b.address_street).toLowerCase() ? t(r.lastOffice.access_instructions) : "",
        headcount: b.headcount != null && b.headcount > 0 ? String(b.headcount) : "",
      }
    : null;

  return {
    callName, fullName, phone, email, ship, delivery, office,
    market: isMarket(r.market) ? r.market : null,
    shipFrom: shipped ? "shop" : delivery ? "delivery" : null,
  };
}
