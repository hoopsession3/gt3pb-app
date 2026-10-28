// THE CONSOLE ON PHONES (R49, 2026-10-23 — Ryan: "were you able to audit a smokescreen test on the backend pages for
// all devices, iPhone [too]?" It was not: scripts/smoke.ui.mjs drives the guest's pages, scripts/smoke.authed.mjs needs a
// real account the checks don't have, and so every console screen had only ever been looked at by a person.)
//
//   npm run smoke:console                 # builds into .next-console, then checks; screenshots in .smoke-console/
//   CONSOLE_ONLY=catalog,money npm run smoke:console
//   CONSOLE_NO_BUILD=1 npm run smoke:console   # reuse .next-console
//   CONSOLE_PROBE='document.title' …            # print what an expression says on each visited screen
//
// What it stands on: a stand-in Supabase (scripts/fixtures/fakebase.mjs — the whole schema in PGlite, every read as
// the signed-in owner under RLS) seeded with a made-up week (scripts/fixtures/consoleWorld.mjs), and this app built
// against it. No real account, no real key, no production row: the session is a made-up token for a made-up owner.
//
// Every console section, on each phone in DEVICES, as the owner. A section fails when:
//   · it is not the console (the sign-in wall, the two-step prompt, an empty "Opening the console…");
//   · a read or write the screen made came back 4xx/5xx from the database (a column, grant or policy wrong), or the page
//     threw;
//   · the page scrolls sideways, or anything visible ends past the screen's right edge (outside a box made to scroll);
//   · text is cut off with no ellipsis — a word clipped by its box, a select whose choice doesn't fit (R48's "Hidden —
//     not in the shop, still editable" was this);
//   · a tap target is smaller than the section's recorded floor, or text smaller than its floor (CONSOLE_FLOOR below —
//     may rise, never fall, like every ratchet here).
// Each screen is kept as a picture (.smoke-console/<device>/<section>.png) for a person to look at; the check says what
// a picture can't be trusted to show.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { startFakebase } from "./fixtures/fakebase.mjs";
import { seedConsoleWorld, OWNER } from "./fixtures/consoleWorld.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = await import("playwright")); }
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";

export const DEVICES = [
  { key: "iphone-17", w: 402, h: 874, dpr: 3 },
  { key: "iphone-se", w: 375, h: 667, dpr: 2 },
  { key: "iphone-17-pro-max", w: 440, h: 956, dpr: 3 },
  // S1.1b (Ryan: "iPhone landscape where supported"): the vision on its side — the studio has 402 points of height.
  { key: "iphone-17-side", w: 874, h: 402, dpr: 3, visitsOnly: true },
  // R53 (Ryan: "be amazing on iPad Pro, iPad… and desktop"): the vision on the iPads, both ways up and in Split View
  // (half of a 13-inch on its side; two thirds), and on a desktop. Their pages are the vision's (VISITS) — the console's
  // sections on an iPad are smoke:native's (its two iPad Airs).
  { key: "ipad-11", w: 820, h: 1180, dpr: 2, kind: "ipad", visitsOnly: true },
  { key: "ipad-11-side", w: 1180, h: 820, dpr: 2, kind: "ipad", visitsOnly: true },
  { key: "ipad-13", w: 1032, h: 1376, dpr: 2, kind: "ipad", visitsOnly: true },
  { key: "ipad-13-side", w: 1376, h: 1032, dpr: 2, kind: "ipad", visitsOnly: true },
  { key: "ipad-split-half", w: 678, h: 1032, dpr: 2, kind: "ipad", visitsOnly: true },
  { key: "ipad-split-two-thirds", w: 917, h: 1032, dpr: 2, kind: "ipad", visitsOnly: true },
  { key: "desktop", w: 1440, h: 900, dpr: 2, kind: "desktop", visitsOnly: true },
  // IP1 (Ryan: the presenter across a table, or on a wall): a 1080p projector, the presenter's slides only.
  { key: "projector", w: 1920, h: 1080, dpr: 1, kind: "desktop", visitsOnly: true, visits: /^vision-(present|ways|case|cash|explore|diligence)$/ },
];
const UA = {
  phone: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
};
export const SECTIONS = ["day", "now", "command", "prep", "plan", "studio", "brew", "garage", "notes", "driver", "money", "catalog", "customers", "team", "settings"];

// S1.1 — THE STUDIO'S GATE, measured on the screen itself: the whole room drawn inside its pane (nothing clipped) and
// large (its longer side at least 70% of the pane's), and the canvas whole on the first screen — no scrolling to reach
// the drawing (a phone may scroll to the room's lists below it, not to the canvas). Returns what's wrong, or null.
const STUDIO_FITS = () => {
  const box = document.querySelector(".vz-planbox"), room = document.querySelector(".vz-plan .room"), stage = document.querySelector(".vz-stage");
  if (!box || !room || !stage) return "no plan on screen";
  const b = box.getBoundingClientRect(), r = room.getBoundingClientRect(), s = stage.getBoundingClientRect();
  const out = [];
  if (r.left < b.left - 1 || r.top < b.top - 1 || r.right > b.right + 1 || r.bottom > b.bottom + 1) out.push(`the room spills out of its pane (${Math.round(r.left - b.left)},${Math.round(r.top - b.top)} → ${Math.round(b.right - r.right)},${Math.round(b.bottom - r.bottom)})`);
  const use = Math.max(r.width / b.width, r.height / b.height);
  if (use < 0.7) out.push(`the room uses ${Math.round(use * 100)}% of its pane`);
  if (s.bottom > window.innerHeight + 1) out.push(`the canvas runs ${Math.round(s.bottom - window.innerHeight)}px past the screen`);
  // At least 300px — or, on a screen too short for that (a phone on its side, S1.1b), at least 70% of the screen.
  if (s.height < Math.min(300, window.innerHeight * 0.7)) out.push(`the canvas is only ${Math.round(s.height)}px tall`);
  return out.length ? out.join("; ") : null;
};

// The crew's screens outside the console (R52): where each opens, what says it's drawn, what to tap first.
const VISITS = [
  { key: "vision-roadmap", path: "/vision", ready: ".vz-board", drawn: ".vz-board .vz-card", long: true },
  { key: "vision-store", path: "/vision", ready: ".vz-board", clicks: ["The store"], drawn: ".vz-plan .it", long: true, check: STUDIO_FITS },
  { key: "vision-flow", path: "/vision", ready: ".vz-board", clicks: ["The store", "Experience"], drawn: ".vz-plan .guest", long: true },
  // S1, the studio: the canvas full screen, and the library (a sheet on a phone and an iPad upright, beside the canvas wide).
  { key: "vision-store-full", path: "/vision", ready: ".vz-board", clicks: ["The store", "Full screen"], drawn: ".vz-studio.full .vz-plan .it", long: false, check: STUDIO_FITS },
  { key: "vision-store-add", path: "/vision", ready: ".vz-board", clicks: ["The store", "Add a fixture"], drawn: ".vz-library .vz-lib-row", long: false },
  { key: "vision-links", path: "/vision", ready: ".vz-board", clicks: ["Links"], drawn: ".vz-insp", long: false },
  { key: "vision-evaluate", path: "/vision", ready: ".vz-board", clicks: ["The store", "Evaluate"], drawn: "[aria-label=\"Evaluate — the most serious first\"]", long: false },
  // PF1 — Primal Food, planned: the Food tab (owners and admins), on every phone.
  { key: "vision-food", path: "/vision", ready: ".vz-board", clicks: ["Food"], drawn: "#vz-food", long: false },
  { key: "vision-standard", path: "/vision", ready: ".vz-board", clicks: ["Standard"], drawn: "[role=radiogroup][aria-label=\"The Standard\"]", long: false },
  { key: "vision-present", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], drawn: ".vp-slide", long: false },
  { key: "vision-ways", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-steps" }, drawn: ".vp-steps .vp-chip", long: false },
  { key: "vision-case", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-slide .vz-kpis" }, drawn: ".vp-slide .vz-kpis .vz-kpi", long: false },
  // IP1 — the presenter's three ways: Explore's levers, and Diligence's figure opened to its formula.
  // IP1.1 — Pitch's cash slide: the low point, the month table, what the investor is paid.
  { key: "vision-cash", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-slide .vp-table" }, drawn: ".vp-table summary", long: false },
  { key: "vision-explore", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-slide .vz-kpis" }, then: ["Explore"], drawn: ".vp-explore input[type=range]", long: false },
  // IP1.4 — Explore's cases as cards (no sideways table), and a Diligence section opened: the use of funds, reconciled.
  { key: "vision-explore-cases", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-slide .vz-kpis" }, then: ["Explore"], drawn: ".vp-scn .vz-kpi", long: false },
  { key: "vision-diligence-funds", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-slide .vz-kpis" }, then: ["Diligence", "2 · Use of funds"], drawn: ".vp-sec[open] .vz-dl", long: false },
  { key: "vision-diligence", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-slide .vz-kpis" }, then: ["Diligence", "Minimum funding"], drawn: ".vp-drill .vz-formula", long: false },
  { key: "vision-tour", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-tour canvas" }, drawn: ".vp-tour canvas", long: false },
  { key: "vision-tour-flow", path: "/vision", ready: ".vz-board", clicks: ["▶ Present"], until: { click: "Next", sel: ".vp-tour canvas" }, then: ["▶ Run the flow"], drawn: ".vp-tour .vz-flow-say", long: false },
  { key: "vision-plans", path: "/vision", ready: ".vz-board", clicks: ["Plans"], drawn: ".vz-ladder .vz-card", long: true },
  { key: "vision-compare", path: "/vision", ready: ".vz-board", clicks: ["Plans", "Side by side"], drawn: ".vz-cmp td", long: true },
  { key: "vision-plan-case", path: "/vision", ready: ".vz-board", clicks: ["Plans", "A bar inside a gym, phase 1"], drawn: ".vz-h", long: true },
  { key: "vision-plan-sheet", path: "/vision", ready: ".vz-board", clicks: ["Plans", "A bar inside a gym, phase 1", "Edit the plan"], drawn: ".vz-formats", long: false },
  { key: "vision-money", path: "/vision", ready: ".vz-board", clicks: ["Plans", "A bar inside a gym, phase 1", "Money"], drawn: ".vz-chart .line", long: true },
  { key: "vision-traffic", path: "/vision", ready: ".vz-board", clicks: ["Plans", "A bar inside a gym, phase 1", "Traffic"], drawn: ".vz-funnel li", long: true },
  { key: "vision-room", path: "/vision", ready: ".vz-board", clicks: ["Plans", "A bar inside a gym, phase 1", "The room"], drawn: ".vz-kpis .vz-kpi", long: true },
  { key: "vision-money-drill", path: "/vision", ready: ".vz-board", clicks: ["Plans", "A bar inside a gym, phase 1", "Money", "Cost to open:"], drawn: ".vz-formula code", long: false },
];
const DB_PORT = 54329, PORT = 3219;
const DB_URL = `http://127.0.0.1:${DB_PORT}`, BASE = `http://127.0.0.1:${PORT}`;
const ANON = "fixture-anon-not-a-key";
const DIST = ".next-console";
const OUT = ".smoke-console";

let pass = 0, fail = 0;
const failures = [];
const ok = (n, c, got) => { if (c) pass++; else { fail++; failures.push(n); console.log(`  ✗ ${n}${got !== undefined ? ` → ${typeof got === "string" ? got : JSON.stringify(got)}`.slice(0, 900) : ""}`); } };

// ── 1 · the build, against the stand-in ──────────────────────────────────────────────────────────────────────────────
const ENV = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: DB_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, GT3_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: "1" };
delete ENV.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.CONSOLE_NO_BUILD || !existsSync(`${DIST}/BUILD_ID`)) {
  console.log("CONSOLE ON PHONES: building against the stand-in database…");
  const NEXT_BIN = require.resolve("next/dist/bin/next");
  // next build writes its folder's types into tsconfig.json; this build's folder is the harness's own, so the file is
  // put back as it was.
  const tsconfig = readFileSync("tsconfig.json", "utf8");
  const b = spawnSync(process.execPath, [NEXT_BIN, "build"], { env: ENV, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  writeFileSync("tsconfig.json", tsconfig);
  if (b.status !== 0) { console.log(String(b.stdout).slice(-2000), String(b.stderr).slice(-2000)); console.log("CONSOLE ON PHONES: the build failed"); process.exit(1); }
}

// ── 2 · the database and the server ──────────────────────────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
const userObject = { id: OWNER.id, aud: "authenticated", role: "authenticated", email: OWNER.email, email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: OWNER.name }, factors: [], created_at: new Date(Date.now() - 864e5 * 200).toISOString() };
// Not a credential: an unsigned token for a made-up account, read only by the stand-in in this process.
const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: OWNER.id, role: "authenticated", aud: "authenticated", email: OWNER.email, exp, aal: "aal2", amr: [{ method: "totp", timestamp: exp - 3600 }], session_id: "fixture" })}.fixture`;
const session = () => ({ access_token: token, refresh_token: "fixture-refresh", expires_in: 6 * 3600, expires_at: exp, token_type: "bearer", user: userObject });
let seedNotes = [];
const fb = await startFakebase({ port: DB_PORT, user: { id: OWNER.id, email: OWNER.email, object: userObject, session }, seed: async (db) => {
  seedNotes = await seedConsoleWorld(db);
  // CONSOLE_ITEMS=<n> (S1.1b, the studio's performance budget): the first room filled to n things — two-tops in rows,
  // 3 ft apart — to measure picking, dragging and panning with 20, 50 and 100 things in a room.
  const want = Number(process.env.CONSOLE_ITEMS || 0);
  if (want > 0) {
    const lay = (await db.query(`select id, width_in, depth_in from public.store_layouts order by created_at limit 1`)).rows[0];
    const have = Number((await db.query(`select count(*) n from public.store_items where layout_id = $1`, [lay.id])).rows[0].n);
    for (let k = 0; k < want - have; k++) {
      const col = k % 9, row = Math.floor(k / 9);
      await db.query(`insert into public.store_items (layout_id, kind, label, x_in, y_in, rot, w_in, d_in, h_in, pillars, sort) values ($1, 'two_top', $2, $3, $4, 0, 24, 24, 30, '{}', $5)`,
        [lay.id, `Test table ${k + 1}`, 24 + col * 36, 24 + row * 36, 100 + k]);
    }
  }
} });
if (seedNotes.length) console.log(`  (the world's seed skipped ${seedNotes.length}: ${seedNotes.slice(0, 4).join(" | ")})`);

const NEXT_BIN = require.resolve("next/dist/bin/next");
const server = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], { env: ENV, stdio: ["ignore", "pipe", "pipe"], detached: true });
const signalGroup = (sig) => { try { process.kill(-server.pid, sig); } catch { /* gone */ } };
process.on("exit", () => signalGroup("SIGKILL"));
process.on("SIGINT", () => { signalGroup("SIGKILL"); process.exit(130); });
let up = false;
for (let i = 0; i < 80 && !up; i++) { await sleep(500); try { const r = await fetch(BASE + "/privacy"); if (r.status < 500) up = true; } catch { /* not yet */ } }
if (!up) { console.log("CONSOLE ON PHONES: the server never came up"); process.exit(1); }

// ── 3 · what a phone shows ───────────────────────────────────────────────────────────────────────────────────────────
// Run in the page. Everything visible, measured against the screen.
const MEASURE = () => {
  const W = window.innerWidth;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; };
  const name = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const t = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const ty = el.tagName === "INPUT" ? `[type=${el.type}]` : "";
    const near = !t && el.closest("label, .sc-row, .k-row, li, section") ? ` in "${(el.closest("label, .sc-row, .k-row, li, section").textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}"` : "";
    return `${el.tagName.toLowerCase()}${ty}${id}${cls}${t ? ` "${t}"` : near}`;
  };
  // A box that scrolls or clips sideways on purpose (a chip row, a table) holds what's past the edge.
  const heldBy = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return p; } return null; };
  const inSheetOrHidden = (el) => !!el.closest("[aria-hidden='true'], [inert], dialog:not([open])");
  // The skip link waits off-screen until a keyboard focuses it (WCAG 2.4.1) — out of sight on purpose, not cut off.
  const srOnly = (el) => el.closest(".sr-only, .visually-hidden") || (el.matches(".skip-link") && document.activeElement !== el) || el.getBoundingClientRect().width <= 1;
  const all = [...document.querySelectorAll("body *")].filter((el) => !inSheetOrHidden(el) && vis(el) && !srOnly(el));
  const past = [], clipped = [], taps = [], texts = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 && !heldBy(el)) past.push(`${name(el)} ends at ${Math.round(r.right)}px`);
    const s = getComputedStyle(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (el.tagName === "SELECT") {
      // The chosen option's words against the box's room for them (less the arrow).
      const o = el.options[el.selectedIndex]; const c = document.createElement("canvas").getContext("2d");
      c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const need = o ? c.measureText(o.text).width : 0;
      if (o && need > room + 1) clipped.push(`${name(el)}: "${o.text.slice(0, 40)}" needs ${Math.round(need)}px, has ${Math.round(room)}px`);
    } else if (ownText && (s.overflowX === "hidden" || s.overflowX === "clip" || s.overflow === "hidden") && s.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1 && s.whiteSpace !== "normal") {
      clipped.push(`${name(el)}: ${el.scrollWidth}px of text in ${el.clientWidth}px`);
    } else if (ownText && s.textOverflow !== "ellipsis" && s.whiteSpace === "nowrap" && heldBy(el) && heldBy(el).getBoundingClientRect().right < r.right - 1 && getComputedStyle(heldBy(el)).overflowX !== "auto" && getComputedStyle(heldBy(el)).overflowX !== "scroll") {
      clipped.push(`${name(el)}: cut at its box's edge`);
    }
    // Cut by its own box, either side: a box that hides what overflows it (a panel, a card) and a child that reaches
    // past it — the R48 menu row ran off the panel's LEFT edge, which no right-edge check sees.
    if ((ownText || el.matches("button, input, select, a[href]")) && !el.closest("[data-carousel], .sr-only")) {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === "auto" || ps.overflowX === "scroll") break;            // a box made to scroll holds it
        if (ps.overflowX === "hidden" || ps.overflowX === "clip") {
          const pr = p.getBoundingClientRect();
          if (r.left < pr.left - 1 || r.right > pr.right + 1) clipped.push(`${name(el)}: reaches ${Math.round(Math.max(pr.left - r.left, r.right - pr.right))}px past ${name(p).slice(0, 50)}`);
          break;
        }
      }
    }
    // A field squeezed by what shares its row: its words (what's typed, or the hint when it's empty) don't fit its box,
    // or it is narrower than a fingertip.
    if (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=date]):not([type=datetime-local]):not([type=time]), textarea")) {
      const c = document.createElement("canvas").getContext("2d"); c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const words = el.value || el.placeholder || "";
      const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      if (r.width < 44) clipped.push(`${name(el)}: squeezed to ${Math.round(r.width)}px`);
      else if (el.tagName === "INPUT" && words && c.measureText(words).width > room + 2)
        clipped.push(`${name(el)}: "${words.slice(0, 30)}" needs ${Math.round(c.measureText(words).width)}px, has ${Math.round(room)}px`);
    }
    if (el.matches("input[type=date], input[type=datetime-local], input[type=time]") && r.width < 120) clipped.push(`${name(el)}: a date squeezed to ${Math.round(r.width)}px`);
    const tappable = el.matches("button, a[href], select, input:not([type=hidden]), [role=button], [role=tab], summary") || (el.matches("label[for]") && !!document.getElementById(el.htmlFor)?.matches("input[type=checkbox], input[type=radio]"));
    // A box or a dot inside its label is tapped by the label.
    const target = el.matches("input[type=checkbox], input[type=radio]") && el.closest("label") ? el.closest("label").getBoundingClientRect() : r;
    // WCAG 2.2's target size (2.5.8, AA): 24 by 24 at least — a link inside a sentence excepted (it is as tall as its
    // line, and the words around it are the spacing).
    const inSentence = s.display === "inline" && [...(el.parentElement?.childNodes ?? [])].some((n) => n !== el && n.nodeType === 3 && n.textContent.trim().length > 2);
    if (tappable && !el.disabled && !inSentence) taps.push({ h: Math.round(Math.min(target.height, target.width)), what: name(el), el });
    if (ownText) texts.push({ px: parseFloat(s.fontSize), what: name(el) });
  }
  // Rows of a list line up: siblings of one kind (three or more, the same class) start their words at the same x —
  // R48's merch rows didn't (a long title squeezed its photo tile, and the words started 10px left of the rest).
  const misaligned = [];
  const firstWords = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && n.parentElement && vis(n.parentElement) ? 1 : 3) }); const n = w.nextNode(); if (!n || ["center", "right", "end"].includes(getComputedStyle(n.parentElement).textAlign)) return null; const rg = document.createRange(); rg.selectNodeContents(n); const rr = rg.getClientRects()[0]; return rr ? rr.left : null; };
  for (const parent of new Set(all.map((e) => e.parentElement))) {
    if (!parent) continue;
    const kids = [...parent.children].filter((k) => all.includes(k) && typeof k.className === "string" && k.className.trim());
    const byClass = new Map();
    for (const k of kids) { const c = k.className.trim(); byClass.set(c, [...(byClass.get(c) ?? []), k]); }
    for (const [c, group] of byClass) {
      if (group.length < 3) continue;
      if (getComputedStyle(parent).display.includes("flex") && getComputedStyle(parent).flexDirection.startsWith("row")) continue;   // a row of chips
      if (getComputedStyle(parent).display.includes("grid") && getComputedStyle(parent).gridTemplateColumns.split(" ").length > 1) continue;
      if (group.some((k) => getComputedStyle(k).textAlign === "center" || getComputedStyle(k).alignItems === "center" && getComputedStyle(k).flexDirection === "column")) continue;   // centered on purpose (the org chart)
      const xs = group.map(firstWords).filter((x) => x != null);
      if (xs.length < 3) continue;
      const spread = Math.max(...xs) - Math.min(...xs);
      if (spread > 2) misaligned.push(`${group.length}× .${c.split(/\s+/)[0]} in ${name(parent).slice(0, 40)}: words start ${Math.round(spread)}px apart`);
    }
  }
  // What a finger hits is not always the box: a control may reach past it (the kit's segments add 7px above and
  // below with ::after). So a target under 24px is probed where it's drawn — how far up and down from its middle a
  // touch still lands on it.
  const sc = document.querySelector(".body"), keep = sc ? sc.scrollTop : 0;
  for (const t of taps.filter((x) => x.h < 24)) {
    t.el.scrollIntoView({ block: "center", inline: "nearest" });
    const rr = t.el.getBoundingClientRect(), x = rr.left + rr.width / 2, y = rr.top + rr.height / 2;
    const hits = (px, py) => { const at = document.elementFromPoint(px, py); return !!at && (at === t.el || t.el.contains(at) || (t.el.tagName === "INPUT" && at === t.el.closest("label"))); };
    let up = 0, down = 0, left = 0, right = 0;
    while (up < 30 && hits(x, y - up - 1)) up++;
    while (down < 30 && hits(x, y + down + 1)) down++;
    while (left < 30 && hits(x - left - 1, y)) left++;
    while (right < 30 && hits(x + right + 1, y)) right++;
    if (hits(x, y)) t.h = Math.round(Math.min(up + down + 1, left + right + 1));
  }
  if (sc) sc.scrollTop = keep;
  const small = taps.filter((t) => t.h < 24).map((t) => `${t.what.slice(0, 60)} (${t.h}px)`);
  const OFF_SCALE = texts.filter((t) => ![11, 12, 13, 15, 16, 17, 20, 22, 28, 34].includes(t.px) && !/rdg-size|text-size-demo/.test(t.what)).map((t) => `${t.what.slice(0, 50)} (${t.px}px)`);
  const minTap = taps.reduce((a, t) => (t.h < a.h ? { h: t.h, what: t.what } : a), { h: 999, what: "" });
  const minText = texts.reduce((a, t) => (t.px < a.px ? t : a), { px: 999, what: "" });
  const sizes = {};
  const sizeEg = {};
  for (const t of texts) { sizes[t.px] = (sizes[t.px] ?? 0) + 1; const eg = (sizeEg[t.px] ??= []); if (eg.length < 3) eg.push(t.what); }
  return {
    sideways: document.scrollingElement.scrollWidth - W,
    past: past.slice(0, 6), pastN: past.length,
    clipped: clipped.slice(0, 6), clippedN: clipped.length, misaligned: misaligned.slice(0, 6), misalignedN: misaligned.length, small: [...new Set(small)], offScale: [...new Set(OFF_SCALE)].slice(0, 6),
    minTap, minText, sizes, sizeEg,
    drawn: !!document.querySelector("section.screen.admin .op-head .op-head-t"),
    head: document.body.innerText.slice(0, 600),
  };
};

// The whole section as one picture. The page itself doesn't scroll — the shell's .body does (the bar and the tabs stay
// put) — so a "full page" screenshot is one screen. The phone is made as tall as the section for one shot (no seams, no
// bar drawn twice), then put back. Fourteen screens at most.
async function longShot(page, path) {
  const vp = page.viewportSize();
  const extra = await page.evaluate(() => { const b = document.querySelector(".body"); return b ? b.scrollHeight - b.clientHeight : null; });
  if (extra === null) throw new Error("no .body");
  const tall = Math.min(vp.height + Math.max(0, extra), vp.height * 14);
  await page.setViewportSize({ width: vp.width, height: tall });
  // A screen this tall is drawn in tiles, and whatever is pinned to the screen (the compact title, the tab bar, a fixed
  // background) is drawn again on every tile: pinned things are let go for the shot, and put back.
  const style = await page.addStyleTag({ content: "*{background-attachment:scroll!important}" });
  await page.evaluate(() => { for (const el of document.querySelectorAll("body *")) { const p = getComputedStyle(el).position; if (p === "fixed" || p === "sticky") { el.dataset.shotHid = el.style.visibility || "-"; el.style.visibility = "hidden"; } } });
  await page.waitForTimeout(350);
  try { await page.screenshot({ path }); }
  finally {
    await page.evaluate(() => { for (const el of document.querySelectorAll("[data-shot-hid]")) { el.style.visibility = el.dataset.shotHid === "-" ? "" : el.dataset.shotHid; delete el.dataset.shotHid; } });
    await style.evaluate((n) => n.remove()).catch(() => {});
    await page.setViewportSize(vp); await page.waitForTimeout(200);
  }
}

const IGNORE = [/Download the React DevTools/i, /ws:\/\/127\.0\.0\.1:54329|realtime|WebSocket/i, /Failed to load resource/i];
const report = [];
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
try {
  const only = process.env.CONSOLE_ONLY ? process.env.CONSOLE_ONLY.split(",") : null;
  for (const d of DEVICES.filter((x) => !process.env.CONSOLE_DEVICES || process.env.CONSOLE_DEVICES.split(",").includes(x.key))) {
    mkdirSync(`${OUT}/${d.key}`, { recursive: true });
    const desk = d.kind === "desktop";
    // CONSOLE_VIDEO=<dir>: every page recorded (a release gate's interaction recordings).
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: !desk, hasTouch: !desk, bypassCSP: true,
      userAgent: UA[d.kind ?? "phone"], ...(process.env.CONSOLE_VIDEO ? { recordVideo: { dir: `${process.env.CONSOLE_VIDEO}/${d.key}`, size: { width: Math.min(d.w, 1440), height: Math.min(d.h, 1032) } } } : {}) });
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); localStorage.setItem("gt3-guide-seen", "1"); sessionStorage.setItem("gt3-splash-shown", "1"); } catch { /* */ } }, ["sb-127-auth-token", JSON.stringify(session())]);
    for (const s of SECTIONS) {
      if (only && !only.includes(s)) continue;
      if (d.visitsOnly) continue;
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
      page.on("console", (m) => { if (m.type() === "error" && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text().slice(0, 200)); });
      const apiBad = [];
      page.on("response", (r) => { if (r.url().startsWith(BASE + "/api/") && r.status() >= 500) apiBad.push(`${r.status()} ${r.url().slice(BASE.length, BASE.length + 90)}`); });
      const mark = fb.failures.length;
      // Not "network idle": the console keeps a live line open and polls, so idle never comes. Loaded, then quiet — no
      // read to the database for 900ms (ten seconds at most), then a beat for the paint.
      await page.goto(`${BASE}/crew?s=${s}`, { waitUntil: "load", timeout: 30000 }).catch(() => {});
      for (let t = Date.now(); Date.now() - t < 10000;) {
        await sleep(300);
        const last = fb.calls.at(-1)?.at ?? 0;
        if (Date.now() - last > 900 && Date.now() - t > 1500) break;
      }
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(400);
      const m = await page.evaluate(MEASURE).catch((e) => ({ error: e.message }));
      await page.screenshot({ path: `${OUT}/${d.key}/${s}-screen.png` }).catch(() => {});
      await longShot(page, `${OUT}/${d.key}/${s}.png`).catch((e) => console.log(`  (no long picture of ${s}: ${e.message.slice(0, 80)})`));
      const dbBad = fb.failures.slice(mark).map((f) => `${f.status} ${f.method} ${f.path.replace("/rest/v1/", "")}${process.env.CONSOLE_VERBOSE ? f.query : ""} — ${f.message}`);
      const tag = `${d.key} · ${s}`;
      if (process.env.CONSOLE_VERBOSE) console.log(`  · ${tag}`);
      const walled = !m.drawn || /Set up two-step sign-in|Your two-step code|Opening the console/i.test(m.head ?? "");
      ok(`${tag} · the console, signed in`, !walled, (m.head ?? m.error ?? "").slice(0, 120).replace(/\s+/g, " "));
      if (walled) { await page.close(); continue; }
      ok(`${tag} · every read and write the screen made, answered`, dbBad.length === 0, [...new Set(dbBad)].slice(0, 4));
      ok(`${tag} · no error on the page`, errors.length === 0, errors.slice(0, 3));
      ok(`${tag} · nothing sideways: the page doesn't scroll left-right, nothing ends past the screen`, m.sideways <= 0 && m.pastN === 0, { sideways: m.sideways, past: m.past });
      ok(`${tag} · no word cut off by its box`, m.clippedN === 0, m.clipped);
      ok(`${tag} · a list's rows line up`, m.misalignedN === 0, m.misaligned);
      ok(`${tag} · every tap target at least 24 by 24 (WCAG 2.5.8)`, m.small.length === 0, m.small.slice(0, 8));
      ok(`${tag} · type on the scale (11 12 13 15 16 17 20 22 28 34)`, m.offScale.length === 0, m.offScale);
      // Then every panel open — what's folded is still the screen a person opens (Catalog's merch, Settings' rows).
      const mark2 = fb.failures.length;
      const opened = await page.evaluate(async () => {
        let n = 0;
        for (const b of [...document.querySelectorAll("section.mpanel > button.mpanel-h[aria-expanded='false']")]) { b.click(); n++; await new Promise((r) => setTimeout(r, 60)); }
        return n;
      }).catch(() => 0);
      let m2 = null;
      if (opened) {
        for (let t = Date.now(); Date.now() - t < 12000;) { await sleep(300); if (Date.now() - (fb.calls.at(-1)?.at ?? 0) > 900 && Date.now() - t > 1500) break; }
        await page.waitForTimeout(400);
        m2 = await page.evaluate(MEASURE).catch((e) => ({ error: e.message }));
        await longShot(page, `${OUT}/${d.key}/${s}-open.png`).catch(() => {});
        const dbBad2 = fb.failures.slice(mark2).map((f) => `${f.status} ${f.method} ${f.path.replace("/rest/v1/", "")}${process.env.CONSOLE_VERBOSE ? f.query : ""} — ${f.message}`);
        ok(`${tag} · ${opened} panels open · every read and write answered`, dbBad2.length === 0, [...new Set(dbBad2)].slice(0, 4));
        ok(`${tag} · ${opened} panels open · nothing sideways`, m2.sideways <= 0 && m2.pastN === 0, { sideways: m2.sideways, past: m2.past });
        ok(`${tag} · ${opened} panels open · no word cut off`, m2.clippedN === 0, m2.clipped);
        ok(`${tag} · ${opened} panels open · a list's rows line up`, m2.misalignedN === 0, m2.misaligned);
        ok(`${tag} · ${opened} panels open · every tap target at least 24 by 24 (WCAG 2.5.8)`, m2.small.length === 0, m2.small.slice(0, 8));
        ok(`${tag} · ${opened} panels open · type on the scale (11 12 13 15 16 17 20 22 28 34)`, m2.offScale.length === 0, m2.offScale);
      }
      ok(`${tag} · no error on the page, panels open`, errors.length === 0, errors.slice(0, 3));
      const mm = m2 && !m2.error ? m2 : m;
      report.push({ device: d.key, section: s, opened, minTap: mm.minTap, minText: mm.minText, sizes: mm.sizes, sizeEg: mm.sizeEg, apiBad });
      await page.close();
    }
    // THE VISION (R52) — the crew's own screens outside the console: the roadmap, the store designer (plan and 3D), the
    // links, and the presenter. Same assertions; "drawn" is the screen's own frame.
    for (const v of VISITS) {
      if (only && !only.includes(v.key)) continue;
      if (d.visits && !d.visits.test(v.key)) continue;
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
      page.on("console", (m) => { if (m.type() === "error" && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text().slice(0, 200)); });
      const mark = fb.failures.length;
      await page.goto(`${BASE}${v.path}`, { waitUntil: "load", timeout: 30000 }).catch(() => {});
      await page.waitForSelector(v.ready, { timeout: 15000 }).catch(() => {});
      const tap = async (c) => { await page.getByRole("radio", { name: c, exact: false }).or(page.getByRole("button", { name: c, exact: false })).or(page.locator("summary", { hasText: c })).first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500); };
      for (const c of v.clicks ?? []) await tap(c);
      // A slide found by stepping to it (the presenter's slides shift as the plan grows): Next until it's there.
      if (v.until) for (let k = 0; k < 20 && !(await page.$(v.until.sel)); k++) await tap(v.until.click);
      for (const c of v.then ?? []) await tap(c);
      for (let t = Date.now(); Date.now() - t < 8000;) { await sleep(300); if (Date.now() - (fb.calls.at(-1)?.at ?? 0) > 900 && Date.now() - t > 1200) break; }
      await page.waitForTimeout(600);
      const tag = `${d.key} · ${v.key}`;
      // CONSOLE_PROBE="<js expression>": what the screen says to it, printed — to look inside a picture's puzzle.
      if (process.env.CONSOLE_PROBE) console.log(`  probe ${tag}:`, JSON.stringify(await page.evaluate((src) => { try { return (0, eval)(src); } catch (e) { return String(e); } }, process.env.CONSOLE_PROBE)).slice(0, 2000));
      if (process.env.CONSOLE_VERBOSE) console.log(`  · ${tag}`);
      const drawn = await page.evaluate((sel) => !!document.querySelector(sel), v.drawn).catch(() => false);
      ok(`${tag} · drawn`, drawn, (await page.evaluate(() => document.body.innerText.slice(0, 160)).catch(() => "")).replace(/\s+/g, " "));
      if (v.check) { const said = await page.evaluate(v.check).catch((e) => e.message); ok(`${tag} · the studio fits its screen (S1.1)`, !said, said); }
      const m = await page.evaluate(MEASURE).catch((e) => ({ error: e.message }));
      await page.screenshot({ path: `${OUT}/${d.key}/${v.key}-screen.png` }).catch(() => {});
      if (v.long) await longShot(page, `${OUT}/${d.key}/${v.key}.png`).catch(() => {});
      // CONSOLE_AFTER=<module>: a walk-through run on the visit's page once it's drawn (a release gate's acceptance run);
      // its default export gets the page, the device and the visit, and reports through ok().
      if (process.env.CONSOLE_AFTER) await (await import(process.env.CONSOLE_AFTER)).default({ page, device: d, visit: v, ok, out: `${OUT}/${d.key}` }).catch((e) => ok(`${tag} · the walk-through ran`, false, e.message));
      const dbBad = fb.failures.slice(mark).map((f) => `${f.status} ${f.method} ${f.path.replace("/rest/v1/", "")} — ${f.message}`);
      ok(`${tag} · every read and write the screen made, answered`, dbBad.length === 0, [...new Set(dbBad)].slice(0, 4));
      ok(`${tag} · no error on the page`, errors.length === 0, errors.slice(0, 3));
      ok(`${tag} · nothing sideways`, m.sideways <= 0 && m.pastN === 0, { sideways: m.sideways, past: m.past });
      ok(`${tag} · no word cut off by its box`, m.clippedN === 0, m.clipped);
      ok(`${tag} · every tap target at least 24 by 24 (WCAG 2.5.8)`, (m.small ?? []).length === 0, (m.small ?? []).slice(0, 8));
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  signalGroup("SIGTERM"); await sleep(500); signalGroup("SIGKILL");
  await fb.close();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(`CONSOLE ON PHONES: ${pass} passed, ${fail} failed · pictures in ${OUT}/`);
process.exit(fail ? 1 : 0);
