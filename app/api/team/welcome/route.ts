import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ownerFromRequest, tenantFromRequest, userFromRequest } from "@/lib/apiAuth";
import { accountEmail } from "@/lib/notify";
import { tellCustomer } from "@/lib/customerMessage";
import { crewWelcome, crewInvite } from "@/lib/crewWelcome";
import { trackFor } from "@/lib/academy";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// THE GT3 WELCOME LETTER, SENT (2026-10-07, Ryan: "When brought on, a GT3 welcome letter should come").
//
//   { kind: "bring_on", user_id }  — after promote_to_crew: the letter to the person just brought on.
//   { kind: "invite", email }      — after an invite is saved: the letter telling them to sign up.
//
// Owner-only, like the door that calls it (bringing someone on and inviting are an owner's). It can
// only ever write to someone the owner just acted on, in the owner's own company: a bring-on letter
// goes to a crew member of this tenant, and an invite letter only to an email with an open invite
// here — so this is not a way to send mail to an arbitrary address. Every send is recorded in
// customer_messages through lib/customerMessage (the send and the record are one call), and the
// provider's verdict comes back to the screen, which says it instead of claiming a letter went.
// A second press inside two minutes is the same press: it answers "sent" without sending twice.
async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "only an owner brings people onto the crew" }, { status: 401 });
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401 });

  let kind = "", userId = "", email = "";
  try { ({ kind = "", user_id: userId = "", email = "" } = await req.json()); } catch { /* */ }
  if (kind !== "bring_on" && kind !== "invite") return NextResponse.json({ ok: false, error: "kind is bring_on or invite" }, { status: 400 });

  const me = await userFromRequest(req);
  // scoped-by: the caller's own profile, read by their verified id
  const { data: mine } = await supabaseAdmin.from("profiles").select("display_name").eq("id", me?.id ?? "").eq("tenant_id", tenant).maybeSingle();
  const from = (mine as { display_name?: string | null } | null)?.display_name ?? null;

  let to = "", letter: { subject: string; message: string };
  if (kind === "bring_on") {
    if (!userId) return NextResponse.json({ ok: false, error: "user_id required" }, { status: 400 });
    const { data: p } = await supabaseAdmin.from("profiles")
      .select("id, display_name, role, market, leads_market").eq("tenant_id", tenant).eq("id", userId).maybeSingle();
    const person = p as { id: string; display_name: string | null; role: string; market: string | null; leads_market: string | null } | null;
    if (!person) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (person.role === "member") return NextResponse.json({ ok: false, error: "they are not on the crew yet" }, { status: 409 });
    to = (await accountEmail(person.id)) ?? "";
    // scoped-by: markets are shared reference rows; the lead is read inside this tenant
    const { data: m } = person.market
      ? await supabaseAdmin.from("markets").select("name").eq("slug", person.market).maybeSingle()
      : { data: null };
    const { data: lead } = person.market && person.leads_market !== person.market
      ? await supabaseAdmin.from("profiles").select("display_name").eq("tenant_id", tenant).eq("leads_market", person.market).neq("id", person.id).maybeSingle()
      : { data: null };
    letter = crewWelcome({
      name: person.display_name, role: person.role,
      city: (m as { name?: string } | null)?.name ?? null,
      leadsCity: !!person.market && person.leads_market === person.market,
      cityLead: (lead as { display_name?: string | null } | null)?.display_name ?? null,
      track: trackFor(person.role), from,
    });
  } else {
    const em = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return NextResponse.json({ ok: false, error: "a real email is needed" }, { status: 400 });
    const { data: inv } = await supabaseAdmin.from("team_invites")
      .select("email, role").eq("tenant_id", tenant).eq("email", em).is("claimed_at", null).limit(1).maybeSingle();
    if (!inv) return NextResponse.json({ ok: false, error: "no open invite for that email" }, { status: 404 });
    to = em;
    letter = crewInvite({ email: em, role: (inv as { role: string }).role, from });
  }
  if (!to.includes("@")) return NextResponse.json({ ok: true, sent: false, detail: "no email address on their account" });

  // The same letter to the same person inside two minutes is a double tap, not a second letter.
  const kindKey = kind === "bring_on" ? "crew_welcome" : "crew_invite";
  // scoped-by: tenant_id
  const { data: recent } = await supabaseAdmin.from("customer_messages").select("id")
    .eq("tenant_id", tenant).eq("kind", kindKey).eq("to_address", to).eq("status", "sent")
    .gte("created_at", new Date(Date.now() - 120_000).toISOString()).limit(1);
  if (recent && recent.length) return NextResponse.json({ ok: true, sent: true, to, again: true });

  const sent = await tellCustomer({ orderId: null, email: to, kind: kindKey, sentBy: me?.id ?? null, ...letter });
  return NextResponse.json({ ok: true, sent: sent.ok, to, detail: sent.ok ? null : (sent.detail ?? (sent.email === "off" ? "email isn't switched on yet" : null)) });
}

export const POST = route("team/welcome", post);
