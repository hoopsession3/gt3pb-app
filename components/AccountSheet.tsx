"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, roleOf } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Sheet from "@/components/Sheet";
import Icon from "@/components/Icon";
import Gt3Mark from "@/components/Gt3Mark";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { readEditMode, writeEditMode } from "@/lib/editModeToggle";
import { showsCommerce, surfaceOf } from "@/lib/surfaces";
import { staffAccess, type Access } from "@/lib/access";
import { canOf } from "@/lib/roles";
import { rememberMode } from "@/lib/mode";
import type { Order } from "@/lib/db";
import Button from "./Button";
import { Segmented } from "@/components/controls";
import { signOutHere } from "@/lib/pushRelease";
import { cardOf, freeWords, STAMP_GOAL } from "@/lib/loyalty";
import { APP_BUILD, isNativeApp } from "@/lib/native";

// THE account popout — a MENU, reachable from the avatar on every page.
//
// ── WHAT IT STOPPED BEING (2026-10-02) ─────────────────────────────────────────────────────────
// It used to open with a second copy of the /3mpire hub — the three stat tiles, the red "Order
// again" block, the gold member-card hero — and only then the rows, so "Switch to Crew Mode" and
// "Sign out" sat below the fold. Every function one home: Today shows the card and the usual; /3mpire
// IS the hub; this is the list of places to go. The identity line at the top is the way to the hub.
//
// ── ONE SHEET, FOUR ROWS (2026-10-12, A2 of the account audit; the owner approved the mockups) ──────
// Fifteen rows in three groups, and every member saw all of them: the office row for people with no
// office, "Your agreement" for every crew role though only an operator has one, the owner's copy
// switch among the help rows, and a member card that could not be scanned. Now:
//   · the header, as before — the way to the hub;
//   · for staff, a Customer · Crew switch instead of a gold row (it waits for the profile; a profile
//     still loading is not "member");
//   · two quick actions: Show card — the scannable card, its photo and finish inside it — and Order again;
//   · four rows — Orders, Rewards, Settings & privacy, Help — and the rows a person has: Your office for a
//     member of an office company, Your agreement or Your offer letter for someone who has one;
//   · the owner's Edit copy in an Owner group; then Sign out.
// Settings & privacy (Profile, Notifications, Display, Delete account) and Help (Ask us, Connect) open in
// place, under this same sheet, with a way back. Nothing is gone: the account audit maps all fifteen.

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

/** One row of the menu: a name, what is behind it, and the sign that it goes somewhere. */
function Row({ title, sub, onClick, end = "›", pressed, row }: { title: string; sub: string; onClick: () => void; end?: string; pressed?: boolean; row?: string }) {
  return (
    <button type="button" className="acs-row" onClick={onClick} aria-pressed={pressed} data-acs-row={row}>
      <span className="acs-row-x"><b>{title}</b><span>{sub}</span></span>
      <span className="acs-row-c" aria-hidden>{end}</span>
    </button>
  );
}

/** A quick action: one of the two things a member opens this sheet for most. */
function Tile({ title, sub, icon, onClick, disabled }: { title: string; sub: string; icon: "qr" | "repeat" | "coffee"; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl border border-line bg-card px-3.5 py-2.5 text-left active:scale-[.98] disabled:opacity-50">
      <span className="flex items-center gap-1.5 text-callout font-semibold text-cream"><Icon name={icon} /> {title}</span>
      <span className="w-full truncate text-footnote text-cream-muted">{sub}</span>
    </button>
  );
}

/** The owner's on-page copy editing (components/EditableCopy), in a group of its own. */
function OwnerRows() {
  // Read when the menu opens (it is drawn in the browser only, after a tap), so no effect is needed.
  const [editing, setEditing] = useState(readEditMode);
  return (
    <>
      <div className="acs-group">Owner</div>
      <div className="acs-rows">
        <Row title="Edit copy on pages" sub={editing ? "On — tap any text to change it" : "Off — turn on to change words on a page"}
          end={editing ? "On" : "Off"} pressed={editing} onClick={() => { const next = !editing; setEditing(next); writeEditMode(next); }} />
      </div>
    </>
  );
}

// HELP AND DISPLAY for someone signed out (2026-10-08, the iPhone chrome round): the floating rail held these on every
// page; on a phone they are rows here. Signed in, they live under Help and Settings & privacy.
function GuestRows({ onClose }: { onClose: () => void }) {
  const ask = showsCommerce(surfaceOf(usePathname()));
  const open = (event: string) => { onClose(); window.dispatchEvent(new Event(event)); };
  return (
    <>
      <div className="acs-group">Help &amp; display</div>
      <div className="acs-rows">
        {ask && <Row title="Ask us" sub="The menu, the truck’s hours, booking" onClick={() => open("gt3-open-concierge")} />}
        <Row title="Connect with GT3" sub="Links, socials & a code to scan" onClick={() => open("gt3-open-connect")} />
        <Row title="Display & text size" sub="Bigger text, bold, roomier spacing" onClick={() => open("gt3-open-display")} />
      </div>
    </>
  );
}

/** The rows only some people have, read when the menu opens: the office company they belong to (0355: a member reads
 *  their own membership), an operator agreement made out to them (0277), an offer letter sent to them (0281). Asked
 *  once the profile is known — an admin reads every offer and agreement, so theirs is asked for by name, and an
 *  unknown profile might be an admin's. A read that fails is never "you have none": this menu is the only door to
 *  those pages in the app, so the menu says it couldn't check, and checks again on a tap. */
type Own = { office: boolean; agreement: boolean; offer: boolean; failed: boolean };
function useOwnRows(userId: string | null, access: Access, admin: boolean): Own & { retry: () => void } {
  const [own, setOwn] = useState<Own>({ office: false, agreement: false, offer: false, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!supabase || !userId || (access !== "allow" && access !== "deny")) return;
    let live = true;
    const sb = supabase;
    const staff = access === "allow";
    // Anyone else sees only their own (RLS), matched on the account or — before they link it — on the email it was sent to.
    let offers = sb.from("offer_letters").select("id").in("status", ["sent", "countered", "accepted"]).limit(1);
    if (admin) offers = offers.eq("candidate_user_id", userId);
    void Promise.all([
      sb.from("company_members").select("id").eq("user_id", userId).eq("active", true).limit(1),
      staff ? sb.from("operator_agreements").select("id").eq("operator_user_id", userId).limit(1) : Promise.resolve({ data: [], error: null }),
      offers,
    ]).then(([m, a, o]) => {
      if (!live) return;
      setOwn({ office: !!m.data?.length, agreement: !!a.data?.length, offer: !!o.data?.length, failed: !!(m.error || a.error || o.error) });
    }, () => { if (live) setOwn((x) => ({ ...x, failed: true })); });
    return () => { live = false; };
  }, [userId, access, admin, attempt]);
  return { ...own, retry: () => setAttempt((n) => n + 1) };
}

export default function AccountSheet({ onClose, onEditProfile, onShowCard }: {
  onClose: () => void;
  onEditProfile: () => void;
  onShowCard: () => void;
}) {
  const { user, profile, profileStatus, signOut, refreshProfile } = useAuth();
  const { toast, reorder, nameOf } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  const role = roleOf(profile);
  // A profile still loading is not "member" (lib/access): the switch waits for it instead of vanishing.
  const access = staffAccess(!!user, profileStatus, profile);
  const staff = access === "allow";
  const admin = staff && canOf(profile).admin;
  const name = profile?.display_name || user?.email?.split("@")[0] || "Guest";
  const founding = !!profile?.founding_member;
  const card = cardOf(profile?.points);
  const credit = (profile?.credit_cents ?? 0) / 100;
  const photo = profile?.avatar_url || "";
  const own = useOwnRows(user?.id ?? null, access, admin);
  const ask = showsCommerce(surfaceOf(pathname));

  // Their last completed order — "Order again" repeats what they had, not what was voided or is still being made.
  const [last, setLast] = useState<Order | null>(null);
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("orders").select("*").eq("user_id", user.id).eq("status", "done").order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { if (data && data[0]) setLast(data[0] as Order); });
  }, [user]);

  const go = (href: string) => { onClose(); router.push(href); };
  const open = (event: string) => { onClose(); window.dispatchEvent(new Event(event)); };

  // "Delete account" swaps the menu for its own body under this same header (components/DeleteAccount), and Settings &
  // privacy and Help open in place the same way, with a way back.
  const [deleting, setDeleting] = useState(false);
  const [view, setView] = useState<"menu" | "settings" | "help">("menu");
  // Focus follows the swap (the tapped row is gone from the page): a sub-view lands on its way back, and the way back
  // lands on the row that opened it — for VoiceOver and a keyboard, as a pushed screen does.
  const backRef = useRef<HTMLButtonElement>(null);
  const cameFrom = useRef<string | null>(null);
  useEffect(() => {
    if (view === "menu") { if (cameFrom.current) document.querySelector<HTMLElement>(`[data-acs-row="${cameFrom.current}"]`)?.focus(); }
    else backRef.current?.focus();
  }, [view]);
  const openView = (v: "settings" | "help") => { cameFrom.current = v; setView(v); };

  const head = (title: string) => (
    <div className="acs-head">
      <span className="acs-head-t"><Gt3Mark tone="cream" /> {title}</span>
      <button type="button" className="isheet-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
    </div>
  );

  // DELETING STAYS ON SCREEN TO ITS END (2026-10-11, the review): the delete signs this phone out as soon as the server
  // has erased the account, and with no one signed in the sheet below turned into "Membership · Sign in" — taking the
  // last step with it: an account made with Apple whose Apple tokens could not be revoked from here is told how to end
  // Sign in with Apple in Settings, and that was never seen. So the delete is asked first, before Settings & privacy
  // and before the signed-out sheet.
  if (deleting) {
    return (
      <Sheet open onClose={onClose} label="Delete your account" header={head("Delete your account")} className="acs-sheet">
        <DeleteAccount staff={staff} onKeep={() => setDeleting(false)}
          onDeleted={() => { onClose(); signOut(); toast("Your account is deleted."); router.push("/"); }} />
      </Sheet>
    );
  }

  if (!user) {
    return (
      <Sheet open onClose={onClose} label="Membership" header={head("Membership")} className="acs-sheet">
        <div className="acs-guest">
          <div className="acs-guest-t">Stamps · order ahead · reserves</div>
          <p>Sign in to earn stamps, track your orders, and carry your GT3 member card.</p>
          {/* A returning member lands on "Welcome back", not on the join pitch (the account audit, #13). */}
          <Button type="button" kind="primary" wide onClick={() => go("/3mpire?signin")}>Sign in</Button>
          <button type="button" className="auth-link min-h-11 mt-1 inline-flex items-center" onClick={() => go("/3mpire")}>New here? Join free</button>
        </div>
        <GuestRows onClose={onClose} />
      </Sheet>
    );
  }

  if (view !== "menu") {
    const back = <button ref={backRef} type="button" className="btn-ter mb-1" aria-label="Back to Your account" onClick={() => setView("menu")}><span aria-hidden="true">‹</span> Your account</button>;
    return (
      <Sheet open onClose={onClose} label={view === "settings" ? "Settings & privacy" : "Help"} header={head(view === "settings" ? "Settings & privacy" : "Help")} className="acs-sheet">
        {back}
        {view === "settings" ? (
          <div className="acs-rows">
            <Row title="Profile" sub={staff ? "Photo, name, title and bio" : "Photo and name"} onClick={() => onEditProfile()} />
            {/* One screen for every kind (R6, components/NotificationsSheet) — there is always something to switch now. */}
            <Row title="Notifications" sub="Order updates, pickup reminders, truck live, texts" onClick={() => open("gt3-open-notifications")} />
            <Row title="Display & text size" sub="Bigger text, bold, roomier spacing" onClick={() => open("gt3-open-display")} />
            {/* A3 of the account audit (2026-10-15): in the iPhone app, an account signed in with its email can take its
                Apple ID — Continue with Apple opens it from then on (components/AppleLink; the web has no Apple sheet). */}
            {APP_BUILD && isNativeApp() && !user.identities?.some((i) => i.provider === "apple") && (
              <Row title="Link Sign in with Apple" sub="Continue with Apple opens this account" onClick={() => open("gt3-link-apple")} />
            )}
            {/* App Store Review Guideline 5.1.1(v): deleting the account is in the account — Settings & privacy, the
                second level, on the web and in the app alike. */}
            <Row title="Delete account" sub="Your profile and details, for good" onClick={() => setDeleting(true)} />
          </div>
        ) : (
          <div className="acs-rows">
            {ask && <Row title="Ask us" sub="The menu, the truck’s hours, booking" onClick={() => open("gt3-open-concierge")} />}
            <Row title="Connect with GT3" sub="Links, socials & a code to scan" onClick={() => open("gt3-open-connect")} />
          </div>
        )}
      </Sheet>
    );
  }

  const usualNames = last ? last.items.map(nameOf).join(" · ") : "";
  // The card in lib/loyalty's words (C6): free cups READY — a redeemed one is gone from the count (0387).
  const stamps = card.free > 0 ? freeWords(card.free) : `${card.toNext} to a free cup`;
  // The crew side is every staff surface — the console, and the work pages (the run, the scan screen, the playbook) — so
  // Customer is a real choice from any of them (lib/surfaces).
  const side = surfaceOf(pathname) === "customer" ? "customer" : "crew";

  return (
    <Sheet open onClose={onClose} label="Your account" header={head("Your account")} className="acs-sheet">
      {/* Identity — who, which tier, how close to free — and the one way to the hub. */}
      <button type="button" className="acs-hero acs-hero-go" onClick={() => go("/3mpire")} aria-label="Open your member hub">
        <div className={`acs-av${photo ? " ph" : ""}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
          {!photo && <Coconut />}
        </div>
        <div className="acs-id">
          <div className="acs-name">{name}</div>
          <span className={`k-tag mt-1.5${founding ? " gold fill" : ""}`}>{founding ? <><Icon name="star" /> Founding Member</> : "Member"}</span>
          <div className="acs-line">{card.stamps}<i>/{STAMP_GOAL}</i> · {stamps}{credit > 0 ? ` · $${credit % 1 === 0 ? credit.toFixed(0) : credit.toFixed(2)} credit at the window` : ""}</div>
        </div>
        <span className="acs-row-c" aria-hidden>›</span>
      </button>

      {/* Which side of GT3 — for the crew, a switch, not a row (lib/mode remembers it, so most days it isn't needed).
          While the profile loads it holds its place, so nothing jumps and no one is told they aren't crew. */}
      {staff ? (
        <Segmented label="Which side of GT3" kind="choice" fill value={side}
          options={[{ key: "customer", label: "Customer" }, { key: "crew", label: "Crew" }]}
          onChange={(k) => { rememberMode(k); go(k === "crew" ? "/crew" : "/"); }} />
      ) : access === "wait" ? <div className="h-9" aria-hidden="true" /> : access === "failed" ? (
        // The profile didn't load: say that, and offer it again — never read it as "not crew" (lib/access).
        <div className="acs-rows mb-0"><Row title="Couldn’t load your account" sub="Tap to try again" end="↻" onClick={() => void refreshProfile()} /></div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tile icon="qr" title="Show card" sub="Scan at the window" disabled={!profile} onClick={() => { onClose(); onShowCard(); }} />
        {last
          ? <Tile icon="repeat" title="Order again" sub={usualNames} onClick={() => { reorder(last.items); onClose(); }} />
          : <Tile icon="coffee" title="See the menu" sub="Order ahead" onClick={() => go("/menu")} />}
      </div>

      <div className="acs-rows mt-2">
        <Row title="Orders" sub="Active, history and receipts" onClick={() => go("/3mpire#orders")} />
        <Row title="Rewards" sub="Stamps, free cups · give $5 get $5" onClick={() => go("/3mpire#rewards")} />
        {own.office && <Row title="Your office" sub="Deliveries, changes and invoices" onClick={() => go("/office")} />}
        {/* An agreement or an offer is a personal document about this person's own terms, so it belongs beside their
            profile rather than inside the crew console — and only for someone who has one. */}
        {own.agreement && <Row title="Your agreement" sub="What you agreed to, what it pays, and signing" onClick={() => go("/agreement")} />}
        {own.offer && <Row title="Your offer letter" sub="Your offer from GT3" onClick={() => go("/offer")} />}
        {own.failed && <Row title="Couldn’t check your other pages" sub="Your office, agreement or offer — tap to try again" end="↻" onClick={own.retry} />}
        <Row title="Settings & privacy" row="settings" sub="Profile · notifications · display · delete account" onClick={() => openView("settings")} />
        <Row title="Help" row="help" sub={ask ? "Ask us · connect with GT3" : "Connect with GT3"} onClick={() => openView("help")} />
      </div>

      {role === "owner" && <OwnerRows />}

      <button type="button" className="btn-del mt-1" onClick={() => { onClose(); void signOutHere(signOut); toast("Signed out"); }}>Sign out</button>
    </Sheet>
  );
}
