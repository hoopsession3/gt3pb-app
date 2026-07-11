"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, roleOf } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Sheet from "@/components/Sheet";
import Gt3Mark from "@/components/Gt3Mark";
import { supabase } from "@/lib/supabase";
import { DRINKS, type DrinkId } from "@/lib/menu";
import type { Order } from "@/lib/db";

// THE customer account popout — the things that matter to THEM, in the canonical LV Sheet:
// who they are, how close they are to a free drink, their credit, one-tap reorder, and their
// member card. Reachable from any page (the account pill). Staff get their Crew Mode door here
// too. Deeper management (orders, referral detail, saved events) links out to the /3mpire hub.
const GOAL = 10;

function Coconut() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="#6b4226" />
      <path d="M5 10c2.2-2.4 11.8-2.4 14 0" stroke="#946239" strokeWidth="1.1" fill="none" opacity="0.7" />
      <circle cx="9.3" cy="10.4" r="1.3" fill="#2a1810" />
      <circle cx="14.7" cy="10.4" r="1.3" fill="#2a1810" />
      <circle cx="12" cy="14.3" r="1.3" fill="#2a1810" />
    </svg>
  );
}

export default function AccountSheet({ onClose, onEditProfile, onShowCard }: {
  onClose: () => void;
  onEditProfile: () => void;
  onShowCard: () => void;
}) {
  const { user, profile, signOut } = useAuth();
  const { toast, reorder } = useApp();
  const router = useRouter();

  const role = roleOf(profile);
  const staff = !!user && role !== "member";
  const name = profile?.display_name || user?.email?.split("@")[0] || "Guest";
  const founding = !!profile?.founding_member;
  const pts = Math.max(0, profile?.points || 0);
  const inCard = pts % GOAL;
  const toGo = GOAL - inCard;
  const free = Math.floor(pts / GOAL);
  const credit = (profile?.credit_cents ?? 0) / 100;
  const photo = profile?.avatar_url || "";

  // Their usual — the single most-used customer action, reachable from anywhere.
  const [last, setLast] = useState<Order | null>(null);
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { if (data && data[0]) setLast(data[0] as Order); });
  }, [user]);

  const go = (href: string) => { onClose(); router.push(href); };

  const head = (title: string) => (
    <div className="acs-head">
      <span className="acs-head-t"><Gt3Mark tone="cream" /> {title}</span>
      <button type="button" className="isheet-x" onClick={onClose}>Close</button>
    </div>
  );

  if (!user) {
    return (
      <Sheet open onClose={onClose} header={head("Membership")} className="acs-sheet">
        <div className="acs-guest">
          <div className="acs-guest-t">Points · pours · reserves</div>
          <p>Sign in to earn stamps, track your orders, and carry your GT3 member card.</p>
          <button type="button" className="acs-cta" onClick={() => go("/3mpire")}>Sign in</button>
        </div>
      </Sheet>
    );
  }

  const usualNames = last ? last.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · ") : "";

  return (
    <Sheet open onClose={onClose} header={head("Your Member Profile")} className="acs-sheet">
      {/* Identity — the portrait, the name, the tier */}
      <div className="acs-hero">
        <div className={`acs-av${photo ? " ph" : ""}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
          {!photo && <Coconut />}
        </div>
        <div className="acs-id">
          <div className="acs-name">{name}</div>
          <span className={`acs-tier${founding ? " founding" : ""}`}>{founding ? "★ Founding Member" : "Member"}</span>
        </div>
      </div>

      {/* Rewards at a glance — every value reads a real, maintained column: points (0012/0152) and
          credit_cents (0013/0152). "Free earned" is derived from points. No dead columns. */}
      <div className="acs-stats">
        <div className="acs-stat">
          <span className="acs-stat-v">{inCard === 0 && pts > 0 ? "0" : inCard}<i>/{GOAL}</i></span>
          <span className="acs-stat-k">{inCard === 0 && pts > 0 ? "Free ready" : `${toGo} to free`}</span>
        </div>
        <div className="acs-stat">
          <span className="acs-stat-v">{pts}</span>
          <span className="acs-stat-k">Points</span>
        </div>
        <div className="acs-stat">
          <span className="acs-stat-v">{credit > 0 ? `$${credit % 1 === 0 ? credit.toFixed(0) : credit.toFixed(2)}` : free}</span>
          <span className="acs-stat-k">{credit > 0 ? "Credit" : "Free earned"}</span>
        </div>
      </div>

      {/* Order again — one tap, from anywhere */}
      {last && (
        <button type="button" className="acs-reorder" onClick={() => { reorder(last.items as DrinkId[]); onClose(); }}>
          <span className="acs-reorder-x"><b>Order again</b><span>{usualNames}</span></span>
          <span className="acs-reorder-a">1-tap ↻</span>
        </button>
      )}

      {/* Your member card — the gold hero action */}
      <button type="button" className="acs-card" onClick={() => { onClose(); onShowCard(); }}>
        <span className="acs-card-l">
          <b>Your member card</b>
          <span>{founding ? "Founding status · photo & finish — show it off ↗" : "Photo, status & finish — show it off ↗"}</span>
        </span>
        <span className="acs-card-mk"><Gt3Mark tone="cream" /></span>
      </button>

      {/* Manage — the real destinations: orders, reservations, rewards */}
      <div className="acs-group">Manage</div>
      <div className="acs-rows">
        <button type="button" className="acs-row" onClick={() => go("/3mpire#orders")}>
          <span className="acs-row-x"><b>Orders &amp; deliveries</b><span>Track, reorder &amp; receipts</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        <button type="button" className="acs-row" onClick={() => go("/events")}>
          <span className="acs-row-x"><b>Reservations &amp; events</b><span>Upcoming stops · RSVPs</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        <button type="button" className="acs-row" onClick={() => go("/3mpire#rewards")}>
          <span className="acs-row-x"><b>Rewards &amp; referrals</b><span>Points, credit · give $5 get $5{free > 0 ? ` · ${free} free` : ""}</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
      </div>

      {/* Account — who you are and how you're reached */}
      <div className="acs-group">Account</div>
      <div className="acs-rows">
        <button type="button" className="acs-row" onClick={onEditProfile}>
          <span className="acs-row-x"><b>Profile &amp; notifications</b><span>Photo · name · order alerts</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        {staff && (
          <button type="button" className="acs-row crew" onClick={() => go("/crew")}>
            <span className="acs-row-x"><b>Switch to Crew Mode</b><span>Your crew console — shift, prep, money</span></span>
            <span className="acs-row-c" aria-hidden>›</span>
          </button>
        )}
        <button type="button" className="acs-row" onClick={() => go("/3mpire")}>
          <span className="acs-row-x"><b>Full member profile</b><span>Card, rewards, orders &amp; history</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
      </div>

      <button type="button" className="acs-signout" onClick={() => { onClose(); signOut(); toast("Signed out"); }}>Sign out</button>
    </Sheet>
  );
}
