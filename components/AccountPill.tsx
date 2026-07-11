"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import AccountSheet from "./AccountSheet";
import ProfileSheet from "./ProfileSheet";
import StatusCard from "./StatusCard";

// Top-right account avatar → the customer account popout (AccountSheet, the canonical LV Sheet).
// The coconut mark (GT3's whole-coconut hydration) shows until they save a photo, then it's their
// portrait everywhere; the bronze caret signals "there's more here." One tap opens the things that
// matter to them — rewards, reorder, their member card — reachable from any page.

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

export default function AccountPill() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  return (
    <div className="acct">
      <button className="acct-av" aria-label="Your account" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {profile?.avatar_url ? <span className="acct-photo" style={{ backgroundImage: `url(${profile.avatar_url})` }} /> : <Coconut />}
        <span className="acct-caret" aria-hidden="true">
          <svg viewBox="0 0 10 10" width="8" height="8"><path d="M2 4l3 3 3-3" fill="none" stroke="#1a1310" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </button>
      {open && (
        <AccountSheet
          onClose={() => setOpen(false)}
          onEditProfile={() => { setOpen(false); setEditProfile(true); }}
          onShowCard={() => setCardOpen(true)}
        />
      )}
      {editProfile && <ProfileSheet onClose={() => setEditProfile(false)} />}
      <StatusCard open={cardOpen} onClose={() => setCardOpen(false)} />
    </div>
  );
}
