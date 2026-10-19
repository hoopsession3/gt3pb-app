import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callerClient, userFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";
import { isMissingTable } from "@/lib/schemaSkew";
import { hashCode, makeCodes, RECOVERY_WORDS } from "@/lib/recoveryCodes";

// TWO-STEP RECOVERY CODES, MADE AND COUNTED (R37, 2026-10-19 — the fresh audit's UX11-10; Ryan: "Recovery codes"; 0438).
//
//   GET  → { left }  how many of the caller's codes are unused — Settings & privacy says it.
//   POST → { codes } ten new ones, shown to the caller once (components/TwoStepSetup); the ten before them stop working.
//          Only on a sign-in that gave the authenticator's code: asked as the caller of the database (0433
//          two_step_state — an authenticator on the account, and its code given on this sign-in), so a password alone,
//          phished, can't make a way past the authenticator.
//
// What is kept is each code's hash (lib/recoveryCodes), in a table no API role can read (0438); the codes themselves are
// in this one answer and nowhere else — not stored, not logged, never cached (no-store).

const NO_STORE = { "cache-control": "no-store" };
/** Nothing made, nothing taken: any codes the person has still work — true whether they have ten or none. */
const MADE_NONE = "We couldn't make recovery codes just now — nothing was changed. Try again.";

async function get(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Not configured" }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  // scoped-by: the caller's own verified id — a person's recovery codes are theirs, keyed by nothing the request sent.
  // arrives-with: 0438 — before the paste the table isn't there: no count to say (null), and Settings says what codes are for.
  const { count, error } = await supabaseAdmin.from("two_step_recovery_codes").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).is("used_at", null);
  if (error && isMissingTable(error)) return NextResponse.json({ ok: true, left: null }, { headers: NO_STORE });
  if (error) return NextResponse.json({ ok: false, error: "We couldn't count your recovery codes just now." }, { status: 500 });
  return NextResponse.json({ ok: true, left: count ?? 0 }, { headers: NO_STORE });
}

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Not configured" }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const sb = callerClient(req);
  if (!sb) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const { data: state, error: stateError } = await sb.rpc("two_step_state");
  if (stateError) return NextResponse.json({ ok: false, error: "We couldn't check your two-step sign-in just now — nothing was changed." }, { status: 503 });
  const s = (state ?? {}) as { enrolled?: unknown; given?: unknown };
  if (s.enrolled !== true || s.given !== true) return NextResponse.json({ ok: false, error: RECOVERY_WORDS.giveCode }, { status: 403 });

  const codes = makeCodes();
  // The new ten are kept first, then the old ten go: a failure between leaves the old ones working, never none.
  // scoped-by: the caller's own verified id.
  // arrives-with: 0438 — before the paste the table isn't there: said as not switched on yet, nothing made.
  const { data: made, error: madeError } = await supabaseAdmin.from("two_step_recovery_codes")
    .insert(codes.map((c) => ({ user_id: user.id, code_hash: hashCode(c) }))).select("id");
  if (madeError && isMissingTable(madeError)) return NextResponse.json({ ok: false, error: RECOVERY_WORDS.notYet }, { status: 503 });
  if (madeError || !made || made.length !== codes.length) {
    return NextResponse.json({ ok: false, error: MADE_NONE }, { status: 500 });
  }
  const keep = made.map((r) => r.id);
  // scoped-by: the caller's own verified id, less the ten just made for them.
  const { error: goneError } = await supabaseAdmin.from("two_step_recovery_codes").delete()
    .eq("user_id", user.id).not("id", "in", `(${keep.join(",")})`);
  if (goneError) {
    // scoped-by: the caller's own verified id and the rows made for them just now.
    const { error: undoError } = await supabaseAdmin.from("two_step_recovery_codes").delete().eq("user_id", user.id).in("id", keep);
    // Undone, nothing changed; not undone, ten nobody was shown sit beside the old — the next ten made take them away.
    return NextResponse.json({ ok: false, error: undoError ? "We couldn't finish making recovery codes. Make them again." : MADE_NONE }, { status: 500 });
  }
  return NextResponse.json({ ok: true, codes }, { headers: NO_STORE });
}

export const GET = route("two-step/codes", get);
export const POST = route("two-step/codes", post);
