import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { etToday } from "@/lib/dates";
import { tokenOk } from "@/lib/webhookSignature";
import { route } from "@/lib/apiRoute";
import { createHash } from "node:crypto";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Inbound email → meeting note. notee (notee.ai) has no API, but its Share menu has
// "Share Text"; share that to Mail and send to this endpoint's address and the summary
// lands in the app as a note (source='email'), newest-first, ready to tag follow-ups.
//
// Provider-agnostic: most inbound-email services (Postmark, SendGrid Inbound Parse,
// Mailgun, Cloudflare Email Workers) POST either JSON or multipart/form-data to a webhook
// URL you register. Point that webhook at:  https://notes:<NOTES_INBOUND_SECRET>@app.gt3pb.com/api/notes/inbound
// (the secret rides as Basic auth, in a header — never in the address; see tokensFrom below).
//
// Two gates before any write (so a guessed URL can't inject notes):
//   1. the token must equal NOTES_INBOUND_SECRET.
//   2. the From address must be in NOTES_INBOUND_FROM (comma-separated allowlist) — notee's
//      "Share Text → Mail" sends from your own address, so allowlist that.
//
// tenant_id is left to the DB default (founding GT3PB tenant), matching how the rest of the
// app inserts while per-tenant RLS enforcement is still deferred (see 0040 multi-tenant).

const NOTE_MAX_CHARS = 50_000;
// A copy whose twin arrived less than this long ago is told to come back: the twin is still being written (R20 review).
const IN_FLIGHT_MS = 120_000;

/** The mail's own id — its Message-ID header first, the same however many ways the mail is sent on (Postmark's Headers,
 *  Mailgun's Message-Id, the raw headers SendGrid forwards) — else Postmark's id for the delivery. Pure. */
function messageIdOf(f: Record<string, unknown>): string | null {
  const clip = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  for (const h of Array.isArray(f.Headers) ? f.Headers : []) {
    if (h && typeof h === "object" && /^message-id$/i.test(String((h as { Name?: unknown }).Name ?? ""))) {
      const v = clip((h as { Value?: unknown }).Value);
      if (v) return v;
    }
  }
  for (const k of ["Message-Id", "Message-ID", "message-id", "message_id"]) { const v = clip(f[k]); if (v) return v; }
  const m = /^message-id:\s*(\S+)/im.exec(typeof f.headers === "string" ? f.headers : "");
  if (m) return m[1].slice(0, 300);
  return clip(f.MessageID);
}

// pull a field by any of several provider-specific names
const pick = (o: Record<string, any>, ...keys: string[]): string => {
  for (const k of keys) { const v = o[k]; if (typeof v === "string" && v.trim()) return v; }
  return "";
};
const stripHtml = (s: string) => s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+\n/g, "\n").trim();
// "Ryan T <ryan@x.com>" → "ryan@x.com"
const emailOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

// THE SECRET OUT OF THE ADDRESS (R18, 2026-10-17 — the 10/10 audit, security F10). A query string is written into every
// request log it passes — the platform's, a proxy's — so a webhook's ?token= was the door's key, kept in the logs. The
// token is taken from the Authorization header first: Basic (what a webhook URL with `notes:<secret>@` in it sends — most
// inbound-email services take one) or Bearer. ?token= is still read for a webhook set up before R18; moving it is the
// owner's change in the provider's settings, and then the address carries nothing.
// Either one opens it (R18 review): a provider that sends an Authorization header of its own beside a ?token= webhook
// set up before R18 is still let in by the token in the address, and the header's never shuts it out.
function tokensFrom(req: Request, url: URL): string[] {
  const out: string[] = [];
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(auth)?.[1];
  if (bearer) out.push(bearer);
  const basic = /^Basic\s+(\S+)\s*$/i.exec(auth)?.[1];
  if (basic) {
    try { const pair = atob(basic); if (pair.includes(":")) out.push(pair.slice(pair.indexOf(":") + 1)); } catch { /* not Basic's shape */ }
  }
  const query = url.searchParams.get("token");
  if (query) out.push(query);
  return out;
}

async function post(req: Request) {
  const secret = process.env.NOTES_INBOUND_SECRET;
  if (!supabaseAdmin || !secret) return NextResponse.json({ ok: false }, { status: 503 });

  // Compared in constant time (2026-10-11, lib/webhookSignature): `!==` stops at the first wrong character, and how
  // long a refusal takes is one more thing a guesser can measure.
  const url = new URL(req.url);
  if (!tokensFrom(req, url).some((t) => tokenOk(t, secret))) return NextResponse.json({ ok: false }, { status: 401 });

  // Accept JSON (Postmark) or multipart/form-data (SendGrid/Mailgun).
  let f: Record<string, any> = {};
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("application/json")) {
      f = await req.json();
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) if (typeof v === "string") f[k] = v;
    }
  } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (!f || typeof f !== "object" || Array.isArray(f)) return NextResponse.json({ ok: false }, { status: 400 });   // a literal null (R10b)

  const from = emailOf(pick(f, "from", "From", "sender", "Sender"));
  const allow = (process.env.NOTES_INBOUND_FROM || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // If an allowlist is configured, the sender must be on it. (No allowlist = secret-only.)
  if (allow.length && !allow.includes(from)) return NextResponse.json({ ok: false }, { status: 403 });

  const subject = pick(f, "subject", "Subject").trim();
  let text = pick(f, "text", "TextBody", "body-plain", "stripped-text", "plain");
  if (!text) { const html = pick(f, "html", "HtmlBody", "body-html"); if (html) text = stripHtml(html); }
  text = text.trim();
  if (!subject && !text) return NextResponse.json({ ok: false }, { status: 400 });

  // Kept to a note's length (R20 — the 10/10 audit, API F16): a forwarded thread or a pasted log is a note, not a dump.
  text = text.slice(0, NOTE_MAX_CHARS);

  // ONCE A MESSAGE (R20 — API F16). An inbound-email service retries a delivery it didn't hear answered, and a webhook
  // set up twice sends each mail twice: every copy was a note. The mail's own Message-ID (messageIdOf) is kept, hashed,
  // in the webhook inbox (0230; only the server reads it), and a copy already written is thanked and not written again.
  // A copy whose twin is not marked written yet — still being written, two at once, or a delivery that died — is told
  // to come back (409: Postmark, Mailgun and SendGrid retry it; a Cloudflare Email Worker only if its own code does),
  // unless the twin arrived long enough ago to have died:
  // then one copy takes it over, the one whose stamp moves, and writes it (the R20 review). A mail with no id is written,
  // as before.
  const messageId = messageIdOf(f);
  const inboxId = messageId ? `notes:${createHash("sha256").update(messageId).digest("hex").slice(0, 40)}` : null;
  if (inboxId) {
    const { error: inboxErr } = await supabaseAdmin.from("webhook_events").insert({ id: inboxId, provider: "notes", type: "inbound", payload: null });
    if ((inboxErr as { code?: string } | null)?.code === "23505") {
      const { data: seen, error: seenErr } = await supabaseAdmin.from("webhook_events").select("processed_at").eq("id", inboxId).maybeSingle();
      if (seenErr) return NextResponse.json({ ok: false, retry: true }, { status: 503 });
      if (seen?.processed_at) return NextResponse.json({ ok: true, replay: true });
      const now = Date.now();
      const { data: took, error: takeErr } = await supabaseAdmin.from("webhook_events").update({ received_at: new Date(now).toISOString() })
        .eq("id", inboxId).is("processed_at", null).lt("received_at", new Date(now - IN_FLIGHT_MS).toISOString()).select("id");
      if (takeErr || !Array.isArray(took) || took.length === 0) return NextResponse.json({ ok: false, retry: true }, { status: 409 });
    }
  }

  // Title = subject, else first non-empty line of the body, else a dated fallback.
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const title = (subject || firstLine || `Meeting note · ${etToday()}`).slice(0, 160);
  // Summary = a readable lead; full text kept in body so nothing is lost.
  const summary = text.slice(0, 1200) || null;

  const { error } = await supabaseAdmin.from("meeting_notes").insert({
    title, summary, body: text || null, source: "email",
  });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  if (inboxId) {
    const done = await supabaseAdmin.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", inboxId);
    if (done.error) console.warn(`notes inbound: a note was written and its mail not marked — ${done.error.message}`);
  }
  return NextResponse.json({ ok: true });
}

export const POST = route("notes/inbound", post);
