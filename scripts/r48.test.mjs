// R48 — FINDABLE, MANY AT ONCE, AND THE FLOOR (2026-10-23 — Ryan: "one would think that what I'm looking for would be in
// settings under business"; "areas where you can do multiple things for multiple items… take off multiple items
// offline"; "audits across all consoles… 10 out of 10… make that our baseline standard… no regression ever").
//
//   1 · lib/bulk: select all = what is shown; each row answered on its own; refusals named; the confirm names the count.
//   2 · the kit (components/BulkBar): asks, writes, says, keeps what didn't take picked, holds an Undo.
//   3 · Catalog: merch and menu — Select, the actions, Undo to exactly what was there, export; the cut-off field; the row tile.
//   4 · GT3 Nutrition, the product: its price and Live/Hidden, an owner's; Hidden takes the Shop's row too.
//   5 · findable: every panel in lib/panelIndex, the palette searches it, Settings › Business has the store.
//   6 · the floor: scripts/console.audit runs with every audit; 0445's history on what we sell.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── 1 · lib/bulk ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const B = loadTs("lib/bulk.ts");
  const sel = new Set(["a", "b", "z"]);
  ok("acts on what is picked AND shown — a row filtered away or gone is never touched", JSON.stringify(B.inView(sel, ["a", "b", "c"])) === '["a","b"]');
  ok("Select all picks what is shown; again clears what is shown and keeps the rest",
    JSON.stringify([...B.toggleAll(new Set(["z"]), ["a", "b"])].sort()) === '["a","b","z"]' && JSON.stringify([...B.toggleAll(new Set(["a", "b", "z"]), ["a", "b"])]) === '["z"]'
      && B.toggleAll(new Set(), []).size === 0 && B.toggle(new Set(["a"]), "a").size === 0 && B.toggle(new Set(), "a").has("a"));
  const out = await B.runEach(["a", "b", "c", "d", "e"], async (id) => (id === "b" ? "locked" : id === "d" ? (() => { throw new Error("no network"); })() : null), 2);
  ok("each row answered on its own — a refusal and a throw named, the rest done", JSON.stringify(out.ok) === '["a","c","e"]' && JSON.stringify(out.failed) === '[{"id":"b","why":"locked"},{"id":"d","why":"no network"}]', out);
  const name = (id) => ({ a: "Tote", b: "Cap", c: "Tee" })[id] ?? id;
  ok("said plainly: all, some (naming each refusal), none — never a blanket Saved",
    B.outcomeWords({ ok: ["a"], failed: [] }, "Hid", name) === "Hid 1 item." && B.outcomeWords({ ok: ["a", "c"], failed: [] }, "Hid", name) === "Hid 2 items."
      && B.outcomeWords({ ok: ["a"], failed: [{ id: "b", why: "locked" }] }, "Hid", name) === "Hid 1 of 2 items — Cap: locked"
      && B.outcomeWords({ ok: [], failed: [{ id: "b", why: "locked" }] }, "Hid", name) === "Nothing changed — Cap: locked"
      && B.outcomeWords({ ok: ["a", "c"], failed: [] }, "Marked sold out", name, ["drink", "drinks"]) === "Marked sold out 2 drinks.");
  const w = B.confirmWords("Hide", 4, ["item", "items"], "from the shop");
  ok("the confirm names the count and what happens, and says it can be undone", w.title === "Hide 4 items from the shop?" && w.confirmLabel === "Hide 4 items" && /undo it for a minute/.test(w.body));
}

// ── 2 · the kit ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const k = read("components/BulkBar.tsx");
  ok("the bar: the count, Select all of what is shown, Clear, the actions — a toolbar a screen reader names",
    /role="toolbar" aria-label=\{`\$\{picked\.length\} selected`\}/.test(k) && /`Select all \$\{shownIds\.length\}`/.test(k) && /setSelected\(toggleAll\(selected, shownIds\)\)/.test(k));
  ok("an action asks first, writes each row, says what took, keeps what didn't picked, and holds an Undo to what was there",
    /if \(!\(await confirm\(\{ \.\.\.w, danger: a\.danger \}\)\)\) return;/.test(k) && /const out = await runEach\(ids, a\.apply\);/.test(k)
      && /setSelected\(new Set\(out\.failed\.map\(\(f\) => f\.id\)\)\);/.test(k) && /action: \{ label: "Undo"/.test(k) && /const back = await runEach\(out\.ok, undo\);/.test(k)
      && /if \(!undoOpen\(at\)\)/.test(k) && /if \(!out\.failed\.length\) haptic\("success"\); else if \(out\.ok\.length\) haptic\("warning"\); else haptic\("error"\);/.test(k));
}

// ── 3 · Catalog ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = read("components/MerchManager.tsx");
  ok("merch: Select, filter by Live/Hidden/Archived and search, Make live / Hide / Archive, Undo to each row's own before",
    /setSelecting\(\(v\) => !v\)/.test(m) && /\(\["all", "live", "hidden", "archived"\] as const\)/.test(m) && /<BulkBar shownIds=\{pickable\.map\(\(p\) => p\.id\)\}/.test(m)
      && /key: "live", label: "Make live"/.test(m) && /key: "hide", label: "Hide"/.test(m) && /key: "archive", label: "Archive"/.test(m)
      && /const before = new Map\(products\.map\(\(p\) => \[p\.id, \{ published_at: p\.published_at, archived_at: p\.archived_at \}\]\)\);/.test(m)
      && /return Promise\.resolve\("no price yet"\)/.test(m) && /data\?\.length \? null : "you can't change this one"/.test(m));
  ok("merch: the visibility field says Live / Hidden / Archived (fits a phone), with what each means under it — and every row has a photo-sized tile",
    /<option value="published">Live<\/option>/.test(m) && !/Hidden — not in the shop, still editable/.test(m) && /In the shop — customers see it and can buy it\./.test(m)
      && /<Icon name="package" size=\{14\} \/>/.test(m) && !/className="prod-dot" style/.test(m));
  const u = read("components/MenuManager.tsx");
  ok("menu: Select over what the filter and search show; on or off the menu, sold out or back; a draft can't go on unnamed or unpriced",
    /const shownIds = groups\.flatMap\(\(g\) => g\.items\.map\(\(p\) => p\.id\)\);/.test(u) && /key: "on", label: "Put on the menu"/.test(u) && /key: "off", label: "Take off the menu"/.test(u)
      && /key: "out", label: "Sold out"/.test(u) && /key: "in", label: "Back in stock"/.test(u) && /it needs a name and a price first/.test(u) && /noun=\{\["drink", "drinks"\]\}/.test(u));
  ok("both export what they show", /downloadCsv\("gt3-merch\.csv"/.test(m) && /downloadCsv\("gt3-menu\.csv"/.test(u));
}

// ── 4 · GT3 Nutrition, the product ───────────────────────────────────────────────────────────────────────────────────
{
  const c = read("components/nutrition/CourseProduct.tsx");
  ok("the course's price and Live/Hidden, an owner's or an admin's, at least $1, refused writes said",
    /\.update\(\{ price_cents: cents, published_at: live \?/.test(c) && /cents < 100/.test(c) && /Only an owner or an admin changes the course/.test(c) && /<option value="hidden">Hidden<\/option>/.test(c)
      && /<CourseProduct canEdit=\{canGive\} \/>/.test(read("components/nutrition/CourseStudents.tsx")));
  ok("Hidden takes the Shop's row too (the course page's button already follows it)", /\{courseOnSale && \(/.test(read("components/Shop.tsx")) && /if \(!prod\) return null;/.test(read("components/nutrition/CourseBuy.tsx")));
}

// ── 5 · findable ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const I = loadTs("lib/panelIndex.ts");
  const page = read("app/crew/page.tsx");
  const ids = new Set([...page.matchAll(/<Panel id="([a-z0-9-]+)"/g)].map((m) => m[1]));
  const indexed = new Set(I.PANEL_INDEX.map((e) => e.id));
  ok("every panel in the console is in the index, and the index names no panel that's gone", [...ids].every((id) => indexed.has(id)) && [...indexed].every((id) => ids.has(id)),
    { missing: [...ids].filter((id) => !indexed.has(id)), stale: [...indexed].filter((id) => !ids.has(id)) });
  const find = (q) => I.PANEL_INDEX.filter((e) => I.panelMatches(e, "", q)).map((e) => e.id);
  ok("the owner's words find the panel: store, merch, course, discount, hide item, students, who changed",
    find("store").includes("merch") && find("store").includes("menu") && find("store").includes("set-store") && find("merch").includes("merch") && find("course").includes("students")
      && find("discount").includes("cust-codes") && find("hide item").includes("merch") && find("students")[0] === "students" && find("who changed").includes("set-admintrail") && find("zzz").length === 0 && find("").length === 0);
  const p = read("components/CommandPalette.tsx");
  ok("the palette searches panels the reader's role can open, and opens each where it lives",
    /PANEL_INDEX\.filter\(\(e\) => allowed\.has\(e\.section\)\)/.test(p) && /run: \(\) => \{ setSection\(e\.section\); scrollToAnchor\(e\.id\); \}/.test(p) && /items\.filter\(\(i\) => !i\.match\)/.test(p));
  ok("Settings › Business: Store & catalog, first — doors to the menu, merch, the course, its lessons, drops, plans, codes, orders",
    /<Panel id="set-store" title="Store & catalog"/.test(page) && ["menu", "merch", "students", "lessons", "resv", "plans", "cust-codes", "shoporders"].every((a) => page.includes(`<GoLine to="catalog" anchor="${a}">`))
      && /\{ label: "Business", panels: \[\s*\{ id: "set-store", gate: "admin" \}/.test(read("lib/settingsLayout.ts")));
}

// ── 6 · the floor ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const pkg = JSON.parse(read("package.json"));
  ok("the console audit runs with every audit, and this file and its database half with theirs", / && node scripts\/console\.audit\.mjs"?$/.test(pkg.scripts.audit)
    && /node scripts\/r47\.test\.mjs && node scripts\/r48\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/db\.r48\.test\.mjs/.test(pkg.scripts["db:test"]));
  const A = await import(join(ROOT, "scripts/console.audit.mjs"));
  ok("every list has a floor, and the store's two are 10/10", A.LISTS.every((L) => A.FLOOR[L.key]) && A.FLOOR.menu === "10/10" && A.FLOOR.merch === "10/10");
  const m = read("supabase/migrations/0445_every_change_to_what_we_sell_is_in_the_activity_log.sql");
  ok("0445: history on everything Catalog edits that had none, under names that replace nothing", /array\['shop_products', 'subscription_plans', 'member_benefits', 'primal_lessons', 'primal_modules', 'primal_pillars', 'reserves'\]/.test(m)
    && /'admin_audit_' \|\| t/.test(m) && /select public\.record_migration\('0445_every_change_to_what_we_sell_is_in_the_activity_log'\);/.test(m) && /^set lock_timeout = '5s';$/m.test(m));
}

console.log(`R48 — FINDABLE, MANY AT ONCE, AND THE FLOOR: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
