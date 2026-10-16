import { NextResponse } from "next/server";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// Owner-only. Clears the stored tokens so the company mailbox is disconnected. Keeps event mappings
// (outlook_event_id) so a future reconnect won't duplicate. Reconnect via /connect.
async function post(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  const cleared = await supabaseAdmin.from("outlook_connection").update({
    access_token: null, refresh_token: null, expires_at: null, account_email: null, connected_at: null, pending_state: null,
    last_sync_note: "Disconnected",
  }).eq("id", 1);
  // Disconnected only when the tokens are gone (R12b, F4): it answered ok and the mailbox stayed connected.
  if (cleared.error) return NextResponse.json({ ok: false, error: "Couldn't disconnect Outlook — try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const POST = route("outlook/disconnect", post);
