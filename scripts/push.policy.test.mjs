// WHAT A PUSH SAYS, AND WHERE IT GOES — supabase/functions/push/policy.ts, compiled and asked (2026-10-11, wave 2).
//
// The push function's three rules, run as written: which channels a severity gets (an fyi gets the inbox and nothing
// else), what a locked phone may show for every kind of push the function sends (no customer name, phone, address,
// email or amount, whatever the row holds), and which change to an alert is an escalation. The function itself is
// Deno and reaches the network; its rules are a plain file it imports, so they are compiled here from that file.
//
// Every record below is made up, and as full of a customer as a real one: a name, a phone, an email, a street, a
// total. Each push built from it is searched for every one of those, and for anything shaped like them.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const SRC = readFileSync(join(ROOT, "supabase/functions/push/policy.ts"), "utf8");
const P = (() => {
  const mod = { exports: {} };
  const out = ts.transpileModule(SRC, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("module", "exports", "require", out)(mod, mod.exports, (spec) => { throw new Error(`policy.ts must stay pure — it imported ${spec}`); });
  return mod.exports;
})();
ok("compiled: supabase/functions/push/policy.ts, with no imports of its own",
  typeof P.channelsFor === "function" && typeof P.alertShown === "function" && !/^\s*import\s/m.test(SRC));

// ── 1 · FYI STAYS QUIET ──────────────────────────────────────────────────────────────────────────────────────────
{
  const f = P.channelsFor("fyi"), i = P.channelsFor("important"), c = P.channelsFor("critical");
  ok("fyi: the inbox only — no push, no sound, no Teams, no email", !f.push && !f.sound && !f.teams && f.email === "never", f);
  ok("important: push with sound, Teams; email only when the producer asks", i.push && i.sound && i.teams && i.email === "asked", i);
  ok("critical: push with sound, Teams and email, always", c.push && c.sound && c.teams && c.email === "always", c);
  ok("a severity the column would not hold is the column's default, important (0050)",
    P.severityOf(undefined) === "important" && P.severityOf("loud") === "important" && P.severityOf("fyi") === "fyi" && P.severityOf("critical") === "critical");
  ok("email: an fyi never, asked or not; an important only when asked; a critical always",
    !P.mayEmail("fyi") && !P.mayEmail("fyi", true) && !P.mayEmail("important") && P.mayEmail("important", true) && P.mayEmail("critical") && P.mayEmail("critical", false));
  ok("the rule is one table, frozen in its shape: three severities, four channels each",
    Object.keys(P.CHANNELS).sort().join() === "critical,fyi,important"
    && Object.values(P.CHANNELS).every((x) => Object.keys(x).sort().join() === "email,push,sound,teams"));
  ok("no severity gets a sound without a push — the sound is the push's", Object.values(P.CHANNELS).every((x) => !x.sound || x.push));
}

// ── 2 · WHAT A LOCKED PHONE MAY SHOW ─────────────────────────────────────────────────────────────────────────────
const NAME = "Jane Q. Customer", FIRST = "Jane", PHONE = "(864) 555-0123", EMAIL = "jane.customer@example.com",
  STREET = "1234 Augusta St", CITY_ZIP = "Greenville 29601", AMOUNT = "$32.00", COMPANY = "Acme Dental LLC", PAYMENT = "pay_TEST000123";
const PII = [NAME, FIRST, PHONE, EMAIL, STREET, CITY_ZIP, AMOUNT, COMPANY, PAYMENT, "Smith Wedding", "Mrs. Lee"];
const leaks = (shown) => {
  if (!shown) return [];
  const text = `${shown.title}\n${shown.body}`;
  const found = PII.filter((p) => text.includes(p));
  if (/[$@]/.test(text)) found.push("a $ or an @");
  if (/\d{3,}/.test(text)) found.push("a run of three or more digits (a phone, a ZIP, a street number, an amount)");
  return found;
};
const shape = (s) => !!s && typeof s.title === "string" && s.title.length > 0 && typeof s.body === "string" && typeof s.tag === "string" && s.tag.length > 0 && typeof s.ring === "boolean";

{
  const o = P.newOrderShown({ id: "o-1", customer: NAME, items: ["rise", "flow"], total_cents: 3200, phone: PHONE });
  ok("new order: \"New order\" · \"2 items · tap to open\" — the count, never who or how much",
    o.title === "New order" && o.body === "2 items · tap to open" && leaks(o).length === 0, o);
  ok("new order: one item is one item", P.newOrderShown({ id: "o-2", items: ["rise"] }).body === "1 item · tap to open");
  ok("new order: no items listed still says something true", P.newOrderShown({ id: "o-3", items: null }).body === "Tap to open the Pass.");
  ok("new order: its own tag, so two orders do not replace each other silently, and it does not ring over an open Pass",
    o.tag === "order:o-1" && o.ring === false && P.newOrderShown({ id: "o-4", items: [] }).tag !== o.tag);
}
{
  const ready = P.orderStatusShown({ id: "o-1", status: "ready", customer: NAME });
  const making = P.orderStatusShown({ id: "o-1", status: "preparing", customer: NAME });
  ok("the customer's order: ready and preparing say so without their name — their lock screen faces the room too",
    /ready/.test(ready.body) && /making your order/.test(making.body) && leaks(ready).length === 0 && leaks(making).length === 0, { ready, making });
  ok("the customer's order: done and void send nothing", P.orderStatusShown({ status: "done" }) === null && P.orderStatusShown({ status: "void" }) === null && P.orderStatusShown({}) === null);
  ok("the customer's order: preparing then ready are two tags — ready rings even while preparing is still showing", ready.tag !== making.tag);
}
{
  const live = P.subscriptionShown({ id: "s-1", status: "active", user_id: "u" });
  const due = P.subscriptionShown({ id: "s-1", status: "past_due" });
  ok("a subscription: live and past due, with no name", /live/.test(live.body) && /didn't go through/.test(due.body) && leaks(live).length === 0 && leaks(due).length === 0);
  ok("a subscription: any other state sends nothing", P.subscriptionShown({ status: "paused" }) === null && P.subscriptionShown({ status: "canceled" }) === null);
}
{
  const t = P.taskShown({ id: "t-1", label: `Call ${NAME} at ${PHONE}` }, false), tc = P.taskShown({ id: "t-1", label: "Smith Wedding load-in" }, true);
  ok("a task: \"You're on the crew\" and \"Task flagged critical\", and neither its label nor its event's title (either can name a client)",
    t.title === "You're on the crew" && tc.title === "Task flagged critical" && leaks(t).length === 0 && leaks(tc).length === 0, { t, tc });
  const s = P.signoffShown({ id: "r-1", title: "Smith Wedding" });
  ok("a sign-off request: says what to do, not whose event", s.title === "Prep needs your sign-off" && leaks(s).length === 0, s);
}
{
  const l = P.liveShown("Falls Park"), none = P.liveShown(null);
  ok("the truck is live: a stop's public name may be said; no stop, no place", l.body === "We're pouring at Falls Park — come thru." && none.body === "We're pouring — come thru." && l.tag === "live");
  ok("the truck is live: a name is cut at sixty characters", P.liveShown("x".repeat(90)).body.length < 100);
}

// Every kind with a sentence, every category, a kind nobody wrote one for, and kind-less alerts.
{
  const rows = [];
  for (const kind of Object.keys(P.KIND_WORDS)) rows.push({ id: `a-${kind}`, kind, category: "order", severity: "critical",
    title: `${NAME} paid ${AMOUNT} — ${COMPANY}`, body: `${STREET}, ${CITY_ZIP}. ${PHONE}. ${EMAIL}. ${PAYMENT}.` });
  for (const category of Object.keys(P.CATEGORY_WORDS)) rows.push({ id: `c-${category}`, kind: null, category, severity: "important",
    title: `Canceled: ${NAME}'s order`, body: `${NAME} · ${AMOUNT}` });
  rows.push({ id: "n-1", kind: "a_kind_nobody_wrote_words_for", category: "money", severity: "critical", title: `A card dispute was opened for ${AMOUNT}`, body: EMAIL });
  rows.push({ id: "n-2", kind: null, category: "no-such-category", severity: "important", title: `Office delivery not made — ${COMPANY}`, body: PHONE });
  rows.push({ id: "n-3", kind: "shop_order_stalled", category: "order", severity: "critical", title: `${NAME} paid ${AMOUNT} 2 days ago — still waiting on us`, body: "x" });
  const bad = rows.flatMap((r) => [P.alertShown(r), P.escalationShown(r)].map((s) => ({ r: r.id, s, leaks: leaks(s), shape: shape(s) })))
    .filter((x) => x.leaks.length || !x.shape);
  ok(`alerts: none of ${rows.length * 2} pushes (every kind, every category, unknown ones; first send and escalation) shows a name, phone, address, email or amount`,
    bad.length === 0, bad.slice(0, 4));
  ok("alerts: a kind with a sentence says it", P.alertWords({ kind: "refund_needed", title: `Voided a PAID order — ${NAME}` }) === "A refund is needed");
  ok("alerts: a kind with none says its category's words", P.alertWords({ kind: "a_new_kind", category: "money", title: NAME }) === "A money alert");
  ok("alerts: a category outside the vocabulary is a system alert", P.alertWords({ category: "drop", title: NAME }) === "A system alert");
  ok("alerts: a kind-less alert whose title is a fixed sentence in its producer's code shows it as written",
    P.alertWords({ kind: null, category: "money", title: "Paid order didn't record — add it" }) === "Paid order didn't record — add it");
  ok("alerts: a kind-less alert with any other title shows its category's words, not its title",
    P.alertWords({ kind: null, category: "order", title: `Canceled: ${NAME}'s order` }) === "An order needs you");
  ok("alerts: a fixed title is matched whole — the same words with a name after them are not it",
    P.alertWords({ kind: null, category: "money", title: `Paid order didn't record — add it ${NAME}` }) === "A money alert");
  const crit = P.alertShown({ id: "a-1", kind: "refund_needed", category: "money", severity: "critical" });
  const imp = P.alertShown({ id: "a-2", kind: "delivery_held", category: "order", severity: "important" });
  ok("alerts: a critical is said so and rings even with the app open; an important does neither",
    crit.title === "Critical — A refund is needed" && crit.ring === true && imp.title === "A delivery is held for pickup" && imp.ring === false);
  ok("alerts: one tag per alert, so two alerts never silently replace each other", crit.tag === "alert:a-1" && imp.tag === "alert:a-2");
  const esc = P.escalationShown({ id: "a-1", kind: "refund_needed", category: "money", title: `${NAME} ${AMOUNT}` });
  ok("escalation: \"Still open\", why it came again, a tag of its own — so it rings beside the first instead of replacing it",
    esc.title === "Still open — A refund is needed" && /10 minutes/.test(esc.body) && esc.tag === "alert:a-1:again" && esc.ring === true, esc);
  const test = P.alertShown({ id: "d-1", kind: "device_test", severity: "critical", title: "anything", target_user_id: "u" });
  ok("a device test: \"Test alert\", rings with the app open, a tag of its own", test.title === "Test alert" && test.ring === true && test.tag === "test:d-1" && leaks(test).length === 0, test);
}

// The words themselves: fixed sentences, and nothing in them a customer could have typed.
{
  const all = [...Object.values(P.KIND_WORDS), ...Object.values(P.CATEGORY_WORDS), ...P.FIXED_TITLES];
  ok("every word on this list is a sentence with no $, @ or digits", all.every((w) => typeof w === "string" && w.length > 3 && !/[$@\d]/.test(w)),
    all.filter((w) => /[$@\d]/.test(w)));
  ok("the category words cover the closed category vocabulary (lib/alertKinds)", (() => {
    const kinds = readFileSync(join(ROOT, "lib/alertKinds.ts"), "utf8");
    const block = /const ALERT_CATEGORIES = \{([\s\S]*?)\} as const;/.exec(kinds)?.[1] ?? "";
    const cats = [...block.matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]);
    return cats.length >= 9 && cats.every((c) => P.CATEGORY_WORDS[c]);
  })());

  // A fixed title is a known pair with the producer that writes it: if that producer rewords it, the entry here
  // is dead (the lock screen falls back to the category — safe — but the list would quietly lie). Each one must still
  // be written, word for word, by a file outside this one.
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (/node_modules|\.next|\.smoke|\.git|ios/.test(p)) continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|sql)$/.test(n)) files.push(p); } };
  walk(join(ROOT, "app")); walk(join(ROOT, "lib")); walk(join(ROOT, "supabase"));
  const corpus = files.filter((f) => !f.endsWith("supabase/functions/push/policy.ts")).map((f) => readFileSync(f, "utf8")).join("\n");
  const sqlQuoted = (t) => t.replace(/'/g, "''");
  const dead = [...P.FIXED_TITLES].filter((t) => !corpus.includes(`"${t}"`) && !corpus.includes(`'${sqlQuoted(t)}'`) && !corpus.includes(`\`${t}\``));
  ok("every fixed title is still written, word for word, by the producer it came from", dead.length === 0, dead);
}

// ── 3 · AN ESCALATION ────────────────────────────────────────────────────────────────────────────────────────────
{
  const at = "2026-10-11T12:10:00Z";
  const base = { severity: "critical", kind: "refund_needed", ack_at: null };
  ok("escalation: escalated_at set for the first time on an unacknowledged critical",
    P.isEscalation({ ...base, escalated_at: at }, { ...base, escalated_at: null }) === true);
  ok("escalation: not the second time (it was already escalated)", P.isEscalation({ ...base, escalated_at: at }, { ...base, escalated_at: at }) === false);
  ok("escalation: not an important or an fyi", P.isEscalation({ ...base, severity: "important", escalated_at: at }, { ...base, escalated_at: null }) === false);
  ok("escalation: not one acknowledged meanwhile", P.isEscalation({ ...base, ack_at: at, escalated_at: at }, { ...base, escalated_at: null }) === false);
  ok("escalation: never a device test — it is one person's, and shown to nobody else",
    P.isEscalation({ ...base, kind: "device_test", escalated_at: at }, { ...base, kind: "device_test", escalated_at: null }) === false);
  ok("escalation: an insert (no old row) or an update that did not touch escalated_at is not one",
    P.isEscalation({ ...base, escalated_at: at }, null) === false && P.isEscalation({ ...base, escalated_at: null }, { ...base, escalated_at: null }) === false);
}

// ── 4 · RING THIS PHONE: what the button says (lib/ringPhone, over 0374 ring_my_devices's answers) ──────────────
{
  const R = (() => {
    const mod = { exports: {} };
    const out = ts.transpileModule(readFileSync(join(ROOT, "lib/ringPhone.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    new Function("module", "exports", "require", out)(mod, mod.exports, (spec) => { throw new Error(`lib/ringPhone must stay pure — it imported ${spec}`); });
    return mod.exports;
  })();
  ok("ring: compiled, and pure", typeof R.ringWords === "function");
  const one = R.ringWords({ data: 1, error: null });
  ok("ring: sent to one device — \"Sent — your phone should ring now.\"", one.sent === true && one.say === "Sent — your phone should ring now.", one);
  ok("ring: sent to three — says so", R.ringWords({ data: 3, error: null }).say === "Sent to your 3 devices — they should ring now.");
  const none = R.ringWords({ data: 0, error: null });
  ok("ring: no device kept for you — says what to do, and does not claim it rang", none.sent === false && /turn on alerts on this phone first/.test(none.say), none);
  const soon = R.ringWords({ data: null, error: { code: "PT429", message: "You rang your phone a moment ago — try again in 37 seconds." } });
  ok("ring: a second press inside the minute shows the database's own words, with how long to wait",
    soon.sent === false && soon.say === "You rang your phone a moment ago — try again in 37 seconds.", soon);
  ok("ring: not on the crew — the database's words too",
    R.ringWords({ error: { code: "42501", message: "Only the crew can ring a phone from here." } }).say === "Only the crew can ring a phone from here.");
  ok("ring: a lapsed session is refused the call by Postgres itself — the button asks them to sign in again, not \"permission denied for function\"",
    R.ringWords({ error: { code: "42501", message: "permission denied for function ring_my_devices" } }).say === "Sign in again to ring your phone.");
  ok("ring: before 0374 is in the database, it says it is not switched on — not \"try again\" for ever",
    /isn't switched on yet/.test(R.ringWords({ error: { code: "PGRST202", message: "Could not find the function public.ring_my_devices" } }).say));
  const broke = R.ringWords({ error: { code: "08006", message: "connection failure at 10.0.0.12" } });
  ok("ring: any other failure says try again — never a server's message, never \"sent\"", broke.sent === false && broke.say === "Couldn't ring your phone — try again.", broke);
  ok("ring: an answer that is not a count is not a send", R.ringWords({ data: null, error: null }).sent === false && R.ringWords({ data: "1", error: null }).sent === false);
}

console.log(`WHAT A PUSH SAYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
