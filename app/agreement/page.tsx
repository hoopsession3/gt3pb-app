"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { staffAccess } from "@/lib/access";
import { Masthead, ClosingBeat } from "@/components/kit";
import SignIn from "@/components/SignIn";
import PourFill from "@/components/PourFill";

const OperatorDeal = dynamic(() => import("@/components/OperatorDeal"), {
  loading: () => <PourFill label="Loading your agreement…" />,
});

// YOUR AGREEMENT — the operator's own copy of the deal.
//
// ── WHY THIS ROUTE EXISTS ──────────────────────────────────────────────────────────────────────
// sign_agreement and respond_to_agreement both permit `operator_user_id = auth.uid()` on purpose:
// the operator signs and answers for themselves. Neither could be called by an operator, because
// their only caller in the app is components/OperatorDeal, mounted inside /crew's `money` section,
// and ROLE_SECTIONS.operator is day, now, prep, plan, brew, garage, notes, driver. No money.
//
// The person the screen was built for could not open it. Production has one account in the
// operator role and one operator agreement.
//
// ── WHY A ROUTE AND NOT A SECTION ──────────────────────────────────────────────────────────────
// Adding "money" to ROLE_SECTIONS.operator would hand them expenses, budgets, invoices, offer
// letters and the whole P&L in order to solve a scoping problem. RLS would refuse most of the
// writes, but "the query comes back empty" and "this screen should not exist for you" are
// different statements, and only one of them is a design.
//
// It is also not a crew section because it is not crew work. An agreement is a personal document
// about one person's own terms — the same category as their profile — so it lives on its own
// route, reachable from the account sheet, and reads the same on a phone as everything else.
//
// The component is the SAME component an owner uses, with `mine`. A second signing flow is the
// last thing this codebase needs.
export default function AgreementPage() {
  const { user, profile, profileStatus, refreshProfile } = useAuth();
  const access = staffAccess(!!user, profileStatus, profile);

  if (access === "anon") return <SignIn />;

  // "wait" and "failed" are not refusals and must not be spelled like one — lib/access owns that
  // distinction and scripts/gate.audit.mjs fails the build if a screen forgets it.
  if (access === "wait" || access === "failed") {
    return (
      <section className="screen">
        <Masthead eyebrow="Your agreement" right={<Link className="pf" href="/3mpire" aria-label="Back">‹</Link>} />
        <div className="h-title">{access === "failed" ? "Couldn't check your access" : "One moment"}</div>
        <div className="h-sub">
          {access === "failed"
            ? "We couldn't read your profile just now, so we don't know what you can see. This isn't a refusal."
            : "Checking your access…"}
        </div>
        {access === "failed" && (
          <button type="button" className="note-save" style={{ marginTop: 14 }} onClick={() => refreshProfile()}>Try again</button>
        )}
        <ClosingBeat />
      </section>
    );
  }

  if (access === "deny") {
    return (
      <section className="screen">
        <Masthead eyebrow="Your agreement" right={<Link className="pf" href="/3mpire" aria-label="Back">‹</Link>} />
        <div className="h-title">Crew only</div>
        <div className="h-sub">Operator agreements are between GT3 and the people running its markets.</div>
        <ClosingBeat />
      </section>
    );
  }

  return (
    <section className="screen">
      <Masthead eyebrow="Your agreement" right={<Link className="pf" href="/3mpire" aria-label="Back">‹</Link>} />
      <OperatorDeal mine />
      <ClosingBeat />
    </section>
  );
}
