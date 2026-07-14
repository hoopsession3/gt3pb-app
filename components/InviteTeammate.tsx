"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";

// INVITE A TEAMMATE (0221) — the onboarding path for a team going 2 → 5. The owner invites an email
// WITH a role; the moment that person signs up (magic link or password, any device), the signup
// trigger claims the invite and lands them in the right role — no more "sign up, then wait for me to
// find you in the roster." Owner-only (an invite is a role assignment).
type Invite = { id: string; email: string; role: string; created_at: string; claimed_at: string | null };
const ROLES: { v: string; l: string }[] = [
  { v: "server", l: "Server — service & delivery" },
  { v: "contractor", l: "Contractor — service, prep & gear" },
  { v: "operator", l: "Operator — + brew & pipeline" },
  { v: "event_manager", l: "Event manager — leadership" },
  { v: "admin", l: "Admin — everything but ownership" },
];

export default function InviteTeammate() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("server");
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("team_invites").select("id, email, role, created_at, claimed_at").order("created_at", { ascending: false }).limit(20);
    setInvites((data as Invite[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("team_invites", load);

  const invite = async () => {
    if (!supabase || busy) return;
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast("Enter a real email", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("team_invites").insert({ email: em, role, invited_by: user?.id ?? null });
    setBusy(false);
    if (error) { toast(`Couldn't invite — ${error.message}`, "error"); return; }
    setEmail("");
    toast(`Invited ${em} as ${role.replace("_", " ")} — when they sign up with that email, they land in the role automatically.`);
    load();
  };
  const revoke = async (i: Invite) => {
    if (!supabase) return;
    await supabase.from("team_invites").delete().eq("id", i.id);
    load();
  };

  const open = invites.filter((i) => !i.claimed_at);
  const claimed = invites.filter((i) => i.claimed_at).slice(0, 5);

  return (
    <div className="tinv">
      <div className="tinv-form">
        <input className="note-in tinv-email" type="email" inputMode="email" placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Teammate email" />
        <select className="note-in" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          {ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
        <button type="button" className="note-save" onClick={invite} disabled={busy}>{busy ? "…" : "Invite"}</button>
      </div>
      <p className="tinv-hint">They sign up at app.gt3pb.com with this email — any sign-in method — and land in their role instantly. If they already have an account, promote them in the roster below instead.</p>
      {open.length > 0 && (
        <div className="tinv-list">
          {open.map((i) => (
            <div className="tinv-row" key={i.id}>
              <span className="tinv-em">{i.email}</span>
              <span className="tinv-role">{i.role.replace("_", " ")}</span>
              <span className="tinv-wait">waiting</span>
              <button type="button" className="tinv-x" onClick={() => revoke(i)} aria-label={`Revoke invite for ${i.email}`}>✕</button>
            </div>
          ))}
        </div>
      )}
      {claimed.length > 0 && (
        <div className="tinv-list dim">
          {claimed.map((i) => (
            <div className="tinv-row" key={i.id}>
              <span className="tinv-em">{i.email}</span>
              <span className="tinv-role">{i.role.replace("_", " ")}</span>
              <span className="tinv-ok">✓ joined</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
