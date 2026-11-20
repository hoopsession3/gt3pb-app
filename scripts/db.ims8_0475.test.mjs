// 0475 · A COURSE LINE IS THE OWNER'S AND ADMINS' — the paste sequence, replayed (PGlite). With 0474 HELD: the pre-paste
// check, 0475, the post-paste check, every role's answer, the audit count unchanged, the production gate's view of a held
// 0474 below an applied 0475, then 0474 after 0475 (its own pre-paste check t, course_status untouched), and 0475's
// rollback (course_status exactly 0473's again, the ledger row gone).
//   node scripts/db.ims8_0475.test.mjs            ·  node scripts/db.ims8_0475.test.mjs --print-md5
import { readFileSync } from "node:fs";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { pendingFrom, migrationFiles } from "./migrations.pending.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}${got !== undefined ? ` → ${JSON.stringify(got).slice(0, 500)}` : ""}`); } };
const R = (f) => readFileSync(f, "utf8");
const M0474 = R("supabase/migrations/0474_a_customer_book_is_the_owners_and_a_wrong_link_is_counted.sql");
const M0475 = R("supabase/migrations/0475_a_course_line_is_the_owners_and_admins.sql");
const PRE5 = R("supabase/checks/ims8_0475_prepaste.sql"), POST5 = R("supabase/checks/ims8_0475_postpaste.sql");
const PRE4 = R("supabase/checks/ims8_0474_prepaste.sql"), RB5 = R("supabase/cleanup/0475_rollback.sql");
const T = "00000000-0000-0000-0000-000000000001";
const U = { owner: "0c475000-0000-4000-8000-0000000000a1", admin: "0c475000-0000-4000-8000-0000000000a2", operator: "0c475000-0000-4000-8000-0000000000a3", server: "0c475000-0000-4000-8000-0000000000a4", member: "0c475000-0000-4000-8000-0000000000a5" };
const md5Of = async (db) => (await db.query(`select md5(btrim(regexp_replace(prosrc, '\\s+', ' ', 'g'))) m from pg_proc where pronamespace = 'public'::regnamespace and proname = 'course_status'`)).rows[0].m;
const shape = async (db) => J((await db.query(`select p.prosecdef, p.proconfig, md5(btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g'))) m, pg_get_function_result(p.oid) r,
  has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'course_status'`)).rows);
const J = (x) => JSON.stringify(x);
const allT = (rows) => rows.length > 0 && rows.every((r) => r.as_expected === true);
const fails = (rows) => rows.filter((r) => r.as_expected !== true).map((r) => r.what);
const ledger = async (db) => (await db.query(`select version from public.schema_migrations order by version`)).rows.map((r) => r.version);
const definers = async (db) => Number((await db.query(`select count(*) n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) and p.prorettype <> 'trigger'::regtype`)).rows[0].n);

async function world(db) {
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
  for (const [k, id] of Object.entries(U)) {
    await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [id, `${k}@t.test`]);
    await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, k === "member" ? "member" : k, T]);
  }
  const c = (await db.query(`insert into public.customers (tenant_id, name, email) values ($1, 'Test Customer', 'c@t.test') returning id`, [T])).rows[0].id;
  await db.query(`insert into public.program_access (tenant_id, customer_id, tier, source, note) values ($1, $2, 'pro', 'comp', 'a gift')`, [T, c]);
  return c;
}
const as = async (db, who, sql, p = []) => {
  try { return await db.transaction(async (tx) => {
    if (who) await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [who, J({ sub: who, role: "authenticated" })]);
    await tx.exec(`set local role ${who ? "authenticated" : "anon"}`);
    return { rows: (await tx.query(sql, p)).rows };
  }); } catch (e) { return { code: e.code ?? "error", message: e.message }; }
};
const line = (db, who, c) => as(db, who, `select source, note, paid_cents from public.course_status($1)`, [c]);

// ── 0473 in, 0474 held, 0475 not yet ──────────────────────────────────────────────────────────────────────────────
const db = await fullSchema({ before: "0474" });
const C = await world(db);
const md5_0473 = await md5Of(db), shape0473 = await shape(db), count0473 = await definers(db);
ok("the replay starts at 0473 with 0474 not applied (production today)", (await ledger(db)).at(-1).startsWith("0473"));
ok("course_status at 0473 has the fingerprint 0475's pre-paste check expects", md5_0473 === "0bcb9496067b7d2030049a734f7e0da4", md5_0473);
const pre5 = (await db.query(PRE5)).rows;
ok("0475 pre-paste check: every row t", allT(pre5), fails(pre5));
const before = { owner: await line(db, U.owner, C), operator: await line(db, U.operator, C) };
ok("before 0475: the operator gets the line without note or payment", before.operator.rows?.length === 1 && before.operator.rows[0].note === null && before.operator.rows[0].paid_cents === null, before.operator);

// ── paste 0475 ────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(M0475);
const md5_0475 = await md5Of(db);
if (process.argv.includes("--print-md5")) console.log(`course_status md5 after 0475: ${md5_0475}`);
const post5 = (await db.query(POST5)).rows;
ok("0475 post-paste check: every row t", allT(post5), fails(post5));
ok("…the ledger has 0475, not 0474", (await ledger(db)).some((v) => v.startsWith("0475")) && !(await ledger(db)).some((v) => v.startsWith("0474")));
const after = {}; for (const k of Object.keys(U)) after[k] = await line(db, U[k], C);
after.signedOut = await line(db, null, C);
ok("after 0475: the owner and an admin get the line with its note", after.owner.rows?.[0]?.note === "a gift" && after.admin.rows?.[0]?.note === "a gift", [after.owner, after.admin]);
ok("…an operator gets no line (no error — the same answer as a member)", after.operator.rows?.length === 0, after.operator);
ok("…a server and a member: no line", after.server.rows?.length === 0 && after.member.rows?.length === 0);
ok("…signed out: refused (no grant)", after.signedOut.code === "42501", after.signedOut);
ok("the audit's count of callable privileged functions is unchanged by 0475 (the audit still says 140 > 127 in production)", (await definers(db)) === count0473, { before: count0473, after: await definers(db) });

// ── the production gate with 0475 applied and 0474 held ───────────────────────────────────────────────────────────
const files = migrationFiles();
const seqs = (await ledger(db)).map((v) => Number(v.slice(0, 4)));
const gateHeld = pendingFrom(files, seqs.length, Math.max(...seqs), [474], seqs);
ok("the production gate, with 0474 held and 0475 applied: clean — the gap below 0475 is the named held migration, not a forgotten one", gateHeld.status === "clean", gateHeld);
const gateUnheld = pendingFrom(files, seqs.length, Math.max(...seqs), [], seqs);
ok("…and if 0474 were NOT named held, the gate would refuse (a gap), so holding it is what keeps the gate honest", gateUnheld.status === "gap", gateUnheld.status);

// ── 0474 later, on top of 0475 ────────────────────────────────────────────────────────────────────────────────────
const pre4 = (await db.query(PRE4.replace("@@MD5_0475@@", md5_0475))).rows;
ok("0474's pre-paste check after 0475: every row t (0475 first is a supported order)", allT(pre4), fails(pre4));
await db.exec(M0474);
ok("0474 applies on top of 0475 and leaves course_status as 0475 made it", (await md5Of(db)) === md5_0475);
ok("…the operator still gets no line, the owner still the note", (await line(db, U.operator, C)).rows?.length === 0 && (await line(db, U.owner, C)).rows?.[0]?.note === "a gift");
await db.close();

// ── 0475's rollback (0474 held) ───────────────────────────────────────────────────────────────────────────────────
const rb = await fullSchema({ before: "0474" });
const C2 = await world(rb);
await rb.exec(M0475);
await rb.exec(RB5);
ok("0475's rollback: course_status exactly 0473's again (body, definer, search_path, result, grants)", (await shape(rb)) === shape0473, await shape(rb));
ok("…0475 off the ledger, 0473 still on it", !(await ledger(rb)).some((v) => v.startsWith("0475")) && (await ledger(rb)).some((v) => v.startsWith("0473")));
ok("…the operator gets the limited line again", (await line(rb, U.operator, C2)).rows?.[0]?.note === null && (await line(rb, U.operator, C2)).rows?.length === 1);
const pre5again = (await rb.query(PRE5)).rows;
ok("…and 0475's pre-paste check says t again (it could be re-applied)", allT(pre5again), fails(pre5again));
await rb.close();

// ── the files carry the fingerprint the replay produced ───────────────────────────────────────────────────────────
ok("the post-paste check and 0474's pre-paste check name 0475's fingerprint, as replayed", POST5.includes(md5_0475) && PRE4.includes(md5_0475), md5_0475);
console.log(`0475 PASTE SEQUENCE, 0474 HELD (replayed): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
