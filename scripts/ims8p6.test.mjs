// IMS8 P6 — THE INVESTOR VIEW AND THE FIELD INSPECTOR. The presenter opens on the brand's own wordmark (the file, never a
// redraw); an ask reads its amount, "None needed" or "Being priced" — never $0; next steps come from the plans' own open
// needs; the room can be seen as its own plan drawn to scale (the Studio's renderer, read-only). The inspector says what
// a link sends in one sentence counted from the response, shows every piece of free text in it (100%), says what it
// doesn't send — each claim held to the payload function — and shows the response itself on asking.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const SP = loadTs("lib/sharePreview.ts"), PR = loadTs("lib/publishReadiness.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };

const PG = "0c46f000-0000-4000-8000-0000000000a1", PL = "0c46f000-0000-4000-8000-0000000000b1", PL2 = "0c46f000-0000-4000-8000-0000000000b2", RM = "0c46f000-0000-4000-8000-0000000000c1";
const payload = {
  label: "Upstate investors", show_asks: true, pinned_at: "2026-11-01T00:00:00Z", expires_at: null,
  programs: [{ id: PG, lane: "Business", title: "The first store", summary: "One store in a gym, then a storefront.", why: "People train here every day.", pillars: ["fuel"], horizon: "now", status: "planned", start_on: null, target_on: "2027-03-01", emoji: "🏁", layout_id: RM, sort: 1 }],
  asks: [{ program_id: PG, plan_id: PL, label: "Build-out", amount_cents: null, state: "open", note: "Two quotes in hand.", sort: 1 }],
  plans: [
    { id: PL, program_id: PG, name: "Gym bar", format: "gym_bar", phase: 1, status: "planned", sqft: 400, deal: "rev_share", place: "Upstate", summary: "A bar inside the gym.", why: null, gate: "Gym signs.", layout_id: RM, sort: 1, customer: "Members", market: null, positioning: null,
      needs: [{ label: "Choose the gym", kind: "partner", due_on: "2026-12-01", done_on: null, sort: 1 }, { label: "Lease signed", kind: "deal", due_on: null, done_on: "2026-10-01", sort: 2 }], waits_on: [],
      money: { baseline: { scenarios: { base: { uses: [{ id: "l1", label: "Bar build", category: "equipment", qty: 1, unitCents: 1200000 }] } }, structure: { kind: "none" }, acknowledged: [] }, approved_at: "2026-10-31", version: 1 },
      research: [{ topic: "demand", claim: "1,200 members a day.", figure: "1,200", source_url: "https://x.example", source_title: "Count", bearing: "for", retrieved_at: "2026-10-01" }], risks: [{ kind: "risk", words: "Footfall drops in summer.", likelihood: "medium", impact: "high", mitigation: "Events.", status: "open" }] },
    { id: PL2, program_id: PG, name: "Storefront", format: "storefront_lease", phase: 3, status: "idea", sqft: 1200, deal: "lease", place: null, summary: null, why: null, gate: null, layout_id: null, sort: 2, customer: null, market: null, positioning: null, needs: [], waits_on: [PL], money: null, research: null, risks: null },
  ],
  layouts: [{ id: RM, name: "Storefront", width_in: 240, depth_in: 360, ceiling_in: 120, items: [{ id: "0c46f000-0000-4000-8000-0000000000d1", kind: "counter", label: "Bar", x_in: 10, y_in: 10, rot: 0, w_in: 96, d_in: 30, h_in: 42, why: "Where the pour happens.", pillars: [], sort: 1 }] }],
};
ok("one sentence, counted from the response: programs, plans and their money, open needs (done ones aren't), research, asks, rooms, and how much writing", SP.sendsSentence(payload) === "It sends 1 program, 2 plans (1 with an approved money case), 1 open need, 1 research finding, 1 ask and 1 room — and 26 text fields written by you or your team, each shown word for word below.", SP.sendsSentence(payload));
ok("…a response with nothing of the plan says so", SP.sendsSentence({ label: "x", programs: [], plans: [], asks: [], layouts: [] }) === "It sends nothing of the plan yet — only who it's for.");
const pv = SP.previewOf(payload), shown = [...pv.sections.flatMap((s) => s.texts), ...pv.other];
const all = PR.textsOf(payload);
ok("the inspector shows 100% of the response's free text, word for word", all.every((t) => shown.some((x) => x === t.text || x.startsWith(`${t.text} — `))), all.filter((t) => !shown.some((x) => x === t.text || x.startsWith(`${t.text} — `))).map((t) => t.text));
ok("…and an unset ask is said as being set, never $0", shown.includes("Build-out — amount to be set"));
const left = SP.notChosen({ ...payload, show_asks: false, asks: [] });
ok("what it leaves out that it could have carried: the asks, a plan's money, research and needs", left.includes("The asks — not chosen") && left.includes("Storefront's money — not chosen, or not approved yet") && left.includes("Storefront's research — not chosen") && left.includes("Storefront's open needs — not chosen") && !left.some((x) => x.startsWith("Gym bar's money")), left);

// The never-sent claims, held to the payload function (its latest definition).
const migs = (await import("node:fs")).readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const fileOf = migs.filter((m) => /create or replace function public\.vision_share_payload\(/.test(read(`supabase/migrations/${m}`))).at(-1);
const src = read(`supabase/migrations/${fileOf}`), body = src.slice(src.lastIndexOf("create or replace function public.vision_share_payload("), src.indexOf("$$;", src.lastIndexOf("create or replace function public.vision_share_payload(")));
const needs = /'needs', case when[\s\S]*?jsonb_build_object\(([^)]*)\)/.exec(body)?.[1] ?? "", items = /'items', coalesce\(\(select jsonb_agg\(jsonb_build_object\(([\s\S]*?)\) order by i\.sort/.exec(body)?.[1] ?? "", rooms = /'layouts', coalesce\(\(select jsonb_agg\(jsonb_build_object\(([\s\S]*?)'items'/.exec(body)?.[1] ?? "";
ok(`"notes on needs, and who owns them" — the payload (${fileOf}) names a need's label, kind and dates only`, /'label', n\.label, 'kind', n\.kind, 'due_on', n\.due_on, 'done_on', n\.done_on, 'sort', n\.sort/.test(needs) && !/note|owner/.test(needs), needs);
ok(`"a room's notes; library links, suppliers and prices" — a room's and a placed thing's fields name none`, rooms.length > 10 && items.length > 10 && !/notes|asset|library|supplier|price|cost/.test(rooms + items), { rooms, items });
ok(`"money that isn't approved" and "research that isn't accepted" — the pinned approved version and accepted findings only`, /x\.approved_at <= s\.pinned_at/.test(body) && /r\.status = 'accepted'/.test(body) && !/vision_plan_money/.test(body));
ok(`"who made the link, its key, and who opened it" — none of created_by, token, opens is in it`, !/created_by|token|opens|last_opened_at/.test(body));
ok(`"recipes, the Standard, HQ" — it reads no table outside the vision`, !/food_|std_|academy|alerts|orders|profiles/.test(body));

// The investor view.
const present = read("components/vision/Present.tsx"), room = read("components/vision/RoomToScale.tsx"), lp = read("components/vision/LinkPreview.tsx");
const size = statSync(join(ROOT, "public/gt3-pb-wordmark.png")).size;
ok("the cover shows the brand's own wordmark file (public/gt3-pb-wordmark.png, 440×248), never a redraw", /<img className="vp-mark" src="\/gt3-pb-wordmark\.png" width=\{440\} height=\{248\} alt="GT3 Performance Bar" \/>/.test(present) && size > 1000);
ok("an ask on a slide: its amount, None needed, or Being priced — never $0 or a dash", /const askWord = \(cents: number \| null\) => \(cents \? shortMoney\(cents\) : cents === 0 \? "None needed" : "Being priced"\);/.test(present) && /<b>\{askWord\(a\.amount_cents\)\}<\/b>/.test(present) && !/: "—"\}/.test(present));
ok("next steps: the program's plans' open needs, from the response, soonest first, four at most", /vision\.needs\.filter\(\(n\) => mine\.has\(n\.plan_id\) && !n\.done_on\)/.test(present) && /\.slice\(0, 4\)/.test(present));
ok("the room as its own plan drawn to scale: the Studio's renderer, read-only, loaded only when asked", /const RoomToScale = dynamic\(\(\) => import\("\.\/RoomToScale"\)/.test(present) && /<PlanView layout=\{layout\} selected=\{null\} bad=\{NONE\} canEdit=\{false\} flow=\{null\}/.test(room) && /Drawn to scale/.test(room)
  && (room.match(/^import .*$/gm) ?? []).every((l) => /"\.\/studio\.css"|"\.\/PlanView"|"@\/lib\/vision"/.test(l)));
ok("the inspector: the sentence, what it doesn't send, and the response itself on asking", /<p className="vz-card-s">\{says\}<\/p>/.test(lp) && /\[\.\.\.left, \.\.\.NEVER_SENT\]/.test(lp) && /JSON\.stringify\(raw, null, 2\)/.test(lp));
console.log(`IMS8 P6 — THE INVESTOR VIEW AND THE FIELD INSPECTOR: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
