import { NextResponse } from "next/server";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// Owner-only. Clears the stored tokens so the company mailbox is disconnected. Keeps event mappings
// (outlook_event_id) so a future reconnect won't duplicate. Reconnect via /connect.
export async function POST(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  await supabaseAdmin.from("outlook_connection").update({
    access_token: null, refresh_token: null, expires_at: null, account_email: null, connected_at: null, pending_state: null,
    last_sync_note: "Disconnected",
  }).eq("id", 1);
  return NextResponse.json({ ok: true });
}
