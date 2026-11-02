"use client";

import { useAuth } from "@/components/AuthProvider";
import dynamic from "next/dynamic";
import DriverRun from "@/components/DriverRun";
import SignIn from "@/components/SignIn";
import PourFill from "@/components/PourFill";
import AccountPill from "@/components/AccountPill";
import { Masthead, ClosingBeat } from "@/components/kit";
import { staffAccess } from "@/lib/access";

// The office route rides above the porch run, loaded only for the crew who can see it (2026-10-07,
// 0357): a guest on /driver downloads none of it.
const OfficeRun = dynamic(() => import("@/components/OfficeRun"), { ssr: false });

// The driver's screen — one-handed, at the wheel. Crew-only (any non-member role, since a driver is
// tagged crew); guests and members get a friendly bounce. The run itself lives in <DriverRun/>.
export default function DriverPage() {
  const { ready, user, profile, enabled, profileStatus } = useAuth();
  if (!enabled) return null;
  // Same false negative: until the profile is actually known, "not staff" is a guess, not a fact.
  const access = staffAccess(!!user, profileStatus, profile);
  const staff = access === "allow";
  return (
    <section className="screen" id="s-driver">
      <Masthead eyebrow="Delivery run" right={<AccountPill />} />
      {/* NOT KNOWN IS NOT SIGNED OUT (IMS8 P13): until the session on this phone has been read, the screen says it's opening
          — as the console does (R34) — never "Sign in" to someone who is signed in. That's also what the server renders, so
          a slow start shows "Opening…", not a sign-in form a crew member might fill in. */}
      {!ready ? (
        <div className="driver-empty"><PourFill label="Opening your run…" /></div>
      ) : !user ? (
        <div className="driver-empty"><SignIn context={{ title: "Your delivery run.", sub: "Sign in with your crew account to see today’s stops." }} /></div>
      ) : access === "wait" || access === "failed" ? (
        <div className="driver-empty">Checking your access…</div>
      ) : !staff ? (
        <div className="driver-empty">This is a crew screen — ask an owner to add you to the team as a driver.</div>
      ) : (
        <>
          <OfficeRun />
          <DriverRun />
          <ClosingBeat />
        </>
      )}
    </section>
  );
}
