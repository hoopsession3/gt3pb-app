"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import { useRealtimeTable } from "@/lib/realtime";
import { roleLabel, type Role } from "@/lib/roles";
import { FOUNDING_MARKET } from "@/lib/markets";
import { authedFetch } from "@/lib/authedFetch";
import Icon from "@/components/Icon";
import Button from "./Button";

// ADD A TEAMMATE — ONE DOOR (2026-10-07, Ryan: "Invite and bring team member on seems redundant").
//
// There were two: "Bring someone onto the crew" on Team's roster (someone who already has an account
// — promote_to_crew) and "Invite a teammate" in Settings (an email that has none yet — team_invites,
// claimed at sign-up). An owner had to know which of the two the person was before choosing a door,
// and the invite form's own answer to the wrong choice was a link to the other door. Now there is one
// box: type a name or an email. Someone with an account is brought on — role, city, and the city they
// lead; an email with no account is invited — the role waits for them. The roster is right below it.
//
// AND THEY HEAR ABOUT IT (Ryan: "When brought on, a GT3 welcome letter should come"). Either way a
// letter goes out — the welcome (their role, city, who leads it, the first three steps, their Academy
// path) or the invite (who invited them, the role waiting, sign up with this email). It is sent and
// recorded by app/api/team/welcome, and what the provider said is what this screen says: "sent to …"
// or why it could not — never a letter claimed that did not go.
//
// Everything the two doors did, this does: the city starts as theirs, else yours, else the founding
// market (not Atlanta by the alphabet); a customer's card arrives with them picked (?promote=, read
// by Team and handed in as promoteFor); after a bring-on, the offer letter and the Academy path open
// for them; an email that already has an account is brought on rather than invited into a void; an
// open invite can be sent again or cancelled.

type Person = { id: string; display_name: string | null; email: string | null; customer_name: string | null; market: string | null };
type Invite = { id: string; email: string; role: string; created_at: string; claimed_at: string | null };
export type Letter = { sent: boolean; to?: string; detail?: string | null };

// What an owner can make someone, with this door's one-line hint. Owner is absent — making another
// owner is done on the roster, deliberately — and member, because nobody is brought on as a customer.
// One list for both paths (the two doors had two, and the bring-on one left out admin by accident):
// admin_set_role is the rule for who may grant what, and it is an owner pressing this.
const CREW_ROLES: { v: Role; hint: string }[] = [
  { v: "server", hint: "service & delivery" },
  { v: "contractor", hint: "service, prep & gear" },
  { v: "operator", hint: "+ brew & pipeline" },
  { v: "event_manager", hint: "leadership" },
  { v: "admin", hint: "everything but ownership" },
];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const nameOf = (p: Person) => p.display_name || p.customer_name || "this person";

// A picked row can sit below sections that are still arriving; keep it in view until it settles.
function keepInView(ref: { current: HTMLElement | null }, tries = 12) {
  let n = 0;
  const tick = () => {
    const el = ref.current;
    if (!el || n++ >= tries) return;
    try {
      const r = el.getBoundingClientRect();
      if (r.top > 40 && r.bottom < window.innerHeight) return;
      el.scrollIntoView({ behavior: "auto", block: "center" });
    } catch { return; }
    setTimeout(tick, 130);
  };
  requestAnimationFrame(tick);
}

/** The letter's one sender: this door, and the person's record when an owner sends it again (components/CrewPerson). */
export async function sendLetter(body: { kind: "bring_on"; user_id: string } | { kind: "invite"; email: string }): Promise<Letter> {
  try {
    const r = await authedFetch("/api/team/welcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null) as { ok?: boolean; sent?: boolean; to?: string; detail?: string | null; error?: string } | null;
    if (!r.ok || !j?.ok) return { sent: false, detail: j?.error ?? `the server said ${r.status}` };
    return { sent: !!j.sent, to: j.to, detail: j.detail ?? null };
  } catch {
    return { sent: false, detail: "couldn't reach the server" };
  }
}

export default function AddTeammate({ promoteFor, onDone }: { promoteFor: string | null; onDone: () => void }) {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(() => !!promoteFor);
  const [people, setPeople] = useState<Person[]>([]);
  const [markets, setMarkets] = useState<{ slug: string; name: string }[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPickRaw] = useState<string | null>(null);   // a person, by profile id
  const [inviting, setInviting] = useState<string | null>(null); // an email with no account
  const [role, setRole] = useState<Role>("operator");
  const [marketChosen, setMarketChosen] = useState<string | null>(null);
  const [lead, setLead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: "bring_on"; id: string; name: string; role: string; city: string; lead: boolean; letter: Letter } | { kind: "invite"; email: string; role: string; letter: Letter } | null>(null);
  const wanted = useRef<string | null>(promoteFor);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const setPick = (id: string | null) => { setPickRaw(id); setInviting(null); setMarketChosen(null); };

  const picked = pick ? people.find((p) => p.id === pick) ?? null : null;
  // THE CITY STARTS AS THEIRS (2026-10-04, the form audit): their profile's city, else yours, else the
  // founding market — choosing one makes it yours until someone else is picked.
  const market = marketChosen
    ?? [picked?.market, profile?.market, FOUNDING_MARKET].find((m) => !!m && markets.some((x) => x.slug === m))
    ?? markets[0]?.slug ?? "";
  const cityName = (slug: string) => markets.find((m) => m.slug === slug)?.name || slug;

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [pp, mk, inv] = await Promise.all([
      supabase.from("v_promotable").select("id, display_name, email, customer_name, market"),
      supabase.from("markets").select("slug, name").order("slug"),
      supabase.from("team_invites").select("id, email, role, created_at, claimed_at").order("created_at", { ascending: false }).limit(20),
    ]);
    setLoading(false);
    // A failed read is said, never shown as "nobody to add" or "no invites".
    setLoadErr(pp.error?.message ?? mk.error?.message ?? inv.error?.message ?? null);
    const list = (pp.data as Person[]) ?? [];
    setPeople(list);
    setMarkets((mk.data as { slug: string; name: string }[]) ?? []);
    setInvites((inv.data as Invite[]) ?? []);
    // Arrived from a customer's card with someone named: pick them at the one moment the list is here.
    const w = wanted.current;
    if (w) {
      wanted.current = null;
      if (list.some((p) => p.id === w)) { setPickRaw(w); setInviting(null); setMarketChosen(null); keepInView(boxRef); }
      else toast("They are already on the crew — change their role from the roster below.");
    }
  }, [toast]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useRealtimeTable("team_invites", load, { enabled: open });

  const ql = q.trim().toLowerCase();
  const matches = ql
    ? people.filter((p) => (p.display_name ?? "").toLowerCase().includes(ql) || (p.customer_name ?? "").toLowerCase().includes(ql) || (p.email ?? "").toLowerCase().includes(ql))
    : people;
  const emailTyped = EMAIL.test(ql) ? ql : null;
  // An email nobody in the list has: offered as an invite (checked again against every account on press).
  const inviteOffered = !!emailTyped && !people.some((p) => (p.email ?? "").toLowerCase() === emailTyped);
  const openInvites = invites.filter((i) => !i.claimed_at);
  const joined = invites.filter((i) => i.claimed_at).slice(0, 3);

  const bringOn = async () => {
    if (!supabase || !picked || busy) return;
    const name = nameOf(picked);
    const city = market ? cityName(market) : "";
    if (!(await confirm({ title: `Bring ${name} onto the crew as ${roleLabel(role)}?`, body: city ? `In ${city}${lead ? `, leading ${city}` : ""}. They get a GT3 welcome letter.` : "They get a GT3 welcome letter.", confirmLabel: "Bring them on" }))) return;
    setBusy(true);
    const { error } = await supabase.rpc("promote_to_crew", { p_member: picked.id, p_role: role, p_market: market || null, p_lead: lead });
    if (error) { setBusy(false); toast(`Couldn't bring ${name} on — ${error.message}`, "error"); return; }
    const letter = await sendLetter({ kind: "bring_on", user_id: picked.id });
    setBusy(false);
    setDone({ kind: "bring_on", id: picked.id, name, role: roleLabel(role), city, lead, letter });
    setPick(null); setLead(false); setQ("");
    load(); onDone();
  };

  const invite = async () => {
    if (!supabase || !inviting || busy) return;
    if (!(await confirm({ title: `Invite ${inviting} as ${roleLabel(role)}?`, body: "They get a letter telling them to sign up with this email — they land in the role the moment they do.", confirmLabel: "Send the invite" }))) return;
    setBusy(true);
    // AN INVITE TO SOMEONE WHO ALREADY HAS AN ACCOUNT NEVER ARRIVES (2026-10-04, the form audit):
    // invites are claimed at sign-up only. customers.email_norm finds an account by its email —
    // a customer's is brought on instead; someone already on the crew is said so.
    // A failed lookup is not "no account": the invite goes ahead, and says it could not check.
    const { data: acct, error: lookErr } = await supabase.from("customers").select("user_id").eq("email_norm", inviting).not("user_id", "is", null).limit(1);
    const uid = ((acct as { user_id: string | null }[] | null) ?? [])[0]?.user_id ?? null;
    if (uid) {
      setBusy(false);
      if (people.some((p) => p.id === uid)) { setPick(uid); toast("They already have an account — bring them on instead."); }
      else toast(`${inviting} is already on the crew — change their role on the roster below.`);
      return;
    }
    const { error } = await supabase.from("team_invites").insert({ email: inviting, role, invited_by: user?.id ?? null });
    if (error) { setBusy(false); toast(`Couldn't invite — ${error.message}`, "error"); return; }
    const letter = await sendLetter({ kind: "invite", email: inviting });
    setBusy(false);
    setDone({ kind: "invite", email: inviting, role: roleLabel(role), letter });
    if (lookErr) toast("Couldn't check whether that email already has an account — if it does, bring them on from this box instead.", "error");
    setInviting(null); setQ("");
    load();
  };

  const resend = async (i: Invite) => {
    const letter = await sendLetter({ kind: "invite", email: i.email });
    toast(letter.sent ? `Invite letter sent to ${i.email}` : `Couldn't send it — ${letter.detail ?? "unknown"}`, letter.sent ? undefined : "error");
  };
  const cancel = async (i: Invite) => {
    if (!supabase) return;
    if (!(await confirm({ title: `Cancel the invite for ${i.email}?`, body: "If they sign up later, they arrive as a customer.", confirmLabel: "Cancel invite", danger: true }))) return;
    const { error } = await supabase.from("team_invites").delete().eq("id", i.id);
    if (error) toast(`Couldn't cancel — ${error.message}`, "error");
    load();
  };

  const letterLine = (l: Letter, what: string) => l.sent
    ? <>{what} sent to {l.to}.</>
    : <>The {what.toLowerCase()} couldn&rsquo;t send{l.detail ? ` — ${l.detail}` : ""}.</>;

  return (
    <div className="tm-hire" id="tm-hire" ref={boxRef}>
      <button type="button" className="tm-hire-open" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="plus" /> {picked ? `Bring ${nameOf(picked)} onto the crew` : "Add a teammate"}
        <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="tm-hire-body">
          {done?.kind === "bring_on" && (
            <div className="tm-hired" role="status">
              <b>{done.name} is on the crew.</b> {done.role}{done.city ? ` · ${done.city}` : ""}{done.lead ? " · leads the city" : ""}. {letterLine(done.letter, "Welcome letter")}
              <div className="tm-hired-next">
                <a className="tm-hire-open" href={`/crew?s=money&a=offers&offer_for=${done.id}`}>
                  Draft their offer letter <span className="ev-chev" aria-hidden="true">›</span>
                </a>
                <a className="tm-hire-open" href={`/academy?assign=${done.id}`}>
                  Their Academy path is live — see what {done.name.split(" ")[0]} has to complete <span className="ev-chev" aria-hidden="true">›</span>
                </a>
              </div>
              <button type="button" className="note-arch tm-again" onClick={() => setDone(null)}>Add someone else</button>
            </div>
          )}
          {done?.kind === "invite" && (
            <div className="tm-hired" role="status">
              <b>{done.email} is invited as {done.role}.</b> {letterLine(done.letter, "Invite letter")}{" "}
              {!done.letter.sent && <>Tell them to sign up at app.gt3pb.com with that email — they land in the role.</>}
              <button type="button" className="note-arch tm-again" onClick={() => setDone(null)}>Add someone else</button>
            </div>
          )}
          {loadErr && (
            <p className="load-failed" role="status">Couldn&apos;t load who can be added — this is not &ldquo;nobody&rdquo;. <button type="button" className="btn-ter" onClick={() => load()}>Try again</button></p>
          )}
          {!done && (picked || inviting ? (
            <>
              <div className="tm-hire-chosen">
                <span>
                  <b>{picked ? nameOf(picked) : inviting}</b>
                  <i>{picked ? (picked.email || "no email on file") : "no account yet — they'll get an invite"}</i>
                </span>
                <button type="button" className="note-arch" onClick={() => { setPick(null); setQ(""); }}>Someone else</button>
              </div>
              <div className="tm-hire-form">
                <label>Role
                  <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    {CREW_ROLES.map((r) => <option key={r.v} value={r.v}>{roleLabel(r.v)} — {r.hint}</option>)}
                  </select>
                </label>
                {picked && (
                  <>
                    <label>City
                      <select value={market} onChange={(e) => setMarketChosen(e.target.value)}>
                        {markets.map((m) => <option key={m.slug} value={m.slug}>{m.name || m.slug}</option>)}
                      </select>
                    </label>
                    {/* Leading a city requires operator or above — the rule set_market_lead enforces. */}
                    <label className="adm-check">
                      <input type="checkbox" checked={lead} disabled={!["operator", "event_manager"].includes(role)} onChange={(e) => setLead(e.target.checked)} />
                      Leads this city
                    </label>
                  </>
                )}
                <Button type="button" kind="primary" className="ml-auto" onClick={picked ? bringOn : invite} disabled={busy}>
                  {busy ? "…" : picked ? `Bring ${nameOf(picked).split(" ")[0]} on` : "Send the invite"}
                </Button>
              </div>
              <p className="tm-hire-next">
                {picked
                  ? "Sets their role and city now, and sends their GT3 welcome letter. Their offer letter and Academy path come next."
                  : "Saves the invite and sends them a letter: sign up at app.gt3pb.com with this email, and they land in the role."}
              </p>
            </>
          ) : (
            <>
              <input className="auth-input" placeholder="Name or email" aria-label="Name or email of the person to add" autoComplete="off"
                     value={q} onChange={(e) => setQ(e.target.value)} />
              {loading && <div className="h-sub">Loading…</div>}
              {!loading && (
                <div className="tm-hire-list">
                  {inviteOffered && (
                    <button type="button" className="tm-hire-row invite" onClick={() => { setPickRaw(null); setInviting(emailTyped); }}>
                      <b>Invite {emailTyped}</b>
                      <i>no account yet — they get a letter to sign up</i>
                    </button>
                  )}
                  {matches.slice(0, 30).map((p) => (
                    <button key={p.id} type="button" className="tm-hire-row" onClick={() => setPick(p.id)}>
                      <b>{p.display_name || p.customer_name || "Unnamed"}</b>
                      <i>{p.email || "no email on file"}</i>
                    </button>
                  ))}
                  {ql && !inviteOffered && matches.length === 0 && (
                    <div className="h-sub">No account matches &ldquo;{q}&rdquo; — type their email to invite them.</div>
                  )}
                  {!ql && people.length === 0 && <div className="h-sub">Everyone with an account is on the crew — type an email to invite someone new.</div>}
                </div>
              )}
            </>
          ))}
          {(openInvites.length > 0 || joined.length > 0) && (
            <div className="tm-invites">
              <div className="tm-invites-h">Invites</div>
              {openInvites.map((i) => (
                <div key={i.id} className="tm-invite">
                  <span><b>{i.email}</b><i>{roleLabel(i.role)} · waiting for them to sign up</i></span>
                  <button type="button" className="btn-ter" onClick={() => resend(i)}>Send again</button>
                  <button type="button" className="btn-ter" onClick={() => cancel(i)} aria-label={`Cancel the invite for ${i.email}`}>Cancel</button>
                </div>
              ))}
              {joined.map((i) => (
                <div key={i.id} className="tm-invite joined">
                  <span><b>{i.email}</b><i>{roleLabel(i.role)} · joined</i></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
