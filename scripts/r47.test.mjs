// R47 — THE OWNER SEES WHO HAS THE COURSE, AND GIVES IT (2026-10-22 — Ryan: "can i give access in settings somewhere? how
// can i see the users… a member's profile should show if they enrolled and all of the other stuff… industry standard").
//
//   1 · lib/courseStudents: how they got it, how far along, the badge, the owner's numbers, the search, the export.
//   2 · a customer's record: enrolled or not, how, how far — and Give / Take back for an owner or an admin.
//   3 · Catalog: GT3 Nutrition · students — the numbers, where people stop, everyone, give by email, export.
//   4 · the database, as text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── 1 · lib/courseStudents ───────────────────────────────────────────────────────────────────────────────────────────
{
  const S = loadTs("lib/courseStudents.ts");
  const now = new Date("2026-10-22T12:00:00Z");
  const row = (o) => ({ customer_id: "c", name: "Ana", email: "ana@x.test", user_id: "u", source: "purchase", granted_at: "2026-10-20T00:00:00Z", revoked_at: null, order_id: "o",
    paid_cents: 4700, note: null, done: 0, total: 3, rookie_done: 0, rookie_total: 3, last_done_at: null, ...o });
  const rows = [
    row({ customer_id: "a", done: 3, rookie_done: 3 }),
    row({ customer_id: "b", name: "Ben", email: "ben@x.test", done: 1, granted_at: "2026-08-01T00:00:00Z" }),
    row({ customer_id: "c", name: "Cy", email: "cy@x.test", source: "comp", order_id: null, paid_cents: null, note: "a gift" }),
    row({ customer_id: "d", name: "Di", email: "di@x.test", revoked_at: "2026-10-21T00:00:00Z", paid_cents: 4700 }),
  ];
  const k = S.courseKpis(rows, now);
  ok("the numbers: live students, bought vs given, taken back, revenue (all and 30 days) from what's still theirs, started, finished, badges, average",
    k.students === 3 && k.bought === 2 && k.given === 1 && k.takenBack === 1 && k.revenueCents === 9400 && k.revenue30Cents === 4700 && k.sold30 === 2
      && k.started === 2 && k.finished === 1 && k.badge === 1 && k.avgPct === 44, k);
  ok("in a word: Bought, Given, Taken back", S.howWord(rows[0]) === "Bought" && S.howWord(rows[2]) === "Given" && S.howWord(rows[3]) === "Taken back");
  ok("progress said plainly, and never on an empty course", S.progressWords(rows[1]) === "1 of 3 lessons" && S.progressWords({ done: 0, total: 1 }) === "0 of 1 lesson" && S.progressWords({ done: 0, total: 0 }) === "No lessons live yet");
  ok("the search and the filters", S.filterStudents(rows, "", "all").length === 3 && S.filterStudents(rows, "", "given")[0].customer_id === "c"
    && S.filterStudents(rows, "", "back")[0].customer_id === "d" && S.filterStudents(rows, "BEN@", "all")[0].customer_id === "b" && S.filterStudents(rows, "zzz", "all").length === 0);
  const csv = S.studentsCsv([rows[0], rows[2]]);
  ok("the export: the columns an email tool or a bookkeeper reads", JSON.stringify(Object.keys(csv[0])) === JSON.stringify(["name", "email", "how", "since", "paid", "lessons_done", "lessons_live", "rookie_badge", "last_lesson", "note"])
    && csv[0].paid === "47.00" && csv[0].rookie_badge === "yes" && csv[1].paid === "" && csv[1].note === "a gift", csv);
}

// ── 2 · a customer's record ──────────────────────────────────────────────────────────────────────────────────────────
{
  const r = read("components/nutrition/CourseOnRecord.tsx");
  ok("the record says enrolled or not, how (bought with its price, given with its note), taken back, progress, the badge, the last lesson",
    /Not enrolled\./.test(r) && /`Bought \$\{day\(s\.granted_at\)\}/.test(r) && /`Given \$\{day\(s\.granted_at\)\}\$\{s\.note/.test(r) && /taken back \$\{day\(s\.revoked_at\)\}/.test(r)
      && /progressWords\(s\)\} · Rookie \{s\.rookie_done\} of \{s\.rookie_total\}/.test(r) && /Rookie badge/.test(r) && /last finished/.test(r));
  ok("Give the course, with a note; Take it back, asked first on the card — never a browser dialog; a paid one says to refund it too",
    /supabase\.rpc\("course_give", \{ p_customer: customerId, p_note: note\.trim\(\) \|\| null \}\)/.test(r) && /supabase\.rpc\("course_take_back", \{ p_customer: customerId \}\)/.test(r)
      && /setAsking\(true\)/.test(r) && !/confirm\(/.test(r) && /refund the order too/.test(r));
  ok("…an owner's or an admin's: anyone else on the crew is told who does it", /\{!canGive && <div className="crm-note mt-0">An owner or an admin gives or takes back the course\.<\/div>\}/.test(r));
  ok("on every customer's record, guest or member", /<CourseOnRecord customerId=\{c\.id\} canGive=\{canTier\} \/>\s*\{hasLoyalty && \(/.test(read("components/CrmPanel.tsx")));
}

// ── 3 · Catalog ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const p = read("components/nutrition/CourseStudents.tsx");
  ok("the students panel: the numbers, where people stop, give by email (an owner's or an admin's), the filters, search, export, each opening their record",
    /courseKpis\(rows\)/.test(p) && /Where people stop — each lesson, how many finished it/.test(p) && /canGive && \(/.test(p) && /\.ilike\("email", e\)/.test(p)
      && /<Segmented label="Which students" kind="choice"/.test(p) && /downloadCsv\("gt3-nutrition-students\.csv", studentsCsv\(shown\)\)/.test(p) && /openRecord\("customer", s\.customer_id\)/.test(p));
  ok("…an email two customers share is not guessed at", /hits\.length !== 1/.test(p) && /Two customers have that email/.test(p));
  const pg = read("app/crew/page.tsx");
  ok("in Catalog, beside the lessons", /<Panel id="students" title="GT3 Nutrition · students" sub="[^"]+"><CourseStudents \/><\/Panel>\s*<Panel id="lessons" title="GT3 Nutrition · lessons"/.test(pg));
}

// ── 4 · the database, as text ────────────────────────────────────────────────────────────────────────────────────────
{
  const m = read("supabase/migrations/0444_the_owner_sees_who_has_the_course.sql");
  ok("0444: who gave it, who took it, why; the audit trail; give and take back an admin's; the students read the crew's; nobody else runs them",
    /add column if not exists note text/.test(m) && /add column if not exists granted_by uuid/.test(m) && /add column if not exists revoked_by uuid/.test(m)
      && /create trigger audit_program_access after insert or update or delete on public\.program_access/.test(m)
      && (m.match(/if not public\.is_admin\(\) then raise exception/g) || []).length === 2 && /and \(select public\.is_staff\(\)\)/.test(m)
      && /revoke all on function public\.course_students\(\) from public, anon, authenticated;/.test(m) && /select public\.record_migration\('0444_the_owner_sees_who_has_the_course'\);/.test(m));
  const pkg = JSON.parse(read("package.json"));
  ok("this file runs with every test, and its database half with the database's", /node scripts\/r46\.test\.mjs && node scripts\/r47\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/db\.r47\.test\.mjs/.test(pkg.scripts["db:test"]));
}

console.log(`R47 — THE OWNER SEES WHO HAS THE COURSE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
