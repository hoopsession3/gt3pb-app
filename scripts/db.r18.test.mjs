// R18 — A STAFF INVITE WAITS FOR A PROVEN ADDRESS, MONEY KEEPS ITS DOORS, A JOB THAT STOPPED IS SAID, RUN IN POSTGRES
// (2026-10-17; Ryan: "Keep working to improve to a 10").
//
//   0423  claim_team_invites + claim_invites_on_proof + password_waits_for_proof where a crew role is at stake (the
//         switch password_scope_everywhere), take_signup_password as an account becomes crew, the mark that asks for a
//         password taken (profiles.password_taken_at, password_chosen, password_not_now; never a code sign-up's) and
//         confirm_address (the security pass, SEC1, and the R18 review's four passes); money_columns_guard
//         on shop orders, their lines, jug counts and expenses (database F2); business_day() where current_date stood
//         (database F4); cron_watch says a job that stopped and requests the database sent that failed (database F8,
//         operations F11); the public buckets' types and sizes (SEC3); four foreign-key indexes (database F19).
//
//   0424  (held) password_scope_everywhere() true: the rule on every account.
//
// What is run here is the whole schema up to 0422, the findings reproduced on it, then 0423 — twice — as the roles that
// call it, then 0424 — twice. Every person, address and order is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M423 = readFileSync(join(ROOT, "supabase/migrations/0423_an_invite_waits_for_a_proven_address_money_keeps_its_doors_a_stopped_job_is_said.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c423000-0000-4000-8000-0000000000c1";   // the owner who invites
const CREW = "0c423000-0000-4000-8000-0000000000c2";    // an operator on the crew
const ADMIN = "0c423000-0000-4000-8000-0000000000c3";   // an admin
const MEMBER = "0c423000-0000-4000-8000-0000000000a1";  // a customer

const t0 = Date.now();
const db = await fullSchema({ before: "0423" });
console.log(`the schema to 0422 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const n = async (s, p) => Number((await q1(s, p)).n);
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
const as = async (who, sql, params) => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`select set_config('request.jwt.claim.sub', '${who && who !== "service" ? who : ""}', false);
    select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
  grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;
  alter role service_role bypassrls;`);
for (const [id, role, name] of [[OWNER, "owner", "Alex Rivera"], [CREW, "operator", "Kim Lee"], [ADMIN, "admin", "Dana Cole"], [MEMBER, "member", "Sam Ito"]]) {
  await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4, is_admin = ($2 in ('owner', 'admin')) where id = $1`, [id, role, T1, name]);
}
const invite = (email, role = "operator") => q(`insert into public.team_invites (email, role, invited_by, tenant_id) values ($1, $2, $3, $4) returning id`, [email, role, OWNER, T1]);
// GoTrue writes auth.users as its own database role (supabase_auth_admin); the SQL editor writes as postgres — which is
// how 0423 tells an address proven by its owner from one an owner vouched for by hand (vouched_by_hand, by session_user).
// PGlite has one session user and cannot switch back from another, so once 0423 is loaded (below) its one-line rule is
// read for what it says, and then stood in for by a setting: off is GoTrue (the default here), on is an owner by hand.
const asGoTrue = async (sql, params) => (await db.query(sql, params)).rows;
// An account as GoTrue makes it (the R18 review): the row is always INSERTed unproven — with the password when one was
// typed, and confirmation_sent_at when a confirmation went out (Confirm email on) — and confirmed by an UPDATE: at once
// for a provider that vouches for the address (Sign in with Apple) or with Confirm email off, later by the emailed code.
// A code sign-up (signInWithOtp, the fourth pass) is made the same way with a random password GoTrue generates — nobody's
// — and, from this round's app, the joined_by_code mark in its metadata.
const signUp = async (email, { password = "", sendsConfirmation = true, confirmed = false, provider = "email", meta = {} } = {}) => {
  const id = (await asGoTrue(`insert into auth.users (email, encrypted_password, confirmation_sent_at, raw_app_meta_data, raw_user_meta_data)
    values ($1, $2, case when $3 then now() else null end, jsonb_build_object('provider', $4::text), $5::jsonb) returning id`,
    [email, password, sendsConfirmation && !confirmed, provider, JSON.stringify(meta)]))[0].id;
  if (confirmed) await asGoTrue(`update auth.users set email_confirmed_at = now() where id = $1`, [id]);
  return id;
};
let temp = 0;
const codeJoin = (email, { thisBuild = true } = {}) =>
  signUp(email, { password: `gotrue-temporary-${++temp}`, meta: thisBuild ? { joined_by_code: true } : {} });
// GoTrue's UpdatePassword: the new hash, and confirmation_sent_at (with the other tokens' stamps) cleared.
const setPassword = (id, hash) => asGoTrue(`update auth.users set encrypted_password = $2, confirmation_sent_at = null where id = $1`, [id, hash]);
const prove = (id) => asGoTrue(`update auth.users set email_confirmed_at = now() where id = $1`, [id]);
const byHand = async (id) => {   // the SQL editor, as postgres
  await db.exec(`set gt3test.vouched = 'on'`);
  try { await q(`update auth.users set email_confirmed_at = now() where id = $1`, [id]); } finally { await db.exec(`set gt3test.vouched = 'off'`); }
};
const roleOf = async (id) => (await q1(`select role from public.profiles where id = $1`, [id]))?.role ?? null;
const claimedBy = async (email) => (await q1(`select claimed_by::text c from public.team_invites where email = $1 order by created_at desc limit 1`, [email]))?.c ?? null;
const passwordOf = async (id) => (await q1(`select encrypted_password p from auth.users where id = $1`, [id])).p;

// ── before 0423: the findings, reproduced ─────────────────────────────────────────────────────────────────────────────
{
  await invite("kai@example.test");
  const kai = await signUp("kai@example.test", { password: "a-strangers-hash" });
  ok("before 0423: an account made with an invited address and a password, never proven, held the invite's role at once",
    (await roleOf(kai)) === "operator" && (await claimedBy("kai@example.test")) === kai);
  const so = await as("service", `insert into public.shop_orders (email, subtotal_cents, total_cents, status, tenant_id) values ('sam@example.test', 4200, 4200, 'paid', $1) returning id`, [T1]);
  const edit = await as(CREW, `update public.shop_orders set refund_amount_cents = 4200, status = 'refunded' where id = $1 returning id`, [so.rows[0].id]);
  ok("before 0423: any crew role rewrote a shop order's refund and status straight through the API", !so.error && !edit.error && edit.rows.length === 1, [so.error, edit.error]);
  const ex = await as(CREW, `insert into public.expenses (category, description, amount_cents, created_by) values ('supplies', 'ice', 1500, $1) returning id`, [CREW]);
  const exEdit = await as(CREW, `update public.expenses set amount_cents = 15 where id = $1 returning id`, [ex.rows[0]?.id]);
  ok("before 0423: …and an expense's amount", !ex.error && !exEdit.error && exEdit.rows.length === 1, [ex.error, exEdit.error]);
  ok("before 0423: market_live asked current_date (the UTC calendar)", /CURRENT_DATE/i.test((await q1(`select pg_get_viewdef('public.market_live') d`)).d));
}

await db.exec(M423);
await db.exec(M423);   // a second run changes nothing
// 0423 loads on the schema to 0422, and loads again — a throw above fails this file; a milestone, not counted as a check.
const VOUCH = (await q1(`select prosrc from pg_proc where proname = 'vouched_by_hand'`)).prosrc;
const vouchedHere = (await q1(`select public.vouched_by_hand() v`)).v;
await db.exec(`create or replace function public.vouched_by_hand() returns boolean language sql stable set search_path = public as
  $$ select coalesce(current_setting('gt3test.vouched', true), 'off') = 'on' $$;`);

// ── a staff invite waits for a proven address ────────────────────────────────────────────────────────────────────────
const markOf = async (id) => (await q1(`select password_taken_at is not null m from public.profiles where id = $1`, [id])).m;
{
  ok("0423: the rule reaches as far as a crew role at stake — 0424 (held) turns it to every account",
    (await q1(`select public.password_scope_everywhere() v`)).v === false);
  await invite("lee@example.test");
  const lee = await signUp("lee@example.test", { password: "a-strangers-hash" });
  ok("0423: an account made with an invited address and a password is a member until the address is proven — the invite waits",
    (await roleOf(lee)) === "member" && (await claimedBy("lee@example.test")) === null);
  await prove(lee);
  ok("0423: …proven (the emailed code or link), the invite is claimed and the role given", (await roleOf(lee)) === "operator" && (await claimedBy("lee@example.test")) === lee);
  ok("0423: …and the password set before the proof is gone — the stranger who set it is not in", (await passwordOf(lee)) === "");
  ok("0423 (third pass): …and the account is marked, so whoever proved it is asked to choose one wherever they next sign in", (await markOf(lee)) === true);
  await setPassword(lee, "lees-own-hash");   // the join screen, or the choose sheet
  ok("0423 (third pass): a password set takes the mark off (password_chosen)", (await markOf(lee)) === false && (await passwordOf(lee)) === "lees-own-hash");

  // A code join is made with GoTrue's random password on it (the fourth pass).
  await invite("mo@example.test", "event_manager");
  const mo = await codeJoin("mo@example.test");
  ok("0423: a code sign-up waits too", (await roleOf(mo)) === "member" && (await claimedBy("mo@example.test")) === null);
  await prove(mo);
  ok("0423 (fourth pass): …claimed the moment the code proves the address — GoTrue's random password taken, and nobody asked to choose one (joined_by_code)",
    (await roleOf(mo)) === "event_manager" && (await claimedBy("mo@example.test")) === mo && (await passwordOf(mo)) === "" && (await markOf(mo)) === false);
  await invite("max@example.test", "server");
  const max = await codeJoin("max@example.test", { thisBuild: false });
  await prove(max);
  ok("0423 (fourth pass): …a code sign-up from an iPhone build before this round carries no mark of its own: taken, and asked once (a code still signs them in)",
    (await roleOf(max)) === "server" && (await passwordOf(max)) === "" && (await markOf(max)) === true);

  await invite("ana@example.test");
  const ana = await signUp("ana@example.test", { sendsConfirmation: false, confirmed: true, provider: "apple" });
  ok("0423: Sign in with Apple (made unproven, confirmed by GoTrue's own update at once, no password) claims as it is confirmed",
    (await roleOf(ana)) === "operator" && (await claimedBy("ana@example.test")) === ana);

  // THE R18 REVIEW'S HOLE: a stranger's row brought onto the crew from Add teammate before anyone proved the address.
  const vic = await signUp("vic@example.test", { password: "a-strangers-hash" });
  const promoted = await as(OWNER, `select public.promote_to_crew($1, 'operator')`, [vic]);
  ok("0423 (review): an account a stranger made under someone's address can still be brought on — but it is not proven, so its password cannot sign in",
    !promoted.error && (await roleOf(vic)) === "operator" && (await passwordOf(vic)) === "a-strangers-hash", promoted.error);
  await prove(vic);
  ok("0423 (review): …and the moment its owner proves the address, the stranger's password is gone — a crew role is at stake, and it is the prover's alone",
    (await passwordOf(vic)) === "" && (await roleOf(vic)) === "operator" && (await markOf(vic)) === true);
  const notMine = await as(MEMBER, `select public.password_not_now()`);
  ok("0423 (third pass): \"Not now\" takes off only its caller's own mark", !notMine.error && (await markOf(vic)) === true, notMine.error);
  const notNow = await as(vic, `select public.password_not_now()`);
  ok("0423 (third pass): …theirs, when they say it — asked once, not at every sign-in", !notNow.error && (await markOf(vic)) === false, notNow.error);
  ok("0423 (third pass): …and a page signed out may not ask", /permission denied/i.test((await as(null, `select public.password_not_now()`)).error ?? ""));
  const selfMark = await as(MEMBER, `update public.profiles set password_taken_at = null where id = $1`, [MEMBER]);
  ok("0423 (third pass): the mark is the database's to write, not a page's (no member grant on the column)", /permission denied/i.test(selfMark.error ?? ""), selfMark.error);

  // THE THIRD PASS: an iPhone build from before R18 sets nothing again after the code — a customer's password stays at the
  // proof until 0424 (held, below) takes it on every account.
  const zoe = await signUp("zoe@example.test", { password: "zoes-own-hash" });
  await prove(zoe);
  ok("0423 (third pass): with no crew role at stake, a customer's password stays at the proof (that is 0424's, held) — nothing marked",
    (await passwordOf(zoe)) === "zoes-own-hash" && (await roleOf(zoe)) === "member" && (await markOf(zoe)) === false);
  const uma = await signUp("uma@example.test", { password: "umas-own-hash", sendsConfirmation: false, confirmed: true });
  ok("0423: an account made already confirmed (Confirm email off, or the dashboard) keeps its password — no proof was asked of anyone",
    (await passwordOf(uma)) === "umas-own-hash");
  await invite("raj@example.test");
  const raj = await signUp("raj@example.test", { password: "rajs-own-hash", sendsConfirmation: false, confirmed: true });
  ok("0423 (third pass): with an invite waiting, Confirm email off (or the dashboard's Auto Confirm) proves nothing — the invite waits for the owner, and by the claim's own test nothing is taken either",
    (await roleOf(raj)) === "member" && (await claimedBy("raj@example.test")) === null && (await passwordOf(raj)) === "rajs-own-hash" && (await markOf(raj)) === false);
  const already = await signUp("ivy@example.test", { password: "ivys-hash", sendsConfirmation: false, confirmed: true });
  await asGoTrue(`update auth.users set email_confirmed_at = now() + interval '1 minute' where id = $1`, [already]);
  ok("0423: an address proven before is never proven again — a later change to the stamp leaves the password alone", (await passwordOf(already)) === "ivys-hash");

  // ONTO THE CREW WITH THE PASSWORD IT WAS MADE WITH (the fourth and fifth passes): proven as a customer, its sign-up
  // password kept — and the stranger who set it signed in with it since — then brought on. GoTrue clears
  // confirmation_sent_at whenever it sets a new password, so one still there is the sign-up's.
  const signIn = async (id) => {   // a session and its refresh token, as GoTrue makes them; and one from before sessions
    const sid = (await asGoTrue(`insert into auth.sessions (user_id) values ($1) returning id`, [id]))[0].id;
    await asGoTrue(`insert into auth.refresh_tokens (token, user_id, session_id, revoked) values ('made-up-token', $1::text, $2, false),
      ('made-up-old-token', $1::text, null, false), ('made-up-unsaid-token', $1::text, null, null)`, [id, sid]);
  };
  const signedIn = async (id) => ({
    sessions: await n(`select count(*) n from auth.sessions where user_id = $1`, [id]),
    live: await n(`select count(*) n from auth.refresh_tokens where user_id = $1::text and coalesce(revoked, false) = false`, [id]),
  });
  const sue = await signUp("sue@example.test", { password: "a-strangers-hash" });
  await prove(sue);
  await signIn(sue);
  const sueOn = await as(OWNER, `select public.promote_to_crew($1, 'server') r`, [sue]);
  ok("0423 (fourth pass): a customer proven with the password it was made with, brought onto the crew later — that password is taken as it becomes crew, and marked",
    !sueOn.error && (await roleOf(sue)) === "server" && (await passwordOf(sue)) === "" && (await markOf(sue)) === true, sueOn.error);
  const sueOut = await signedIn(sue);
  ok("0423 (fifth pass): …and every session it had is ended, the tokens from before sessions too — whoever signed in with that password is out",
    sueOut.sessions === 0 && sueOut.live === 0, sueOut);
  ok("0423 (fifth pass): …and promote_to_crew says so, for Add teammate to say", sueOn.rows[0]?.r?.password_taken === true, sueOn.rows[0]?.r);
  const tom = await signUp("tom@example.test", { password: "tom-at-sign-up" });
  await prove(tom);
  await setPassword(tom, "toms-own-hash");
  await signIn(tom);
  const tomOn = await as(OWNER, `select public.promote_to_crew($1, 'server') r`, [tom]);
  const tomIn = await signedIn(tom);
  ok("0423 (fourth pass): …one whose password was set since its proof (confirmation_sent_at cleared) keeps it — and its sessions, and says nothing was taken",
    (await roleOf(tom)) === "server" && (await passwordOf(tom)) === "toms-own-hash" && (await markOf(tom)) === false
      && tomIn.sessions === 1 && tomIn.live === 3 && tomOn.rows[0]?.r?.password_taken === false, { tomIn, r: tomOn.rows[0]?.r });
  const una = await codeJoin("una@example.test");
  await prove(una);
  await signIn(una);
  await q(`update public.profiles set role = 'contractor' where id = $1`, [una]);   // any path to a crew role: the trigger reads it
  ok("0423 (fourth pass): …a code-made account brought on by any path has GoTrue's random password taken, and is not asked to choose one — its sessions ended all the same (a stranger can set that mark too)",
    (await roleOf(una)) === "contractor" && (await passwordOf(una)) === "" && (await markOf(una)) === false && (await signedIn(una)).sessions === 0);
  const ula = await codeJoin("ula@example.test");
  await prove(ula);
  await signIn(ula);
  const ulaOn = await as(OWNER, `select public.promote_to_crew($1, 'server') r`, [ula]);
  ok("0423 (sixth pass): …brought on by Add teammate, a code-made account's random password goes and its sessions end — and nothing is said of a password it never knew",
    !ulaOn.error && (await passwordOf(ula)) === "" && (await signedIn(ula)).sessions === 0 && (await signedIn(ula)).live === 0 && ulaOn.rows[0]?.r?.password_taken === false, ulaOn.rows[0]?.r ?? ulaOn.error);
  ok("0423 (fourth pass): …and an owner's own row, made already confirmed, is never touched by it",
    (await q1(`select public.take_signup_password($1) t`, [uma])).t === false && (await passwordOf(uma)) === "umas-own-hash");

  // AN OWNER'S HAND (the R18 review, then its fourth pass): "the email never came" is answered in the SQL editor — the owner
  // proves the address, and an invite waiting for it is claimed; the owner cannot say who set the password on it.
  await invite("ned@example.test");
  const ned = await signUp("ned@example.test", { password: "a-strangers-hash" });
  await byHand(ned);
  ok("0423 (fourth pass): an address the owner confirms by hand in the SQL editor claims its invite — and the password set before it is taken, and marked",
    (await passwordOf(ned)) === "" && (await roleOf(ned)) === "operator" && (await claimedBy("ned@example.test")) === ned && (await markOf(ned)) === true);
  ok("0423 (review): …the hand is told by the session's role: postgres or supabase_admin (the SQL editor) — GoTrue's own confirmations are the address proving itself",
    /select session_user in \('postgres', 'supabase_admin'\)/.test(VOUCH) && vouchedHere === true, { VOUCH, vouchedHere });
  const callVouch = await as(MEMBER, `select public.vouched_by_hand()`);
  ok("0423 (review): …and it is not a door anyone can call", /permission denied/i.test(callVouch.error ?? ""), callVouch.error);
  const pat = await signUp("pat@example.test", { password: "pats-own-hash" });
  await byHand(pat);
  ok("0423 (fourth pass): …a customer's address confirmed by hand keeps its password while 0424 is held, as a customer's own proof does",
    (await passwordOf(pat)) === "pats-own-hash" && (await markOf(pat)) === false);

  // confirm_address: the one line Ryan runs for it — the dashboard's "Confirm email" is GoTrue's own.
  const vouched = async (sql, params) => { await db.exec(`set gt3test.vouched = 'on'`); try { return (await q1(sql, params)); } finally { await db.exec(`set gt3test.vouched = 'off'`); } };
  await invite("oli@example.test", "server");
  const oli = await signUp("oli@example.test", { password: "a-strangers-hash" });
  const said = (await vouched(`select public.confirm_address(' OLI@example.test ') r`)).r;
  ok("0423 (fourth pass): confirm_address proves the address by hand, claims the invite, takes the password set before it — and says each",
    said === "Confirmed by hand. The invite waiting for it is claimed. The password set before now is taken — whoever set it may not be them: they sign in with a code and choose one (their mail never arrives? set one with them there: select public.set_password_by_hand('…', '…');)."
      && (await passwordOf(oli)) === "" && (await roleOf(oli)) === "server" && (await claimedBy("oli@example.test")) === oli && (await markOf(oli)) === true, said);
  const late = (await vouched(`select public.confirm_address('raj@example.test') r`)).r;
  ok("0423 (third pass): …an address already confirmed (the dashboard's Create user) has its waiting invite claimed now — the owner's own password on it stays (nothing was sent: confirmation_sent_at was never set)",
    late === "Already confirmed. The invite waiting for it is claimed. Its password stays." && (await roleOf(raj)) === "operator" && (await passwordOf(raj)) === "rajs-own-hash", late);
  ok("0423 (third pass): …an address nobody has, and one with nothing waiting, are said",
    (await vouched(`select public.confirm_address('nobody@example.test') r`)).r === "No account has that address."
      && (await vouched(`select public.confirm_address('raj@example.test') r`)).r === "Already confirmed. Nothing was waiting for it. Its password stays.");
  let refused = null;
  try { await q(`select public.confirm_address('zoe@example.test')`); } catch (e) { refused = e; }
  ok("0423 (third pass): …outside the SQL editor it refuses, and changes nothing", refused?.code === "42501" && /in the SQL editor/.test(refused?.message ?? ""), refused?.message);
  const viaApi = await as(OWNER, `select public.confirm_address('zoe@example.test')`);
  ok("0423 (third pass): …and the app has no door to it — not even an owner's", /permission denied/i.test(viaApi.error ?? ""), viaApi.error);
  ok("0423 (fifth pass): …and where it takes a password it names the way in for someone whose mail never comes", /set_password_by_hand/.test(said), said);

  // set_password_by_hand: the owner's way in for someone whose mail never arrives (the fifth pass).
  await signIn(oli);
  const set = (await vouched(`select public.set_password_by_hand('oli@example.test', 'olis-temporary-pw') r`)).r;
  const oliRow = await q1(`select encrypted_password p, confirmation_sent_at s from auth.users where id = $1`, [oli]);
  ok("0423 (fifth pass): set_password_by_hand sets a bcrypt password GoTrue reads, as GoTrue's own change would (confirmation_sent_at cleared, every session ended) — and asks them to choose their own",
    set === "Set by hand. Say it to them in person — they sign in with it, and are asked to choose their own at every sign-in until they do. Then clear this query from the editor's history: the password is in it."
      && /^\$2a\$10\$/.test(oliRow.p) && (await q1(`select extensions.crypt('olis-temporary-pw', $1) = $1 ok`, [oliRow.p])).ok === true
      && oliRow.s === null && (await signedIn(oli)).sessions === 0 && (await signedIn(oli)).live === 0 && (await markOf(oli)) === true, { set, s: oliRow.s });
  ok("0423 (sixth pass): …at GoTrue's own cost (10), and its answer says to clear the query from the editor's history", /\$2a\$10\$/.test(oliRow.p) && /clear this query from the editor's history/.test(set ?? ""));
  const oliNotNow = await as(oli, `select public.password_not_now()`);
  ok("0423 (sixth pass): …a password the owner set is one the owner knows — \"Not now\" leaves them asked until they choose their own",
    !oliNotNow.error && (await markOf(oli)) === true, oliNotNow.error);
  await setPassword(oli, "olis-own-hash");
  ok("0423 (sixth pass): …and choosing one takes both marks off", (await markOf(oli)) === false
    && (await q1(`select password_set_by_hand_at is null n from public.profiles where id = $1`, [oli])).n === true);
  const oliNow = await passwordOf(oli);
  ok("0423 (fifth pass): …refuses a short one, an address not confirmed, and nobody, each said — and changes nothing",
    (await vouched(`select public.set_password_by_hand('oli@example.test', 'short') r`)).r === "A password is at least 8 characters — nothing was changed."
      && (await vouched(`select public.set_password_by_hand('nobody@example.test', 'long-enough-pw') r`)).r === "No account has that address."
      && (await passwordOf(oli)) === oliNow);
  const unproven = await signUp("wes@example.test", { password: "a-strangers-hash" });
  ok("0423 (fifth pass): …an address not confirmed is sent to confirm_address first",
    /isn't confirmed yet — confirm it first: select public\.confirm_address\('wes@example\.test'\);/.test((await vouched(`select public.set_password_by_hand('wes@example.test', 'long-enough-pw') r`)).r ?? "")
      && (await passwordOf(unproven)) === "a-strangers-hash");
  await signUp("o'brien@example.test", { password: "a-hash" });
  ok("0423 (sixth pass): …the query it suggests is quoted as SQL — an address with an apostrophe too",
    (await vouched(`select public.set_password_by_hand($1, 'long-enough-pw') r`, ["o'brien@example.test"])).r?.endsWith("select public.confirm_address('o''brien@example.test');"));
  let refusedSet = null;
  try { await q(`select public.set_password_by_hand('oli@example.test', 'long-enough-pw')`); } catch (e) { refusedSet = e; }
  ok("0423 (fifth pass): …outside the SQL editor it refuses, and the app has no door to it",
    refusedSet?.code === "42501" && /permission denied/i.test((await as(OWNER, `select public.set_password_by_hand('oli@example.test', 'long-enough-pw')`)).error ?? ""), refusedSet?.message);

  // The paste checks first that it may write auth.users (the fifth pass): a role that can't is stopped, with nothing done.
  const guard = M423.slice(M423.indexOf("do $$ begin\n  if not (has_table_privilege('auth.users', 'UPDATE')"), M423.indexOf("end $$;", M423.indexOf("has_table_privilege('auth.users', 'UPDATE')")) + "end $$;".length);
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'r18_no_auth') then create role r18_no_auth; end if; end $$; grant usage on schema auth to r18_no_auth;`);
  let stopped = null;
  try { await db.exec(`set role r18_no_auth; ${guard}`); } catch (e) { stopped = e; } finally { await db.exec(`reset role`); }
  ok("0423 (fifth pass): the paste stops at its first step for a role that may not write auth.users — and says which role, and what it needs",
    guard.length > 100 && /0423 needs UPDATE on auth\.users, DELETE on auth\.sessions and UPDATE on auth\.refresh_tokens for the role running it \(r18_no_auth\)/.test(stopped?.message ?? ""), stopped?.message ?? guard.slice(0, 80));

  const again = await q1(`select public.claim_team_invites($1, 'lee@example.test') n`, [lee]);
  ok("0423: an invite already claimed is not claimed again", Number(again.n) === 0 && (await roleOf(lee)) === "operator");
  const call = await as(MEMBER, `select public.claim_team_invites($1, 'nobody@example.test')`, [MEMBER]);
  ok("0423: the claim is not a door anyone can call (signed in or not)", /permission denied/i.test(call.error ?? "") && /permission denied/i.test((await as(null, `select public.claim_team_invites($1, 'x@example.test')`, [MEMBER])).error ?? ""), call.error);
  ok("0423: an existing crew role is never lowered by a claim", (await q1(`select public.claim_team_invites($1, 'kim@example.test') n`, [CREW])) && (await roleOf(CREW)) === "operator");
  const priv = await q1(`select has_function_privilege('authenticated', 'public.password_chosen()', 'execute') a,
    has_function_privilege('anon', 'public.password_waits_for_proof()', 'execute') b, has_function_privilege('authenticated', 'public.password_not_now()', 'execute') c,
    has_function_privilege('authenticated', 'public.take_signup_password(uuid)', 'execute') d, has_function_privilege('authenticated', 'public.password_scope_everywhere()', 'execute') e`);
  ok("0423 (third and fourth passes): the proof test, the switch and the mark's writers are not doors anyone can call — only \"Not now\" is, signed in",
    /permission denied/i.test((await as(MEMBER, `select public.address_proved_itself(null, null)`)).error ?? "") && priv.a === false && priv.b === false && priv.c === true && priv.d === false && priv.e === false, priv);
}

// ── the money on a shop order, a jug count and an expense keeps its doors ────────────────────────────────────────────
{
  const so = await as("service", `insert into public.shop_orders (email, subtotal_cents, total_cents, status, tenant_id) values ('nia@example.test', 3000, 3000, 'paid', $1) returning id`, [T1]);
  ok("0423: the checkout (the server) still makes a shop order", !so.error, so.error);
  const id = so.rows[0].id;
  const make = await as(CREW, `insert into public.shop_orders (email, subtotal_cents, total_cents, status, tenant_id) values ('x@example.test', 1, 1, 'paid', $1)`, [T1]);
  ok("0423: a page cannot make a shop order", make.code === "42501", make);
  for (const [col, val] of [["total_cents", 1], ["refund_amount_cents", 3000], ["status", "'refunded'"], ["payment_id", "'pay_fake'"], ["user_id", `'${MEMBER}'`]]) {
    const r = await as(CREW, `update public.shop_orders set ${col} = ${val} where id = $1`, [id]);
    ok(`0423: a crew page cannot change a shop order's ${col}`, r.code === "42501" && r.error.includes(col), r);
  }
  const note = await as(CREW, `update public.shop_orders set note = 'left at the side door' where id = $1 returning id`, [id]);
  ok("0423: …a note on it still writes as before", !note.error && note.rows.length === 1, note.error);
  const adm = await as(ADMIN, `update public.shop_orders set refund_amount_cents = 500 where id = $1 returning id`, [id]);
  ok("0423: an admin can correct one", !adm.error && adm.rows.length === 1, adm.error);
  // The guard covers a page signed out too (review, R18): a grant and a row rule a later migration opened to anon would
  // still meet it — opened here for the test alone, and closed again.
  await db.exec(`create policy zz_r18_anon_open on public.shop_orders for all to anon using (true) with check (true); grant select, update on public.shop_orders to anon;`);
  const anonEdit = await as(null, `update public.shop_orders set total_cents = 1 where id = $1`, [id]);
  await db.exec(`drop policy zz_r18_anon_open on public.shop_orders; revoke select, update on public.shop_orders from anon;`);
  ok("0423: a page signed out (anon) meets the same guard, even where a grant and a rule would let it write", anonEdit.code === "42501" && anonEdit.error.includes("total_cents"), anonEdit);

  const line = await as("service", `insert into public.shop_order_items (order_id, title, qty, unit_cents, cost_cents) values ($1, 'GT3 tee', 1, 3000, 1200) returning id`, [id]);
  ok("0423: the checkout still writes its lines", !line.error, line.error);
  const lineMake = await as(CREW, `insert into public.shop_order_items (order_id, title, qty, unit_cents) values ($1, 'free tee', 9, 0)`, [id]);
  const linePrice = await as(CREW, `update public.shop_order_items set unit_cents = 1 where id = $1`, [line.rows[0].id]);
  ok("0423: a page cannot add a line or change its price", lineMake.code === "42501" && linePrice.code === "42501", [lineMake, linePrice]);

  const jug = await as(CREW, `insert into public.jug_ledger (jugs_out, jugs_in, note) values (5, 0, 'hand count')`);
  ok("0423: a page cannot write a jug count (the delivery's door does)", jug.code === "42501", jug);
  const jugRow = await as("service", `insert into public.jug_ledger (jugs_out, jugs_in, balance_after) values (3, 0, 3) returning id`);
  const jugEdit = await as(CREW, `update public.jug_ledger set jugs_in = 3 where id = $1`, [jugRow.rows[0].id]);
  ok("0423: …nor change one", !jugRow.error && jugEdit.code === "42501", [jugRow.error, jugEdit]);

  const ex = await as(CREW, `insert into public.expenses (category, description, amount_cents, created_by) values ('supplies', 'cups', 2400, $1) returning id`, [CREW]);
  ok("0423: the crew still log a purchase", !ex.error && ex.rows.length === 1, ex.error);
  const eid = ex.rows[0].id;
  const voidedNew = await as(CREW, `insert into public.expenses (category, amount_cents, created_by, voided_at) values ('supplies', 100, $1, now())`, [CREW]);
  ok("0423: …but not one logged already voided", voidedNew.code === "42501", voidedNew);
  for (const [col, val] of [["amount_cents", 24], ["spent_on", "current_date - 40"], ["voided_at", "now()"], ["created_by", `'${ADMIN}'`]]) {
    const r = await as(CREW, `update public.expenses set ${col} = ${val} where id = $1`, [eid]);
    ok(`0423: a crew page cannot change an expense's ${col}`, r.code === "42501", r);
  }
  const desc = await as(CREW, `update public.expenses set description = 'cups, 16 oz', receipt_path = 'r/1.jpg' where id = $1 returning id`, [eid]);
  ok("0423: …its words and its receipt still write", !desc.error && desc.rows.length === 1, desc.error);
  const voided = await as(CREW, `select (public.void_expense($1, 'logged twice')).voided_at is not null v`, [eid]);
  ok("0423: voiding goes through its own door (void_expense), for the crew as before", !voided.error && voided.rows[0].v === true, voided.error);
  const ex2 = await as(CREW, `insert into public.expenses (category, amount_cents, created_by) values ('supplies', 900, $1) returning id`, [CREW]);
  const fix = await as(ADMIN, `update public.expenses set amount_cents = 990 where id = $1 returning amount_cents`, [ex2.rows[0].id]);
  ok("0423: Money's spend editor (an owner or admin) still corrects an amount", !fix.error && fix.rows[0]?.amount_cents === 990, fix.error);

  ok("0423: the guard stands on the eight money tables", (await n(`select count(*) n from pg_trigger where tgname = 'a_money_columns_guard'`)) === 8);
  const pack = await as(CREW, `update public.drop_orders set paid = true where false`);
  ok("0423: 0420's four tables keep their guard (the function was rewritten, not narrowed)", !pack.error
    && /'drop_orders' +then array\['paid'/.test((await q1(`select prosrc from pg_proc where proname = 'money_columns_guard'`)).prosrc), pack.error);
}

// ── the business day where the calendar was still UTC ────────────────────────────────────────────────────────────────
{
  const def = async (sql) => (await q1(sql)).d;
  const ml = await def(`select pg_get_viewdef('public.market_live') d`), ao = await def(`select pg_get_viewdef('public.all_orders') d`);
  ok("0423: market_live and all_orders ask business_day(), not the UTC calendar", /business_day\(\)/.test(ml) && !/CURRENT_DATE/i.test(ml) && /business_day\(\)/.test(ao) && !/CURRENT_DATE/i.test(ao));
  const ro = await def(`select prosrc d from pg_proc where proname = 'respond_to_offer'`), eb = await def(`select prosrc d from pg_proc where proname = 'account_erasure_blockers'`);
  ok("0423: respond_to_offer and account_erasure_blockers ask business_day() too", /business_day\(\)/.test(ro) && !/current_date/.test(ro) && (eb.match(/business_day\(\)/g) || []).length === 2 && !/current_date/.test(eb));
  ok("0423: market_live stays readable signed out (its grants kept)", !(await as(null, `select market from public.market_live limit 1`)).error);
  const today = (await q1(`select public.business_day()::text d`)).d;
  await q(`insert into public.markets (slug, name, opens_on) values ('test-today', 'Test Today', $1::date), ('test-tomorrow', 'Test Tomorrow', $1::date + 1) on conflict (slug) do update set opens_on = excluded.opens_on`, [today]);
  const live = await q(`select market, pre_launch from public.market_live where market in ('test-today', 'test-tomorrow') order by market`);
  ok("0423: a city opening on the business day is open, one opening tomorrow is still to come", JSON.stringify(live.map((r) => r.pre_launch)) === "[false,true]", live);
}

// ── a job that stopped, and a request the database sent that failed, are said ────────────────────────────────────────
{
  const job = async (name) => (await q1(`insert into cron.job (jobname, schedule, command) values ($1, '*/10 * * * *', 'select 1') returning jobid`, [name])).jobid;
  const ran = (jobid, minutesAgo, status = "succeeded") => q(`insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
    values ($1, $2, '', now() - make_interval(mins => $3), now() - make_interval(mins => $3) + interval '1 second')`, [jobid, status, minutesAgo]);
  const stopped = await job("stopped-job"), fine = await job("fine-job"), daily = await job("daily-job"), young = await job("young-job");
  for (const m of [120, 130, 140, 150]) await ran(stopped, m);   // every ten minutes, then nothing for two hours
  for (const m of [5, 15, 25]) await ran(fine, m);
  for (const m of [20 * 60, 44 * 60, 68 * 60]) await ran(daily, m);   // once a day, last 20 hours ago
  for (const m of [300, 310]) await ran(young, m);                     // two runs: too few to know its rhythm
  const said = Number((await q1(`select public.cron_watch() n`)).n);
  const stalled = await q(`select title, body, severity, category, link from public.alerts where kind = 'cron_stalled' and ack_at is null`);
  ok("0423: a job that started every ten minutes and has gone two hours without starting is said, once",
    stalled.length === 1 && stalled[0].title === "A scheduled job stopped running — stopped-job" && /every 10 minutes/.test(stalled[0].body)
      && /ET\.$/.test(stalled[0].body) && stalled[0].severity === "important" && stalled[0].category === "system" && said >= 1, stalled);
  ok("0423: a job on its rhythm, a daily one inside three days, and one with too few runs to know are not", stalled.every((a) => !/fine-job|daily-job|young-job/.test(a.title)));
  await q(`select public.cron_watch()`);
  ok("0423: watched again, it is still one alert (alert_open_once)", (await n(`select count(*) n from public.alerts where kind = 'cron_stalled' and ack_at is null`)) === 1);

  // Only an active job on an every-day schedule is read for its gaps (review, R18): a weekday-only job's weekend, a
  // service window's night and a paused job's silence are not a job that stopped. A minute list still is every day.
  const jobAt = async (name, schedule, active = true) =>
    (await q1(`insert into cron.job (jobname, schedule, command, active) values ($1, $2, 'select 1', $3) returning jobid`, [name, schedule, active])).jobid;
  const weekdays = await jobAt("weekday-job", "*/10 * * * 1-5"), windowed = await jobAt("window-job", "*/10 9-17 * * *");
  const paused = await jobAt("paused-job", "*/10 * * * *", false), listed = await jobAt("list-job", "0,30 * * * *");
  for (const id of [weekdays, windowed, paused]) for (const m of [120, 130, 140, 150]) await ran(id, m);
  for (const m of [180, 210, 240, 270]) await ran(listed, m);           // every half hour, then three hours of nothing
  await q(`select public.cron_watch()`);
  const open = (await q(`select title from public.alerts where kind = 'cron_stalled' and ack_at is null order by title`)).map((a) => a.title);
  ok("0423: a weekday-only job, a job with a service window and a paused job are never 'stopped' — the same silence, no alarm",
    open.every((t) => !/weekday-job|window-job|paused-job/.test(t)), open);
  ok("0423: …a job on a minute list ('0,30 * * * *') is every day, and is said", open.some((t) => / — list-job$/.test(t)) && open.length === 2, open);

  // R18 review: schedules whose gaps are uneven by design are read by their long gap, or not at all.
  const hourly3 = await jobAt("three-am-job", "* 3 * * *"), uneven = await jobAt("uneven-job", "0,10,20 * * * *"), twoHourly = await jobAt("two-hour-job", "0 */2 * * *");
  for (const m of [60 * 20, 60 * 20 + 1, 60 * 20 + 2, 60 * 20 + 3]) await ran(hourly3, m);              // a minute apart, twenty hours ago
  for (const m of [35, 45, 55, 95, 105, 115, 155, 165, 175]) await ran(uneven, m);                      // :00 :10 :20 each hour; the :20 was 35 minutes ago
  for (const m of [7 * 60, 9 * 60, 11 * 60, 13 * 60]) await ran(twoHourly, m);                          // every two hours, then seven hours of nothing
  await q(`select public.cron_watch()`);
  const open2 = (await q(`select title, body from public.alerts where kind = 'cron_stalled' and ack_at is null`));
  ok("0423 (review): a job that runs every minute of one hour ('* 3 * * *') is not read for gaps — never 'stopped' between its hours", open2.every((a) => !/three-am-job/.test(a.title)), open2.map((a) => a.title));
  ok("0423 (review): a minute list with an uneven hour ('0,10,20') is read by its long gap — forty minutes — and is not called stopped thirty-five minutes on", open2.every((a) => !/uneven-job/.test(a.title)), open2.map((a) => a.title));
  const two = open2.find((a) => / — two-hour-job$/.test(a.title));
  ok("0423 (review): …and a job every two hours, seven hours quiet, is said in hours", !!two && /usually starts about every 2 hours;/.test(two.body), two);
  const minutely = await jobAt("minute-job", "* * * * *");
  for (let m = 40; m < 60; m++) await ran(minutely, m);
  await q(`select public.cron_watch()`);
  const one = (await q1(`select body from public.alerts where kind = 'cron_stalled' and ack_at is null and title like '% — minute-job'`))?.body ?? "";
  ok("0423 (review): one is one — 'about every 1 minute', not '1 minutes'", /usually starts about every 1 minute;/.test(one), one);

  // The job that starts again closes its own line: the mechanism's ack (ack_by left null), and it isn't reopened.
  await q(`update public.alerts set created_at = now() - interval '5 minutes' where kind = 'cron_stalled' and title like '% — stopped-job'`);
  await ran(stopped, 1);
  await q(`select public.cron_watch()`);
  const back = await q(`select ack_at is not null as closed, ack_by from public.alerts where kind = 'cron_stalled' and title like '% — stopped-job'`);
  ok("0423: a stopped job that starts again closes its own alert — the mechanism's ack, nobody's name on it",
    back.length === 1 && back[0].closed === true && back[0].ack_by === null, back);
  await q(`select public.cron_watch()`);
  ok("0423: …and the next watch doesn't open it again (one row, still closed)",
    (await n(`select count(*) n from public.alerts where kind = 'cron_stalled' and title like '% — stopped-job' and ack_at is null`)) === 0
      && (await n(`select count(*) n from public.alerts where kind = 'cron_stalled' and title like '% — stopped-job'`)) === 1);

  ok("0423: nothing the database sent has failed → nothing said", (await n(`select count(*) n from public.alerts where kind = 'db_http_failed'`)) === 0);
  await q(`insert into net._http_response (id, status_code, timed_out, error_msg, created) values (1, 200, false, null, now() - interval '2 minutes'),
    (2, 500, false, null, now() - interval '90 minutes')`);
  await q(`select public.cron_watch()`);
  ok("0423: a success, and a failure an hour and a half ago, are not said", (await n(`select count(*) n from public.alerts where kind = 'db_http_failed'`)) === 0);
  await q(`insert into net._http_response (id, status_code, timed_out, error_msg, created) values (3, 401, false, null, now() - interval '3 minutes'),
    (4, null, true, null, now() - interval '1 minute')`);
  await q(`select public.cron_watch()`);
  const http = await q(`select title, body from public.alerts where kind = 'db_http_failed' and ack_at is null`);
  ok("0423: requests that failed in the last twenty minutes are one alert, counting them and saying the last",
    http.length === 1 && http[0].title === "Requests the database sends are failing — 2 in 20 minutes" && /The last said: timed out\.$/.test(http[0].body), http);

  // pg_net's answers that can't be read (any error, not only a missing table — review, R18): the run still writes the
  // failed-job line, and an open request line stays open (unread is not answering again).
  await ran(fine, 2, "failed");
  await q(`alter table net._http_response rename column timed_out to timed_out_was`);
  const blind = await q(`select public.cron_watch() n`).then((r) => ({ r }), (e) => ({ e: e.message }));
  await q(`alter table net._http_response rename column timed_out_was to timed_out`);
  ok("0423: pg_net's answers unreadable — cron_watch still runs, and the failing job is said in that run",
    !blind.e && (await n(`select count(*) n from public.alerts where kind = 'cron_failed' and title = 'A scheduled job is failing — fine-job' and ack_at is null`)) === 1, blind);
  ok("0423: …and the open request line stays open — unread is not answering again",
    (await n(`select count(*) n from public.alerts where kind = 'db_http_failed' and ack_at is null`)) === 1);

  await q(`update net._http_response set created = now() - interval '30 minutes' where id in (3, 4)`);
  await q(`select public.cron_watch()`);
  const calm = await q(`select ack_at is not null as closed, ack_by from public.alerts where kind = 'db_http_failed'`);
  ok("0423: nothing failed in the last twenty minutes — the request line closes itself (the mechanism's ack)",
    calm.length === 1 && calm[0].closed === true && calm[0].ack_by === null, calm);
  ok("0423: cron_watch is not a door anyone can call", /permission denied/i.test((await as(MEMBER, `select public.cron_watch()`)).error ?? ""));
}

// ── what a public bucket takes, and the indexes ──────────────────────────────────────────────────────────────────────
{
  const b = await q(`select id, file_size_limit::bigint s, allowed_mime_types t from storage.buckets
                      where id in ('content', 'shop', 'brand', 'training', 'intake', 'note-files', 'receipts') order by id`);
  const by = Object.fromEntries(b.map((r) => [r.id, r]));
  const types = (k) => JSON.stringify(by[k]?.t);
  ok("0423: content takes images and videos up to 100 MB", Number(by.content?.s) === 104857600 && types("content") === '["image/*","video/*"]', by.content);
  ok("0423 (review): the shop takes what its picker takes, type for type (lib/shopMedia) — never an SVG in a public bucket — up to 100 MB",
    Number(by.shop?.s) === 104857600 && types("shop") === '["image/jpeg","image/png","image/webp","image/avif","image/gif","video/mp4","video/quicktime","video/webm"]', by.shop);
  ok("0423: brand and training take images up to 12 MB", ["brand", "training"].every((k) => Number(by[k]?.s) === 12582912 && types(k) === '["image/*"]'), [by.brand, by.training]);
  ok("0423: intake takes a picture, a PDF or a text file (SmartIntake), up to 25 MB",
    Number(by.intake?.s) === 26214400 && types("intake") === '["image/*","application/pdf","text/plain","text/csv","text/markdown"]', by.intake);
  ok("0423: note files take pictures, a PDF or a text file (NoteAttach), up to 25 MB",
    Number(by["note-files"]?.s) === 26214400 && types("note-files") === '["image/*","application/pdf","text/plain"]', by["note-files"]);
  ok("0423: receipts take a photo or a PDF (LogPurchase), and keep 0292's 20 MB",
    Number(by.receipts?.s) === 20971520 && types("receipts") === '["image/*","application/pdf"]', by.receipts);
  ok("0423: the four foreign keys the alerts and money doors walk are indexed",
    (await n(`select count(*) n from pg_indexes where indexname in ('orders_collected_by_idx', 'drop_orders_collected_by_idx', 'loyalty_ledger_by_user_idx', 'alerts_ack_by_idx')`)) === 4);
  ok("0423: recorded in the ledger", (await n(`select count(*) n from public.schema_migrations where version like '0423_%'`)) === 1);
}

// ── 0424 (held): a password set before the proof waits for it, on every account ─────────────────────────────────────
{
  const M424 = readFileSync(join(ROOT, "supabase/migrations/0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql"), "utf8");
  const held = JSON.parse(readFileSync(join(ROOT, "supabase/held.json"), "utf8")).held.map((h) => h.file);
  // The paste file as generated: 0424 named among its held files and absent from what it runs. (It once also had to carry
  // 0423 — pending then; applied 2026-10-18, so the file now starts after it.)
  const pasteFile = readFileSync(join(ROOT, "supabase/APPLY_ALL_PENDING.sql"), "utf8"), paste = pasteFile.replace(/^--.*$/gm, "");
  ok("0424 is held (supabase/held.json) and is not in the paste file — it waits for R18's iPhone build to be on the phones",
    held.includes("0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql") && !/0424_a_password_set_before_the_proof/.test(paste)
      && /^-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere\.sql — NOT in this file/m.test(pasteFile), held);
  await db.exec(M424);
  await db.exec(M424);   // a second run changes nothing
  ok("0424: the rule reaches every account", (await q1(`select public.password_scope_everywhere() v`)).v === true);
  const pia = await signUp("pia@example.test", { password: "a-strangers-hash" });
  await prove(pia);
  ok("0424: a customer account's password set before the proof goes at the proof — the stranger who made it is not in — and the account is marked",
    (await passwordOf(pia)) === "" && (await markOf(pia)) === true && (await roleOf(pia)) === "member");
  const zed = await codeJoin("zed@example.test");
  await prove(zed);
  ok("0424: a customer's code sign-up: GoTrue's random password taken, nobody asked", (await passwordOf(zed)) === "" && (await markOf(zed)) === false);
  const ken = await signUp("ken@example.test", { password: "kens-own-hash", sendsConfirmation: false, confirmed: true });
  ok("0424: an account made already confirmed still keeps its password — nothing was proven, nothing is taken", (await passwordOf(ken)) === "kens-own-hash" && (await markOf(ken)) === false);
  const ray = await signUp("ray@example.test", { password: "a-strangers-hash" });
  await byHand(ray);
  ok("0424: an owner's hand proves the address, and the password set before it goes — as any proof's", (await passwordOf(ray)) === "" && (await markOf(ray)) === true);
  await invite("tia@example.test");
  const tia = await signUp("tia@example.test", { password: "a-strangers-hash" });
  await prove(tia);
  ok("0424: an invited address as before — taken, marked, and claimed", (await passwordOf(tia)) === "" && (await markOf(tia)) === true && (await roleOf(tia)) === "operator");
  await db.exec(M423);   // 0423 pasted again, after 0424
  const kit = await signUp("kit@example.test", { password: "a-strangers-hash" });
  await prove(kit);
  ok("0424: pasting 0423 again after it leaves the rule reaching every account (0423 makes its switch only where there is none)",
    (await q1(`select public.password_scope_everywhere() v`)).v === true && (await passwordOf(kit)) === "");
  ok("0424: recorded in the ledger, with one changelog line",
    (await n(`select count(*) n from public.schema_migrations where version like '0424_%'`)) === 1
      && (await n(`select count(*) n from public.changelog where title = 'An account is only ever its owner''s'`)) === 1);
}

console.log(`\nR18 — 0423 AND 0424 (HELD), IN POSTGRES: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
