"use client";

import { useAuth, roleOf } from "./AuthProvider";
import { roleLabel } from "@/lib/roles";
import { AccountFace, useAccountDoor } from "./AccountPill";

// SETTINGS › YOU › ACCOUNT (2026-10-06, the settings-by-category round). The first row of Settings is
// the person: their face, their name and email, their role — and a tap opens the account menu, the
// same one the avatar on the customer pages opens (components/AccountPill: useAccountDoor). The row
// reads like the rows under it (a Panel header's parts: title, line, value, chevron), but it opens a
// sheet rather than unfolding, because the menu is a sheet everywhere else.
export default function AccountRow() {
  const { user, profile } = useAuth();
  const door = useAccountDoor();
  const name = profile?.display_name || user?.email?.split("@")[0] || "Guest";
  return (
    <div className="acct acct-rowwrap">
      <button type="button" className="mpanel-h acct-row" aria-haspopup="dialog" aria-expanded={door.open} onClick={door.openAccount}>
        <span className="acct-av" aria-hidden="true"><AccountFace /></span>
        <span className="mpanel-tt"><span className="mpanel-t">Account</span><span className="mpanel-s">{user?.email ? `${name} · ${user.email}` : name}</span></span>
        <span className="mpanel-v">{roleLabel(roleOf(profile))}</span>
        <span className="mpanel-chev" aria-hidden="true">›</span>
      </button>
      {door.sheets}
    </div>
  );
}
