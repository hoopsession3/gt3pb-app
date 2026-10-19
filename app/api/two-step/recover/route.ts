import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bearerProvedWithin, userFromRequest } from "@/lib/apiAuth";
import { isJsonObject, route } from "@/lib/apiRoute";
import { callerIp, limitsFit } from "@/lib/rateLimit";
import { raiseAlert } from "@/lib/serverAlerts";
import { isMissingTable } from "@/lib/schemaSkew";
import { codeMatches, looksLikeCode, RECOVERY_WORDS } from "@/lib/recoveryCodes";

// A RECOVERY CODE TAKES A LOST AUTHENTICATOR OFF (R37, 2026-10-19 — the fresh audit's UX11-10; Ryan: "Recovery codes";
// 0438).
//
//   POST { code } → { ok, left }  the code is used up, every authenticator on the account is taken off through Supabase's
//                                 own admin door — which signs the person out everywhere — and the owners and admins are
//                                 told. They sign in again and set up a new one (components/TwoStepPrompt says so).
//
// Asked of a sign-in proved in the last few minutes (lib/freshProof — the code emailed, a password, Apple, just now), as
// deleting an account is (R27): a session left open on a lent phone is not enough, with a code or without. Ten tries an
// hour for a person and thirty for an address — a guess is one in about 10^15 each time. A code is compared with what
// the table keeps for it (lib/recoveryCodes: scrypt, constant-time) and marked used before anything else happens, so the
// same code twice finds nothing; a failure after that gives it back — and says so only when it was given back.

/** What became of the code, said after a failure past the mark: given back, or — the give-back refused — spent. */
const codeLeft = (back: boolean) => (back ? "your code wasn't used" : "that code is used up, so use another of yours");

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Not configured" }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  if (!bearerProvedWithin(req)) return NextResponse.json({ ok: false, error: RECOVERY_WORDS.fresh, prove: true }, { status: 403 });
  let body: unknown = null;
  try { body = await req.json(); } catch { /* answered below */ }
  const typed = isJsonObject(body) ? body.code : undefined;
  if (!looksLikeCode(typed)) return NextResponse.json({ ok: false, error: RECOVERY_WORDS.notCode }, { status: 400 });
  const fits = await limitsFit(supabaseAdmin, [
    { bucket: `recover:${user.id}`, windowMs: 3_600_000, max: 10 },
    { bucket: `recover-ip:${callerIp(req)}`, windowMs: 3_600_000, max: 30 },
  ]);
  if (!fits) return NextResponse.json({ ok: false, error: RECOVERY_WORDS.tooMany }, { status: 429 });

  // scoped-by: the caller's own verified id — their codes, keyed by nothing the request sent.
  // arrives-with: 0438 — before the paste the table isn't there, so nobody has codes: said as none, nothing changed.
  const { data: rows, error: readError } = await supabaseAdmin.from("two_step_recovery_codes").select("id, code_hash")
    .eq("user_id", user.id).is("used_at", null);
  if (readError && isMissingTable(readError)) return NextResponse.json({ ok: false, error: RECOVERY_WORDS.none }, { status: 422 });
  if (readError) return NextResponse.json({ ok: false, error: "We couldn't check that code just now — nothing was changed." }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ ok: false, error: RECOVERY_WORDS.none }, { status: 422 });
  const hit = rows.find((r) => codeMatches(typed, r.code_hash));
  if (!hit) return NextResponse.json({ ok: false, error: RECOVERY_WORDS.wrong }, { status: 422 });

  // Used once: marked before anything else.
  // scoped-by: the caller's own verified id and the row read for them just now.
  const { data: marked, error: markError } = await supabaseAdmin.from("two_step_recovery_codes")
    .update({ used_at: new Date().toISOString() }).eq("id", hit.id).eq("user_id", user.id).is("used_at", null).select("id");
  if (markError) return NextResponse.json({ ok: false, error: "We couldn't use that code just now — nothing was changed." }, { status: 500 });
  if (!marked?.length) return NextResponse.json({ ok: false, error: "That code was used just now. Try another of yours." }, { status: 409 });
  /** The code given back after a failure past the mark — its answer read: true only when it is unused again. */
  const giveBack = async (): Promise<boolean> => {
    // scoped-by: the caller's own verified id and the row marked for them just now.
    const { error } = await supabaseAdmin!.from("two_step_recovery_codes").update({ used_at: null }).eq("id", hit.id).eq("user_id", user.id);
    if (error) console.error(`[two-step/recover] a recovery code couldn't be given back after a failure: ${String(error.message ?? error.code ?? "refused").slice(0, 200)}`);
    return !error;
  };

  // The lost authenticator off the account — Supabase's admin door, the server's alone. It signs them out everywhere.
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: user.id });
  if (listError) {
    const back = await giveBack();
    return NextResponse.json({ ok: false, error: `We couldn't reach your sign-in's settings just now — ${codeLeft(back)}. Try again.` }, { status: 503 });
  }
  // Nothing to take off — set up nowhere, or turned off since the codes were made: the code is given back, not spent, and
  // nobody is told an authenticator came off that wasn't there.
  const totp = (list?.factors ?? []).filter((f) => f.factor_type === "totp");
  if (!totp.some((f) => f.status === "verified")) {
    const back = await giveBack();
    return NextResponse.json({ ok: false, error: `${RECOVERY_WORDS.nothingOn} — ${codeLeft(back)}.` }, { status: 409 });
  }
  let removed = 0;
  for (const f of totp) {
    const { error } = await supabaseAdmin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
    if (error) {
      if (removed > 0) {
        return NextResponse.json({ ok: false, error: "Only part of that went through. Sign in again and set up a new authenticator; ask an owner if the old one is still asked for." }, { status: 503 });
      }
      const back = await giveBack();
      return NextResponse.json({ ok: false, error: `We couldn't take your authenticator off just now — ${codeLeft(back)}. Try again.` }, { status: 503 });
    }
    removed++;
  }

  // The owners and admins are told: a recovery code is a way past the second step, and they should know it was taken.
  // scoped-by: the caller's own verified id — their own name, for the alert.
  const { data: me } = await supabaseAdmin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const who = String(me?.display_name ?? "").trim() || "Someone on the team";
  await raiseAlert({
    severity: "important", category: "system",
    title: "A recovery code was used",
    body: `${who} used a two-step recovery code: their authenticator is off their account, and they set up a new one when they sign in again. If it wasn't them, take their owner or admin role away in Team.`,
    link: "/crew?s=team",
  });
  return NextResponse.json({ ok: true, removed, left: rows.length - 1 }, { headers: { "cache-control": "no-store" } });
}

export const POST = route("two-step/recover", post);
