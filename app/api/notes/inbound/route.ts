import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Inbound email → meeting note. notee (notee.ai) has no API, but its Share menu has
// "Share Text"; share that to Mail and send to this endpoint's address and the summary
// lands in the app as a note (source='email'), newest-first, ready to tag follow-ups.
//
// Provider-agnostic: most inbound-email services (Postmark, SendGrid Inbound Parse,
// Mailgun, Cloudflare Email Workers) POST either JSON or multipart/form-data to a webhook
// URL you register. Point that webhook at:  /api/notes/inbound?token=<NOTES_INBOUND_SECRET>
//
// Two gates before any write (so a guessed URL can't inject notes):
//   1. ?token= must equal NOTES_INBOUND_SECRET.
//   2. the From address must be in NOTES_INBOUND_FROM (comma-separated allowlist) — notee's
//      "Share Text → Mail" sends from your own address, so allowlist that.
//
// tenant_id is left to the DB default (founding GT3PB tenant), matching how the rest of the
// app inserts while per-tenant RLS enforcement is still deferred (see 0040 multi-tenant).

// pull a field by any of several provider-specific names
const pick = (o: Record<string, any>, ...keys: string[]): string => {
  for (const k of keys) { const v = o[k]; if (typeof v === "string" && v.trim()) return v; }
  return "";
};
const stripHtml = (s: string) => s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+\n/g, "\n").trim();
// "Ryan T <ryan@x.com>" → "ryan@x.com"
const emailOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

export async function POST(req: Request) {
  const secret = process.env.NOTES_INBOUND_SECRET;
  if (!supabaseAdmin || !secret) return NextResponse.json({ ok: false }, { status: 503 });

  const url = new URL(req.url);
  if (url.searchParams.get("token") !== secret) return NextResponse.json({ ok: false }, { status: 401 });

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

  const from = emailOf(pick(f, "from", "From", "sender", "Sender"));
  const allow = (process.env.NOTES_INBOUND_FROM || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // If an allowlist is configured, the sender must be on it. (No allowlist = secret-only.)
  if (allow.length && !allow.includes(from)) return NextResponse.json({ ok: false }, { status: 403 });

  const subject = pick(f, "subject", "Subject").trim();
  let text = pick(f, "text", "TextBody", "body-plain", "stripped-text", "plain");
  if (!text) { const html = pick(f, "html", "HtmlBody", "body-html"); if (html) text = stripHtml(html); }
  text = text.trim();
  if (!subject && !text) return NextResponse.json({ ok: false }, { status: 400 });

  // Title = subject, else first non-empty line of the body, else a dated fallback.
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const title = (subject || firstLine || `Meeting note · ${new Date().toLocaleDateString()}`).slice(0, 160);
  // Summary = a readable lead; full text kept in body so nothing is lost.
  const summary = text.slice(0, 1200) || null;

  const { error } = await supabaseAdmin.from("meeting_notes").insert({
    title, summary, body: text || null, source: "email",
  });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
