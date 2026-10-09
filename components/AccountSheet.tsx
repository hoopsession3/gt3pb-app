"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, roleOf } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Sheet from "@/components/Sheet";
import Icon from "@/components/Icon";
import Gt3Mark from "@/components/Gt3Mark";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { readEditMode, writeEditMode } from "@/lib/editModeToggle";
import { showsCommerce, surfaceOf } from "@/lib/surfaces";
import type { Order } from "@/lib/db";
import Button from "./Button";

// THE account popout — a MENU, reachable from the avatar on every page.
//
// ── WHAT IT STOPPED BEING (2026-10-02) ─────────────────────────────────────────────────────────
// It used to open with a second copy of the /3mpire hub — the three stat tiles, the red "Order
// again" block, the gold member-card hero — and only then the rows, so "Switch to Crew Mode" and
// "Sign out" sat below the fold. Ryan's three screenshots showed the same four facts (name, tier,
// stamps, usual) rendered on Today, on /3mpire and here, and his own console four taps away.
// Every function one home: Today shows the card and the usual; /3mpire IS the hub; this is the
// list of places to go. The identity line at the top is the way to the hub. Nothing is lost —
// every destination this used to show is one tap away in a row, and the sheet now fits a phone
// without scrolling.
//
// For staff, Crew Mode is the FIRST row and the reason they opened this. lib/mode.ts remembers
// the side they are on, so most days the owner never needs it: the app opens where he left it.
const GOAL = 10;

// Loaded when someone taps "Delete account", not with every page: the account sheet rides in every
// route's bundle, and the design ratchet weighs each one (scripts/design.ratchet.mjs).
const DeleteAccount = dynamic(() => import("@/components/DeleteAccount"), { ssr: false });

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

// HELP AND DISPLAY (2026-10-08, the iPhone chrome round, approved). The floating rail held these on every
// page; on a phone it is gone, and they are rows here — for a guest too. Each opens its own sheet
// (Ask us: components/Concierge; Connect and Display: components/HelpSheets) as this menu closes. In the
// frame the rail still has them as well: a menu that lists its help is never wrong.
function HelpRows({ onClose, owner }: { onClose: () => void; owner: boolean }) {
  const ask = showsCommerce(surfaceOf(usePathname()));
  const open = (event: string) => { onClose(); window.dispatchEvent(new Event(event)); };
  // Read when the menu opens (it is drawn in the browser only, after a tap), so no effect is needed.
  const [editing, setEditing] = useState(readEditMode);
  return (
    <>
      <div className="acs-group">Help &amp; display</div>
      <div className="acs-rows">
        {ask && (
          <button type="button" className="acs-row" onClick={() => open("gt3-open-concierge")}>
            <span className="acs-row-x"><b>Ask us</b><span>The menu, the truck&rsquo;s hours, booking</span></span>
            <span className="acs-row-c" aria-hidden>›</span>
          </button>
        )}
        <button type="button" className="acs-row" onClick={() => open("gt3-open-connect")}>
          <span className="acs-row-x"><b>Connect with GT3</b><span>Links, socials &amp; a code to scan</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        <button type="button" className="acs-row" onClick={() => open("gt3-open-display")}>
          <span className="acs-row-x"><b>Display &amp; text size</b><span>Bigger text, bold, roomier spacing</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        {/* The owner's on-page copy editing (components/EditableCopy), the rail's Edit copy switch. */}
        {owner && (
          <button type="button" className="acs-row" aria-pressed={editing} onClick={() => { const next = !editing; setEditing(next); writeEditMode(next); }}>
            <span className="acs-row-x"><b>Edit copy on pages</b><span>{editing ? "On — tap any text to change it" : "Off — turn on to change words on a page"}</span></span>
            <span className="acs-row-c" aria-hidden>{editing ? "On" : "Off"}</span>
          </button>
        )}
      </div>
    </>
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

  // "Delete account" swaps the menu for its own body under this same header (components/DeleteAccount).
  const [deleting, setDeleting] = useState(false);

  const head = (title: string) => (
    <div className="acs-head">
      <span className="acs-head-t"><Gt3Mark tone="cream" /> {title}</span>
      <button type="button" className="isheet-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
    </div>
  );

  if (!user) {
    return (
      <Sheet open onClose={onClose} header={head("Membership")} className="acs-sheet">
        <div className="acs-guest">
          <div className="acs-guest-t">Points · pours · reserves</div>
          <p>Sign in to earn stamps, track your orders, and carry your GT3 member card.</p>
          <Button type="button" kind="primary" wide onClick={() => go("/3mpire")}>Sign in</Button>
        </div>
        <HelpRows onClose={onClose} owner={false} />
      </Sheet>
    );
  }

  const usualNames = last ? last.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · ") : "";
  const stamps = inCard === 0 && pts > 0 ? "a free pour is ready" : `${toGo} to your free pour`;

  if (deleting) {
    return (
      <Sheet open onClose={onClose} header={head("Delete your account")} className="acs-sheet">
        <DeleteAccount staff={staff} onKeep={() => setDeleting(false)}
          onDeleted={() => { onClose(); signOut(); toast("Your account is deleted."); router.push("/"); }} />
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} header={head("Your account")} className="acs-sheet">
      {/* Identity — who, which tier, how close to free — and the one way to the full card. */}
      <button type="button" className="acs-hero acs-hero-go" onClick={() => go("/3mpire")} aria-label="Open your member card">
        <div className={`acs-av${photo ? " ph" : ""}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
          {!photo && <Coconut />}
        </div>
        <div className="acs-id">
          <div className="acs-name">{name}</div>
          <span className={`acs-tier${founding ? " founding" : ""}`}>{founding ? <><Icon name="star" /> Founding Member</> : "Member"}</span>
          <div className="acs-line">{inCard}<i>/{GOAL}</i> · {stamps}{credit > 0 ? ` · $${credit % 1 === 0 ? credit.toFixed(0) : credit.toFixed(2)} credit` : free > 0 ? ` · ${free} free earned` : ""}</div>
        </div>
        <span className="acs-row-c" aria-hidden>›</span>
      </button>

      {staff && (
        <div className="acs-rows acs-rows-first">
          <button type="button" className="acs-row crew" onClick={() => go("/crew")}>
            <span className="acs-row-x"><b>Crew Mode</b><span>Your console — shift, prep, plan, money</span></span>
            <span className="acs-row-c" aria-hidden>›</span>
          </button>
        </div>
      )}

      <div className="acs-group">Manage</div>
      <div className="acs-rows">
        {last && (
          <button type="button" className="acs-row" onClick={() => { reorder(last.items as DrinkId[]); onClose(); }}>
            <span className="acs-row-x"><b>Order again</b><span>{usualNames} · one tap</span></span>
            <span className="acs-row-c" aria-hidden>↻</span>
          </button>
        )}
        <button type="button" className="acs-row" onClick={() => go("/3mpire#orders")}>
          <span className="acs-row-x"><b>Orders &amp; deliveries</b><span>Track, reorder &amp; receipts</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        <button type="button" className="acs-row" onClick={() => go("/office")}>
          <span className="acs-row-x"><b>Office delivery</b><span>Your team&rsquo;s Monday route &amp; jugs</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        <button type="button" className="acs-row" onClick={() => go("/3mpire#rewards")}>
          <span className="acs-row-x"><b>Rewards &amp; referrals</b><span>Points, credit · give $5 get $5</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        <button type="button" className="acs-row" onClick={() => { onClose(); onShowCard(); }}>
          <span className="acs-row-x"><b>Your member card</b><span>{founding ? "Founding status · photo & finish — show it off" : "Photo, status & finish — show it off"}</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
      </div>

      <div className="acs-group">Account</div>
      <div className="acs-rows">
        <button type="button" className="acs-row" onClick={onEditProfile}>
          <span className="acs-row-x"><b>Profile &amp; notifications</b><span>Photo · name · order alerts</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
        {/* An agreement is a personal document about this person's own terms, so it belongs beside
            their profile rather than inside the crew console — which is also the only place an
            operator could not reach it from. */}
        {staff && (
          <button type="button" className="acs-row" onClick={() => go("/agreement")}>
            <span className="acs-row-x"><b>Your agreement</b><span>What you agreed to, what it pays, and signing</span></span>
            <span className="acs-row-c" aria-hidden>›</span>
          </button>
        )}
        {/* App Store Review Guideline 5.1.1(v): deleting the account is in the account, one tap from
            the menu, on the web and in the app alike. */}
        <button type="button" className="acs-row" onClick={() => setDeleting(true)}>
          <span className="acs-row-x"><b>Delete account</b><span>Your profile and details, for good</span></span>
          <span className="acs-row-c" aria-hidden>›</span>
        </button>
      </div>

      <HelpRows onClose={onClose} owner={role === "owner"} />

      <button type="button" className="acs-signout" onClick={() => { onClose(); signOut(); toast("Signed out"); }}>Sign out</button>
    </Sheet>
  );
}
