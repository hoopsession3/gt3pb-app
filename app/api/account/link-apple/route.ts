import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { route, isJsonObject } from "@/lib/apiRoute";
import { verifyIdentityToken } from "@/lib/appleSignIn";
import { linkApple, LINK_WORDS, type LinkSteps } from "@/lib/appleLink";
import { errorMessage } from "@/lib/errorMessage";

// LINK SIGN IN WITH APPLE TO THIS ACCOUNT (2026-10-15, A3 of the account audit; decided by Ryan on 2026-10-13).
//
// The iPhone app asks this in two places, both signed in to the member's own email account: right after a first Apple
// sign-in, once the member has entered the code their email was sent (components/AppleLink — the code signed them in to
// that account), and from Settings & privacy › Link Sign in with Apple. Either way it sends a fresh identity token from
// Apple's sheet and the nonce it asked Apple with. lib/appleLink decides; this hands it the real steps:
//
//   POST { idToken, nonce } → 200 { ok, joined } · 400 · 401 · 409 (in words a person can act on) · 429 · 502 · 503
//
// Supabase does the linking itself (manual linking: token?grant_type=id_token with link_identity), asked with the
// member's own session, so the link is theirs. When that Apple ID already made an empty account, that account is deleted
// first (0353's erasure; 0403 says it holds nothing a person would lose) and its Apple token moves across.
const PER_PERSON = { windowMs: 10 * 60_000, max: 6 };

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const admin = supabaseAdmin;
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const jwt = (req.headers.get("authorization") || "").slice(7);   // userFromRequest read this same Bearer token

  let body: { idToken?: unknown; nonce?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const idToken = typeof body.idToken === "string" && body.idToken.length < 4096 ? body.idToken : "";
  const nonce = typeof body.nonce === "string" && /^[0-9a-f]{32,128}$/.test(body.nonce) ? body.nonce : "";
  if (!idToken || !nonce) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { data: under } = await admin.rpc("rate_limit_hit", { p_bucket: `apple-link:${user.id}`, p_window_ms: PER_PERSON.windowMs, p_max: PER_PERSON.max });
  if (under === false) return NextResponse.json({ error: "Too many tries. Wait a few minutes, then try again." }, { status: 429 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ error: LINK_WORDS.busy }, { status: 503 });

  const steps: LinkSteps = {
    verify: (token, raw) => verifyIdentityToken(token, raw),
    identitiesOf: async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user) return null;
      return (data.user.identities ?? []).map((i) => ({ provider: i.provider, sub: String(i.identity_data?.sub ?? i.id ?? "") }));
    },
    link: async (callerJwt, token, raw) => {
      try {
        const r = await fetch(`${url}/auth/v1/token?grant_type=id_token`, {
          method: "POST",
          headers: { apikey: anon, Authorization: `Bearer ${callerJwt}`, "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "apple", id_token: token, nonce: raw, link_identity: true }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) return { ok: true };
        const j = (await r.json().catch(() => ({}))) as { error_code?: string; code?: string | number; msg?: string; message?: string };
        return { ok: false, code: String(j.error_code ?? j.code ?? r.status), message: String(j.msg ?? j.message ?? "") };
      } catch (e) {
        return { ok: false, code: "network", message: errorMessage(e, 300) };
      }
    },
    accountForApple: async (sub) => {
      const { data } = await admin.rpc("account_for_apple", { p_sub: sub });
      return typeof data === "string" ? data : null;
    },
    unused: async (id) => (await admin.rpc("account_unused", { p_user: id })).data === true,
    moveAppleToken: async (from, to) => {
      // scoped-by: both ids are accounts this request proved — the caller's session, and the account the verified Apple
      // identity token signs in to (account_for_apple); apple_tokens is the server's alone (0363: no policy, no grant).
      const { data: theirs } = await admin.from("apple_tokens").select("user_id").eq("user_id", to).maybeSingle();
      if (theirs) return false;
      const { data, error } = await admin.from("apple_tokens").update({ user_id: to, updated_at: new Date().toISOString() }).eq("user_id", from).select("user_id");
      return !error && (data ?? []).length > 0;
    },
    deleteAccount: async (id) => {
      const { error } = await admin.auth.admin.deleteUser(id);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
  };

  const answer = await linkApple({ id: user.id, jwt }, idToken, nonce, steps);
  return NextResponse.json(answer.body, { status: answer.status });
}

export const POST = route("account/link-apple", post);
