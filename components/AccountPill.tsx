"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";

// Top-right account avatar → a role-aware dropdown. The coconut mark (GT3's whole-
// coconut hydration) makes it jump out, and the bronze caret signals "there are options."
// Quick actions live here (reachable from any page); the full hub is the 3MPIRE tab.

const rawRole = (p: { role?: string | null; is_admin?: boolean } | null): string =>
  p?.role ?? (p?.is_admin ? "owner" : "member");
const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", admin: "Admin", event_manager: "Event manager",
  operator: "Operator", contractor: "Contractor", server: "Server", member: "Member",
};

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
  const { user, profile, signOut } = useAuth();
  const { toast } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const role = rawRole(profile);
  const staff = !!user && role !== "member";
  const name = profile?.display_name || user?.email || "Guest";
  const go = (href: string) => { setOpen(false); router.push(href); };

  return (
    <div className="acct" ref={ref}>
      <button className="acct-av" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Coconut />
        <span className="acct-caret" aria-hidden="true">
          <svg viewBox="0 0 10 10" width="8" height="8"><path d="M2 4l3 3 3-3" fill="none" stroke="#1a1310" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          {user ? (
            <>
              <div className="acct-who"><b>{name}</b><span>{ROLE_LABEL[role] ?? "Member"}</span></div>
              <button className="acct-item" role="menuitem" onClick={() => go("/3mpire")}>Your 3MPIRE</button>
              {staff && <button className="acct-item crew" role="menuitem" onClick={() => go("/admin")}>Switch to Crew Mode</button>}
              <button className="acct-item danger" role="menuitem" onClick={() => { setOpen(false); signOut(); toast("Signed out"); }}>Sign out</button>
            </>
          ) : (
            <>
              <div className="acct-who"><b>Not signed in</b><span>points · pours · reserves</span></div>
              <button className="acct-item" role="menuitem" onClick={() => go("/3mpire")}>Sign in</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
