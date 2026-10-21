// R46 — GT3 NUTRITION IS FOR SALE (2026-10-21 — Ryan: "One-time buy", then "you do it now"; $47 the founding price).
//
//   1 · lib/nutritionBuy: the tier a purchase gives, the access row it writes (tied to its order), the button's words.
//   2 · the checkout: a member signs in first; the price is the catalog's, never the page's; one key is one charge; the
//       order is delivered at once with nothing to ship; the access is granted on their record, tied to the order; every
//       way it can stop after the money is told to the crew; the receipt says where the course is read.
//   3 · the screens: the course page sells it (or says it's theirs); the iPhone app sends the purchase to the web and
//       never takes a card for it; the Shop points at it.
//   4 · the database, as text: 0443 goes now; 0442 stays held until 0443 is in.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// ── 1 · lib/nutritionBuy ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const B = loadTs("lib/nutritionBuy.ts");
  const row = B.courseAccessRow("C1", "O1");
  ok("the purchase gives the tier every lesson asks for ('pro'), live, bought, tied to its order",
    B.COURSE_TIER === "pro" && row.customer_id === "C1" && row.tier === "pro" && row.source === "purchase" && row.order_id === "O1" && row.revoked_at === null && !Number.isNaN(Date.parse(row.granted_at)), row);
  ok("the button says the catalog's price, and no price when there is none", B.buyLabel(4700) === "Get GT3 Nutrition — $47" && B.buyLabel(9750) === "Get GT3 Nutrition — $97.50"
    && B.buyLabel(0) === "Get GT3 Nutrition" && B.buyLabel(null) === "Get GT3 Nutrition", [B.buyLabel(4700), B.buyLabel(9750)]);
}

// ── 2 · the checkout ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = code(read("app/api/nutrition/checkout/route.ts"));
  ok("a member signs in first — a guest is refused before any card", /const user = who\.kind === "user" \? \{ id: who\.id \} : null;\s+if \(!user\) return NextResponse\.json\(\{ error: "Sign in first — GT3 Nutrition is kept on your account\." \}, \{ status: 401 \}\);/.test(r)
    && r.indexOf("if (!user)") < r.indexOf("chargeCard("));
  ok("the price is the catalog's: the one live program_tier 'pro' row, never a number the page sent — and a price raised since the button is refused",
    /\.from\("shop_products"\)\s*\.select\("id, title, price_cents, cost_cents"\)\.eq\("tenant_id", tenant\)\.eq\("kind", "program_tier"\)\.eq\("program_tier", COURSE_TIER\)/.test(r)
      && /const total = Math\.max\(0, Number\(p\.price_cents\) \|\| 0\);/.test(r) && /aboveShown\(total, shownCents\(body\.expectedCents\)\)/.test(r) && !/body\.(price|amount|cents)\b/.test(r));
  ok("already theirs: nothing is charged", /if \(has\?\.length\) return NextResponse\.json\(\{ ok: true, already: true \}/.test(r) && r.indexOf("already: true") < r.indexOf("claimKey("));
  ok("one key, one charge: seen before, claimed, charged once (lib/chargeOnce), every card try bounded per caller and for the app",
    /seenBefore\(checkoutClaims\(supabaseAdmin\), idemKey, true/.test(r) && /claimKey\(seen\.claims, idemKey, \{ channel: "shop", card: true, amountCents: total \}/.test(r) && /chargeOnce\(\{/.test(r)
      && /bucket: `course-checkout:\$\{ip\}`/.test(r) && /bucket: "course-checkout:global", windowMs: 60_000, max: CARD_TRIES\.allPerMinute/.test(r) && /cardsPausedRefusal\(supabaseAdmin, \{ userId: user\.id, ip \}\)/.test(r));
  ok("the order is delivered at once — nothing to ship — its line the product's, found again by Square's payment id on a retry",
    /status: "delivered"/.test(r) && /ship_name: null, ship_address: null/.test(r) && /\.from\("shop_orders"\)\.select\("id"\)\.eq\("payment_id", paymentId\)/.test(r) && /product_id: p\.id, title: p\.title, variant: null, qty: 1, unit_cents: total/.test(r));
  ok("the course opens on their record, tied to the order — upserted on the one row a member has per tier",
    /const access = courseAccessRow\(customerId, orderId\);/.test(r) && /\.from\("program_access"\)\.upsert\(access, \{ onConflict: "customer_id,tier" \}\)/.test(r));
  ok("every way it stops after the money is the crew's to hear, and the buyer is told it's paid — never a checkout that failed",
    (r.match(/severity: "critical", category: "money"/g) || []).length >= 5 && /title: "GT3 Nutrition paid — open the course for them"/.test(r) && /paid: true, recorded: true, opened: false/.test(r));
  const rc = loadTs("lib/receipt.ts");
  const msg = rc.orderReceipt({ id: "abcdef12-0000", ship_name: null, total_cents: 4700, items: [{ title: "GT3 Nutrition · Return to Primal", qty: 1, unit_cents: 4700 }], digital: true });
  ok("its receipt says where the course is read — not that tracking follows", /It's yours now — every lesson and every map, for good\. Sign in with this email and open GT3 Nutrition: https:\/\/app\.gt3pb\.com\/primal/.test(msg.message) && !/tracking/i.test(msg.message), msg.message);
  ok("…and a receipt resent from the order says the same (an order with nothing to ship is the course's)",
    /digital: !\(order as \{ ship_address\?: unknown \}\)\.ship_address,/.test(read("app/api/shop/receipt/route.ts")) && /select\("id, email, user_id, ship_name, ship_address, total_cents, status"\)/.test(read("app/api/shop/receipt/route.ts")));
}

// ── 3 · the screens ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const b = read("components/nutrition/CourseBuy.tsx");
  ok("the buy reads the catalog's price, and offers nothing when the course isn't on sale",
    /\.from\("shop_products"\)\.select\("price_cents, blurb"\)\s*\.eq\("kind", "program_tier"\)\.eq\("program_tier", COURSE_TIER\)/.test(b) && /if \(!prod\) return null;/.test(b) && /buyLabel\(prod\.price_cents\)/.test(b));
  ok("in the iPhone app the purchase is the web's — a link out, never a card form",
    /if \(isNativeApp\(\)\) \{\s*return \(\s*<div className="nu-buy">\s*<a href=\{`\$\{WEB_ORIGIN\}\/primal#nu-pro`\}/.test(b) && b.indexOf("isNativeApp()") < b.indexOf("<PaymentCard ref"));
  ok("signed out: sign in first; signed in: one key per purchase, the server's answer said, Pay felt", /Sign in first — GT3 Nutrition is kept on your account\./.test(b) && /useIdemKey\("gt3-course-idem"\)/.test(b)
    && /authedFetch\("\/api\/nutrition\/checkout"/.test(b) && /haptic\("paid"\)/.test(b) && /idem\.settle\(attempt\.key, r\.status, data\)/.test(b));
  ok("bought: it says so, and the course page reads again (the lessons open)", /GT3 Nutrition is yours — every lesson and every map\./.test(b) && /onBought\(\);/.test(b));
  const ac = read("components/PrimalAcademy.tsx");
  ok("the course page sells it where it shows what it holds — the card form loaded only when that block is", /const CourseBuy = dynamic\(\(\) => import\("@\/components\/nutrition\/CourseBuy"\)\);/.test(ac)
    && /<CourseBuy owned=\{isPro\} signedIn=\{!!user\} onBought=\{\(\) => void board\.reload\(\)\} \/>/.test(ac));
  ok("the Shop points at it", /<Link href="\/primal#nu-pro" className="block no-underline mb-3" onClick=\{\(\) => haptic\("light"\)\}>\s*<InfoRow name="GT3 Nutrition — the course"/.test(read("components/Shop.tsx")));
  ok("the words: one time, the founding price", /One time — no subscription\. The founding price: every lesson added later is yours too\./.test(b) && /\{ key: "primal\.cta_eye", default: "GT3 Nutrition · one time" \}/.test(read("lib/copy.ts")));
}

// ── 4 · the database, as text ────────────────────────────────────────────────────────────────────────────────────────
{
  const m = read("supabase/migrations/0443_gt3_nutrition_is_for_sale.sql");
  ok("0443: the product once ($47, published), the order an access came from, and a refund or cancel taking back what that order gave",
    /'program_tier', 'pro', 'GT3 Nutrition · Return to Primal', 'GT3 Nutrition',/.test(m) && /4700, now\(\), 0\nwhere not exists/.test(m)
      && /add column if not exists order_id uuid references public\.shop_orders\(id\) on delete set null/.test(m)
      && /if new\.status in \('refunded', 'canceled'\) and old\.status is distinct from new\.status then/.test(m) && /where order_id = new\.id and revoked_at is null;/.test(m)
      && /revoke all on function public\.program_access_follows_its_order\(\) from public, anon, authenticated;/.test(m)
      && /^set lock_timeout = '5s';$/m.test(m) && /select public\.record_migration\('0443_gt3_nutrition_is_for_sale'\);/.test(m));
  const held = JSON.parse(read("supabase/held.json")).held;
  const paste = read("supabase/APPLY_ALL_PENDING.sql");
  ok("0443 is in the paste file; 0442 is still held — locked only once the course can be bought",
    (/begin;   -- 0443,/.test(paste) || !/pending-from: 04[0-3]\d/.test(paste)) && !/begin;   -- 0442,/.test(paste) && held.some((h) => h.file.startsWith("0442_")));
  const pkg = JSON.parse(read("package.json"));
  ok("this file runs with every test, and its database half with the database's", /node scripts\/r45\.test\.mjs && node scripts\/r46\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/db\.r46\.test\.mjs/.test(pkg.scripts["db:test"]));
}

console.log(`R46 — GT3 NUTRITION IS FOR SALE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
