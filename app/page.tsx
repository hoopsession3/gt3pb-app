"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth, type Profile } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import GenerateDay from "@/components/GenerateDay";
import ReservePitch from "@/components/ReservePitch";
import StampCard from "@/components/StampCard";
import MemberInbox, { useHasActiveOrder } from "@/components/MemberInbox";
import Skeleton from "@/components/Skeleton";
import Watermark from "@/components/Watermark";
import EditableCopy from "@/components/EditableCopy";
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
        lead="Your"
        leadSub="usual"
        name={names}
        sub="same order, one tap"
        trailing={<span className="k-chip k-chip-sec">Order again</span>}
        onClick={() => reorder(last.items as DrinkId[])}
        ariaLabel={`Order your usual again: ${names}`}
      />
    </div>
  );
}

function TodayReal({ t }: { t: (k: string) => string }) {
  const { user, profile } = useAuth();
  const name = firstName(profile, user?.email);
  // Read the clock CLIENT-SIDE only. SSR + the first client render both see `now === null` (so the
  // HTML matches and there's no hydration mismatch, React #418); the effect then fills in the real
  // local date + greeting a frame later.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const hasActive = useHasActiveOrder();

  return (
    <section className="screen" id="s-today">
      <Watermark variant="landing" />
      <Masthead
        eyebrow="Today"
        right={
          <Link
            className={`pf${profile?.avatar_url ? " pf-photo" : ""}`}
            href="/3mpire"
            aria-label="Your 3MPIRE"
            style={profile?.avatar_url ? { backgroundImage: `url(${profile.avatar_url})` } : undefined}
          >
            {profile?.avatar_url ? "" : name.charAt(0)}
          </Link>
        }
      />
      <h1 className="k-title">{now ? `${greet(now)}, ` : ""}{name}.</h1>
      {now && <p className="k-sub">{todayLabel(now)}</p>}

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
      <EditableCopy k="home.questions" value={t("home.questions")} as="p" style={{ fontSize: 14, color: "var(--cream-m)", margin: "14px 2px 4px" }} />
      <GenerateDay />

      <ClosingBeat />
    </section>
  );
}

// Today is the MEMBER home. Guests (and unconfigured builds) land on the Truck — the public
// front door: where the bar is, the route, the menu.
export default function TodayScreen() {
  const { ready, enabled, user } = useAuth();
  const t = useSiteCopy();
  const router = useRouter();
  useEffect(() => {
    if (!enabled || (ready && !user)) router.replace("/truck");
  }, [enabled, ready, user, router]);
  if (!enabled || !ready || !user) {
    return <section className="screen" id="s-today"><div className="toprow"><div className="eyb" /></div><Skeleton variant="row" count={4} /></section>;
  }
  return <TodayReal t={t} />;
}
