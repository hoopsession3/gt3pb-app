// R10b — THE REST OF THE 10/10 AUDIT OF THE BACK END, RUN IN POSTGRES (2026-10-16; Ryan: "then audit for 10/10 best
// practices... front and back end").
//
//   0421  a file is listed only by those it belongs to (the public buckets, note-files); a photo is an image under ten
//         megabytes; a subscription Square may have started is kept and said, never swept; the mailbox's tokens are the
//         server's; a button link is a path or a web address; an order is stamped with its event before its 86 check;
//         a brew's and a stop's day are Eastern; a lead moves people only within reach; the last owner is counted locked
//
// What is run here is the whole schema up to 0420, the findings reproduced on it, then 0421 — twice — as the roles that
// call it. Every person, file and order is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M421 = readFileSync(join(ROOT, "supabase/migrations/0421_files_are_their_owners_and_a_lost_answer_is_kept.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SAM = "0c421000-0000-4000-8000-0000000000a1";    // a member
const NIA = "0c421000-0000-4000-8000-0000000000a2";    // a member
const KAY = "0c421000-0000-4000-8000-0000000000b1";    // crew (server)
const LEAD = "0c421000-0000-4000-8000-0000000000b3";   // crew: Atlanta's market lead (operator)
const GLEAD = "0c421000-0000-4000-8000-0000000000b5";  // crew: Greenville's market lead (operator)
const MOE = "0c421000-0000-4000-8000-0000000000b4";    // crew (server) in Greenville
const ALEX = "0c421000-0000-4000-8000-0000000000c1";   // an owner
const BEA = "0c421000-0000-4000-8000-0000000000c2";    // an owner

const t0 = Date.now();
const db = await fullSchema({ before: "0421" });
console.log(`the schema to 0420 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
  alter role service_role bypassrls;
  -- Storage as Supabase runs it: row security on the objects, the API roles able to ask.
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  alter table storage.objects enable row level security;`);
for (const [id, role, name, market] of [[SAM, "member", "Sam Ito", "greenville"], [NIA, "member", "Nia Park", "greenville"], [KAY, "server", "Kay Lin", "greenville"],
  [LEAD, "operator", "Lee Ford", "atlanta"], [GLEAD, "operator", "Gil Shaw", "greenville"], [MOE, "server", "Moe Vance", "greenville"], [ALEX, "owner", "Alex Rivera", "greenville"], [BEA, "owner", "Bea Cole", "greenville"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4, market = $5, is_admin = ($2 in ('owner', 'admin')) where id = $1`, [id, role, T1, name, market]);
}
await q(`update public.profiles set leads_market = 'atlanta' where id = $1`, [LEAD]);
await q(`update public.profiles set leads_market = 'greenville' where id = $1`, [GLEAD]);
await q(`insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true), ('content', 'content', true), ('training', 'training', true),
  ('brand', 'brand', true), ('vip', 'vip', false), ('note-files', 'note-files', false) on conflict (id) do nothing`);
await q(`insert into storage.buckets (id, name, public) values ('shop', 'shop', true) on conflict (id) do nothing`);
const obj = (bucket, name, owner = null) => q(`insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, $3::uuid, $4)`, [bucket, name, owner, owner]);
await obj("avatars", `${SAM}/avatar.jpg`, SAM);
await obj("avatars", `${NIA}/avatar.jpg`, NIA);
await obj("content", "flyer/feed-1.png", KAY);
const note = async (by, visibility) => (await q1(`insert into public.meeting_notes (title, body, visibility, created_by, tenant_id) values ('Made-up note', 'x', $2, $1, $3) returning id`, [by, visibility, T1])).id;
const PRIVATE = await note(ALEX, "private"), TEAM = await note(ALEX, "team"), KAYS = await note(KAY, "team");
await obj("note-files", `${PRIVATE}/contract.pdf`, ALEX);
await obj("note-files", `${TEAM}/agenda.pdf`, ALEX);
const list = (who, bucket) => as(who, `select name from storage.objects where bucket_id = $1 order by name`, [bucket]);

// ── before 0421: the findings, reproduced ──────────────────────────────────────────────────────────────────────────
{
  const guest = await list(null, "avatars");
  ok("before 0421: anyone with the public key listed every member's photo — their ids with them", guest.rows.length === 2, guest);
  const priv = await list(KAY, "note-files");
  ok("before 0421: any crew role listed the files of an owner's private note", priv.rows.some((r) => r.name.startsWith(PRIVATE)), priv);
  ok("before 0421: the company mailbox's tokens' table was granted to anon", (await q1(`select has_table_privilege('anon', 'public.outlook_connection', 'select') a`)).a === true);
  const js = await q(`insert into public.promos (active, headline, cta_href) values (false, 'Made-up', 'javascript:alert(1)') returning id`);
  ok("before 0421: a splash link could be javascript:", js.length === 1);
  await q(`delete from public.promos where id = $1`, [js[0].id]);
  ok("before 0421: a brew needed at 8 am Saturday with a twelve-hour extraction started 'Saturday' (the UTC date of 8 pm Friday)",
    (await q1(`select public.brew_start_date('2026-10-17', 12)::text d`)).d === "2026-10-17");
  const moved = await as(LEAD, `select public.set_member_market($1, 'atlanta')`, [ALEX]);
  ok("before 0421: a market lead moved an owner into their own market", moved.error === null
    && (await q1(`select market from public.profiles where id = $1`, [ALEX])).market === "atlanta", moved);
  await q(`update public.profiles set market = 'greenville' where id = $1`, [ALEX]);
  const order = (await q(`select tgname from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal and tgtype & 2 = 2 order by tgname`)).map((r) => r.tgname);
  ok("before 0421: the 86 check fired before the order was stamped with its event", order.indexOf("orders_availability_check") < order.indexOf("orders_stamp_event"), order);
}

await db.exec(M421);
await db.exec(M421);   // a second run changes nothing
// 0421 loads on the schema to 0420, and loads again — a throw above fails this file; a milestone, not counted as a check (R14, F25).

// ── storage: a file is listed by those who own it ─────────────────────────────────────────────────────────────────
{
  const guest = await list(null, "avatars"), sam = await list(SAM, "avatars"), kay = await list(KAY, "avatars");
  ok("avatars: nobody lists them — a member sees their own folder (to replace their photo), and only that",
    guest.rows.length === 0 && sam.rows.length === 1 && sam.rows[0].name === `${SAM}/avatar.jpg` && kay.rows.length === 0, { guest, sam, kay });
  const up = await as(SAM, `update storage.objects set metadata = '{"v":2}' where bucket_id = 'avatars' and name = $1 returning name`, [`${SAM}/avatar.jpg`]);
  const other = await as(SAM, `insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [`${NIA}/avatar.png`, SAM]);
  ok("…a member still replaces their own photo, and can't write into someone else's folder", up.rows.length === 1 && !!other.error, { up, other });
  const content = { guest: await list(null, "content"), member: await list(SAM, "content"), crew: await list(KAY, "content") };
  ok("content: the crew lists the Studio's media; a guest and a member don't", content.guest.rows.length === 0 && content.member.rows.length === 0 && content.crew.rows.length === 1, content);
  ok("no everyone-read policy is left on a public bucket", await n(`select count(*) n from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('avatars public read', 'content public read', 'training media public read', 'brand assets public read', 'shop media public read')`) === 0);
  const lim = await q(`select id, file_size_limit, allowed_mime_types from storage.buckets where id in ('avatars', 'vip') order by id`);
  ok("a profile photo and a VIP photo are images, ten megabytes at most",
    lim.length === 2 && lim.every((b) => Number(b.file_size_limit) === 10485760 && b.allowed_mime_types.includes("image/jpeg") && !b.allowed_mime_types.some((m) => /html|svg|javascript|octet/.test(m))), lim);
}

// ── note-files: the note's own rules ────────────────────────────────────────────────────────────────────────────────
{
  const kay = await list(KAY, "note-files"), alex = await list(ALEX, "note-files");
  ok("a private note's files are its author's — the crew sees a team note's, not an owner's private one",
    kay.rows.length === 1 && kay.rows[0].name.startsWith(TEAM) && alex.rows.length === 2, { kay, alex });
  const intoOwners = await as(KAY, `insert into storage.objects (bucket_id, name, owner, owner_id) values ('note-files', $1, $2::uuid, $3)`, [`${TEAM}/kay.pdf`, KAY, KAY]);
  const intoOwn = await as(KAY, `insert into storage.objects (bucket_id, name, owner, owner_id) values ('note-files', $1, $2::uuid, $3) returning name`, [`${KAYS}/kay.pdf`, KAY, KAY]);
  const intoPrivate = await as(MOE, `insert into storage.objects (bucket_id, name, owner, owner_id) values ('note-files', $1, $2::uuid, $3)`, [`${PRIVATE}/x.pdf`, MOE, MOE]);
  ok("a file is added by whoever may add to the note — its author (or leadership, on a note that isn't private)",
    !!intoOwners.error && intoOwn.rows.length === 1 && !!intoPrivate.error, { intoOwners, intoOwn, intoPrivate });
  const kayDelOwners = await as(KAY, `delete from storage.objects where bucket_id = 'note-files' and name = $1 returning name`, [`${TEAM}/agenda.pdf`]);
  const kayDelOwn = await as(KAY, `delete from storage.objects where bucket_id = 'note-files' and name = $1 returning name`, [`${KAYS}/kay.pdf`]);
  const alexDel = await as(ALEX, `delete from storage.objects where bucket_id = 'note-files' and name = $1 returning name`, [`${TEAM}/agenda.pdf`]);
  ok("a file is removed by whoever added it, the note's author, or an admin — not by the rest of the crew",
    kayDelOwners.rows.length === 0 && kayDelOwn.rows.length === 1 && alexDel.rows.length === 1, { kayDelOwners, kayDelOwn, alexDel });
  ok("nothing broad is left on note-files", await n(`select count(*) n from pg_policies where schemaname = 'storage' and policyname = 'note files staff all'`) === 0);
}

// ── a subscription Square may have started is kept ─────────────────────────────────────────────────────────────────
{
  const asked = (await q1(`insert into public.subscriptions (user_id, plan, status, square_asked_at, created_at) values ($1, 'coffee_12', 'pending', now() - interval '20 minutes', now() - interval '20 minutes') returning id`, [SAM])).id;
  const never = (await q1(`insert into public.subscriptions (user_id, plan, status, created_at) values ($1, 'coffee_6', 'pending', now() - interval '20 minutes') returning id`, [NIA])).id;
  const swept = (await q1(`select public.reap_stale_pending_subs() n`)).n;
  const left = (await q(`select id from public.subscriptions where id in ($1, $2)`, [asked, never])).map((r) => r.id);
  const said = await q(`select severity, category, title, link, subject_id from public.alerts where kind = 'subscription_unknown'`);
  ok("a try Square was asked about and never answered is kept, and said as a critical; a try never asked goes, as before",
    Number(swept) === 1 && left.length === 1 && left[0] === asked && said.length === 1 && said[0].severity === "critical" && said[0].subject_id === asked
      && said[0].link === "/crew?s=money&a=pay", { swept, left, said });
  await q(`select public.reap_stale_pending_subs()`);
  ok("…every quarter hour it is the same one alert, until a person looks", await n(`select count(*) n from public.alerts where kind = 'subscription_unknown'`) === 1);
  ok("the sweep is the function now", /reap_stale_pending_subs\(\)/.test((await q1(`select command from cron.job where jobname = 'reap-stale-pending-subs' order by jobid desc limit 1`)).command));
  ok("the sweep is the database's own to run", /permission denied/.test((await as(KAY, `select public.reap_stale_pending_subs()`)).error ?? ""));
}

// ── the smaller doors ──────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("the company mailbox's tokens are the server's alone", (await q1(`select has_table_privilege('anon', 'public.outlook_connection', 'select') a,
    has_table_privilege('authenticated', 'public.outlook_connection', 'select') b`)).a === false
    && (await q1(`select has_table_privilege('authenticated', 'public.outlook_connection', 'select') b`)).b === false);
  const tryLink = async (href) => { try { await q(`insert into public.promos (active, headline, cta_href) values (false, 'Made-up', $1)`, [href]); return true; } catch { return false; } };
  const good = ["/delivery", "/", "/reserve?drop=1", "https://gt3pb.com", "https://gt3pb.com/shop?x=1", "https://gt3pb.com?utm=splash", "http://example.org/x"];
  const bad = ["javascript:alert(1)", "//evil.example/x", "/\\evil.example", "https://a@evil.example/", "data:text/html,hi", " /delivery", "/de livery", "mailto:x@example.org"];
  const g = await Promise.all(good.map(tryLink)), b = await Promise.all(bad.map(tryLink));
  ok("a splash link is a page here or a web address — never javascript:, data:, //another-site or a name@host",
    g.every(Boolean) && b.every((x) => !x), { good: good.filter((_, i) => !g[i]), bad: bad.filter((_, i) => b[i]) });
  const bc = async (href) => { try { await q(`insert into public.broadcasts (title, cta_label, cta_href) values ('Made-up', 'Go', $1)`, [href]); return true; } catch { return false; } };
  ok("…the banners' too", (await bc("/reserve")) && !(await bc("javascript:alert(1)")));
}

// ── an order is stamped with its event before its 86 check ─────────────────────────────────────────────────────────
{
  const order = (await q(`select tgname from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal and tgtype & 2 = 2 order by tgname`)).map((r) => r.tgname);
  ok("the stamp fires first now", order[0] === "a_orders_stamp_event" && order.indexOf("a_orders_stamp_event") < order.indexOf("orders_availability_check"), order);
  const oat = (await q1(`insert into public.products (slug, name, price_cents, active, tenant_id) values ('oat-r10b', 'OAT R10B', 600, true, $1) returning id`, [T1])).id;
  const atl = (await q1(`insert into public.events (title, market, tenant_id, is_live) values ('Made-up Atlanta pop-up', 'atlanta', $1, true) returning id`, [T1])).id;
  const out = await as(KAY, `select public.set_eighty_six($1, 'atlanta', true) r`, [oat]);
  let refused = null;
  try { await q(`insert into public.orders (items, total_cents) values (array['oat-r10b'], 600)`); } catch (e) { refused = String(e.message); }
  ok("an order at a live event in another city is checked against that city's 86s — it was checked against Greenville's",
    out.error === null && /OAT R10B just sold out/.test(refused ?? ""), { out, refused });
  const stamped = await q1(`insert into public.orders (items, total_cents) values (array['rise'], 600) returning event_id`).catch(() => null);
  ok("…and an order still takes the live event as before", stamped === null || stamped.event_id === atl, stamped);
  await q(`update public.events set is_live = false where id = $1`, [atl]);
}

// ── a brew's and a stop's day are Eastern ──────────────────────────────────────────────────────────────────────────
{
  ok("a brew needed at 8 am Saturday with a twelve-hour extraction starts Friday — the Eastern day of 8 pm Friday",
    (await q1(`select public.brew_start_date('2026-10-17', 12)::text d`)).d === "2026-10-16");
  ok("…and is ready Friday at 8 pm, before it is needed", (await q1(`select public.brew_ready_at('2026-10-17', 12) <= public.brew_needed_by('2026-10-17') ok`)).ok === true);
  ok("…a six-hour one still starts that morning's day", (await q1(`select public.brew_start_date('2026-10-17', 6)::text d`)).d === "2026-10-17");
  ok("a stop's brews are re-dated on the stop's Eastern day", /at time zone 'America\/New_York'\)::date/.test((await q1(`select prosrc from pg_proc where proname = 'resync_stop_brews'`)).prosrc));
}

// ── a lead moves people only within reach; the last owner is counted locked ──────────────────────────────────────────
{
  const lead = await as(LEAD, `select public.set_member_market($1, 'atlanta')`, [GLEAD]);
  const owner = await as(LEAD, `select public.set_member_market($1, 'atlanta')`, [ALEX]);
  const crew = await as(LEAD, `select public.set_member_market($1, 'atlanta')`, [MOE]);
  const byOwner = await as(ALEX, `select public.set_member_market($1, 'atlanta')`, [GLEAD]);
  ok("a lead can't move an owner or another market's lead; they still bring crew into their own market; an owner moves anyone",
    /Only an owner moves a market's lead/.test(lead.error ?? "") && /cannot move an owner or admin/.test(owner.error ?? "")
      && crew.error === null && (await q1(`select market from public.profiles where id = $1`, [MOE])).market === "atlanta" && byOwner.error === null, { lead, owner, crew, byOwner });
  const first = await as(ALEX, `select public.admin_set_role($1, 'admin')`, [BEA]);
  const last = await as(ALEX, `select public.admin_set_role($1, 'admin')`, [ALEX]);   // the one owner left, stepping down
  ok("the last owner can't be demoted — the owners are locked before they are counted",
    first.error === null && /last owner/.test(last.error ?? "") && /for update/.test((await q1(`select prosrc from pg_proc where proname = 'admin_set_role'`)).prosrc), { first, last });
}

// ── the joins ──────────────────────────────────────────────────────────────────────────────────────────────────────
ok("the four joins the money triggers and erasure walk are indexed",
  await n(`select count(*) n from pg_indexes where indexname in ('invoices_business_order_idx', 'jug_ledger_business_order_idx', 'reserve_claims_reserve_idx', 'alerts_claimed_by_idx')`) === 4);

console.log(`R10b · THE BACK END AT TEN, THE REST: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
