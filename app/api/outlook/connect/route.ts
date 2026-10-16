import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { authUrl, outlookConfigured } from "@/lib/msgraph";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reqOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  return `${proto}://${host}`;
}

// Owner-only. Issues a CSRF state, stashes it on the (singleton) connection row, and returns the
// Microsoft consent URL. The browser then navigates there; Microsoft redirects back to /callback.
async function get(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!outlookConfigured()) return NextResponse.json({ ok: false, error: "Outlook isn't configured — set MS_CLIENT_ID and MS_CLIENT_SECRET." }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  // From the iPhone app (?from=app): the state says so, and the callback answers the app's browser sheet with a page
  // that sends the person back to the app instead of to the website's console (components/OutlookConnect).
  const state = `${new URL(req.url).searchParams.get("from") === "app" ? "app." : ""}${randomUUID()}`;
  // The state the callback checks is kept before the owner is sent to Microsoft (R12b, F4) — unkept, the callback
  // refused the answer and the connect failed after the consent screen.
  const kept = await supabaseAdmin.from("outlook_connection").upsert({ id: 1, pending_state: state }, { onConflict: "id" });
  if (kept.error) return NextResponse.json({ ok: false, error: "Couldn't start connecting Outlook — try again." }, { status: 500 });
  return NextResponse.json({ ok: true, url: authUrl(reqOrigin(req), state) });
}

export const GET = route("outlook/connect", get);
