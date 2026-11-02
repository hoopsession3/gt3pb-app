// IMS8 P8 — A LINK'S LIFE, FROM ITS RECORDS. Off (final), Ended, Live, or Changed since shared — the last only from the
// server's review (fingerprint, 0472), never guessed. What changed is said word for word between what the link sends and
// what sharing it now would send; sharing the changes, and changing how long it lives, go through review and publish
// like every change. A draft is said to be this device's. "Opened 3×" never says who.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const L = loadTs("lib/linkStates.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };
const NOW = Date.parse("2026-11-01T12:00:00Z");
ok("turned off: Off, whatever else is true (0468: final)", L.linkPhase({ revoked_at: "2026-10-01", expires_at: "2027-01-01" }, true, NOW).phase === "off");
ok("past its date: Ended", L.linkPhase({ revoked_at: null, expires_at: "2026-10-31T00:00:00Z" }, false, NOW).phase === "ended");
ok("live, unread or unchanged: Live, with when it ends", L.linkPhase({ revoked_at: null, expires_at: "2026-11-11T12:00:00Z" }, null, NOW).word === "Live" && L.linkPhase({ revoked_at: null, expires_at: "2026-11-11T12:00:00Z" }, false, NOW).ends === "ends in 10 days");
ok("…changed only when the server's review says so", L.linkPhase({ revoked_at: null }, true, NOW).word === "Changed since shared" && L.linkPhase({ revoked_at: null }, null, NOW).phase === "live");
const was = { label: "L", show_asks: false, programs: [{ id: "p", title: "The first store", summary: "One store in a gym." }], plans: [], asks: [], layouts: [{ id: "r", name: "Storefront", width_in: 240, items: [] }] };
const now = { ...was, programs: [{ id: "p", title: "The first store", summary: "One store in a gym, then a storefront." }], layouts: [{ id: "r", name: "Storefront", width_in: 300, items: [] }] };
const c = L.changesBetween(was, now);
ok("what changed, word for word: the summary rewritten (new and no longer), per category", c.changes.length === 1 && c.changes[0].title === "Roadmap programs" && c.changes[0].added[0] === "One store in a gym, then a storefront." && c.changes[0].removed[0] === "One store in a gym.", c);
ok("…a change in numbers only (a room's width) is said as numbers, not invented words", (() => { const n = L.changesBetween(was, { ...was, layouts: [{ id: "r", name: "Storefront", width_in: 300, items: [] }] }); return n.changes.length === 0 && n.numbersOnly; })());
ok("…the same response twice: no change, pins and ends aside", (() => { const n = L.changesBetween({ ...was, pinned_at: "a" }, { ...was, pinned_at: "b" }); return n.changes.length === 0 && !n.numbersOnly; })());
const sh = read("components/vision/Shares.tsx"), st = read("components/vision/LinkStudio.tsx");
ok("a live link's state comes from the server's review of it", /const r = useAsyncData\(async \(\) => \(supabase \? reviewLink\(supabase, share\.id, \{\}\) : null\), \[share\.id\]\);\n  const st = linkPhase\(share, r\.data\?\.changed \?\? null\);/.test(sh));
ok("sharing the changes and changing how long it lives go through review and publish", /publish\(share\.id, \{\}, "share the changes"\)/.test(sh) && /publish\(share\.id, \{ days \}, "change how long it lives"\)/.test(sh));
ok("…and until then the link keeps sending what was reviewed — said so", /It still sends what you shared; the plan has changed since\./.test(sh));
ok("what it sends now is the link's own answer (vision_share_preview → its published revision), compared with the review", /supabase\.rpc\("vision_share_preview", \{ p_share: share\.id, p_draft: null \}\)/.test(sh) && /changesBetween\(sent\.data, rev\.payload\)/.test(sh));
ok("a draft is said to be this device's", /Draft · kept on this device only, until it&apos;s shared/.test(st));
ok("each link says its revision and when it was shared; read with the plans so the list still reads before 0472", /select\(`\$\{base\}, plan_ids, need_plans, published_at, revision`\)/.test(sh) && !/const COLS = "[^"]*published_at/.test(sh) && /revision \$\{s\.revision \?\? 1\}, shared \$\{ageLabel\(s\.published_at\)\}/.test(sh));
ok("opens are counted, never attributed", /opened \$\{s\.opens\}×/.test(sh) && !/opened by|who opened/i.test(sh));
console.log(`IMS8 P8 — A LINK'S LIFE, FROM ITS RECORDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
