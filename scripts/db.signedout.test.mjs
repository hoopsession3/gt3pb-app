// 0401 — A SIGNED-OUT CALLER REACHES ONLY WHAT IS MEANT FOR IT, executed from its file against the whole schema (every
// migration before it, in order, with Supabase's own default privileges: scripts/fixtures/schema.full.mjs), acting as
// anon, a member, the crew and the server the way PostgREST does.
//
// The finding, as a sentence: Supabase grants every function made in public to anon BY NAME, so a revoke "from public"
// alone — or none at all — left 55 SECURITY DEFINER functions answering a caller with no session, 44 of them never granted
// to anon by any migration; and two of those (respond_to_offer, respond_to_agreement) let that caller answer an offer or
// an agreement not yet tied to an account.
//
// The schema here is checked against production as it was measured on each side of 0401 — 55 definer functions open to
// anon and 116 to the signed-in at ledger 0400, the fourteen open to anon by name at ledger 0401 (the security snapshot
// and Supabase's advisor agreed both times). Those are facts about 0401, written here, not read from
// supabase/schema.security.json: that file moves on with every snapshot, and a migration's test must not move with it
// (it did once — the snapshot pulled after 0401 broke this test's "before" check, 2026-10-14).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL401 = readFileSync(join(ROOT, "supabase/migrations/0401_a_signed_out_caller_reaches_only_what_is_meant_for_it.sql"), "utf8");
// Production, measured after 0401 was applied (ledger 0401, 2026-10-14): the definer functions a caller with no session may call.
const MEASURED_ANON_0401 = ["cancel_by_ticket(p_ticket uuid)", "effective_tenant()", "field_ops_drift()", "is_admin()", "is_owner()",
  "is_staff()", "keep_app_push_token(p_token text)",
  "keep_push_device(p_endpoint text, p_p256dh text, p_auth text, p_crew boolean, p_wants_live boolean)",
  "market_visible(p_market text)", "order_ticket(p_ticket uuid)", "primal_menu_for_lesson(_lesson_id uuid)", "stop_menu(p_stop uuid)",
  "ticket_eta(p_ticket uuid, p_eta text)", "track_guest()"];
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c401000-0000-4000-8000-0000000000c1", SAM = "0c401000-0000-4000-8000-0000000000a1";
const CANDIDATE = "0c401000-0000-4000-8000-0000000000a2", OPERATOR = "0c401000-0000-4000-8000-0000000000a3";

const t0 = Date.now();
const db = await fullSchema({ before: "0401" });
console.log(`the schema before 0401 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
// "server" is the service role with no session (the routes, the cron); a uid is a signed-in person; null is anon.
const as = async (uid, sql, params, email) => {
  const sub = uid && uid !== "server" ? uid : "";
  const claims = email ? JSON.stringify({ sub, email }).replace(/'/g, "''") : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claims', '${claims}', false);
    set role ${uid === "server" ? "service_role" : uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code }; }
  finally { await root(); }
};
for (const [id, role, email] of [[OWNER, "owner", "owner@example.test"], [SAM, "member", "sam@example.test"],
  [CANDIDATE, "member", "casey@example.test"], [OPERATOR, "member", "olive@example.test"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}

// Every SECURITY DEFINER function in public, as "name(identity args)", that a role may execute.
const open = async (role) => (await q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.f);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const diff = (a, b) => ({ onlyHere: a.filter((x) => !b.includes(x)).slice(0, 6), onlyThere: b.filter((x) => !a.includes(x)).slice(0, 6) });

// ── THE SCHEMA HERE IS PRODUCTION'S, AS MEASURED ────────────────────────────────────────────────────────────────────────
const anonBefore = await open("anon"), authBefore = await open("authenticated"), svcBefore = await open("service_role");
ok("before 0401: 55 definer functions open to anon, as production measured at ledger 0400", anonBefore.length === 55, anonBefore.length);
ok("before 0401: 116 open to the signed-in, as production measured", authBefore.length === 116, authBefore.length);
ok("before 0401: every one of the fourteen production keeps open to anon after 0401 is among the 55",
  MEASURED_ANON_0401.every((f) => anonBefore.includes(f)), MEASURED_ANON_0401.filter((f) => !anonBefore.includes(f)));
ok("before 0401: a guest's cup reminder is refused by the function's own check, not by its grant",
  /Sign in to be reminded/.test((await as(null, `select public.keep_cup_reminder(gen_random_uuid(), now())`)).error || ""));

// ── THE TWO THAT LET A STRANGER ANSWER, BEFORE ──────────────────────────────────────────────────────────────────────────
// Offers and agreements made the way the crew's screens make them, then put straight to "sent" (the approval chain is
// 0281's and 0286's, tested there); neither is tied to an account yet.
await db.exec(`alter table public.offer_letters disable trigger user; alter table public.operator_agreements disable trigger user;`);
const offer = async () => (await q1(`insert into public.offer_letters (candidate_name, candidate_email, title, base_cents, rate_per, status, tenant_id)
  values ('Casey', 'casey@example.test', 'Barista', 3600000, 'year', 'sent', $1) returning id`, [T1])).id;
const agreement = async () => (await q1(`insert into public.operator_agreements (operator_name, operator_email, status, tenant_id)
  values ('Olive', 'olive@example.test', 'sent', $1) returning id`, [T1])).id;
await db.exec(`alter table public.offer_letters enable trigger user; alter table public.operator_agreements enable trigger user;`);
const O1 = await offer(), A1 = await agreement();
const strangerOffer = await as(null, `select status from public.respond_to_offer($1, 'decline', 'not me')`, [O1]);
ok("before 0401: a caller with no session declines an offer sent to an email with no account yet — the hole",
  !strangerOffer.error && strangerOffer.rows[0]?.status === "declined", strangerOffer);
const strangerDeal = await as(null, `select status from public.respond_to_agreement($1, 'accept', null)`, [A1]);
ok("before 0401: …and accepts an agreement not yet tied to its operator",
  !strangerDeal.error && strangerDeal.rows[0]?.status === "accepted", strangerDeal);

// ── 0401 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(SQL401);
let again = null;
try { await db.exec(SQL401); } catch (e) { again = String(e.message || e); }
ok("0401 runs twice and changes nothing the second time", again === null, again);
ok("the ledger says 0401 ran", (await q(`select 1 from public.schema_migrations where version = '0401_a_signed_out_caller_reaches_only_what_is_meant_for_it'`)).length === 1);

const anonAfter = await open("anon"), authAfter = await open("authenticated"), svcAfter = await open("service_role");
const KEPT = ["effective_tenant()", "is_owner()", "primal_menu_for_lesson(_lesson_id uuid)"];
// The 41 names, as 0401 itself lists them (its first DO block).
const NAMES = [...SQL401.slice(SQL401.indexOf("names text[] := array["), SQL401.indexOf("];", SQL401.indexOf("names text[] := array["))).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const closed = anonBefore.filter((f) => !anonAfter.includes(f));
const closedNames = [...new Set(closed.map((f) => f.slice(0, f.indexOf("("))))].sort();
ok(`a caller with no session reaches ${anonAfter.length} definer functions, not ${anonBefore.length}: the ones closed are exactly 0401's ${NAMES.length} names`,
  NAMES.length === 41 && anonAfter.length === 14 && JSON.stringify(closedNames) === JSON.stringify([...NAMES].sort()), { after: anonAfter.length, closedNames: closedNames.length });
ok("kept for anon: the two row-level policies judge signed-out readers with, and a rookie lesson's drink stack",
  KEPT.every((f) => anonAfter.includes(f)), KEPT.filter((f) => !anonAfter.includes(f)));
ok("after 0401: the fourteen open to anon are exactly the ones production measured at ledger 0401",
  same(anonAfter, MEASURED_ANON_0401), diff(anonAfter, MEASURED_ANON_0401));
// What anon still reaches, apart from the three kept, some migration grants to anon by name.
const MIGS = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .map((f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8").replace(/--.*$/gm, "")).join("\n");
const grantedToAnon = (name) => new RegExp(`grant\\s+(execute|all)[^;]*function\\s+(public\\.)?${name}\\s*\\([^;]*\\bto\\b[^;]*\\banon\\b`, "i").test(MIGS);
const unexplained = anonAfter.filter((f) => !KEPT.includes(f) && !grantedToAnon(f.slice(0, f.indexOf("("))));
ok("every other function anon still reaches is granted to anon by name in a migration", unexplained.length === 0, unexplained);
ok("the signed-in reach exactly what they reached before — not one function more or fewer", same(authAfter, authBefore), diff(authAfter, authBefore));
ok("the server reaches exactly what it reached before", same(svcAfter, svcBefore), diff(svcAfter, svcBefore));
const publicLeft = await q(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname = any($1) and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')`,
  [closedNames]);
ok("none of the 41 is left to PUBLIC either (anon is a member of PUBLIC)", publicLeft.length === 0, publicLeft.map((r) => r.proname));

// ── WHAT A SIGNED-OUT CALLER GETS NOW ───────────────────────────────────────────────────────────────────────────────────
const denied = (r) => /permission denied/.test(r.error || "") && r.code === "42501";
ok("a guest's cup reminder: permission denied, as 0394 meant", denied(await as(null, `select public.keep_cup_reminder(gen_random_uuid(), now())`)));
ok("a guest cannot ask what a market brews", denied(await as(null, `select * from public.market_brew_capacity('greenville')`)));
ok("a guest cannot ask which shelf item a recipe ingredient is", denied(await as(null, `select * from public.resolve_ingredient('oat milk', 'greenville')`)));
ok("a guest cannot set a role, even to be refused", denied(await as(null, `select public.admin_set_role($1, 'admin')`, [SAM])));
const O2 = await offer(), A2 = await agreement();
ok("a guest cannot answer an offer: permission denied", denied(await as(null, `select public.respond_to_offer($1, 'decline', null)`, [O2])));
ok("a guest cannot answer an agreement: permission denied", denied(await as(null, `select public.respond_to_agreement($1, 'accept', null)`, [A2])));
// The guard in the function itself, for any caller that may execute it and has no session (the service role, the cron).
const noSession = await as("server", `select public.respond_to_offer($1, 'accept', null)`, [O2]);
ok("respond_to_offer refuses a caller with no session before anything else (28000), whatever its grants",
  noSession.code === "28000" && /Sign in to answer your offer/.test(noSession.error || ""), noSession);
const noSessionDeal = await as("server", `select public.respond_to_agreement($1, 'accept', null)`, [A2]);
ok("respond_to_agreement too", noSessionDeal.code === "28000" && /Sign in to answer your agreement/.test(noSessionDeal.error || ""), noSessionDeal);
ok("…and neither moved", (await q1(`select status from public.offer_letters where id = $1`, [O2])).status === "sent"
  && (await q1(`select status from public.operator_agreements where id = $1`, [A2])).status === "sent");

// ── WHAT THE SIGNED-IN STILL DO ─────────────────────────────────────────────────────────────────────────────────────────
const wrong = await as(SAM, `select public.respond_to_offer($1, 'accept', null)`, [O2], "sam@example.test");
ok("a signed-in stranger is still told it is not theirs", /Only the person this offer is for/.test(wrong.error || ""), wrong);
const mine = await as(CANDIDATE, `select status, candidate_user_id from public.respond_to_offer($1, 'accept', 'yes please')`, [O2], "casey@example.test");
ok("the candidate, signed in with the email it was sent to, accepts it — and the offer is tied to their account",
  !mine.error && mine.rows[0]?.status === "accepted" && mine.rows[0]?.candidate_user_id === CANDIDATE, mine);
await db.query(`update public.operator_agreements set operator_user_id = $2 where id = $1`, [A2, OPERATOR]);
const deal = await as(OPERATOR, `select status from public.respond_to_agreement($1, 'accept', null)`, [A2]);
ok("the operator answers their own agreement", !deal.error && deal.rows[0]?.status === "accepted", deal);
ok("a member keeps a cup reminder's call (the function answers; no permission error)",
  !denied(await as(SAM, `select public.keep_cup_reminder(gen_random_uuid(), now())`)));
const tracked = await as(SAM, `select public.track_user('menu', false)`);
ok("a member's day is still counted (track_user)", !tracked.error, tracked);
const asked = await as(SAM, `select public.admin_set_role($1, 'admin')`, [SAM]);
ok("a member may still ask to set a role, and is refused by the function, not the grant", asked.error && !denied(asked), asked);
const anonRead = await as(null, `select count(*)::int as n from public.live_status`);
ok("a signed-out reader still reads what the policies give it (effective_tenant kept for them)", !anonRead.error, anonRead);
const lesson = await as(null, `select * from public.primal_menu_for_lesson(gen_random_uuid())`);
ok("a signed-out reader still gets a rookie lesson's drink stack (primal_menu_for_lesson kept)", !lesson.error, lesson);

// ── THE INDEXES AND THE SEARCH PATHS ────────────────────────────────────────────────────────────────────────────────────
const idx = (await q(`select indexname from pg_indexes where schemaname = 'public' and indexname in ('rsvps_one_per_member', 'rsvps_member_once', 'products_tenant', 'products_tenant_idx') order by 1`)).map((r) => r.indexname);
ok("one of each twin is left: rsvps_member_once and products_tenant", idx.join() === "products_tenant,rsvps_member_once", idx);
const EV = (await q1(`insert into public.events (title, tenant_id) values ('Twin check', $1) returning id`, [T1])).id;
await db.query(`insert into public.rsvps (event_id, user_id, tenant_id) values ($1, $2, $3)`, [EV, SAM, T1]);
let twice = null;
try { await db.query(`insert into public.rsvps (event_id, user_id, tenant_id) values ($1, $2, $3)`, [EV, SAM, T1]); } catch (e) { twice = e.code; }
ok("…and a member still cannot RSVP to one event twice", twice === "23505", twice);
const loose = await q(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')`);
ok("every function of ours in public has a fixed search_path (an extension's own are not ours)", loose.length === 0, loose.map((r) => r.proname));

console.log(`0401 — A SIGNED-OUT CALLER REACHES ONLY WHAT IS MEANT FOR IT: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
