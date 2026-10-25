"use client";

import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import AccountPill from "@/components/AccountPill";
import { Masthead } from "@/components/kit";
import { staffAccess } from "@/lib/access";
import { canOf, roleOf } from "@/lib/roles";

// THE VISION (R52) — the roadmap, the store designer and the presenter (components/vision), for the crew: everyone on
// it reads the plan; owners and admins change it. Loaded only once the screen knows it's the crew's, so a guest
// downloads none of it.
const VisionApp = dynamic(() => import("@/components/vision/VisionApp"), { ssr: false });

export default function VisionPage() {
  const { user, profile, enabled, profileStatus } = useAuth();
  if (!enabled) return null;
  const access = staffAccess(!!user, profileStatus, profile);
  return (
    <section className="screen" id="s-vision">
      <Masthead eyebrow="The vision" right={<AccountPill />} />
      {!user ? (
        <div className="driver-empty"><SignIn context={{ title: "The plan, and what's next.", sub: "Sign in with your crew account to see the roadmap and the store." }} /></div>
      ) : access === "wait" || access === "failed" ? (
        <div className="driver-empty">Checking your access…</div>
      ) : access !== "allow" ? (
        <div className="driver-empty">This is the crew&apos;s plan — ask an owner for a link to it.</div>
      ) : (
        <VisionApp canEdit={canOf(profile).admin} isOwner={roleOf(profile) === "owner"} />
      )}
    </section>
  );
}
