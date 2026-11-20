// THE ORDER SHEET, BY ROLE (IMS8 D6 / 0475 evidence, local only). Renders the shop-order record as the owner, an admin and
// an operator against the console walk's stand-in database (scripts/fixtures/fakebase.mjs, made-up accounts, no key) and
// the walk's build (.next-console — run `npm run smoke:console` once first). For each role: is the customer's name a
// link, does it open the customer record, and what does course_status answer that role. Screenshots in .journey-ordersheet/.
//   node scripts/journey.ordersheet.mjs
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { startFakebase } from "./fixtures/fakebase.mjs";
import { seedConsoleWorld, OWNER } from "./fixtures/consoleWorld.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";

const ROLES = [
  { key: "owner", id: OWNER.id, email: OWNER.email, name: OWNER.name },
  { key: "admin", id: "0c449000-0000-4000-8000-0000000000b1", email: "maria@fixture.test", name: "Maria Delgado-Whitfield" },
  { key: "operator", id: "0c449000-0000-4000-8000-0000000000b2", email: "dev@fixture.test", name: "Dev Okafor" },
];
// The build inlines the stand-in's address (port 54329), so the walk's ports are reused — never run this beside the walk.
const DB_PORT = 54329, PORT = 3219, DIST = ".next-console", OUT = ".journey-ordersheet";
const BASE = `http://127.0.0.1:${PORT}`, DB_URL = `http://127.0.0.1:${DB_PORT}`;
if (!existsSync(`${DIST}/BUILD_ID`)) { console.log("ORDER SHEET BY ROLE: no .next-console build — run npm run smoke:console first"); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const results = [];
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}${got !== undefined ? ` → ${JSON.stringify(got).slice(0, 400)}` : ""}`); } };
const NEXT_BIN = require.resolve("next/dist/bin/next");
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});

for (const role of ROLES) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const userObject = { id: role.id, aud: "authenticated", role: "authenticated", email: role.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: role.name }, factors: [], created_at: new Date(Date.now() - 864e5 * 200).toISOString() };
  // Not a credential: an unsigned token for a made-up account, read only by the stand-in in this process.
  const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: role.id, role: "authenticated", aud: "authenticated", email: role.email, exp, aal: "aal2", amr: [{ method: "totp", timestamp: exp - 60 }], session_id: "fixture" })}.fixture`;
  const session = () => ({ access_token: token, refresh_token: "fixture-refresh", expires_in: 3600, expires_at: exp, token_type: "bearer", user: userObject });
  let order = null;
  const fb = await startFakebase({ port: DB_PORT, user: { id: role.id, email: role.email, object: userObject, session }, seed: async (db) => {
    await seedConsoleWorld(db);
    order = (await db.query(`select o.id, o.customer_id, c.name from public.shop_orders o join public.customers c on c.id = o.customer_id where o.status = 'paid' limit 1`)).rows[0];
    await db.query(`insert into public.program_access (tenant_id, customer_id, tier, source, note) values ((select tenant_id from public.shop_orders where id = $1), $2, 'pro', 'comp', 'journey note') on conflict do nothing`, [order.id, order.customer_id]);
  } });
  const server = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: DB_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-not-a-key", GT3_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: "1", SUPABASE_SERVICE_ROLE_KEY: "" }, stdio: "ignore", detached: true });
  for (let i = 0; i < 80; i++) { await sleep(500); try { if ((await fetch(BASE + "/privacy")).status < 500) break; } catch { /* not yet */ } }

  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, bypassCSP: true });
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); localStorage.setItem("gt3-guide-seen", "1"); sessionStorage.setItem("gt3-splash-shown", "1"); } catch { /* */ } }, ["sb-127-auth-token", JSON.stringify(session())]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/crew?s=day&r=shop_order:${order.id}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction((n) => document.body.innerText.includes(n), order.name, { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const nameLink = page.locator("button.rec-link", { hasText: order.name });
  const linked = await nameLink.count() > 0;
  const nameShown = (await page.locator("body").innerText()).includes(order.name);
  await page.screenshot({ path: `${OUT}/${role.key}-order.png` });
  let opened = false, courseLine = null;
  if (linked) {
    await nameLink.first().click();
    await sleep(2500);
    opened = new URL(page.url()).searchParams.get("r") === `customer:${order.customer_id}`;
    courseLine = (await page.locator("body").innerText()).match(/GT3 NUTRITION[^\n]*\n[^\n]*\n[^\n]*/i)?.[0] ?? null;
    await page.screenshot({ path: `${OUT}/${role.key}-customer.png` });
  }
  // The database door itself, as this role (the stand-in runs every request as the signed-in account).
  const r = await fetch(`${DB_URL}/rest/v1/rpc/course_status`, { method: "POST", headers: { "content-type": "application/json", apikey: "fixture-anon-not-a-key", authorization: `Bearer ${token}` }, body: JSON.stringify({ p_customer: order.customer_id }) });
  const rows = r.ok ? await r.json() : { status: r.status };
  const line = Array.isArray(rows) ? rows[0] ?? null : rows;
  results.push({ role: role.key, nameShown, linked, opened, courseLine, course_status: line ? { source: line.source, note: line.note ?? null, paid_cents: line.paid_cents ?? null } : null });
  await ctx.close();
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await fb.close();
  await sleep(500);
}
await browser.close();

const by = Object.fromEntries(results.map((x) => [x.role, x]));
const narrowed = !!process.env.EXPECT_0475;
ok("owner: the customer's name on the order is a link, and it opens the customer record", by.owner.linked && by.owner.opened, by.owner);
ok("admin: the same", by.admin.linked && by.admin.opened, by.admin);
ok("operator: the name is shown as plain text — no link, no customer record", by.operator.nameShown && !by.operator.linked && !by.operator.opened, by.operator);
ok("owner and admin: course_status gives the line with its note", !!by.owner.course_status?.note && by.admin.course_status?.note === by.owner.course_status.note, [by.owner.course_status, by.admin.course_status]);
ok(narrowed ? "operator, 0475: course_status gives no line" : "operator, 0473: course_status gives the line without note or payment",
  narrowed ? by.operator.course_status === null : by.operator.course_status?.source === "comp" && by.operator.course_status.note === null && by.operator.course_status.paid_cents === null, by.operator.course_status);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
console.log(`ORDER SHEET BY ROLE (${narrowed ? "with 0475" : "0473"}): ${pass} passed, ${fail} failed · pictures in ${OUT}/`);
process.exit(fail ? 1 : 0);
