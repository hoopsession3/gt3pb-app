import { NextResponse } from "next/server";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { outlookConfigured } from "@/lib/msgraph";

export const runtime = "nodejs";

// Owner-only. Reports whether Outlook is configured (env) and connected (tokens stored), plus the
// connected account and last sync. Never returns tokens.
export async function GET(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const configured = outlookConfigured();
  let connected = false, account: string | null = null, last_sync: string | null = null, last_note: string | null = null;
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin.from("outlook_connection").select("account_email, refresh_token, last_sync_at, last_sync_note").eq("id", 1).maybeSingle();
    if (data?.refresh_token) { connected = true; account = data.account_email ?? null; last_sync = data.last_sync_at ?? null; last_note = data.last_sync_note ?? null; }
  }
  return NextResponse.json({ ok: true, configured, connected, account, last_sync, last_note });
}
