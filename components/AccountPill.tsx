"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

// Top-right account pill for the anonymous-browseable screens. Shows the signed-in
// member's initial, or a neutral person icon when signed out. Links to /3mpire.
export default function AccountPill() {
  const { user, profile } = useAuth();
  const initial = (profile?.display_name || user?.email || "").trim().charAt(0).toUpperCase();
  return (
    <Link className="pf" href="/3mpire" aria-label="Account">
      {initial || (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      )}
    </Link>
  );
}
