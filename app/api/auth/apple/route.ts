import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";
import { exchangeCode, isAppleCode, siwaConfigured } from "@/lib/appleSignIn";

// SIGN IN WITH APPLE — KEEP WHAT DELETING THE ACCOUNT WILL REVOKE (2026-10-11).
//
// The iPhone app posts the sheet's one-time authorization code here right after a Sign in with Apple, with the new
// session (components/AppleSignIn, lib/appleAuth). The code is traded at Apple for the refresh token (lib/appleSignIn) and
// kept (apple_tokens, 0363) only when Apple's own answer names the signed-in person's own Apple identity — a code from
// anyone else's sign-in is refused. The sign-in never waits on this; deleting the account revokes what it keeps.
//
//   POST { code }  → 200 { kept: true } · 200 { kept: false, why } · 400 · 401 · 403 · 429
const PER_PERSON = { windowMs: 60_000, max: 5 };   // the sheet gives one code per sign-in

async function post(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  let body: { code?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!isAppleCode(body.code)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!siwaConfigured() || !supabaseAdmin) return NextResponse.json({ kept: false, why: "not configured" });

  const { data: under } = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `apple-code:${user.id}`, p_window_ms: PER_PERSON.windowMs, p_max: PER_PERSON.max });
  if (under === false) return NextResponse.json({ error: "Too many tries." }, { status: 429 });

  // The person's Apple identity, as Supabase recorded it when the identity token signed them in.
  const { data: found } = await supabaseAdmin.auth.admin.getUserById(user.id);
  const apple = found.user?.identities?.find((i) => i.provider === "apple");
  const appleId = String(apple?.identity_data?.sub ?? apple?.id ?? "");
  if (!appleId) return NextResponse.json({ kept: false, why: "no Apple sign-in on this account" });

  const got = await exchangeCode(body.code);
  if (!got) return NextResponse.json({ kept: false, why: "Apple did not take the code" });
  if (got.appleUser !== appleId) return NextResponse.json({ error: "That sign-in isn't this account's." }, { status: 403 });

  const { error } = await supabaseAdmin.from("apple_tokens").upsert(
    { user_id: user.id, apple_user: got.appleUser, refresh_token: got.refreshToken, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return NextResponse.json(error ? { kept: false, why: "not stored" } : { kept: true });
}

export const POST = route("auth/apple", post);
