// WHO AN OPERATOR AGREEMENT IS FOR, ON THE OWNER'S FORM (2026-10-04, the form audit).
//
// lib/operatorDeal is the deal — the split, the tiers, the statuses — and it rides into the
// candidate's offer page through the pay explainer (components/OfferLetterPrint → lib/dealExplainer).
// This is only the owner's form: who the agreement is for and what a pick fills. Apart, so nobody
// reading an offer downloads it (/offer measured 200 B heavier with it inside lib/operatorDeal).

import { isMarket, type Market } from "./markets";
import { follow } from "./pickFill";

/** What a draft is called before anyone is named on it — not a name, so a pick replaces it. */
export const UNNAMED_OPERATOR = "New operator";

/** Someone an agreement can be for, as the form knows them: the crew roster, plus what is on file. */
export type OperatorPerson = { id: string; name: string; email: string | null; market: string | null };

/**
 * WHO IT IS FOR, LINKED (2026-10-04, the form audit). Nothing in the app wrote operator_user_id, and
 * everything on the operator's side finds the agreement by it — their own copy at /agreement, the
 * "agreements operator read own" policy (0277), respond_to_agreement and sign_agreement (0309). So
 * an agreement drafted here could not be opened, answered or signed by the person it was for.
 * Picking them links it, and fills the name and email it carries and the market they lead (else the
 * one they work in) — the name and email only while they are empty or still the previous pick's
 * (lib/pickFill). `p` null unlinks it: someone not on the crew yet, whose name is typed.
 */
export function forOperator<T extends { operatorUserId: string | null; operatorName: string; operatorEmail: string; market: Market }>(
  d: T, prev: OperatorPerson | null, p: OperatorPerson | null,
): T {
  return {
    ...d,
    operatorUserId: p?.id ?? null,
    operatorName: follow(d.operatorName === UNNAMED_OPERATOR ? "" : d.operatorName, prev?.name, p?.name),
    operatorEmail: follow(d.operatorEmail, prev?.email, p?.email),
    market: p?.market && isMarket(p.market) ? p.market : d.market,
  };
}
