import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exchangeCode, graph, outlookConfigured } from "@/lib/msgraph";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reqOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  return `${proto}://${host}`;
}

// Microsoft redirects the browser here with ?code&state. We validate state (CSRF) against what
// /connect issued, exchange the code for tokens, store them (service role), then bounce to /crew.
// Top-level redirect, so we return a plain 302 — no bearer is available here; state is the guard.
// BACK TO WHERE IT WAS PRESSED (2026-10-06, the settings round): Connect lives in Settings ›
// Integrations now (components/OutlookConnect), so the bounce opens that panel, which reads the note.
// FROM THE IPHONE APP (2026-10-11): a state that starts "app." was issued to the app (?from=app on /connect), whose
// consent runs in its own browser sheet. That sheet is answered with a page that says what happened and to tap Done —
// the app reads the status again when the sheet closes. Redirected to the console instead, the sheet showed the
// website, signed out. The page is static words: nothing from the request is written into it.
const APP_PAGE: Record<"connected" | "error", [string, string]> = {
  connected: ["Outlook is connected.", "Tap Done to go back to GT3."],
  error: ["Outlook didn't connect.", "Tap Done, then try again from Settings in GT3."],
};
const appPage = (note: "connected" | "error") => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GT3 · Outlook</title></head>`
  + `<body style="margin:0;padding:72px 24px;text-align:center;font:17px/1.45 -apple-system,system-ui,sans-serif;background:#F5F1E8;color:#2A2820">`
  + `<p style="font-size:22px;font-weight:600;margin:0 0 8px">${APP_PAGE[note][0]}</p><p style="margin:0">${APP_PAGE[note][1]}</p></body></html>`,
  { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
);

async function get(req: Request) {
  const origin = reqOrigin(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (note: "connected" | "error") => (state?.startsWith("app.")
    ? appPage(note)
    : new Response(null, { status: 302, headers: { Location: `${origin}/crew?s=settings&a=set-outlook&outlook=${note}` } }));
  if (!code || !state || !supabaseAdmin || !outlookConfigured()) return back("error");

  const { data: conn } = await supabaseAdmin.from("outlook_connection").select("pending_state").eq("id", 1).maybeSingle();
  if (!conn || !conn.pending_state || conn.pending_state !== state) return back("error");

  try {
    const tok = await exchangeCode(origin, code);
    let email: string | null = null;
    try { const me = await graph(tok.access_token, "/me"); email = me?.mail || me?.userPrincipalName || null; } catch { /* non-fatal */ }
    await supabaseAdmin.from("outlook_connection").update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? null,
      expires_at: new Date(Date.now() + ((tok.expires_in || 3600) - 60) * 1000).toISOString(),
      account_email: email,
      connected_at: new Date().toISOString(),
      pending_state: randomUUID(), // burn the used state
    }).eq("id", 1);
    return back("connected");
  } catch {
    return back("error");
  }
}

export const GET = route("outlook/callback", get);
