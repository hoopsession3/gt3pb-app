import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exchangeCode, graph, outlookConfigured } from "@/lib/msgraph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reqOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  return `${proto}://${host}`;
}

// Microsoft redirects the browser here with ?code&state. We validate state (CSRF) against what
// /connect issued, exchange the code for tokens, store them (service role), then bounce to /admin.
// Top-level redirect, so we return a plain 302 — no bearer is available here; state is the guard.
export async function GET(req: Request) {
  const origin = reqOrigin(req);
  const back = (note: string) => new Response(null, { status: 302, headers: { Location: `${origin}/admin?outlook=${note}` } });
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
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
