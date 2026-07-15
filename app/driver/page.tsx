"use client";

import { useAuth, roleOf } from "@/components/AuthProvider";
import DriverRun from "@/components/DriverRun";
import SignIn from "@/components/SignIn";
import AccountPill from "@/components/AccountPill";
import { Masthead, ClosingBeat } from "@/components/kit";

// The driver's screen — one-handed, at the wheel. Crew-only (any non-member role, since a driver is
// tagged crew); guests and members get a friendly bounce. The run itself lives in <DriverRun/>.
export default function DriverPage() {
  const { user, profile, enabled } = useAuth();
  if (!enabled) return null;
  const staff = !!user && roleOf(profile) !== "member";
  return (
    <section className="screen" id="s-driver">
      <Masthead eyebrow="Delivery run" right={<AccountPill />} />
      {!user ? (
        <div className="driver-empty"><p className="dl-sub" style={{ marginBottom: 12 }}>Sign in to see your run.</p><SignIn /></div>
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
