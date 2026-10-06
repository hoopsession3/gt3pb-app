"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import Icon from "@/components/Icon";
import { InfoRow } from "@/components/kit";
import { roleLabel, type Role } from "@/lib/roles";
import { useCrew } from "./useCrew";

// INVITE A TEAMMATE (0221) — the onboarding path for a team going 2 → 5. The owner invites an email
// WITH a role; the moment that person signs up (magic link or password, any device), the signup
// trigger claims the invite and lands them in the right role — no more "sign up, then wait for me to
// find you in the roster." Owner-only (an invite is a role assignment).
type Invite = { id: string; email: string; role: string; created_at: string; claimed_at: string | null };
// Which roles you can INVITE somebody into. Member is absent because nobody is invited to be a
// customer — they sign up — and owner because making another owner is a deliberate act in the
// roster, not a line in an invite. The hints are this form's own copy; the names are not, so they
// come from lib/roles. This list used to spell it "Event manager" while the team console and the
// org chart spelled it "Event Manager".
//
// NOTE for whoever touches this next: three surfaces answer "which roles can I put someone in?"
// with three different lists — this one, HIRE_ROLES in the team console (no admin) and
// OFFERABLE_ROLES in lib/offerLetter (includes member). Inviting, hiring and offering are
// arguably different questions, so they are NOT consolidated here; but the team console excluding
// admin while this form includes it is an inconsistency somebody decided by accident, and it is
// Ryan's call which is right, not a sweep's.
const INVITABLE: { v: Role; hint: string }[] = [
  { v: "server", hint: "service & delivery" },
  { v: "contractor", hint: "service, prep & gear" },
  { v: "operator", hint: "+ brew & pipeline" },
  { v: "event_manager", hint: "leadership" },
  { v: "admin", hint: "everything but ownership" },
];

export default function InviteTeammate() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("server");
  const [busy, setBusy] = useState(false);
  // AN INVITE TO SOMEONE WHO ALREADY HAS AN ACCOUNT NEVER ARRIVES (2026-10-04, the form audit).
  // handle_new_user claims invites at sign-up only (0280), so an invite for an existing account sits
  // "waiting" forever while the owner wonders why. The email is looked up first: an account that is
  // already crew is said so; a customer's account is offered the door that works — Bring them onto
  // the crew (?promote=, the same link a customer's card uses).
  const crew = useCrew();
  const [hasAccount, setHasAccount] = useState<{ email: string; id: string; crewRole: string | null } | null>(null);
  // Swallowed error → [] → "no invites yet", which reads as "nobody has been invited" to an owner
  // who invited three people this morning and is wondering why none of them can sign in.
  const loader = useCallback(async (): Promise<Invite[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("team_invites").select("id, email, role, created_at, claimed_at").order("created_at", { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return (data as Invite[]) ?? [];
  }, []);
  const state = useAsyncData(loader, []);
  const invites = state.data ?? [];
  const load = state.reload;
  useRealtimeTable("team_invites", load);

  const invite = async () => {
    if (!supabase || busy) return;
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast("Enter a real email", "error"); return; }
    setBusy(true);
    setHasAccount(null);
    // customers.email_norm is lower(btrim(email)) (0232); every account has its row (0246/0280). A
    // failed lookup is not "no account": the invite goes ahead as it always did, and says it could
    // not check.
    const { data: acct, error: lookErr } = await supabase.from("customers").select("user_id").eq("email_norm", em).not("user_id", "is", null).limit(1);
    const uid = ((acct as { user_id: string | null }[] | null) ?? [])[0]?.user_id ?? null;
    if (uid) {
      setBusy(false);
      setHasAccount({ email: em, id: uid, crewRole: crew.find((c) => c.id === uid)?.role ?? null });
      return;
    }
    const { error } = await supabase.from("team_invites").insert({ email: em, role, invited_by: user?.id ?? null });
    setBusy(false);
    if (error) { toast(`Couldn't invite — ${error.message}`, "error"); return; }
    setEmail("");
    toast(`Invited ${em} as ${role.replace("_", " ")} — when they sign up with that email, they land in the role automatically.${lookErr ? " (Couldn't check whether that email already has an account — if it does, bring them on from the roster instead.)" : ""}`);
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
          {INVITABLE.map((r) => <option key={r.v} value={r.v}>{roleLabel(r.v)} — {r.hint}</option>)}
        </select>
        {/* The .btn-pri of its panel: inviting is the actual commit action (the write that lets a
            future sign-up auto-claim its role). It lived on Team, where nothing else had a primary
            action; since 2026-10-06 (the settings round) it is Settings › Business › Team & permissions › Invite a
            teammate, and the roster — where a role is changed — stayed on Team. Was .note-save (the
            legacy crew-console primary look, copy-pasted from .adm-btn.primary — see globals.css
            ~653) — now the documented kit tier. .tinv-form is already flex-wrap, so the full-width
            button drops to its own line under the email/role inputs, same as Studio's
            .studio-pub-row full-width-primary pattern. */}
        <button type="button" className="btn-pri" onClick={invite} disabled={busy}>{busy ? "…" : "Invite"}</button>
      </div>
      {hasAccount && (
        <p className="tinv-hint" role="status">
          {hasAccount.crewRole
            ? <>{hasAccount.email} is already on the crew as {roleLabel(hasAccount.crewRole)} — change their role on Team&rsquo;s roster.</>
            : <>{hasAccount.email} already has an account, and an invite only reaches someone when they sign up — so it would never arrive.{" "}
                <a href={`/crew?s=team&promote=${hasAccount.id}`}>Bring them onto the crew now ›</a></>}
        </p>
      )}
      <p className="tinv-hint">They sign up at app.gt3pb.com with this email — any sign-in method — and land in their role instantly. If they already have an account, bring them on from Team&rsquo;s roster instead.</p>
      {/* Each invite is a kit InfoRow: email → name, role (already a small pill — unchanged
          .tinv-role) → nameExtra, waiting/joined status (already plain text — unchanged .tinv-wait/
          .tinv-ok) → meta, revoke → trailing. .tinv-list keeps its own flex/gap + dim classes
          (WorkloadBoard right below uses the identical combo, className="wl k-rows"); k-rows only
          adds the "no hairline under the last row" rule. Revoke moves from a bare icon button to
          .btn-ter — a lower-emphasis, undo-flavored tier (the same one OfficeOrders uses for
          "Cancel") — with a visible label added since every other .btn-ter in the app carries text,
          not just an icon. No data fetching, state, or conditions below changed — presentation only. */}
      {state.status === "error" && (
        <p className="load-failed" role="status">
          Couldn&apos;t load the invites you&apos;ve sent — this is not &ldquo;none&rdquo;.{" "}
          <button type="button" className="btn-ter" onClick={() => load()}>Try again</button>
        </p>
      )}
      {open.length > 0 && (
        <div className="tinv-list k-rows">
          {open.map((i) => (
            <InfoRow
              key={i.id}
              name={<span style={{ overflowWrap: "anywhere" }}>{i.email}</span>}
              nameExtra={<span className="tinv-role">{i.role.replace("_", " ")}</span>}
              meta={<span className="tinv-wait">waiting</span>}
              trailing={<button type="button" className="btn-ter" onClick={() => revoke(i)} aria-label={`Revoke invite for ${i.email}`}><Icon name="close" /> Revoke</button>}
            />
          ))}
        </div>
      )}
      {claimed.length > 0 && (
        <div className="tinv-list dim k-rows">
          {claimed.map((i) => (
            <InfoRow
              key={i.id}
              name={<span style={{ overflowWrap: "anywhere" }}>{i.email}</span>}
              nameExtra={<span className="tinv-role">{i.role.replace("_", " ")}</span>}
              meta={<span className="tinv-ok"><Icon name="check" /> joined</span>}
            />
          ))}
        </div>
      )}
    </div>
  );
}
