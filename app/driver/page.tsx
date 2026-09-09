"use client";

import { useAuth } from "@/components/AuthProvider";
import DriverRun from "@/components/DriverRun";
import SignIn from "@/components/SignIn";
import AccountPill from "@/components/AccountPill";
import { Masthead, ClosingBeat } from "@/components/kit";
import { staffAccess } from "@/lib/access";

// The driver's screen — one-handed, at the wheel. Crew-only (any non-member role, since a driver is
// tagged crew); guests and members get a friendly bounce. The run itself lives in <DriverRun/>.
export default function DriverPage() {
  const { user, profile, enabled, profileStatus } = useAuth();
  if (!enabled) return null;
  // Same false negative: until the profile is actually known, "not staff" is a guess, not a fact.
  const access = staffAccess(!!user, profileStatus, profile);
  const staff = access === "allow";
  return (
    <section className="screen" id="s-driver">
      <Masthead eyebrow="Delivery run" right={<AccountPill />} />
      {!user ? (
        <div className="driver-empty"><p className="dl-sub" style={{ marginBottom: 12 }}>Sign in to see your run.</p><SignIn /></div>
      ) : access === "wait" || access === "failed" ? (
        <div className="driver-empty">Checking your access…</div>
      ) : !staff ? (
        <div className="driver-empty">This is a crew screen — ask an owner to add you to the team as a driver.</div>
      ) : (
        <>
          <DriverRun />
          <ClosingBeat />
        </>
      )}
    </section>
  );
}
