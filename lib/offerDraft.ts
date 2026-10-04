// HOW AN OWNER'S DRAFT OF AN OFFER FILLS ITSELF (2026-10-04, the form audit).
//
// lib/offerLetter is the letter: its terms, what a role reaches, what the statute asks, the money
// words — and the candidate's own page (/offer) loads it. This is only the WRITER's side: where a
// new offer's fields start from, and how they move when a choice changes. It lives apart so the
// person reading their offer never downloads the code that drafted it (a module rides whole into
// every chunk that imports any of it — /offer measured 1 KB heavier with these inside).

import { emptyOffer, OFFERABLE_ROLES, type OfferTerms, type EmploymentType, type RoleKey } from "./offerLetter";
import { isMarket, type Market } from "./markets";
import { toRole } from "./roles";
import { follow } from "./pickFill";

/** A past letter, as far as the house wording needs it. */
export type HouseRow = {
  status?: string | null; employment_type?: string | null; role?: string | null;
  normal_hours?: string | null; pay_schedule?: string | null; pay_method?: string | null; deductions?: string | null;
};
type HouseKey = "normalHours" | "paySchedule" | "payMethod" | "deductions";
const HOUSE_KEYS: readonly HouseKey[] = ["normalHours", "paySchedule", "payMethod", "deductions"];
// A letter the co-owners have passed carries wording somebody checked; a draft may be half-typed.
const VETTED = new Set(["approved", "sent", "countered", "accepted", "declined", "expired"]);

/**
 * THE HOUSE'S OWN WORDS FOR THE STATUTORY FOUR (2026-10-04, the form audit). When and how the
 * company pays and what it deducts are facts about the company, the same on every letter — they were
 * retyped on every one. A new offer starts from the latest letter that has them: one the co-owners
 * passed before any draft, the same employment type before the other. Normal hours belong to a role,
 * so they carry over only from a letter for the same role and type. Nothing is invented — no letter,
 * no prefill — and every value stays editable. `rows` newest first, as the board loads them.
 */
export function houseWording(
  rows: readonly HouseRow[],
  t: { employmentType: EmploymentType; role: RoleKey },
): Pick<OfferTerms, HouseKey> {
  const pool = [...rows.filter((r) => VETTED.has(r.status ?? "")), ...rows.filter((r) => !VETTED.has(r.status ?? ""))];
  const has = (r: HouseRow) => !!(r.pay_schedule?.trim() || r.pay_method?.trim() || r.deductions?.trim());
  const src = pool.find((r) => r.employment_type === t.employmentType && has(r)) ?? pool.find(has) ?? null;
  const sameRole = pool.find((r) => r.role === t.role && r.employment_type === t.employmentType && (r.normal_hours ?? "").trim());
  const v = (x: string | null | undefined) => (x && x.trim() ? x : null);
  return { normalHours: v(sameRole?.normal_hours), paySchedule: v(src?.pay_schedule), payMethod: v(src?.pay_method), deductions: v(src?.deductions) };
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim();
const blank = (a: string | null | undefined) => !(a ?? "").trim();

/**
 * THE DEFAULTS THAT FOLLOW A CHOICE (2026-10-04, the form audit). Two kinds of field start from the
 * company's own records rather than from the person typing: the statutory four (houseWording, which
 * depends on the role and the employment type) and who the person reports to (whoever leads the
 * market). When the role, the type or the market changes, those fields move with it — but only
 * while they are empty or still hold the default they were given. A value the owner typed is theirs.
 * `leadOf(market, candidateId)` names the market's lead, never the candidate themselves.
 */
export function restateDefaults(
  prev: OfferTerms, next: OfferTerms,
  ctx: OfferContext,
): OfferTerms {
  const out: OfferTerms = { ...next };
  const before = houseWording(ctx.history, prev), after = houseWording(ctx.history, next);
  for (const k of HOUSE_KEYS) {
    if (same(before[k], after[k])) continue;
    if (blank(out[k]) || same(out[k], before[k])) out[k] = after[k];
  }
  const leadBefore = ctx.leadOf(prev.market, prev.candidateUserId ?? null);
  const leadAfter = ctx.leadOf(next.market, next.candidateUserId ?? null);
  if (leadBefore?.id !== leadAfter?.id && (blank(out.reportsTo) || same(out.reportsTo, leadBefore?.name))) {
    out.reportsTo = leadAfter?.name ?? null;
    out.reportsToId = leadAfter?.id ?? null;
  }
  return out;
}

/** What the defaults are drawn from: past letters (newest first) and who leads each market. */
export type OfferContext = {
  history: readonly HouseRow[];
  leadOf: (m: Market, candidateId: string | null) => { id: string; name: string } | null;
};

/** A new offer: the company's defaults filled in, nobody chosen yet. */
export function startOffer(ctx: OfferContext): OfferTerms {
  const e = emptyOffer();
  const lead = ctx.leadOf(e.market, null);
  return { ...e, ...houseWording(ctx.history, e), reportsTo: lead?.name ?? null, reportsToId: lead?.id ?? null };
}

/** Someone an offer can be for, as the form knows them: on the crew, or a customer with an account. */
export type OfferPerson = {
  id: string; name: string; email: string | null;
  role: string | null; market: string | null; title: string | null;
};

/**
 * WHO IT IS FOR FILLS IN WHAT WE KNOW ABOUT THEM (2026-10-04, the form audit). Picking the person
 * links the letter to their account — offer_letters.candidate_user_id, which the onboarding steps
 * (0311), the deadlines board (0320) and the candidate's own copy read, and which nothing in the
 * app wrote — and fills their name, email, city, access level and title from what is on file. A
 * field follows the pick while it is empty or still holds the previous person's value; anything the
 * owner typed stays (lib/pickFill). `p` null is "someone new": the link goes, and so do the last
 * person's details.
 * The defaults that hang off the role and the market are restateDefaults' job, run after this.
 */
export function forPerson(d: OfferTerms, prev: OfferPerson | null, p: OfferPerson | null): OfferTerms {
  const role = p?.role ? toRole(p.role) : null;
  return {
    ...d,
    candidateUserId: p?.id ?? null,
    candidateName: follow(d.candidateName, prev?.name, p?.name),
    candidateEmail: follow(d.candidateEmail, prev?.email, p?.email),
    title: follow(d.title, prev?.title, p?.title),
    market: p?.market && isMarket(p.market) ? p.market : d.market,
    // Only a role that can be offered: an owner's own role is not an access level a letter grants.
    role: role && OFFERABLE_ROLES.includes(role) ? role : d.role,
  };
}
