"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth, isStaff, type Profile } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import { readMode } from "@/lib/mode";
import dynamic from "next/dynamic";
import { markFrontDoor } from "@/lib/viewerHint";
import { isNativeApp } from "@/lib/native";
import { useApp } from "@/components/AppProvider";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import GenerateDay from "@/components/GenerateDay";
import ReservePitch from "@/components/ReservePitch";
import StampCard from "@/components/StampCard";
import MemberInbox, { useHasActiveOrder } from "@/components/MemberInbox";
import Skeleton from "@/components/Skeleton";
import Watermark from "@/components/Watermark";
import EditableCopy from "@/components/EditableCopy";
import EditCopyPill from "@/components/EditCopyPill";
import { useSiteCopy } from "@/lib/copy";
import { supabase } from "@/lib/supabase";
import { DRINKS, type DrinkId } from "@/lib/menu";
import type { Order } from "@/lib/db";

// TODAY — the member home, on the kit (Design System v1). Masthead → greeting →
// usual → loyalty card → reserve pitch → the day generator → closing beat.

function firstName(profile: Profile | null, email?: string | null) {
  const n = profile?.display_name || (email ? email.split("@")[0] : "");
  const f = (n || "there").split(" ")[0];
  return f.charAt(0).toUpperCase() + f.slice(1);
}

// Both take the date explicitly (never call new Date() at render) so the CALLER controls when the
// clock is read — critical for hydration: read on the server it bakes UTC time/date into the HTML,
// which then mismatches the browser's local value (React #418). Callers pass a client-only `now`.
function todayLabel(d: Date) {
  const wk = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  const mo = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getMonth()];
  return `${wk}, ${mo} ${d.getDate()}`;
}
function greet(d: Date) {
  const h = d.getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

// ───────────────── your usual — one-tap reorder of the last order, as a kit row ─────────────────
function YourUsual() {
  const { reorder } = useApp();
  const { user } = useAuth();
  const t = useSiteCopy();
  const [last, setLast] = useState<Order | null>(null);
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { if (data && data[0]) setLast(data[0] as Order); });
  }, [user]);
  if (!last) return null;
  const names = last.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · ");
  return (
    <div className="k-rows" style={{ marginTop: 18 }}>
      <InfoRow
        lead={t("today.usual_lead")}
        leadSub={t("today.usual_leadsub")}
        name={names}
        sub={t("today.usual_sub")}
        trailing={<span className="k-chip k-chip-sec">{t("today.usual_cta")}</span>}
        onClick={() => reorder(last.items as DrinkId[])}
        ariaLabel={`Order your usual again: ${names}`}
      />
    </div>
  );
}

// YOU'RE ON THE CREW (2026-10-08) — components/CrewWelcomeRow, loaded only for the one person it is
// for (a staff member who has never picked a side on this phone), so the home's own script does not
// carry the first-day guide's words for every guest and member.
const CrewWelcomeRow = dynamic(() => import("@/components/CrewWelcomeRow"));

function TodayReal({ t }: { t: (k: string) => string }) {
  const { user, profile } = useAuth();
  const name = firstName(profile, user?.email);
  // Read the clock CLIENT-SIDE only. SSR + the first client render both see `now === null` (so the
  // HTML matches and there's no hydration mismatch, React #418); the effect then fills in the real
  // local date + greeting a frame later.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const hasActive = useHasActiveOrder();
  // Read once, client only: TodayReal renders after the session is known, never in the server's HTML.
  const [sideChosen] = useState(() => readMode() !== null);

  return (
    <section className="screen" id="s-today">
      <Watermark variant="landing" />
      <Masthead
        eyebrow={<EditableCopy k="masthead.today" value={t("masthead.today")} />}
        right={
          // stamp.* (Loyalty card) can't be inline-click-edited — see StampCard.tsx — so this pill
          // is its only door into Settings from the live page, same idea as Reserve's confirm_return/
          // confirm_new. "Home · signed-in" itself stays implicitly pill-free here: every key in
          // that group is already inline-editable below, this pill is strictly for the stamp card.
          <div className="mast-right">
            <EditCopyPill group="Loyalty card" />
            {/* The same avatar as every other customer page — the account sheet. This one used to be
                a link to /3mpire, so the avatar did two different things depending on the page, and
                for the owner that was the first of four taps to reach his own console (2026-10-02).
                The card is one tap below in "Open your card", and one tap inside the sheet. */}
            <AccountPill />
          </div>
        }
      />
      <h1 className="k-title">{now ? `${greet(now)}, ` : ""}{name}.</h1>
      {now && <p className="k-sub">{todayLabel(now)}</p>}

      {isStaff(profile) && !sideChosen && <CrewWelcomeRow />}

      {/* your stuff — live order activity first (ready / out-for-delivery / pay-at-pickup) */}
      <MemberInbox />
      <YourUsual />
      <StampCard />
      {/* Don't upsell "reserve a drop" to someone who already has a pack/delivery coming. */}
      {!hasActive && <ReservePitch />}

      <SectionHeader
        label={<EditableCopy k="home.dialed_title" value={t("home.dialed_title")} />}
        annotation={<EditableCopy k="home.dialed_sub" value={t("home.dialed_sub")} />}
      />
      <EditableCopy k="home.questions" value={t("home.questions")} as="p" style={{ fontSize: 15, color: "var(--cream-m)", margin: "14px 2px 4px" }} />
      <GenerateDay />

      <ClosingBeat />
    </section>
  );
}

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
  return <TodayReal t={t} />;
}
