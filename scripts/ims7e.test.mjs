// IMS7-E — THE STUDIO'S ONE LINE. A thing picked in the Studio says the one most useful thing GT3 knows about it, three
// short facts (size against the library, GT3's approval, its cost in the plan), and the rest one tap away — never a new
// panel. Tested on the pure part (lib/planFixtures thingSays) and the wiring.
import { readFileSync } from "node:fs";
import { loadTs } from "./search.read.mjs";
const F = loadTs("lib/planFixtures.ts"), M = loadTs("lib/visionMoney.ts");
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 500)}` : ""}`); } };

const table = { id: "t", name: "Fixture community table", status: "candidate", status_reason: null, cost_cents: 180000, cost_unit: "each", cost_basis: "estimated", w_in: 96, d_in: 42, h_in: 30 };
const item = { id: "i1", kind: "community", label: "Community table", w_in: 96, d_in: 36, h_in: 30, library_id: "t" };
const room = { id: "room", name: "The store", items: [item, { id: "i2", kind: "community", label: "Second table", w_in: 96, d_in: 20, h_in: 30, library_id: "t" }] };
const plan = (status, uses = []) => ({ plan: { id: "p1", name: "The gym bar", status }, base: M.toInputs({ uses }) });
const says = (o = {}) => F.thingSays({ item, room, found: [], asset: table, named: "t", loaded: true, blockers: ["1 mandatory criterion not judged."], pending: 0, plans: [plan("draft")], ...o });

const s = says();
ok("three facts: the size against the library, the approval, the cost in the plan", s.facts.join(" · ") === "Size: differs from the library · Not approved for GT3 yet · Cost: not reviewed in the plan", s.facts);
ok("one line first: the library's word — what refuses something (its gate) before anything else", s.top?.engine === "library" && s.top.rule === "status" && s.top.blocks === true, s.top);
ok("…and how many more, one tap away", s.more === s.all.length - 1 && s.more >= 2);
ok("…its own size only — not the other table's", s.all.filter((i) => i.rule === "size_differs").length === 1 && s.all.find((i) => i.rule === "size_differs").subject.id === "i1");
ok("…the size said in feet and inches", /the library says 3′ 6″ deep; drawn 3′/.test(s.all.find((i) => i.rule === "size_differs").words), s.all.find((i) => i.rule === "size_differs")?.words);
const inPlan = says({ plans: [plan("draft", [{ id: "L", label: "Tables", category: "equipment", qty: 2, unitCents: 180000, libraryId: "t" }])] });
ok("named in the plan's startup costs at the library's price: 'Cost: in the plan', and nothing to reconcile", inPlan.facts[2] === "Cost: in the plan" && !inPlan.all.some((i) => i.rule === "not_in_plan" || i.rule === "cost_differs"));
const two = says({ plans: [plan("draft", [{ id: "L", label: "Tables", category: "equipment", qty: 2, unitCents: 180000, libraryId: "t" }]), { plan: { id: "p2", name: "The kiosk", status: "draft" }, base: M.toInputs({}) }] });
ok("two plans on the room, one with it: 'in some plans'", two.facts[2] === "Cost: in some plans");
ok("reconciled in the plan's scenario — inside the allowance or a confirmed extra — is represented; not this plan's is said so", (() => {
  const p2 = (fx) => ({ plan: { id: "p1", name: "The gym bar", status: "draft" }, base: M.toInputs({ uses: [], fixtures: fx }) });
  return says({ plans: [p2({ "t": "in_allowance" })] }).facts[2] === "Cost: not reviewed in the plan"
    && says({ asset: { ...table, id: "0c000000-0000-4000-8000-0000000000aa" }, item: { ...item, library_id: "0c000000-0000-4000-8000-0000000000aa" }, room: { ...room, items: [{ ...item, library_id: "0c000000-0000-4000-8000-0000000000aa" }] }, plans: [p2({ "0c000000-0000-4000-8000-0000000000aa": "in_allowance" })] }).facts[2] === "Cost: in the plan"
    && says({ asset: { ...table, id: "0c000000-0000-4000-8000-0000000000aa" }, item: { ...item, library_id: "0c000000-0000-4000-8000-0000000000aa" }, room: { ...room, items: [{ ...item, library_id: "0c000000-0000-4000-8000-0000000000aa" }] }, plans: [p2({ "0c000000-0000-4000-8000-0000000000aa": "excluded" })] }).facts[2] === "Not this plan's"; })());
ok("the line is the Studio's: a plan's money look (not reviewed, over the allowance) is never it — it waits under \"n more\"", (() => { const x = says({ asset: { ...table, status: "approved", d_in: 36 }, blockers: [] }); return (x.top === null || x.top.home !== "plans") && x.all.some((i) => i.rule === "not_in_plan"); })());
ok("no plan reads the room: 'In no plan yet' — and no cost insight invented", says({ plans: [] }).facts[2] === "In no plan yet" && !says({ plans: [] }).all.some((i) => ["not_in_plan", "cost_differs", "going_unapproved"].includes(i.rule)));
const ok2 = says({ asset: { ...table, status: "approved", d_in: 36 }, blockers: [], plans: [plan("go", [{ id: "L", label: "Tables", category: "equipment", qty: 2, unitCents: 180000, libraryId: "t" }])] });
ok("approved, the right size, in the plan: the three facts say so and there's nothing on the line", ok2.facts.join(" · ") === "Size: matches the library · Approved for GT3 · Cost: in the plan" && ok2.top === null, ok2);
ok("approved but its judgement went stale: said", says({ asset: { ...table, status: "approved" } }).facts[1] === "Approved — judgement no longer complete");
ok("drawn turned: said as turned", says({ item: { ...item, w_in: 42, d_in: 96 }, asset: { ...table } }).facts[0] === "Size: matches, drawn turned");
ok("a size the library doesn't record: said, never 'matches'", says({ asset: { ...table, w_in: null, d_in: null, h_in: null } }).facts[0] === "Size: not in the library");
ok("marked go with it unapproved: the plan going ahead is among what's said", says({ plans: [plan("go")] }).all.some((i) => i.rule === "going_unapproved"));
ok("no library asset named: no facts, only the room's checks", F.thingSays({ item: { ...item, library_id: null }, room, found: [], asset: null, named: null, loaded: true, blockers: [], pending: 0, plans: [] }).facts.length === 0);
ok("named but gone from the library: said", F.thingSays({ item, room, found: [], asset: null, named: "t", loaded: true, blockers: [], pending: 0, plans: [] }).facts.join() === "Its library asset couldn't be found");
const found = [{ ids: ["i1", "door"], level: "error", words: "The table stands where the door swings.", check: "door", source: "detected" }, { ids: ["i9"], level: "warn", words: "Elsewhere.", check: "route", source: "detected" }];
const sp = F.thingSays({ item: { ...item, library_id: null }, room, found, asset: null, named: null, loaded: true, blockers: [], pending: 0, plans: [] });
ok("the room's checks about this thing only", sp.top?.words === "The table stands where the door swings." && sp.all.length === 1);
ok("…a room error stops; with a library gate too, the stop comes first (louder), the gate in the rest", says({ found }).top?.level === "stop" && says({ found }).all.some((i) => i.rule === "status"));
ok("deterministic", JSON.stringify(says()) === JSON.stringify(says()));

const ui = read("components/vision/ThingInsight.tsx"), des = read("components/vision/StoreDesigner.tsx");
ok("at most one line, the facts under it, the rest behind a tap — no new panel", (ui.match(/\{top && <p/g) ?? []).length === 1 && /<summary className="vz-card-s cursor-pointer py-1">\{more\} more<\/summary>/.test(ui) && !/mpanel|<Sheet/.test(ui));
ok("…in the Studio's own finding styles (one red: what the room's checks already call serious)", /top\.level === "stop" \? "vz-issue error" : top\.level === "look" \? "vz-issue warn" : "vz-card-s"/.test(ui));
ok("…right under the picked thing's name, for owners and admins (the editing inspector)", /<ThingInsight item=\{item\} room=\{room\} found=\{found\} plans=\{plans\} \/>/.test(des) && des.indexOf("<ThingInsight") > des.indexOf("if (!canEdit) {"));
ok("…given the room's findings and the plans", /found=\{found\} plans=\{plans\}\n/.test(des));
ok("…a failure is said, not an empty line", /Couldn&apos;t check it against the library and the plan just now\./.test(ui));
ok("…it reads (as the person: their session, the database's rules) and writes nothing", !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(ui) && /from\("vision_plan_money"\)\.select\("plan_id, scenarios"\)/.test(ui) && /rpc\("std_material_blockers"/.test(ui));
ok("…it never counts a pending research finding as the size — only the asset's own (std_materials)", /from\("std_materials"\)\.select\("\*"\)\.eq\("id", lib\)/.test(ui) && /select\("id", \{ count: "exact", head: true \}\)/.test(ui));
const world = read("scripts/fixtures/consoleWorld.mjs");
ok("the console smoke's room names a mismatched, unapproved table, so the line is drawn there", /'Fixture community table', 'seating', 'community', 96, 42, 30/.test(world) && /where label = 'Community table'/.test(world));
console.log(`IMS7-E — THE STUDIO'S ONE LINE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
