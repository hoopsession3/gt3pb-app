// 0393 — THE CATALOG IS THE MENU, executed from its file against the whole schema (every migration before it, in order:
// scripts/fixtures/schema.full.mjs), with production's state set up first: the owner's two edits on the menu (TIDE's and
// NATURE'S AIDE's lines, read off the live menu 2026-10-13), Salted Latte (0144) on sale as a pack add-on, a product the
// owner made in the Catalog, and one Catalog field the owner wrote himself.
//
// The finding, as a sentence (R2 of the customer audit): the menu was ten drinks in code, and the Catalog said two things
// about them. After 0393 the Catalog's rows say what the menu says — the owner's words where he wrote them — and carry
// what the menu showed that had no column, a stop's menu can be read by the menu and by Pay, and a field the owner wrote
// in the Catalog is never written over.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F393 = "0393_the_catalog_is_the_menu.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c393000-0000-4000-8000-0000000000c1", SERVER = "0c393000-0000-4000-8000-0000000000c3";
const TEN = ["rise", "flow", "dusk", "kingme", "maple", "tide", "aide", "forge", "hunt", "wild"];

const t0 = Date.now();
const db = await fullSchema({ before: "0393" });
console.log(`the schema before 0393 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select on all tables in schema public to anon, authenticated;
  grant update on public.products to authenticated;
`);
for (const [id, role] of [[OWNER, "owner"], [SERVER, "server"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-393@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
const row = async (slug) => (await q(`select * from public.products where slug = $1`, [slug]))[0];

// ── production's state, set up ─────────────────────────────────────────────────────────────────────────────────
{
  const seeded = await q(`select slug from public.products where slug = any($1::text[]) order by slug`, [TEN]);
  ok("the seeds wrote all ten drinks' Catalog rows (0062, 0127)", seeded.length === 10, seeded);
  ok("…and Salted Latte, 0144's pack add-on, is on sale", (await row("salted-latte"))?.active === true, await row("salted-latte"));
  ok("…KING ME, the latte and NATURE'S AIDE were seeded with no description and no ingredients", (await row("kingme")).what === null && (await row("aide")).ingredients?.length === 0, { what: (await row("kingme")).what, ing: (await row("aide")).ingredients });
  ok("…TIDE's ingredients are the 0062 seed's, not the menu's", JSON.stringify((await row("tide")).ingredients) === JSON.stringify(["Organic young coconut water", "Organic Thai coconut meat", "Raw honey", "Blended to order"]), (await row("tide")).ingredients);
  // The owner's two edits on the live menu (read 2026-10-13), word for word.
  await q(`insert into public.site_copy (key, value) values
    ('menu.tide.lines', $1), ('menu.aide.lines', $2), ('menu.sec.2.sub', 'After the work, and the day'), ('menu.sec.1.name', 'Hydrate'),
    ('craft.hyd_items', 'Sea salt — Sodium.\nMineral water base — We build on mineral water, not stripped water, so there''s substance behind every pour.')`,
    ["Organic coconut water + young organic Thai coconut meat\nFinished with organic local honey", "Organic Coconut water + Organic Lime Juice\nOrganic maple · Sea salt"]);
  // A field the owner wrote in the Catalog himself, and a product he made there (MenuManager's shape).
  await q(`update public.products set why = 'Owner wrote this in the Catalog.' where slug = 'flow'`);
  await q(`insert into public.products (slug, name, line, price_cents, active, sort) values ('item-k3x9a', 'Matcha', 'Activation', 900, true, 50)`);
}

await db.exec(MIG(F393));

// ── the new columns ────────────────────────────────────────────────────────────────────────────────────────────
{
  const cols = (await q(`select column_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = any($1::text[])`,
    [["cup_orderable", "caffeine", "contains", "tag", "when_text"]]));
  ok("0393 adds cup_orderable, caffeine, contains, tag and when_text", cols.length === 5, cols);
  const cup = cols.find((c) => c.column_name === "cup_orderable");
  ok("…cup_orderable is required and on by default for a new product", cup?.is_nullable === "NO" && /true/.test(cup?.column_default ?? ""), cup);
}

// ── sold by the cup: today's menu, exactly ─────────────────────────────────────────────────────────────────────
{
  const on = (await q(`select slug from public.products where cup_orderable order by slug`)).map((r) => r.slug);
  ok("the ten drinks on today's menu are sold by the cup, and nothing else is", JSON.stringify(on) === JSON.stringify([...TEN].sort()), on);
  ok("…Salted Latte stays a pack add-on", (await row("salted-latte")).cup_orderable === false);
  ok("…and the product the owner made is not put on the menu by this migration", (await row("item-k3x9a")).cup_orderable === false);
  await q(`insert into public.products (slug, name, line, price_cents, active, sort) values ('item-new01', 'New', 'Activation', 0, false, 60)`);
  ok("a product made after it is sold by the cup by default (MenuManager sends no cup_orderable)", (await row("item-new01")).cup_orderable === true);
}

// ── the rows say what the menu says ────────────────────────────────────────────────────────────────────────────
{
  const tide = await row("tide"), aide = await row("aide"), rise = await row("rise"), flow = await row("flow"), kingme = await row("kingme"), maple = await row("maple"), forge = await row("forge");
  ok("TIDE's description is the owner's edit on the menu, word for word", tide.what === "Organic coconut water + young organic Thai coconut meat\nFinished with organic local honey", tide.what);
  ok("…NATURE'S AIDE's too", aide.what === "Organic Coconut water + Organic Lime Juice\nOrganic maple · Sea salt", aide.what);
  ok("…and its ingredients are what the owner said is in it: no mineral water",
    JSON.stringify(aide.ingredients) === JSON.stringify(["Organic coconut water", "Organic lime juice", "Organic maple syrup", "Sea salt"]), aide.ingredients);
  ok("TIDE's ingredients are the menu's words, not the 0062 seed's",
    JSON.stringify(tide.ingredients) === JSON.stringify(["Organic young coconut water", "Young organic Thai coconut meat", "Organic local honey", "Blended to order"]), tide.ingredients);
  ok("RISE's seeded one-line description becomes the menu's two lines", rise.what === "Cold-extracted coffee in mineral water\nFinished with Organic Coconut Water", rise.what);
  ok("a field the owner wrote in the Catalog keeps his words", flow.why === "Owner wrote this in the Catalog.", flow.why);
  ok("the drinks seeded with nothing get the menu's words: KING ME's why, the latte's ingredients",
    kingme.why === "A sensory phenomenon — texture and microbubbles, nothing added." && maple.ingredients?.length === 4 && maple.excludes?.length === 3, { why: kingme.why, ing: maple.ingredients });
  ok("the broths sit under Fuel, the name customers read (seeded Recovery)", forge.line === "Fuel" && (await row("hunt")).line === "Fuel" && (await row("wild")).line === "Fuel", forge.line);
  ok("…while Salted Latte's line is left as it was", (await row("salted-latte")).line === "Recovery");
  ok("the tags the menu showed: RISE Start here, KING ME Nitro, the rest none",
    rise.tag === "Start here" && kingme.tag === "Nitro" && (await q(`select count(*)::int n from public.products where slug = any($1::text[]) and tag is not null`, [TEN]))[0].n === 2);
  ok("when to drink it, for all ten", (await q(`select count(*)::int n from public.products where slug = any($1::text[]) and when_text is not null`, [TEN]))[0].n === 10 && rise.when_text === "Morning, before the first task.");
  ok("NATURE'S AIDE sorts after TIDE (both were 20)", tide.sort === 20 && aide.sort === 21, { tide: tide.sort, aide: aide.sort });
}

// ── caffeine and contains, from the ingredients (the owner's yes, 2026-10-13) ─────────────────────────────────
{
  const caf = (await q(`select slug from public.products where caffeine order by slug`)).map((r) => r.slug);
  ok("caffeine on the five coffees", JSON.stringify(caf) === JSON.stringify(["dusk", "flow", "kingme", "maple", "rise"]), caf);
  const none = (await q(`select count(*)::int n from public.products where slug = any($1::text[]) and caffeine = false`, [["tide", "aide", "forge", "hunt", "wild"]]))[0].n;
  ok("…said 'no caffeine' on the other five, not left unsaid", none === 5, none);
  ok("…and nothing said for a product nobody has described (the owner's own)", (await row("item-k3x9a")).caffeine === null && (await row("item-k3x9a")).contains === null);
  const c = Object.fromEntries((await q(`select slug, contains from public.products where slug = any($1::text[])`, [TEN])).map((r) => [r.slug, r.contains]));
  ok("contains: goat milk in the latte, coconut in RISE, TIDE and NATURE'S AIDE, honey in TIDE, nothing in the rest",
    JSON.stringify(c.maple) === '["Goat milk"]' && JSON.stringify(c.rise) === '["Coconut"]' && JSON.stringify(c.tide) === '["Coconut","Honey"]'
    && JSON.stringify(c.aide) === '["Coconut"]' && JSON.stringify(c.flow) === "[]" && JSON.stringify(c.forge) === "[]", c);
}

// ── a section's subtitle follows its name ──────────────────────────────────────────────────────────────────────
{
  const s = await q(`select value from public.site_copy where key = 'menu.line.Fuel.sub'`);
  ok("an owner's edit to a section's subtitle moves to the section's name (menu.sec.2.sub → menu.line.Fuel.sub)", s[0]?.value === "After the work, and the day", s);
  ok("…and the owner's edits on the menu are kept where they were", (await q(`select count(*)::int n from public.site_copy where key in ('menu.tide.lines', 'menu.aide.lines')`))[0].n === 2);
  const renamed = await q(`select value from public.site_copy where key = 'menu.line.Hydrate.sub'`);
  ok("a section the owner renamed (Hydration → Hydrate) keeps its subtitle under its new name, and its drinks sit under it",
    renamed[0]?.value === "During the work" && (await row("tide")).line === "Hydrate" && (await row("aide")).line === "Hydrate", { renamed, line: (await row("tide")).line });
  const craft = (await q(`select value from public.site_copy where key = 'craft.hyd_items'`))[0]?.value ?? "";
  ok("the Craft page's hydration list loses the mineral-water base (neither hydration drink has one) and names the lime",
    !/Mineral water base/.test(craft) && /Organic lime juice · NATURE'S AIDE/.test(craft) && /^Sea salt — Sodium\./.test(craft), craft);
}

// ── a stop's menu ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const [poured] = await q(`insert into public.stops (name, starts_at, market) values ('WineXpress', now() + interval '1 day', 'greenville') returning id`);
  const [open] = await q(`insert into public.stops (name, starts_at, market) values ('Main St', now() + interval '2 day', 'greenville') returning id`);
  await q(`insert into public.event_menu_items (stop_id, product_slug) values ($1, 'rise'), ($1, 'forge'), ($1, 'flow')`, [poured.id]);
  const anon = await as(null, `select public.stop_menu($1) m`, [poured.id]);
  ok("anyone can read a stop's menu — the menu shows it (stop_menu, as anon)", !anon.error && JSON.stringify(anon.rows[0]?.m) === '["flow","forge","rise"]', anon);
  const none = await as(null, `select public.stop_menu($1) m`, [open.id]);
  ok("…a stop with no menu set answers null, which limits nothing", !none.error && none.rows[0]?.m === null, none);
  const direct = await as(null, `select count(*)::int n from public.event_menu_items`);
  ok("…while the crew's menu table stays the crew's (anon reads no rows)", !!direct.error || direct.rows[0]?.n === 0, direct);
}

// ── who may change the new fields ──────────────────────────────────────────────────────────────────────────────
{
  const crew = await as(SERVER, `update public.products set caffeine = false where slug = 'rise'`);
  ok("a server can't change a drink's caffeine (0351's trigger covers a column added after it)", !!crew.error && (await row("rise")).caffeine === true, crew);
  const crewCup = await as(SERVER, `update public.products set cup_orderable = false where slug = 'rise'`);
  ok("…or take it off the cup menu", !!crewCup.error && (await row("rise")).cup_orderable === true, crewCup);
  const crew86 = await as(SERVER, `update public.products set sold_out = true where slug = 'rise'`);
  ok("…and can still 86 it", !crew86.error && (await row("rise")).sold_out === true, crew86);
  await q(`update public.products set sold_out = false where slug = 'rise'`);
  const owner = await as(OWNER, `update public.products set contains = '{"Coconut","Cacao"}' where slug = 'rise'`);
  ok("the owner can", !owner.error && JSON.stringify((await row("rise")).contains) === '["Coconut","Cacao"]', owner);
  const read = await as(null, `select slug, cup_orderable, caffeine, contains, tag, when_text from public.products where slug = 'kingme'`);
  ok("a guest reads the new fields of a drink on sale (products public read)", !read.error && read.rows[0]?.tag === "Nitro" && read.rows[0]?.caffeine === true, read);
}

// ── a second run changes nothing ───────────────────────────────────────────────────────────────────────────────
{
  await q(`update public.products set cup_orderable = true where slug = 'item-k3x9a'`); // the owner puts his drink on the menu
  await q(`update public.products set what = null, caffeine = null where slug = 'dusk'`); // and empties two of DUSK's fields
  const before = JSON.stringify(await q(`select slug, name, what, why, ingredients, excludes, line, sort, tag, when_text, caffeine, contains, cup_orderable from public.products order by slug`));
  await db.exec(MIG(F393));
  const after = JSON.stringify(await q(`select slug, name, what, why, ingredients, excludes, line, sort, tag, when_text, caffeine, contains, cup_orderable from public.products order by slug`));
  ok("a second run of 0393 changes nothing — the owner's own drink stays on the menu, and fields he emptied stay empty",
    before === after && (await row("dusk")).what === null && (await row("dusk")).caffeine === null);
  ok("…one changelog line", (await q(`select count(*)::int n from public.changelog where title = 'The Catalog is the menu'`))[0].n === 1);
  ok("…recorded in the ledger", (await q(`select count(*)::int n from public.schema_migrations where version = '0393_the_catalog_is_the_menu'`))[0].n === 1);
}

console.log(`\n0393 THE CATALOG IS THE MENU: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
