"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, roleOf } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import AccountPill from "@/components/AccountPill";
import EditableCopy from "@/components/EditableCopy";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import ReviewPrompt from "@/components/ReviewPrompt";
import MembershipCard from "@/components/MembershipCard";
import VipVerify from "@/components/VipVerify";
import MyPacks from "@/components/MyPacks";
import MyDeliveries from "@/components/MyDeliveries";
import Skeleton from "@/components/Skeleton";
import Icon from "@/components/Icon";
import { supabase } from "@/lib/supabase";
import type { Order } from "@/lib/db";
import { clickable } from "@/lib/a11y";
import { useSiteCopy } from "@/lib/copy";
import { money, moneyPlain, moneyRound } from "@/lib/money";
import { isSettled } from "@/lib/settled";
import { orderNo } from "@/lib/activeOrder";
import { orderTag } from "@/lib/orderWords";
import { publicOrigin } from "@/lib/native";
import { shareLink } from "@/lib/deviceActions";
import { cardOf, freeWords, STAMP_GOAL } from "@/lib/loyalty";

const RING = 232; // 2πr for r=37, matches prototype stroke-dasharray

function histDate(iso: string) {
  const d = new Date(iso);
  const wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${wk} · ${mo} ${d.getDate()}`;
}

// Real order history + one-tap reorder (replaces the old stub row).
function OrderHistory() {
  const { reorder, nameOf } = useApp();
  const { user } = useAuth();
  const t = useSiteCopy();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false); // quiet by default: 4 rows, the rest fold

  useEffect(() => {
    if (!supabase || !user) { setLoaded(true); return; }
    supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8)
      .then(({ data }) => { if (data) setOrders(data as Order[]); setLoaded(true); });
  }, [user]);

  if (loaded && orders.length === 0) return null; // stay quiet for brand-new members

  return (
    <>
      <SectionHeader label={<EditableCopy k="account.orders_label" value={t("account.orders_label")} />} annotation={<EditableCopy k="account.orders_note" value={t("account.orders_note")} />} />
      {(showAll ? orders : orders.slice(0, 4)).map((o) => (
        <div className="hist-row" key={o.id}>
          <div className="hist-row-l">
            <b>{o.items.map(nameOf).join(" · ")}</b>
            {/* Its number and where it ended (R3b): a canceled order said nothing here and read like one picked up. */}
            <span>{histDate(o.created_at)} · {orderNo(o.id)} · {orderTag(o.status)}{o.status === "void" ? "" : isSettled(o) ? " · paid" : " · pay at the window"}</span>
          </div>
          <span className="hist-px">{money(o.total_cents)}</span>
          <button className="k-icon-btn shrink-0" onClick={() => reorder(o.items)} aria-label="Order this again">↻</button>
        </div>
      ))}
      {orders.length > 4 && (
        <button type="button" className="hist-more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? "Fewer ▴" : `All ${orders.length} ▸`}
        </button>
      )}
    </>
  );
}

function useRingFill(fill: number) {
  const ringRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const r = ringRef.current;
    if (!r) return;
    const t = setTimeout(() => {
      r.style.transition = "stroke-dashoffset 1.1s ease";
      r.style.strokeDashoffset = String(RING * (1 - fill));
    }, 700);
    return () => clearTimeout(t);
  }, [fill]);
  return ringRef;
}

function ReferralCard({ code }: { code: string }) {
  const { toast } = useApp();
  const { user } = useAuth();
  const t = useSiteCopy();
  const [copyLbl, setCopyLbl] = useState(t("account.copy"));
  const [stats, setStats] = useState<{ n: number; earned: number } | null>(null);

  // Real earned-credit stats from the referral ledger (referrer = me).
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("referral_events").select("referrer_credit_cents").eq("referrer", user.id)
      .then(({ data }) => {
        if (data) setStats({ n: data.length, earned: data.reduce((s, r) => s + (r.referrer_credit_cents ?? 0), 0) });
      });
  }, [user]);

  const link = typeof window !== "undefined" ? `${publicOrigin()}/?ref=${encodeURIComponent(code)}` : "";

  // The share sheet — the browser's on the web, the phone's in the app (lib/deviceActions). Closing it is
  // an answer; with no share sheet at all, or one that fails, the link is copied instead.
  const share = async () => {
    const how = await shareLink({ title: "GT3 Performance Bar", text: `Join me on GT3 — use code ${code} and we both get $5.`, url: link });
    if (how === "done" || how === "cancelled") return;
    try { await navigator.clipboard.writeText(link); toast("Invite link copied"); } catch { toast(link); }
  };
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* clipboard may be blocked */ }
    setCopyLbl(t("account.copied"));
    setTimeout(() => setCopyLbl(t("account.copy")), 1400);
    toast("Referral code copied");
  };

  return (
    <div className="referral">
      <EditableCopy k="mpire.ref_eye" value={t("mpire.ref_eye")} as="div" className="eyb" />
      <EditableCopy k="mpire.ref_title" value={t("mpire.ref_title")} as="h3" />
      <EditableCopy k="mpire.ref_body" value={t("mpire.ref_body")} as="p" className="ref-sub" multiline />
      <div className="code"><b>{code}</b><span className="cp" aria-label={`Copy referral code ${code}`} {...clickable(copyCode)}>{copyLbl}</span></div>
      <button type="button" className="btn-pri btn-wide mt-2.5" onClick={share}>{t("account.share")}</button>
      {stats && stats.n > 0 && (
        <div className="ref-stat">{stats.n} {stats.n === 1 ? "friend" : "friends"} joined · {moneyRound(stats.earned)} earned</div>
      )}
    </div>
  );
}

// ───────────────────────── signed-in, profile-driven ─────────────────────────
function MpireReal() {
  const { toast } = useApp();
  const { profile, user, signOut } = useAuth();
  const router = useRouter();
  const t = useSiteCopy();

  // lib/loyalty's card (C6): stamps now, free cups READY — a redeemed one is gone from the count (0387). "Free earned"
  // counted every ten points forever.
  const card = cardOf(profile?.points);
  const credit = moneyPlain(profile?.credit_cents);
  const code = profile?.referral_code || "GT3PB-3MP";
  const creditCents = profile?.credit_cents ?? 0;

  // Deep-link landing — the account popout routes here with #orders / #rewards; scroll to the
  // section once the page has laid out (data blocks mount async).
  useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!h) return;
    const t = setTimeout(() => { document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 260);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="screen" id="s-mpire">
      <Masthead eyebrow={<EditableCopy k="mpire.eyebrow" value={t("mpire.eyebrow")} />} right={<AccountPill />} />

      {/* The card IS the hero — name, tier, stamps, code, QR, the free-pour promise. The old ring
          card + stat tiles repeated all of it (name ×2, 5/10 ×3); everything they added now lives
          in one quiet line, and credit only speaks up when there's actually credit. */}
      <MembershipCard />
      <VipVerify />
      <div id="rewards" className="memline acs-anchor">
        <span><b>{card.stamps}</b>/{STAMP_GOAL} stamps</span>
        <span className="memline-dot">·</span>
        <span>{card.free > 0 ? <b>{freeWords(card.free)}</b> : `${card.toNext} to a free cup`}</span>
        {/* Spent at the window (0389, H8): the crew sees it on the scan screen and takes it off. */}
        {creditCents > 0 && <><span className="memline-dot">·</span><span><b>${credit}</b> credit · use it at the window</span></>}
      </div>

      <ReviewPrompt />

      {/* Your orders — the fulfillment tracker the delivery success screen promises ("track it in
          your account"). Packs and deliveries share one card, live. Each self-hides when empty, so
          a brand-new member sees nothing here. Reserves stay on /events (their own mechanic). */}
      <div id="orders" className="acs-anchor" aria-hidden />
      <MyPacks />
      <MyDeliveries />

      <OrderHistory />

      <ReferralCard code={code} />

      <SectionHeader label={<EditableCopy k="account.section_label" value={t("account.section_label")} />} annotation={<EditableCopy k="account.section_note" value={t("account.section_note")} />} />
      <div className="rows">
        {/* "Switch to Crew Mode" lives in the account popout (the pill, top-right of THIS page and
            every screen) — an inline duplicate here was clutter. Academy is the staff door kept. */}
        {roleOf(profile) !== "member" && (
          <div className="row" aria-label="GT3 Academy" {...clickable(() => router.push("/academy"))}>
            <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 3L2 8l10 5 10-5-10-5z" /><path d="M6 10v5c0 1 3 3 6 3s6-2 6-3v-5" /></svg></div>
            <div className="rl"><b>{t("account.academy")}</b><span>{t("account.academy_sub")}</span></div>
            <div className="rr">›</div>
          </div>
        )}
        {roleOf(profile) === "owner" && (
          <div className="row" aria-label="System architecture" {...clickable(() => router.push("/architecture"))}>
            <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg></div>
            <div className="rl"><b>{t("account.arch")}</b><span>{t("account.arch_sub")}</span></div>
            <div className="rr">›</div>
          </div>
        )}
        <div className="row" aria-label="Book the bar — B2B" {...clickable(() => router.push("/book"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 9h18M3 9l2-5h14l2 5M5 9v11h14V9M9 13h6" /></svg></div>
          <div className="rl"><b>{t("account.book")}</b><span>{t("account.book_sub")}</span></div>
          <div className="rr">›</div>
        </div>
        {/* Notifications (R6): every kind on one screen — order updates, pickup reminders, truck live, and texts (R5's
            switch for the number on their orders lives there now, components/NotificationsSheet). */}
        <div className="row" aria-label="Notifications" {...clickable(() => window.dispatchEvent(new Event("gt3-open-notifications")))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg></div>
          <div className="rl"><b>{t("account.notifications")}</b><span>{t("account.notifications_sub")}</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Sign out" {...clickable(() => { void import("@/lib/pushRelease").then((m) => m.signOutHere(signOut), () => signOut()); toast("Signed out"); })}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg></div>
          <div className="rl"><b>{t("account.signout")}</b><span>{user?.email}</span></div>
          <div className="rr">›</div>
        </div>
      </div>

      <ClosingBeat />
    </section>
  );
}

// ───────────────────────── demo (Supabase not configured) ─────────────────────────
function MpireDemo() {
  const { toast } = useApp();
  const router = useRouter();
  const t = useSiteCopy();
  // One demo card (17 stamps: 7 on the card, a free cup ready), said the way a real one is — the ring, the line and the
  // free cups agree (R7: the ring said 7 of 10 beside "2/10 stamps").
  const demo = cardOf(17);
  const ringRef = useRingFill(demo.stamps / STAMP_GOAL);
  return (
    <section className="screen" id="s-mpire">
      <Masthead eyebrow={<EditableCopy k="mpire.eyebrow" value={t("mpire.eyebrow")} />} right={<AccountPill />} />

      <MembershipCard />
      <div className="memcard"><div className="min">
        <div className="mp-ring">
          <svg width="88" height="88">
            <circle cx="44" cy="44" r="37" fill="none" stroke="rgba(245,241,232,.1)" strokeWidth="8" />
            <circle ref={ringRef} cx="44" cy="44" r="37" fill="none" stroke="#B82420" strokeWidth="8" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING} />
          </svg>
          <div className="rc">{demo.stamps}<small>OF {STAMP_GOAL} STAMPS</small></div>
        </div>
        <div className="mt">
          <div className="eyb"><Icon name="star" /> Founding Member</div>
          <h2>Alex R.</h2>
          <p>Buy {STAMP_GOAL}, the next cup is on us. A stamp on every drink.</p>
        </div>
      </div></div>

      <div className="memline">
        <span><b>{demo.stamps}</b>/{STAMP_GOAL} stamps</span>
        <span className="memline-dot">·</span>
        <span><b>{freeWords(demo.free)}</b></span>
        <span className="memline-dot">·</span>
        <span><b>$14.00</b> credit · use it at the window</span>
      </div>

      <ReferralCard code="RYAN-3MP" />

      <SectionHeader label={<EditableCopy k="account.section_label" value={t("account.section_label")} />} annotation={<EditableCopy k="account.section_note" value={t("account.section_note")} />} />
      <div className="rows">
        <div className="row" aria-label="Order History" {...clickable(() => toast("Showing your last 6 orders"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 3h18v4H3zM5 7v14h14V7M9 11h6" /></svg></div>
          <div className="rl"><b>Order History</b><span>Last: 2× FLOW · Duncan Square</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Book the bar — B2B" {...clickable(() => router.push("/book"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 9h18M3 9l2-5h14l2 5M5 9v11h14V9M9 13h6" /></svg></div>
          <div className="rl"><b>{t("account.book")}</b><span>{t("account.book_sub")}</span></div>
          <div className="rr">›</div>
        </div>
      </div>

      <ClosingBeat />
    </section>
  );
}

// The avatar's Sign in comes here as /3mpire?signin and lands on "Welcome back", not on the join pitch (A2 of the
// account audit, #13) — read as the router reads it, so it is right from another page and from this one; keyed, so a
// second tap from the join pitch switches it.
function GuestDoor() {
  const signingIn = useSearchParams().has("signin");
  return <SignIn key={signingIn ? "signin" : "join"} start={signingIn ? "signin" : "join"} />;
}

export default function MpireScreen() {
  const { ready, enabled, user } = useAuth();
  const router = useRouter();
  // Return-to-intent: if the member door was opened mid-task (e.g. "Sign in to reserve"), finish
  // the thought — send them back where they were the moment sign-in completes.
  useEffect(() => {
    if (!user) return;
    try {
      const next = sessionStorage.getItem("gt3-next");
      if (next) { sessionStorage.removeItem("gt3-next"); router.replace(next); }
    } catch { /* ignore */ }
  }, [user, router]);
  if (!enabled) return <MpireDemo />;
  if (!ready) return <section className="screen" id="s-mpire"><div className="toprow"><div className="eyb">Membership</div></div><Skeleton variant="card" count={1} /><Skeleton variant="row" count={3} /></section>;
  if (!user) return <Suspense fallback={<SignIn />}><GuestDoor /></Suspense>;
  return <MpireReal />;
}
