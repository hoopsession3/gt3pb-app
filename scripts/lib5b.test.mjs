// IMS5b — THE EXPERIENCE LIBRARY: the words and rules the screen shows, tested on their own (the database's part, which
// enforces the same rules, in db.lib5b.test). Plus the screens' wiring, read from the source.
import { readFileSync } from "node:fs";
import { loadTs } from "./search.read.mjs";
const L = loadTs("lib/experienceLibrary.ts");
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };
const A = (o = {}) => L.toAsset({ id: o.id ?? "a", name: "Test", category: "seating", status: "candidate", pillars: [], watch_list: [], ...o });

ok("the seven statuses of the brief, in order", L.STATUSES.join(",") === "candidate,under_research,evidence_incomplete,qualified,approved,restricted,rejected");
ok("each status says what it means, and qualified is not approved", L.STATUSES.every((s) => L.STATUS_MEANS[s]?.length > 10) && /Not yet approved/.test(L.STATUS_MEANS.qualified));
ok("every category of the brief is a category (furniture … cleaning)", ["seating", "counter", "equipment", "flooring", "wall", "paint", "adhesive", "coating", "plant", "lighting", "acoustic", "air", "water", "signage", "artwork", "menu_board", "merchandising", "food_contact", "serviceware", "cleaning"].every((c) => L.CATEGORY_WORD[c]));
ok("…and the database allows exactly these", L.CATEGORIES.every(([k]) => read("supabase/migrations/0461_the_experience_library.sql").includes(`'${k}'`)));
ok("a row with an unknown status reads as a candidate, never approved", A({ status: "certified" }).status === "candidate");
ok("a pillar outside the four is dropped", A({ pillars: ["stillness", "espresso"] }).pillars.join() === "stillness");

ok("a cost is said with its basis", L.costWords(A({ cost_cents: 12000, cost_unit: "each", cost_basis: "estimated" })) === "$120 each · estimated");
ok("…an unknown cost is said unknown, never $0", L.costWords(A()) === "Cost not known");
ok("…cents are kept when there are cents", L.costWords(A({ cost_cents: 1250, cost_basis: "actual" })) === "$12.50 · actual");
ok("a size unsaid is said so", L.sizeWords(A()) === "Size not said" && L.sizeWords(A({ w_in: 24, d_in: 30, h_in: 30 })) === "2′ × 2′ 6″ × 2′ 6″");

const list = [A({ id: "1", name: "Bench", status: "candidate", pillars: ["stillness"] }), A({ id: "2", name: "Lamp", category: "lighting", status: "approved", pillars: ["light"], maker: "Test Maker" }),
  A({ id: "3", name: "Old", status: "approved", archived_at: "2026-01-01" }), A({ id: "4", name: "Cleaner X", category: "cleaning", status: "rejected", status_reason: "Fragrance" })];
ok("the list puts what's usable first, archived out", L.filterAssets(list, {}).map((a) => a.id).join() === "2,1,4");
ok("search reads the maker", L.filterAssets(list, { text: "test maker" }).map((a) => a.id).join() === "2");
ok("filters by category, status and pillar", L.filterAssets(list, { category: "cleaning" }).length === 1 && L.filterAssets(list, { status: "candidate" }).length === 1 && L.filterAssets(list, { pillar: "light" })[0]?.id === "2");

const rows = L.compareRows([list[0], list[1]]);
ok("compare: the same rows for each, unknowns said", rows.every((r) => r.values.length === 2) && rows.find((r) => r.label === "Cost").values[0] === "Cost not known" && rows.find((r) => r.label === "Supplier").values[0] === "Not said");
ok("…pillars compared as intent", rows.some((r) => /intent/.test(r.label)));

const st = (status, isOwner, blockers) => L.nextSteps({ status }, { isOwner, blockers });
ok("an admin is offered approval only as not-yet (an owner approves)", st("qualified", false, []).find((x) => x.to === "approved")?.ready === false);
ok("qualified with the judgement incomplete: not yet, and why", (() => { const s = st("under_research", true, ["1 criterion judged unknown — unknown is never approved."]).find((x) => x.to === "qualified"); return s.ready === false && /unknown/.test(s.why); })());
ok("complete, an owner can approve", st("qualified", true, []).find((x) => x.to === "approved")?.ready === true);
ok("an admin isn't offered to take an approval back", st("approved", false, []).length === 0);
ok("a spec: empty or with an unapproved asset isn't ready", !L.specReady([]).ready && L.specReady([{ status: "approved" }, { status: "qualified" }]).why === "1 asset isn't approved yet.");
ok("…all approved, it is", L.specReady([{ status: "approved" }]).ready);

const lib = read("components/vision/Library.tsx"), link = read("components/vision/LibraryLink.tsx"), des = read("components/vision/StoreDesigner.tsx"), app = read("components/vision/VisionApp.tsx"), rd = read("lib/visionRead.ts");
ok("the Library is a tab for owners and admins", /\{ key: "library" as const, label: "Library" \}/.test(app) && /tab === "library" && canEdit && <Library isOwner=\{isOwner\} \/>/.test(app));
ok("before 0461 the screen says so (never an empty list)", /The library arrives with migration 0461/.test(lib) && /arrives-with: 0461/.test(lib));
ok("nothing here is called a certification", /nothing here is a certification/i.test(lib) && !/certified\b/i.test(lib.replace(/certification/gi, "")));
ok("an approved asset whose judgement goes stale is said stale, not hidden", /Approved, but its judgement is no longer complete/.test(lib));
ok("a watch-list substance is a review, not a verdict", /A match is a review, not a verdict/.test(lib));
ok("a thing in a room names its asset, its status said beside it", /not approved for GT3 yet/.test(link) && /<LibraryLink kind=\{item\.kind\}/.test(des));
ok("…read and saved only where the column is there", /"library_id" in r \?/.test(rd) && /i\.library_id !== undefined \? \{ library_id: i\.library_id \}/.test(rd));
console.log(`IMS5b — THE EXPERIENCE LIBRARY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
