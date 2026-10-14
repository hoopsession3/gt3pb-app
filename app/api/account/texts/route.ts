import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { sayTextConsent, sayTextYes } from "@/lib/notify";
import { e164, textsOn } from "@/lib/texts";
import { route } from "@/lib/apiRoute";

// TEXTS ON OR OFF, FROM THE ACCOUNT (2026-10-14, R5 — 0398 text_consents). The member's own switch (components/
// TextsSetting): a yes or a stop for a number their own orders or record carry, recorded with "account" as its place.
// A number that is not on any of their orders is refused — the switch is theirs, not a way to sign up someone else's
// phone. Only while texts are switched on (lib/texts textsOn).
async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not available yet." }, { status: 503 });
  if (!textsOn()) return NextResponse.json({ error: "Texts aren't switched on yet." }, { status: 409 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to change your texts." }, { status: 401 });

  let body: { phone?: unknown; on?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const num = e164(typeof body.phone === "string" ? body.phone : "");
  if (!num || typeof body.on !== "boolean") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // Theirs: the phone on their customer record, a pack or a delivery of theirs.
  const [cust, packs, dels] = await Promise.all([
    supabaseAdmin.from("customers").select("phone").eq("user_id", user.id).limit(5),
    supabaseAdmin.from("drop_orders").select("phone").eq("user_id", user.id).not("phone", "is", null).order("created_at", { ascending: false }).limit(20),
    supabaseAdmin.from("delivery_orders").select("phone").eq("user_id", user.id).not("phone", "is", null).order("created_at", { ascending: false }).limit(20),
  ]);
  const theirs = new Set([...(cust.data ?? []), ...(packs.data ?? []), ...(dels.data ?? [])].map((r) => e164((r as { phone?: string | null }).phone)).filter(Boolean));
  if (!theirs.has(num)) return NextResponse.json({ error: "That number isn't on your orders." }, { status: 403 });

  // On: a new yes is confirmed by text at once (R6, lib/notify sayTextYes). Off: recorded; the switch's own toast says it.
  const r = body.on ? await sayTextYes(num, "account", user.id) : await sayTextConsent(num, false, "account", user.id);
  if (!r.ok) return NextResponse.json({ error: "Couldn't change it just now — try again." }, { status: 502 });
  return NextResponse.json({ ok: true, on: r.standing === true });
}

export const POST = route("account/texts", post);
