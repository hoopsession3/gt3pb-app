"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth, isStaff } from "@/components/AuthProvider";
import { readMode } from "@/lib/mode";
import { markFrontDoor } from "@/lib/viewerHint";
import { isNativeApp } from "@/lib/native";
import Skeleton from "@/components/Skeleton";
import TodayHome from "@/components/today/TodayHome";
import { useSiteCopy } from "@/lib/copy";

// TODAY — the member home: components/today/TodayHome (2026-10-13, R3 — the page leads with what is true now).

// Today is the MEMBER home. Guests (and unconfigured builds) land on the Truck — the public
// front door: where the bar is, the route, the menu.
export default function TodayScreen() {
  const { ready, enabled, user, profile, profileStatus } = useAuth();
  const t = useSiteCopy();
  const router = useRouter();
  // A guest's slow way to the truck — after the page loaded, hydrated, painted a skeleton and asked
  // the session. proxy.ts (THE FRONT DOOR) sends a KNOWN guest to /truck before any of that, from
  // the cookie lib/viewerHint.ts writes; this stays for the first visit, a cleared browser, and a
  // session that turned out to be gone. Same destination either way.
  useEffect(() => {
    // The front door, said on the way out: the welcome splash shows on /truck only for an arrival
    // marked here or by proxy.ts (lib/viewerHint markFrontDoor) — not for a QR or a tab tap.
    // THE IPHONE APP OPENS ON THE MENU (2026-10-08, the iPhone chrome round, approved): someone who installed
    // the app came to order, and the app has no front-door ad (components/MarketingSplash).
    if (!enabled || (ready && !user)) {
      if (isNativeApp()) { router.replace("/menu"); return; }
      markFrontDoor(); router.replace("/truck");
    }
  }, [enabled, ready, user, router]);
  // A staff member opens the app where they left it (lib/mode.ts). Only once the profile has
  // actually loaded: roleOf(null) is "member", so deciding on a loading profile would always say
  // customer and the memory would never fire. Members have no mode and never come through here.
  useEffect(() => {
    if (!ready || !user || profileStatus !== "ready") return;
    if (isStaff(profile) && readMode() === "crew") router.replace("/crew");
  }, [ready, user, profile, profileStatus, router]);
  if (!enabled || !ready || !user) {
    return <section className="screen" id="s-today"><div className="toprow"><div className="eyb" /></div><Skeleton variant="row" count={4} /></section>;
  }
  return <TodayHome t={t} />;
}
