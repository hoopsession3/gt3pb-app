"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import Icon from "./Icon";
import { showsCommerce, surfaceOf } from "@/lib/surfaces";
import dynamic from "next/dynamic";
// Loaded by the tap that opens them, not with every page that shows the avatar (2026-10-08, the iPhone chrome
// round): the account menu gained its Help & display rows, and it rode in every customer route's first load.
const AccountSheet = dynamic(() => import("./AccountSheet"), { ssr: false });
const ProfileSheet = dynamic(() => import("./ProfileSheet"), { ssr: false });
import MemberCard from "./MemberCard";

// Top-right account avatar → the customer account popout (AccountSheet, the canonical LV Sheet).
// The coconut mark (GT3's whole-coconut hydration) shows until they save a photo, then it's their
// portrait everywhere; the bronze caret signals "there's more here." One tap opens the things that
// matter to them — rewards, reorder, their member card — reachable from any page.
//
// TWO DOORS, ONE MENU (2026-10-06, the settings-by-category round). Settings' first row is the
// person's account, the way a phone's Settings opens on its owner, and the crew console has no
// avatar in its header. components/AccountRow draws that row with useAccountDoor and AccountFace
// from here — the same menu and sheets — and lives in its own file so the customer pages that carry
// this avatar do not carry the row.

function Coconut() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="#6b4226" />
      <path d="M5 10c2.2-2.4 11.8-2.4 14 0" stroke="#946239" strokeWidth="1.1" fill="none" opacity="0.7" />
      <circle cx="9.3" cy="10.4" r="1.3" fill="#2a1810" />
      <circle cx="14.7" cy="10.4" r="1.3" fill="#2a1810" />
      <circle cx="12" cy="14.3" r="1.3" fill="#2a1810" />
    </svg>
  );
}

/** The person's face: their photo once they have saved one, the coconut until then. */
export function AccountFace() {
  const { profile } = useAuth();
  return profile?.avatar_url ? <span className="acct-photo" style={{ backgroundImage: `url(${profile.avatar_url})` }} /> : <Coconut />;
}

/** The account menu and the two sheets it leads to — one wiring for every door into it (the avatar
 *  here, and Settings' Account row, components/AccountRow). */
export function useAccountDoor() {
  const [open, setOpen] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const sheets = (
    <>
      {open && (
        <AccountSheet
          onClose={() => setOpen(false)}
          onEditProfile={() => { setOpen(false); setEditProfile(true); }}
          onShowCard={() => setCardOpen(true)}
        />
      )}
      {editProfile && <ProfileSheet onClose={() => setEditProfile(false)} />}
      <MemberCard open={cardOpen} onClose={() => setCardOpen(false)} />
    </>
  );
  return { open, openAccount: () => setOpen(true), sheets };
}

export default function AccountPill() {
  const door = useAccountDoor();
  // ASK US, BESIDE YOU (2026-10-08, the iPhone chrome round, approved). On a phone the concierge's tab rode
  // the floating rail over the page; it is this button now, on the screens it answers for (the ones that
  // sell — lib/surfaces). The frame keeps the rail's tab and does not draw this one; the desk, which has no
  // rail (2026-10-09, redesign 5: /office), draws it here, as a phone does.
  const ask = showsCommerce(surfaceOf(usePathname()));
  return (
    <div className="acct flex items-center gap-2">
      {ask && (
        <button type="button" className="acct-av hit-44 text-gold2 frame:hidden! desk:flex!"
          aria-label="Ask us — the menu, the truck's hours, booking" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event("gt3-open-concierge"))}>
          <Icon name="chat" size={18} />
        </button>
      )}
      <button className="acct-av hit-44" aria-label="Your account" aria-haspopup="dialog" aria-expanded={door.open} onClick={door.openAccount}>
        <AccountFace />
        <span className="acct-caret" aria-hidden="true">
          <svg viewBox="0 0 10 10" width="8" height="8"><path d="M2 4l3 3 3-3" fill="none" stroke="#1a1310" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </button>
      {door.sheets}
    </div>
  );
}
