// R36 — WHAT RYAN DECIDED ON 2026-10-19, AND THE DATABASE AS IT STANDS AT 0437 (the fresh 10/10 audit at R31: UX11-07,
// FE11-09; the security snapshot re-read once 0430–0437 were applied, Ryan's "Yes, re-read it").
//
//   1 · the security snapshot at ledger 0437: judged clean, its three new doors named where the ceiling rose;
//   2 · what the snapshot found: the Chief of Sales saved leads into the owners' and admins' table on anyone's word on
//       the crew — saving is an owner's or admin's now, drawn only for them, and a scouted lead isn't announced as a
//       customer asking;
//   3 · pinch-to-zoom in the iPhone app (Ryan: "Allow pinch-zoom"): the web view zooms as Safari does, past the page's
//       limit that stops only the zoom into a field, and a zoomed-in page can be moved about;
//   4 · behaviour tests (Ryan: "Yes, add it"): a page to draw the app's own components in, three dev-only libraries
//       pinned, and scripts/behaviour.test.mjs run with every test.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CEILING, judge } from "./security.audit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

// ── 1 · the snapshot at 0437 ─────────────────────────────────────────────────────────────────────────────────────────
{
  const snap = JSON.parse(read("supabase/schema.security.json"));
  // R45: re-pulled at 0440 (436 migrations), after 0438–0440 — a later pull is still one taken after 0430–0437.
  ok("the security snapshot was pulled once 0430–0437 were applied (its ledger's mark is 0437 or later)",
    Number(snap.ledger?.max_seq) >= 437 && Number(snap.ledger?.count) >= 433, snap.ledger);
  const v = judge(snap);
  ok("…and judged clean: nothing hard, and every count at its ceiling or under",
    v.hard.length === 0 && v.publicRead.length <= CEILING.publicRead && v.definerExec.length <= CEILING.definerExec
    && v.anonExec.length <= CEILING.anonExec && v.definerView.length <= CEILING.definerView,
    { hard: v.hard, publicRead: v.publicRead.length, definerExec: v.definerExec.length, anonExec: v.anonExec.length });
  ok("the definer ceiling rose by exactly the three two-step doors 0433 granted to the signed in, each named",
    CEILING.definerExec === 127 && v.definerExec.length === 127
    && ["two_step_ok", "two_step_state", "require_two_step"].every((f) => v.definerExec.some((d) => String(d).startsWith(f)))
    && /definerExec 124 → 127 — two_step_ok, two_step_state and require_two_step \(0433/.test(read("scripts/security.audit.mjs")),
    v.definerExec.filter((d) => /two_step|require_two/.test(String(d))));
  // The snapshot R36 judged counts 15 signed out. The ceiling is that, or the one raise named in security.audit.mjs ahead of
  // the next pull (2026-10-26: 15 → 16, vision_shared, 0447) — the owner's yes, so the re-pulled snapshot meets it.
  ok("…and nothing new is callable signed out (anon 15)", v.anonExec.length === 15 && (CEILING.anonExec === 15
    || (CEILING.anonExec === 16 && /anonExec 15 → 16 — vision_shared \(0447/.test(read("scripts/security.audit.mjs")))), { measured: v.anonExec.length, ceiling: CEILING.anonExec });
  const fns = new Map((snap.f || []).map((f) => [`${f[0]}(${f[1]})`, f]));
  ok("the server's own doors 0430 and 0434 made are the server's alone in production (ops_alive, rate_limit_peek)",
    [...fns.entries()].filter(([k]) => /^(ops_alive|rate_limit_peek)\(/.test(k)).every(([, f]) => f[2] === false && f[3] === false && f[4] === true)
    && [...fns.keys()].filter((k) => /^(ops_alive|rate_limit_peek)\(/.test(k)).length === 2);
  ok("the covered settle has one door, the four-argument one (0432) — the three-argument one is gone from production",
    fns.has("staff_collect_payment(p_kind text, p_id uuid, p_via text, p_reason text)") && !fns.has("staff_collect_payment(p_kind text, p_id uuid, p_via text)"));
  const t = snap.t?.booking_requests;
  ok("booking_requests is the owners' and admins' table in production: nobody signed out may insert one (0437 dropped \"anyone request\")",
    !!t && !(t[7] || []).some((p) => p[0] === "anyone request") && (t[7] || []).some((p) => p[0] === "admin manage requests"), t?.[7]?.map((p) => p[0]));
}

// ── 2 · the Chief of Sales: saving is an owner's or admin's ─────────────────────────────────────────────────────────
{
  const route = code(read("app/api/agents/sales/route.ts"));
  const commitAt = route.indexOf("if (body.commit) {");
  const gate = route.indexOf('if (!(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "Only an owner or admin can add these to Bookings." }, { status: 403 });', commitAt);
  ok("sales: saving scouted leads asks adminFromRequest (403, in words) before anything is written",
    commitAt > 0 && gate > commitAt && gate < route.indexOf('supabaseAdmin.from("booking_requests").insert(rows)'));
  ok("…and the scout itself stays the crew's (staffFromRequest, 401) — it writes nothing",
    /if \(!\(await staffFromRequest\(req\)\)\) return NextResponse\.json\(\{ ok: false, error: "unauthorized" \}, \{ status: 401 \}\);/.test(route)
    && route.indexOf("staffFromRequest(req)") < commitAt);
  ok("…a lead the scout found is kept quiet: the push function doesn't tell the crew \"Someone wants to book GT3PB\" for each",
    /name: String\(o\.name\)\.slice\(0, 160\), status: "new", quiet: true,/.test(route)
    && /if \(record\.quiet === true\) return new Response\("skip: quiet/.test(read("supabase/functions/push/index.ts")));
  const ui = code(read("components/ChiefOfSales.tsx"));
  ok("…the Save button is drawn only for an owner or admin, the crew told who saves them",
    /\{isAdmin && <button type="button" className="btn-pri" onClick=\{save\}/.test(ui)
    && /\{!isAdmin && opps\.length > 0 && <div className="dp-hint mt-3">An owner or admin saves these to Bookings\.<\/div>\}/.test(ui));
  ok("…a pick is a toggle that says it is picked (aria-pressed), and only where it can be saved",
    /return isAdmin \? \(\s*<button key=\{i\} type="button" className=\{`sales-opp\$\{o\._skip \? "" : " on"\}`\} aria-pressed=\{!o\._skip\}/.test(ui));
  ok("…and the console hands it who is asking", /<ChiefOfSales isAdmin=\{isAdmin\} \/>/.test(read("app/crew/page.tsx")));
}

// ── 3 · pinch-to-zoom in the iPhone app ──────────────────────────────────────────────────────────────────────────────
{
  const cap = code(read("capacitor.config.ts"));
  ok("the web view may zoom: capacitor.config.ts zoomEnabled (Capacitor's own scroll delegate refuses every pinch otherwise)",
    /^\s*zoomEnabled: true,$/m.test(cap) && /scrollEnabled: false,/.test(cap));
  const swift = read("ios/App/App/GT3ViewController.swift");
  ok("GT3ViewController lets a pinch past the page's maximum-scale=1 (ignoresViewportScaleLimits) from Capacitor's own configuration",
    /override func webViewConfiguration\(for instanceConfiguration: InstanceConfiguration\) -> WKWebViewConfiguration \{\n\s+let configuration = super\.webViewConfiguration\(for: instanceConfiguration\)\n\s+configuration\.ignoresViewportScaleLimits = true\n\s+return configuration\n\s+\}/.test(swift)
    && /^import WebKit$/m.test(swift));
  ok("…and a zoomed-in page can be moved about — the scroll view moves only while the page is larger than the screen",
    /zoomWatch = webView\?\.scrollView\.observe\(\\\.contentSize, options: \[\.new\]\) \{ scroll, _ in\n\s+let zoomedIn = scroll\.zoomScale > scroll\.minimumZoomScale \+ 0\.01\n\s+if scroll\.isScrollEnabled != zoomedIn \{ scroll\.isScrollEnabled = zoomedIn \}/.test(swift)
    && /private var zoomWatch: NSKeyValueObservation\?/.test(swift));
  const check = spawnSync(process.execPath, [join(ROOT, "scripts/ios.configure.mjs"), "--check"], { encoding: "utf8" });
  ok("…what scripts/ios.configure.mjs writes is what is committed (--check)", check.status === 0, (check.stdout + check.stderr).slice(-300));
  ok("the page still asks for maximum-scale=1 on an iPhone — it stops iOS zooming into a tapped field and staying there",
    /export const NO_FOCUS_ZOOM = "maximum-scale=1";/.test(read("lib/ios.ts")) && /maximumScale: 5,/.test(read("app/layout.tsx")));
}

// ── 4 · behaviour tests ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const pkg = JSON.parse(read("package.json"));
  const want = { "happy-dom": "20.14.5", "@testing-library/react": "16.3.3", "@testing-library/dom": "10.4.2" };
  ok("the three test libraries are dev-only and pinned to an exact version (nothing here ships)",
    Object.entries(want).every(([n, v]) => pkg.devDependencies?.[n] === v && !pkg.dependencies?.[n]), Object.keys(want).map((n) => [n, pkg.devDependencies?.[n], pkg.dependencies?.[n]]));
  ok("…and the lock holds the same versions", (() => {
    const lock = JSON.parse(read("package-lock.json"));
    return Object.entries(want).every(([n, v]) => lock.packages?.[`node_modules/${n}`]?.version === v && lock.packages?.[`node_modules/${n}`]?.dev === true);
  })());
  ok("scripts/behaviour.test.mjs runs with every test (npm test), right after this file",
    /node scripts\/r36\.test\.mjs && node scripts\/behaviour\.test\.mjs/.test(pkg.scripts.test));
  const host = read("scripts/fixtures/domHost.mjs");
  ok("the page keeps Node's clock: React's work is scheduled on one timer, never two of the same name",
    ["setTimeout", "queueMicrotask", "MessageChannel", "fetch", "Response"].every((k) => new RegExp(`"${k}"`).test(host.slice(host.indexOf("const NODE_KEEPS"), host.indexOf("const own ="))))
    && /globalThis\.IS_REACT_ACT_ENVIRONMENT = true;/.test(host));
  const bt = read("scripts/behaviour.test.mjs");
  ok("the behaviour tests draw the components the audit named — the crash screen, an alert's link, and R36's Chief of Sales",
    /load\("app\/error\.tsx"\)/.test(bt) && /load\("components\/OperatorSection\.tsx"\)/.test(bt) && /load\("components\/ChiefOfSales\.tsx"\)/.test(bt));
}

console.log(`\nR36 — WHAT RYAN DECIDED, AND THE DATABASE AT 0437: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
