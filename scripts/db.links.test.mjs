// 0455 — A LINK SHOWS WHAT YOU CHOSE, IN POSTGRES (2026-10-26 — Ryan: "every link currently shows all roadmap programs and
// all store layouts, not just the ones you choose. Fix that as well").
//
// The whole schema to 0454 is loaded, a link made, then 0455 applied twice. What is read: the existing link keeps the
// programs and rooms of the plans marked to show (it doesn't go blank), and no others; a program-level ask shows only with
// its program; a new link shows no program and no room until they're chosen; a second run doesn't refill a link whose
// lists were emptied on purpose; signed out, nobody can read or change the lists; an expired or revoked link shows nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M455 = readFileSync(join(ROOT, "supabase/migrations/0455_a_link_shows_what_you_chose.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const db = await fullSchema({ before: "0455" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
const door = async (token) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [token])).rows[0].v; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role;`); } };

// The seed's programs, plans and room. One plan marked to show, with a room; one program with no shareable plan.
const programs = await q(`select id from public.vision_programs order by sort, created_at`);
const plans = await q(`select id, program_id from public.vision_plans order by phase`);
ok("the seed has programs and plans to share", programs.length >= 2 && plans.length >= 2, { programs: programs.length, plans: plans.length });
const room = await q1(`insert into public.store_layouts (name, width_in, depth_in) values ('Shown room', 360, 480) returning id`);
const hidden = await q1(`insert into public.store_layouts (name, width_in, depth_in) values ('Private room', 240, 240) returning id`);
const shown = plans[0];
await q(`update public.vision_plans set shareable = (id = $1), layout_id = case when id = $1 then $2::uuid else layout_id end`, [shown.id, room.id]);
const other = programs.find((p) => p.id !== shown.program_id);
await q(`insert into public.vision_asks (program_id, label, amount_cents, state) values ($1, 'Unshared program ask', 100000, 'open')`, [other.id]);
const old = await q1(`insert into public.vision_shares (label, show_asks) values ('Before 0455', true) returning id, token`);
const before = await door(old.token);
ok("before 0455: a link shows every program and every room (the leak)", before.programs.length === programs.length && before.layouts.some((l) => l.id === hidden.id), { programs: before.programs.length, layouts: before.layouts.map((l) => l.name) });

await db.exec(M455);
await db.exec(M455);
ok("0455 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0455%'`)).n === 2);

const after = await door(old.token);
ok("the existing link keeps the program of the plan marked to show", after.programs.some((p) => p.id === shown.program_id), after.programs.map((p) => p.id));
ok("…and no program without a shareable plan", !after.programs.some((p) => p.id === other.id));
ok("…keeps that plan's room, and not the private one", after.layouts.some((l) => l.id === room.id) && !after.layouts.some((l) => l.id === hidden.id), after.layouts.map((l) => l.name));
ok("an ask on an unshown program doesn't show", !after.asks.some((a) => a.label === "Unshared program ask"), after.asks.map((a) => a.label));

const fresh = await q1(`insert into public.vision_shares (label) values ('New link') returning id, token`);
const v = await door(fresh.token);
ok("a new link shows no program and no room until chosen", v.programs.length === 0 && v.layouts.length === 0, { programs: v.programs.length, layouts: v.layouts.length });
await q(`update public.vision_shares set program_ids = array[$1::uuid], layout_ids = array[$2::uuid] where id = $3`, [other.id, hidden.id, fresh.id]);
const chosen = await door(fresh.token);
ok("chosen: exactly that program and that room", chosen.programs.length === 1 && chosen.programs[0].id === other.id && chosen.layouts.length === 1 && chosen.layouts[0].id === hidden.id);

await q(`update public.vision_shares set program_ids = '{}', layout_ids = '{}' where id = $1`, [old.id]);
await db.exec(M455);
const emptied = await door(old.token);
ok("a third run doesn't refill a link emptied on purpose", emptied.programs.length === 0 && emptied.layouts.length === 0);

await db.exec(`set role anon;`);
let anonRead; try { anonRead = (await db.query(`select program_ids from public.vision_shares`)).rows; } catch (e) { anonRead = { error: e.message }; } finally { await db.exec(`reset role;`); }
ok("signed out, the lists can't be read off the table", !Array.isArray(anonRead) || anonRead.length === 0, anonRead);
await q(`update public.vision_shares set revoked_at = now() where id = $1`, [fresh.id]);
ok("a revoked link shows nothing at all", !!(await door(fresh.token)).error);
await q(`update public.vision_shares set expires_at = now() - interval '1 minute' where id = $1`, [old.id]);
ok("an expired link shows nothing at all", !!(await door(old.token)).error);

console.log(`0455 — A LINK SHOWS WHAT YOU CHOSE: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
