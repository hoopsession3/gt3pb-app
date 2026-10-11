// THE SUNDAY RUN: ALL OUT AT ONCE, AND A MISSED PORCH ONTO THE NEXT ONE (2026-10-11, the dispatch round).
//
// The findings, as sentences: each porch took two taps to send out ("→ Brewed", "→ Out for delivery"), forty for a
// run of twenty; and a porch held or not home stayed on its old day, because no screen could put it on a run.
// lib/porchRun is the answer: "Mark all out for delivery" (DeliveryOps' own step, one write per porch, each answer
// read), and "Next run" for a held or not-home porch (DeliveryOps' rule for the run, the checkout's rule when no run
// is on the board), each with an undo.
//
// What is real is compiled from lib/ (porchRun, and dueNext, dates, delivery, errorMessage beneath it). delivery_orders
// is a stand-in that applies the filters the writes send (eq, in, is null) and the patch, so a write that would move a
// porch it must not shows up as a porch that moved. The words the writers write are held to 0139's own lists, read
// from the migration. The clock is Eastern. Every name and address is made up.
process.env.TZ = "America/New_York";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const R = load("lib/porchRun.ts");
ok("compiled: lib/porchRun", typeof R.nextRunFor === "function" && typeof R.markOut === "function");

const et = (s) => Date.parse(`${s}-04:00`);   // EDT
const est = (s) => Date.parse(`${s}-05:00`);  // EST

// ── which run: DeliveryOps' rule ────────────────────────────────────────────────────────────────────
{
  ok("the run is the first delivery day on or after today with a porch on it — today counts",
    R.nextRunDay(["2026-10-18", "2026-10-11", "2026-10-25"], "2026-10-11") === "2026-10-11");
  ok("…days before today are not the run", R.nextRunDay(["2026-10-04", "2026-10-18"], "2026-10-11") === "2026-10-18");
  ok("…no porch on the board, no run", R.nextRunDay([], "2026-10-11") === null && R.nextRunDay(["2026-10-04"], "2026-10-11") === null);
  // The card picked it as the first row of a read ordered by delivery_date from today on; the rule is that, for any order.
  const rows = ["2026-10-25", "2026-10-18", "2026-10-11", "2026-10-18"];
  const sorted = [...rows].filter((d) => d >= "2026-10-11").sort();
  ok("…the same answer as the card's old `all[0]?.delivery_date` over its ordered read", R.nextRunDay(rows, "2026-10-11") === (sorted[0] ?? null));
}

// ── a missed porch onto the next run ────────────────────────────────────────────────────────────────
{
  const held = { delivery_date: "2026-10-04", delivery_window: "5–8 AM" };
  const board = ["2026-10-11", "2026-10-18"];
  ok("Sunday 7:00, a porch held last week: today's run — its window is open, the driver is out",
    JSON.stringify(R.nextRunFor(held, board, et("2026-10-11T07:00:00"))) === '{"day":"2026-10-11","from":"run"}', R.nextRunFor(held, board, et("2026-10-11T07:00:00")));
  ok("Sunday 8:30, the same porch: next Sunday's run — a porch moved onto a run that has come home would be late as it landed",
    JSON.stringify(R.nextRunFor(held, board, et("2026-10-11T08:30:00"))) === '{"day":"2026-10-18","from":"run"}', R.nextRunFor(held, board, et("2026-10-11T08:30:00")));
  ok("…and with nothing booked for next Sunday yet: the Sunday a new order would get (the checkout's rule)",
    JSON.stringify(R.nextRunFor(held, ["2026-10-11"], et("2026-10-11T08:30:00"))) === '{"day":"2026-10-18","from":"slot"}', R.nextRunFor(held, ["2026-10-11"], et("2026-10-11T08:30:00")));
  const today = { delivery_date: "2026-10-11", delivery_window: "5–8 AM" };
  ok("a porch not home on today's run goes to the next run, never back onto its own",
    R.nextRunFor(today, board, et("2026-10-11T07:00:00")).day === "2026-10-18");
  ok("Wednesday, nothing on the board: this Sunday — before Friday's 6 PM cutoff",
    JSON.stringify(R.nextRunFor({ delivery_date: "2026-10-11", delivery_window: "5–8 AM" }, [], et("2026-10-14T10:00:00"))) === '{"day":"2026-10-18","from":"slot"}');
  ok("Saturday, nothing on the board: the Sunday after — the cutoff has passed, as it has for a new order",
    R.nextRunFor({ delivery_date: "2026-10-11", delivery_window: "5–8 AM" }, [], et("2026-10-17T10:00:00")).day === "2026-10-25");
  ok("Saturday, with tomorrow's run on the board: tomorrow — the run is real, its porches are being brewed",
    JSON.stringify(R.nextRunFor({ delivery_date: "2026-10-11", delivery_window: "5–8 AM" }, ["2026-10-18"], et("2026-10-17T10:00:00"))) === '{"day":"2026-10-18","from":"run"}');
  ok("the Sunday the clocks go back: 7:30 EST is inside 5–8, today's run; 8:30 EST is past it",
    R.nextRunFor({ delivery_date: "2026-10-25", delivery_window: "5–8 AM" }, ["2026-11-01", "2026-11-08"], est("2026-11-01T07:30:00")).day === "2026-11-01"
    && R.nextRunFor({ delivery_date: "2026-10-25", delivery_window: "5–8 AM" }, ["2026-11-01", "2026-11-08"], est("2026-11-01T08:30:00")).day === "2026-11-08");
  ok("a window nobody can read leaves today's run as the card has it — all day",
    R.nextRunFor({ delivery_date: "2026-10-04", delivery_window: "early" }, board, et("2026-10-11T15:00:00")).day === "2026-10-11");
  ok("a porch on a later day (marked by mistake) never lands on or before its own day",
    R.nextRunFor({ delivery_date: "2026-10-18", delivery_window: "5–8 AM" }, ["2026-10-18"], et("2026-10-12T09:00:00")).day === "2026-10-25");
  ok("runDayWords: today, tomorrow, else the date", R.runDayWords("2026-10-11", "2026-10-11") === "today" && R.runDayWords("2026-10-12", "2026-10-11") === "tomorrow"
    && R.runDayWords("2026-10-18", "2026-10-11") === "Sun, Oct 18");
}

// ── the stand-in table ──────────────────────────────────────────────────────────────────────────────
// Holds rows; applies .update(patch) to the rows every filter keeps; .select() answers the rows it changed. `fail`
// names porches whose write the database refuses; `drop` porches whose request never comes back.
function porchTable(rows) {
  const t = {
    rows: rows.map((r) => ({ ...r })), writes: [], fail: new Set(), drop: new Set(),
    get: (id) => t.rows.find((r) => r.id === id),
    from(table) {
      if (table !== "delivery_orders") throw new Error(`stand-in: unexpected table ${table}`);
      return {
        update(patch) {
          const keep = []; const ids = [];
          const q = {
            eq: (c, v) => { if (c === "id") ids.push(v); keep.push((r) => r[c] === v); return q; },
            in: (c, vs) => { keep.push((r) => vs.includes(r[c])); return q; },
            is: (c, v) => { if (v !== null) throw new Error("stand-in: is() emulates null only"); keep.push((r) => r[c] == null); return q; },
            select: async (cols) => {
              if (cols !== "id") throw new Error("stand-in: select('id') only");
              t.writes.push({ ids, patch });
              if (ids.some((id) => t.drop.has(id))) throw new TypeError("fetch failed");
              if (ids.some((id) => t.fail.has(id))) return { data: null, error: { message: "new row violates row-level security policy" } };
              const hit = t.rows.filter((r) => keep.every((p) => p(r)));
              for (const r of hit) Object.assign(r, patch);
              return { data: hit.map((r) => ({ id: r.id })), error: null };
            },
          };
          return q;
        },
      };
    },
  };
  return t;
}
const P = (id, name, extra = {}) => ({ id, name, status: "received", delivery_date: "2026-10-11", canceled_at: null, driver_outcome: null, empties_collected: null, driver_note: null, ...extra });

// ── all out at once ─────────────────────────────────────────────────────────────────────────────────
{
  const run = [P("a", "Ana Ruiz"), P("b", "Bo Diaz", { status: "brewed" }), P("c", "Cy Ng", { status: "held_for_pickup" }), P("d", "Dot Kim", { status: "delivered" }),
    P("e", "Eli Fox", { status: "out_for_delivery" }), P("f", "Fay Hu", { status: "issue" }), P("g", "Gus Lo", { canceled_at: "2026-10-09T12:00:00Z" })];
  const plan = R.outPlan(run);
  ok("the plan: the run's porches not out yet — received or brewed; held, not home, delivered, out already and canceled stay",
    JSON.stringify(plan.map((o) => o.id)) === '["a","b"]', plan.map((o) => o.id));

  // Four in the plan: Ana and Bo as read; Hal, whom the driver logged delivered between the read and the tap; Ivy, whose
  // write the database refuses; Jo, whose request never comes back.
  const t = porchTable([P("a", "Ana Ruiz"), P("b", "Bo Diaz", { status: "brewed" }), P("h", "Hal Ames", { status: "delivered" }), P("i", "Ivy Tan"), P("j", "Jo Park", { status: "brewed" })]);
  t.fail.add("i"); t.drop.add("j");
  const steps = [{ id: "a", name: "Ana Ruiz", status: "received" }, { id: "b", name: "Bo Diaz", status: "brewed" }, { id: "h", name: "Hal Ames", status: "received" },
    { id: "i", name: "Ivy Tan", status: "received" }, { id: "j", name: "Jo Park", status: "brewed" }];
  const res = await R.markOut(t, steps);
  ok("one write per porch, each by its id — five porches, five writes", t.writes.length === 5 && t.writes.every((w, k) => w.ids.length === 1 && w.ids[0] === steps[k].id), t.writes.map((w) => w.ids));
  ok("each write is DeliveryOps' step: status → out_for_delivery, nothing else", t.writes.every((w) => JSON.stringify(w.patch) === '{"status":"out_for_delivery"}'));
  ok("Ana and Bo are out for delivery", t.get("a").status === "out_for_delivery" && t.get("b").status === "out_for_delivery");
  ok("Hal, delivered meanwhile, is NOT pushed back to out for delivery — the write moves only received or brewed", t.get("h").status === "delivered");
  ok("a refused write and a lost one leave their porches as they were", t.get("i").status === "received" && t.get("j").status === "brewed");
  ok("each answer read: 2 moved, 1 had moved on, 2 failed — by name, with why",
    res.moved.map((p) => p.id).join() === "a,b" && res.skipped.map((p) => p.id).join() === "h" && res.failed.map((p) => p.id).join() === "i,j"
    && /row-level security/.test(res.failed[0].error) && /fetch failed/.test(res.failed[1].error), res);
  const said = R.outWords(res);
  ok("the toast names the porches that failed, and says it is an error",
    said.error === true && said.text === "2 porches out for delivery · didn't save Ivy Tan, Jo Park — try them again · 1 porch had moved on already", said);
  ok("all of them: no error, one sentence", JSON.stringify(R.outWords({ moved: [steps[0]], skipped: [], failed: [] })) === '{"text":"1 porch out for delivery","error":false}');
  ok("many failures are named three, then counted", R.outWords({ moved: [], skipped: [], failed: [1, 2, 3, 4, 5].map((n) => ({ id: `${n}`, name: `P${n}`, status: "received", error: "x" })) }).text
    === "Nothing marked out · didn't save P1, P2, P3 and 2 more — try them again");

  // The undo, five seconds later: the driver has logged Bo already.
  t.get("b").status = "delivered";
  const back = await R.unmarkOut(t, res.moved);
  ok("undo: Ana back to received — the step she was on", t.get("a").status === "received");
  ok("undo: Bo, logged since, left as logged", t.get("b").status === "delivered" && back.skipped.map((p) => p.id).join() === "b");
  ok("undo's toast", JSON.stringify(R.undoOutWords(back)) === '{"text":"1 porch back as they were · 1 porch logged since — left as logged","error":false}', R.undoOutWords(back));
  ok("undo writes each porch back to its own step, only while it is still out for delivery",
    t.writes.slice(5).every((w) => w.ids.length === 1) && JSON.stringify(t.writes[5].patch) === '{"status":"received"}' && JSON.stringify(t.writes[6].patch) === '{"status":"brewed"}');
}

// ── a missed porch onto the next run, and back ──────────────────────────────────────────────────────
{
  const was = P("m", "Mo Reyes", { delivery_date: "2026-10-04", status: "held_for_pickup", driver_outcome: "held_no_empties", empties_collected: 0, driver_note: null });
  const t = porchTable([was]);
  const moved = await R.moveToRun(t, was, "2026-10-11");
  const row = t.get("m");
  ok("moved: on the new run, received — brewed fresh for it like every porch on it", moved.ok === true && row.delivery_date === "2026-10-11" && row.status === "received", row);
  ok("…the last attempt's outcome, empties and note cleared off the porch (0141's audit trail keeps them)",
    row.driver_outcome === null && row.empties_collected === null && row.driver_note === null);
  ok("…and nothing else touched", row.name === "Mo Reyes" && row.canceled_at === null);
  const undone = await R.undoMove(t, was, "2026-10-11");
  ok("undo: exactly what was there", undone.ok === true && JSON.stringify(t.get("m")) === JSON.stringify(was), t.get("m"));

  const nh = P("n", "Nia Vo", { delivery_date: "2026-10-11", status: "issue", driver_note: "Not home — 6:42 AM", empties_collected: 0 });
  const t2 = porchTable([nh]);
  ok("a not-home porch moves too", (await R.moveToRun(t2, nh, "2026-10-18")).ok === true && t2.get("n").delivery_date === "2026-10-18" && t2.get("n").driver_note === null);
  t2.get("n").status = "brewed";   // the crew stepped it on the new run
  const late = await R.undoMove(t2, nh, "2026-10-18");
  ok("undo after the crew moved it on: refused, nothing put back over their step", late.ok === false && late.error === null && t2.get("n").status === "brewed" && t2.get("n").delivery_date === "2026-10-18");

  const picked = P("q", "Quin Sol", { delivery_date: "2026-10-04", status: "delivered" });   // collected at GT3PB since (AlertAction's "Picked up")
  const t3 = porchTable([picked]);
  const no = await R.moveToRun(t3, { ...picked, status: "held_for_pickup" }, "2026-10-11");
  ok("a porch collected since is not moved — only held or not home moves", no.ok === false && no.error === null && t3.get("q").delivery_date === "2026-10-04" && t3.get("q").status === "delivered");
  const other = P("r", "Rae Wu", { delivery_date: "2026-10-11", status: "held_for_pickup" });   // someone moved it already
  const t4 = porchTable([other]);
  ok("…nor one already moved off the day it was on", (await R.moveToRun(t4, { ...other, delivery_date: "2026-10-04" }, "2026-10-18")).ok === false && t4.get("r").delivery_date === "2026-10-11");
  const t5 = porchTable([was]); t5.fail.add("m");
  const refused = await R.moveToRun(t5, was, "2026-10-11");
  ok("a refused move says why, and leaves the porch", refused.ok === false && /row-level security/.test(refused.error) && t5.get("m").delivery_date === "2026-10-04");
  const t6 = porchTable([was]); t6.drop.add("m");
  const lost = await R.moveToRun(t6, was, "2026-10-11");
  ok("a move whose answer never comes says so — it is an error, not 'changed meanwhile'", lost.ok === false && /fetch failed/.test(lost.error ?? ""));
  const t7 = porchTable([{ ...was, canceled_at: "2026-10-05T12:00:00Z" }]);
  ok("a canceled porch is not moved", (await R.moveToRun(t7, was, "2026-10-11")).ok === false && t7.get("m").delivery_date === "2026-10-04");
}

// ── every word the writers write is one the table takes (0139) ──────────────────────────────────────
{
  const sql = readFileSync(join(ROOT, "supabase/migrations/0139_delivery.sql"), "utf8");
  const list = (col) => (new RegExp(`${col}\\s+text[^\\n]*check \\(${col} in \\(([^)]*)\\)\\)`).exec(sql)?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, ""));
  const statuses = list("status"), outcomes = list("driver_outcome");
  const src = readFileSync(join(ROOT, "lib/porchRun.ts"), "utf8");
  const written = [...src.matchAll(/status: "([a-z_]+)"/g)].map((m) => m[1]);
  const filtered = [...src.matchAll(/\.(?:in|eq)\("status", (\[[^\]]*\]|"[a-z_]+")\)/g)].flatMap((m) => JSON.parse(m[1].startsWith("[") ? m[1] : `[${m[1]}]`));
  ok("0139's status list read", statuses.length === 6 && statuses.includes("held_for_pickup"), statuses);
  ok("every status the writers write or filter on is in it", written.length >= 2 && [...written, ...filtered].every((w) => statuses.includes(w)), { written, filtered });
  ok("the outcome the move clears to is null — 0139's check allows it, and a held outcome restored by undo is in its list", outcomes.includes("held_no_empties"));
}

console.log(`porchrun: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
