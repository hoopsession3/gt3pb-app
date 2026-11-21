// THE RECIPE, CORRECTED FROM A PHONE (0476, local only). Two people, on an iPhone-sized screen, against the console walk's
// stand-in database (scripts/fixtures/fakebase.mjs: made-up accounts, no key) with 0476 in its schema, the walk's build
// (.next-console) and a stand-in for the model (scripts/fixtures/claudeStub.mjs — it quotes the recipe version the route
// gave it, so the answer shows which version Ask GT3 read):
//   1 · CREW (an operator — no owner access): Recipes → Salted Maple Latte → Suggest a correction; changes an amount
//       (a test edit), sees the yield, the build step and the batch line follow the table, saves, submits. Then Ask GT3:
//       the answer still comes from the built-in recipe, and offers View recipe / Suggest a correction; a recipe with
//       none on file offers Create recipe draft.
//   2 · KAYLA (her role in GT3, owner — read from the team screen on 2026-11-20): Recipes → Salted Maple Latte → Waiting
//       for review → Publish (v1); Ask GT3 → Edit recipe → a change → Review changes → Publish now (v2); View recipe →
//       Restore v1. At every step the table, Makes, the build step and Ask GT3's answer are read and must agree.
// Screenshots and the taps in .journey-recipes/.   node scripts/journey.recipes.mjs   (after a .next-console build)
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startFakebase } from "./fixtures/fakebase.mjs";
import { seedConsoleWorld } from "./fixtures/consoleWorld.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";

const KAYLA = { key: "kayla-owner", id: "0c476000-0000-4000-8000-0000000000c1", email: "kayla@fixture.test", name: "Kayla Fixture", role: "owner" };
const CREW = { key: "crew-operator", id: "0c449000-0000-4000-8000-0000000000b2", email: "dev@fixture.test", name: "Dev Okafor", role: "operator" };
const DB_PORT = 54329, PORT = 3219, DIST = ".next-console", OUT = ".journey-recipes";
const BASE = `http://127.0.0.1:${PORT}`, DB_URL = `http://127.0.0.1:${DB_PORT}`;
const SERVICE = "fixture-service-not-a-key";
// HELD=1: the database as production has it today — every migration before 0476 — so the code-only rollout is walked as it
// will ship: the recipe screens and Ask GT3 on the built-in recipe, and editing that says it waits for the update.
const HELD = !!process.env.HELD;   // made up: the stand-in's server door, never a real key
if (!existsSync(`${DIST}/BUILD_ID`)) { console.log("RECIPES JOURNEY: no .next-console build — run npm run smoke:console first"); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}${got !== undefined ? ` → ${JSON.stringify(got).slice(0, 500)}` : ""}`); } };
const NEXT_BIN = require.resolve("next/dist/bin/next");
const STUB = fileURLToPath(new URL("./fixtures/claudeStub.mjs", import.meta.url));
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const taps = { [CREW.key]: [], [KAYLA.key]: [] };
let carried = [];   // the crew member's rows, carried into Kayla's database (one stand-in per signed-in person)

async function as(person, seedMore, walk) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const userObject = { id: person.id, aud: "authenticated", role: "authenticated", email: person.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: person.name }, factors: [], created_at: new Date(Date.now() - 864e5 * 200).toISOString() };
  // Not a credential: an unsigned token for a made-up account, read only by the stand-in in this process.
  const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: person.id, role: "authenticated", aud: "authenticated", email: person.email, exp, aal: "aal2", amr: [{ method: "totp", timestamp: exp - 60 }], session_id: "fixture-session" })}.fixture`;
  const session = () => ({ access_token: token, refresh_token: "fixture-refresh", expires_in: 3600, expires_at: exp, token_type: "bearer", user: userObject });
  const fb = await startFakebase({ port: DB_PORT, serviceKey: SERVICE, ...(HELD ? { before: "0476" } : {}), user: { id: person.id, email: person.email, object: userObject, session }, seed: async (db) => {
    await seedConsoleWorld(db);
    if (person === KAYLA) {
      await db.query(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, $2, jsonb_build_object('full_name', $3::text), now())`, [person.id, person.email, person.name]);
      await db.query(`update public.profiles set role = 'owner', display_name = $2 where id = $1`, [person.id, person.name]);
    }
    if (seedMore) await seedMore(db);
  } });
  const server = spawn(process.execPath, ["--import", STUB, NEXT_BIN, "start", "-p", String(PORT)], { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: DB_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-not-a-key", SUPABASE_SERVICE_ROLE_KEY: SERVICE, ANTHROPIC_API_KEY: "fixture-not-a-key", GT3_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = ""; server.stdout.on("data", (d) => { log += d; }); server.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 80; i++) { await sleep(500); try { if ((await fetch(BASE + "/privacy")).status < 500) break; } catch { /* not yet */ } }
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, bypassCSP: true });
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); localStorage.setItem("gt3-guide-seen", "1"); sessionStorage.setItem("gt3-splash-shown", "1"); } catch { /* */ } }, ["sb-127-auth-token", JSON.stringify(session())]);
  const page = await ctx.newPage();
  const shot = async (n) => page.screenshot({ path: `${OUT}/${person.key}-${n}.png` });
  const tap = async (label, opts = {}) => {
    taps[person.key].push(label);
    const scope = opts.in ? page.locator(opts.in) : page;
    const t = (opts.role ? scope.getByRole(opts.role, { name: label, exact: !!opts.exact }) : scope.getByRole("button", { name: label, exact: !!opts.exact }).or(scope.getByRole("link", { name: label, exact: !!opts.exact }))).first();
    await t.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await t.click({ timeout: 8000 });
    await sleep(opts.wait ?? 900);
  };
  const text = async () => page.locator("body").innerText();
  try { await walk({ page, tap, shot, text, db: fb.db }); }
  catch (e) { ok(`${person.key}: the walk finished`, false, String(e).slice(0, 300)); await shot("error"); writeFileSync(`${OUT}/${person.key}-server.log`, log.slice(-8000)); }
  const rows = HELD ? [] : (await fb.db.query(`select * from public.recipe_versions order by created_at`)).rows;   // no table before 0476
  await ctx.close();
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await fb.close();
  await sleep(500);
  return rows;
}
// Ask GT3 on a phone: the header's ✦ (Quick actions) → Ask GT3.
const openAsk = async ({ page, tap }) => {
  await page.goto(`${BASE}/crew?s=day`, { waitUntil: "load", timeout: 30000 }); await sleep(2500);
  const fab = page.locator('button[aria-label^="Quick actions"]:visible').first();
  await fab.click({ timeout: 10000 }); await sleep(900);
  await tap("Ask GT3", { exact: true, role: "tab" });
};
const ask = async ({ page, text }, q) => {
  const box = page.getByRole("textbox", { name: "Ask GT3" });
  await box.fill(q); await box.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll(".oa-msg.assistant").length >= n, (await page.locator(".oa-msg.assistant").count()) + 1, { timeout: 20000 }).catch(() => {});
  await sleep(600);
  const all = await page.locator(".oa-msg.assistant").allInnerTexts();
  return { answer: all[all.length - 1] ?? "", chips: await page.locator(".oa-recipe").last().innerText().catch(() => ""), body: await text() };
};

// What the open recipe says, read off the screen: the table (item → [single, large]), the Makes row, and the build step.
// The test values (2.5 and 3 fl oz milk) are local edits made to prove the editor — never the recipe.
const onScreen = async (page) => {
  const rows = await page.locator('[data-testid="recipe-table"] [role="row"]').allInnerTexts();
  const cells = rows.slice(1).map((r) => r.split("\n").map((x) => x.trim()).filter(Boolean));
  const table = Object.fromEntries(cells.filter((c) => c[0] !== "Makes").map((c) => [c[0], [c[1], c[2]]]));
  const makes = cells.find((c) => c[0] === "Makes")?.slice(1) ?? [];
  const steps = await page.locator('[data-testid="recipe-method"] li').allInnerTexts();
  return { table, makes, build: steps.find((x) => x.startsWith("Single mix:")) ?? "" };
};
// Everything agrees: each amount in the table is the one the build step names, and each Makes is the build's "makes".
const agrees = (v, milk, single) => v.table["A2 goat milk"]?.[0] === `${milk} fl oz` && v.makes[0] === `${single} fl oz`
  && v.build.includes(`${milk} fl oz A2 goat milk`) && v.build.includes(`makes ${single} fl oz`) && v.build.includes("7 fl oz DUSK cold brew")
  && v.build.includes("85 fl oz DUSK cold brew") && v.build.includes("makes 127 fl oz") && v.table["DUSK cold brew"]?.[1] === "85 fl oz";
const toastNow = async (page) => (await page.locator(".toast.show").allInnerTexts()).join(" | ");
const Q = "How much goat milk goes in the Salted Maple Latte?";
const LEAD = (milk) => `${milk} fl oz for one mix, or 24 fl oz for the large batch.`;
const proof = [];   // what Ask GT3 said after each action, and what the screen said — kept in answers.json
// The version label lives in the recipe's History: the row marked current (none before the first publish).
const currentLabel = async (page) => (await page.locator('[data-testid="recipe-history"]').allInnerTexts()).find((x) => /current/.test(x))?.trim()
  ?? ((await page.locator('[data-testid="recipe-history-none"]').count()) ? "built-in (not edited in the app yet)" : "");
// A fresh conversation each time: the page is reloaded, so Ask GT3 starts with no earlier turns.
const freshAsk = async (w, after, milk) => {
  await openAsk(w);
  w.taps.push(`Ask GT3 (fresh): “${Q}”`);
  const r = await ask(w, Q);
  const first = r.answer.trim().split("\n")[0];
  proof.push({ who: w.who, after, answer: r.answer.trim(), buttons: r.chips.split("\n").map((x) => x.trim()).filter(Boolean) });
  ok(`${w.who}: after ${after}, a fresh Ask GT3 leads with “${LEAD(milk)}”`, first === LEAD(milk), r.answer);
  ok(`${w.who}: …the answer leaves the method behind View recipe`, !/Single mix:|Warm the maple/.test(r.answer), r.answer);
  return r;
};
const screenProof = async (w, after, milk, single) => {
  const v = await onScreen(w.page);
  const label = await currentLabel(w.page);
  proof.push({ who: w.who, after, screen: { version: label, line: await w.page.locator('[data-testid="recipe-version"]').innerText(), milk: v.table["A2 goat milk"], makes: v.makes, build: v.build } });
  ok(`${w.who}: after ${after}, the table, Makes and the method agree (${milk} fl oz milk, ${single} fl oz)`, agrees(v, milk, single), v);
  ok(`${w.who}: …the main line says “Current recipe”`, (await w.page.locator('[data-testid="recipe-version"]').innerText()) === "Current recipe");
  return label;
};
const openRecipe = async (w) => {
  await w.page.goto(`${BASE}/crew?s=brew`, { waitUntil: "load", timeout: 30000 });
  await w.page.waitForSelector('[data-testid="drink-recipes"]', { timeout: 20000 });
  await w.tap("Salted Maple Latte");
  await w.page.waitForSelector('[data-testid="recipe-table"]', { timeout: 15000 });
};

if (HELD) {
  for (const person of [CREW, KAYLA]) {
    await as(person, null, async (w0) => {
      const w = { ...w0, who: `${person.key}-before-0476`, taps: (taps[`${person.key}-before-0476`] = []) };
      const { page, tap, shot } = w;
      await openRecipe(w);
      const v = await onScreen(page);
      const body = await page.locator(".rx").innerText();
      ok(`${w.who}: Recipes opens the current recipe — table, Makes and method agree (2 fl oz, 10.5 fl oz)`, agrees(v, 2, 10.5) && (await page.locator('[data-testid="recipe-version"]').innerText()) === "Current recipe", v);
      ok(`${w.who}: it says editing arrives with the update, and offers no edit, correction or history action`, /Recipe editing turns on once the recipe update is applied/.test(body)
        && await page.getByRole("button", { name: /Edit recipe|Suggest a correction|Keep the current recipe|Restore/ }).count() === 0, body.slice(0, 200));
      await shot("1-recipe");
      await tap("Close", { in: ".rx-sheet", exact: true });
      const a = await freshAsk(w, "opening Ask GT3 before 0476", 2);
      ok(`${w.who}: Ask GT3 offers View recipe and the role's action`, /View recipe/.test(a.chips) && (person === KAYLA ? /Edit recipe/ : /Suggest a correction/).test(a.chips), a.chips);
      await tap(person === KAYLA ? "Edit recipe" : "Suggest a correction", { in: ".oa-recipe", exact: true, wait: 1800 });
      const sheet = await page.locator(".rx").innerText();
      ok(`${w.who}: …which opens the current recipe with the same note — never an edit form that couldn't save`, /Recipe editing turns on once/.test(sheet) && await page.getByRole("textbox", { name: "A2 goat milk single mix" }).count() === 0, sheet.slice(0, 200));
      await shot("2-ask-action");
    });
  }
  await browser.close();
  writeFileSync(`${OUT}/answers-before-0476.json`, JSON.stringify(proof, null, 2));
  console.log(`RECIPES JOURNEY BEFORE 0476 (crew + Kayla, phone): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ── 1 · a crew member (no owner access) suggests a correction ───────────────────────────────────────────────────────
carried = await as(CREW, null, async (w0) => {
  const w = { ...w0, who: "crew", taps: taps[CREW.key] };
  const { page, tap, shot } = w;
  await openRecipe(w);
  await shot("1-recipe");
  const l0 = await screenProof(w, "opening it (nothing published yet)", 2, 10.5);
  ok("crew: History says built-in before the first publish", /built-in/.test(l0), l0);
  ok("crew: a crew member is offered Suggest a correction (not Edit recipe)", await page.getByRole("button", { name: "Suggest a correction", exact: true }).count() === 1 && await page.getByRole("button", { name: "Edit recipe" }).count() === 0);
  await tap("Suggest a correction", { exact: true });
  await page.waitForSelector('[data-testid="recipe-yield"]', { timeout: 10000 });
  taps[CREW.key].push("A2 goat milk · single mix: 2 → 2.5 (a test fixture edit)");
  await page.getByRole("textbox", { name: "A2 goat milk single mix" }).fill("2.5");
  await page.getByRole("textbox", { name: "What was wrong (for the reviewer)" }).fill("Test edit");
  await sleep(400);
  const stepFrom = await page.locator('[data-testid="recipe-step-from-amounts"]').innerText();
  ok("crew: as she types, the yield and the method follow the table (2.5 fl oz, 11 fl oz)", /11 fl oz/.test(await page.locator('[data-testid="recipe-yield"]').innerText()) && /2\.5 fl oz A2 goat milk/.test(stepFrom) && /makes 11 fl oz/.test(stepFrom), stepFrom);
  ok("crew: no warning (the large batch is its own formula)", (await page.locator(".rx-warn").allInnerTexts()).length === 0);
  const who = await page.locator('[data-testid="recipe-publishers"]').innerText();
  ok("crew: the publishers are named, and the crew keeps the current recipe until it's published", /Ryan Fixture/.test(who) && /Maria/.test(who) && /crew keeps seeing the current recipe until it's published/.test(who), who);
  await shot("2-correction");
  await tap("Save draft", { exact: true, wait: 1200 });
  ok("crew: Save draft says so in place — no toast", /Draft saved at/.test(await page.locator('[data-testid="recipe-saved"]').innerText()) && !/Draft saved/.test(await toastNow(page)));
  await freshAsk(w, "saving a draft (2.5 pending)", 2);
  await shot("3-ask-after-draft");
  // Back to the recipe to submit the draft.
  await openRecipe(w);
  await tap("Continue your draft", { exact: true });
  await page.waitForSelector('[data-testid="recipe-yield"]', { timeout: 10000 });
  await tap("Submit for review", { exact: true, wait: 1200 });
  const done = await page.locator('[data-testid="recipe-submitted"]').innerText();
  ok("crew: one confirmation — “Submitted for review. The crew will keep seeing the current recipe until your correction is published.” — with the publishers named, and no toast",
    done.startsWith("Submitted for review. The crew will keep seeing the current recipe until your correction is published.") && /Maria Delgado-Whitfield or Ryan Fixture can publish it\./.test(done)
      && (await toastNow(page)) === "" && await page.locator('[data-testid="recipe-saved"]').count() === 0, { done, toast: await toastNow(page) });
  await shot("4-submitted");
  const a = await freshAsk(w, "submitting it for review (2.5 pending)", 2);
  ok("crew: under the answer — View recipe and Suggest a correction", /View recipe/.test(a.chips) && /Suggest a correction/.test(a.chips) && !/Edit recipe/.test(a.chips), a.chips);
  await shot("5-ask-after-submit");
  await tap("View recipe", { in: ".oa-recipe", exact: true, wait: 1500 });
  ok("crew: View recipe holds the full method — the current recipe, not the pending one", /Single mix: 7 fl oz DUSK cold brew, 2 fl oz A2 goat milk/.test(await page.locator('[data-testid="recipe-method"]').innerText()));
  await shot("6-view-recipe");
  await tap("Close", { in: ".rx-sheet", exact: true });
  taps[CREW.key].push("Ask GT3: “What's the recipe for the pumpkin cold foam?”");
  const b = await ask(w, "What's the recipe for the pumpkin cold foam?");
  ok("crew: a recipe question with none on file offers Create recipe draft", /Create recipe draft/.test(b.chips), b.chips);
});
ok("crew: the database holds her submission (one row, submitted, hers) and nothing published", carried.length === 1 && carried[0].status === "submitted" && carried[0].created_by === CREW.id && !carried.some((r) => r.status === "published"), carried.map((r) => r.status));

// ── 2 · Kayla (owner): publishes the submission, edits and publishes v2 herself, restores v1 ──────────────────────────
const after = await as(KAYLA, async (db) => {
  for (const r of carried) await db.query(`insert into public.recipe_versions (id, tenant_id, product_key, status, body, note, created_by, created_at, submitted_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [r.id, r.tenant_id, r.product_key, r.status, r.body, r.note, r.created_by, r.created_at, r.submitted_at]);
}, async (w0) => {
  const w = { ...w0, who: "kayla", taps: taps[KAYLA.key] };
  const { page, tap, shot } = w;
  await openRecipe(w);
  await page.waitForSelector('[data-testid="recipe-review"]', { timeout: 15000 });
  ok("kayla: an owner is offered Edit recipe (not Suggest a correction), and sees the submission waiting", await page.getByRole("button", { name: "Edit recipe", exact: true }).count() === 1
    && await page.getByRole("button", { name: "Suggest a correction" }).count() === 0 && /2\.5 \/ 24 fl oz/.test(await page.locator('[data-testid="recipe-review"]').innerText()));
  await shot("1-review");
  await tap("Publish", { in: '[data-testid="recipe-review"]', exact: true, wait: 1800 });
  const l1 = await screenProof(w, "publishing v1", 2.5, 11);
  ok("kayla: History marks v1 current, published by her", /^v1 · .* · published by Kayla Fixture · current$/.test(l1), l1);
  await shot("2-published-v1");
  await tap("Close", { in: ".rx-sheet", exact: true });
  const a1 = await freshAsk(w, "publishing v1", 2.5);
  ok("kayla: under the answer — View recipe and Edit recipe", /View recipe/.test(a1.chips) && /Edit recipe/.test(a1.chips) && !/Suggest a correction/.test(a1.chips), a1.chips);
  await shot("3-ask-v1");

  // Her own path: Edit recipe → Review changes → Publish now.
  await tap("Edit recipe", { in: ".oa-recipe", exact: true, wait: 1500 });
  taps[KAYLA.key].push("A2 goat milk · single mix: 2.5 → 3 (a test fixture edit)");
  await page.getByRole("textbox", { name: "A2 goat milk single mix" }).fill("3");
  ok("kayla: no Publish now until she has reviewed the changes", await page.getByRole("button", { name: "Publish now" }).count() === 0);
  await tap("Review changes", { exact: true, wait: 900 });
  const rv = await page.locator(".rx").innerText();
  ok("kayla: Review changes shows what changes and the recipe as it will read (3 fl oz, 11.5 fl oz)", /2\.5 \/ 24 fl oz/.test(rv) && /3 \/ 24 fl oz/.test(rv) && /3 fl oz A2 goat milk/.test(rv) && /makes 11\.5 fl oz/.test(rv)
    && /Publishing makes this the current recipe for the crew and Ask GT3\. The one it replaces stays in History and can be restored\./.test(rv), rv.slice(0, 300));
  await shot("4-review-changes");
  await tap("Publish now", { exact: true, wait: 1800 });
  const l2 = await screenProof(w, "publishing v2", 3, 11.5);
  ok("kayla: History marks v2 current; v1 is kept", /^v2 · .* · published by Kayla Fixture · current$/.test(l2) && (await page.locator('[data-testid="recipe-history"]').allInnerTexts()).some((x) => /^v1 /.test(x)), l2);
  await shot("5-published-v2");
  await tap("Close", { in: ".rx-sheet", exact: true });
  await freshAsk(w, "publishing v2", 3);
  await shot("6-ask-v2");

  // Restore v1, from the answer's View recipe.
  await tap("View recipe", { in: ".oa-recipe", exact: true, wait: 1500 });
  await tap("Restore", { in: '[data-testid="recipe-history"]', exact: true, wait: 1800 });
  const l3 = await screenProof(w, "restoring v1", 2.5, 11);
  ok("kayla: History marks v1 current again — the same number", /^v1 · .* · current$/.test(l3), l3);
  await shot("7-restored-v1");
  await tap("Close", { in: ".rx-sheet", exact: true });
  await freshAsk(w, "restoring v1", 2.5);
  await shot("8-ask-restored");
});
// ── 3 · Kayla's production test, rehearsed: publish and restore without changing a quantity ─────────────────────────
// Keep the current recipe as v1 (unchanged) → Edit recipe → add an "Also called" name only → Review changes → Publish now
// (v2) → Restore v1. At each step Ask GT3, the table, Makes and the method stay 2 fl oz / 10.5 fl oz.
const sim = await as(KAYLA, null, async (w0) => {
  const w = { ...w0, who: "kayla-live-rehearsal", taps: (taps["kayla-live-rehearsal"] = []) };
  const { page, tap, shot } = w;
  await openRecipe(w);
  ok("rehearsal: before anything, History says built-in and offers Keep the current recipe as v1", /built-in/.test(await currentLabel(page)) && await page.getByRole("button", { name: "Keep the current recipe as v1" }).count() === 1);
  await tap("Keep the current recipe as v1", { exact: true, wait: 1800 });
  const l1 = await screenProof(w, "keeping the current recipe as v1", 2, 10.5);
  ok("rehearsal: History marks v1 current — the recipe itself unchanged", /^v1 · .* · published by Kayla Fixture · current$/.test(l1), l1);
  await shot("1-kept-v1");
  await tap("Close", { in: ".rx-sheet", exact: true });
  await freshAsk(w, "keeping the current recipe as v1", 2);
  await tap("Edit recipe", { in: ".oa-recipe", exact: true, wait: 1500 });
  taps["kayla-live-rehearsal"].push("Also called: “Kayla test” (no quantity touched)");
  await page.getByRole("textbox", { name: "Also called (comma between names)" }).fill("Kayla test");
  await tap("Review changes", { exact: true, wait: 900 });
  const rv = await page.locator('[data-testid="recipe-changes"]').first().innerText();
  ok("rehearsal: the only change under review is the name — no amount, no yield", /Also called/.test(rv) && !/Amount|Yield/.test(rv), rv);
  await shot("2-review-name-only");
  await tap("Publish now", { exact: true, wait: 1800 });
  const l2 = await screenProof(w, "publishing v2 (a name only)", 2, 10.5);
  ok("rehearsal: v2 is current; quantities unchanged", /^v2 · .* · current$/.test(l2), l2);
  await tap("Close", { in: ".rx-sheet", exact: true });
  await freshAsk(w, "publishing v2 (a name only)", 2);
  await tap("View recipe", { in: ".oa-recipe", exact: true, wait: 1500 });
  await tap("Restore", { in: '[data-testid="recipe-history"]', exact: true, wait: 1800 });
  const l3 = await screenProof(w, "restoring v1", 2, 10.5);
  ok("rehearsal: Restore puts v1 back, and the name with it is gone", /^v1 · .* · current$/.test(l3) && !/Kayla test/.test(await page.locator('[data-testid="recipe-read"]').innerText()), l3);
  await shot("3-restored-v1");
  await tap("Close", { in: ".rx-sheet", exact: true });
  await freshAsk(w, "restoring v1", 2);
});
const simAmts = sim.map((r) => JSON.stringify((r.body.amounts ?? []).map((a) => [a.item, a.single, a.large])));
ok("rehearsal: the database — v1 published, v2 retired, and every version holds the published quantities (7/2/1.5, 85/24/18)",
  sim.filter((r) => r.status === "published").length === 1 && sim.find((r) => r.status === "published")?.version_no === 1 && sim.some((r) => r.version_no === 2 && r.status === "retired")
    && simAmts.every((x) => x === JSON.stringify([["DUSK cold brew", 7, 85], ["A2 goat milk", 2, 24], ["Salted Maple Syrup", 1.5, 18]])), { status: sim.map((r) => [r.status, r.version_no]), simAmts });
writeFileSync(`${OUT}/answers.json`, JSON.stringify(proof, null, 2));
const pub = after.filter((r) => r.status === "published");
ok("the database: exactly one published version (v1), v2 retired, decided by Kayla", pub.length === 1 && pub[0].version_no === 1 && pub[0].decided_by === KAYLA.id && after.some((r) => r.version_no === 2 && r.status === "retired"), after.map((r) => [r.status, r.version_no]));

await browser.close();
writeFileSync(`${OUT}/taps.json`, JSON.stringify(taps, null, 2));
console.log(JSON.stringify(taps, null, 2));
console.log(`RECIPES JOURNEY (crew + Kayla, phone): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
