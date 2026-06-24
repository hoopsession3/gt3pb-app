import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { authUrl, outlookConfigured } from "@/lib/msgraph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reqOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  return `${proto}://${host}`;
}

// Owner-only. Issues a CSRF state, stashes it on the (singleton) connection row, and returns the
// Microsoft consent URL. The browser then navigates there; Microsoft redirects back to /callback.
export async function GET(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!outlookConfigured()) return NextResponse.json({ ok: false, error: "Outlook isn't configured — set MS_CLIENT_ID and MS_CLIENT_SECRET." }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  const state = randomUUID();
  await supabaseAdmin.from("outlook_connection").upsert({ id: 1, pending_state: state }, { onConflict: "id" });
  return NextResponse.json({ ok: true, url: authUrl(reqOrigin(req), state) });
}
