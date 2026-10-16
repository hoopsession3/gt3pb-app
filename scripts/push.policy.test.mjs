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
    /ready/i.test(ready.body) && /being made/i.test(making.body) && leaks(ready).length === 0 && leaks(making).length === 0, { ready, making });
  // R3b (2026-10-13): one number and one set of words — the order's number as the bar and the Pass print it, and the
  // words the bar, Today and the toast use (lib/orderWords), "at the window" where this said "at the bar".
  ok("the customer's order: its number and Today's words — Order #O-1 · Ready, Ready — grab it at the window",
    ready.title === "Order #O-1 · Ready" && ready.body === "Ready — grab it at the window."
    && making.title === "Order #O-1 · Being made" && making.body === "Being made now." && !/at the bar/.test(ready.body), { ready, making });
  ok("the customer's order: no id, no number — the words alone", P.orderStatusShown({ status: "ready" })?.title === "Ready");
  // R3b: a stop called off voids its cup orders, and the member hears why — the stop and its reason are public on Find Us.
  const sc = P.stopCanceledShown({ id: "4f2a-1", paid: true, customer: NAME }, "WineXpress", "Rained out");
  ok("a stop called off: its number, the stop and why, and what becomes of the money — never the customer's name",
    sc.title === "Order #4F2A · Canceled" && sc.body === "WineXpress was called off — Rained out. Your card is being refunded in full."
    && leaks(sc).length === 0 && sc.tag === "order:4f2a-1:void" && sc.ring === false, sc);
  const sc2 = P.stopCanceledShown({ id: "4f2a-2", paid: false, collected_at: null }, null, "  ");
  ok("a stop called off: no name, no reason, nothing charged — still a true sentence",
    sc2.body === "Your stop was called off. Nothing was charged." && P.stopCanceledShown({ id: "x", payment_status: "paid" }, "A", null).body.endsWith("refunded in full."), sc2);
  ok("the customer's order: done and void send nothing", P.orderStatusShown({ status: "done" }) === null && P.orderStatusShown({ status: "void" }) === null && P.orderStatusShown({}) === null);
  // R7 (2026-10-15): a void the crew made at the Pass said nothing — it says so now, with what becomes of the money.
  const vd = P.orderVoidShown({ id: "4f2a-3", paid: true, customer: NAME });
  ok("a canceled order: its number and the money's fate, never the name — paid online, refunded in full",
    vd.title === "Order #4F2A · Canceled" && vd.body === "Canceled — your card is being refunded in full." && leaks(vd).length === 0 && vd.tag === "order:4f2a-3:void" && vd.ring === false, vd);
  ok("a canceled order: paid at the window comes back there; unpaid, nothing was charged",
    P.orderVoidShown({ id: "x", paid: true, collected_at: "2026-10-15T15:00:00Z" }).body === "Canceled — what you paid at the window comes back there."
    && P.orderVoidShown({ id: "x", paid: false, collected_at: null }).body === "Canceled — nothing was charged."
    && P.orderVoidShown({}).title === "Order canceled");
  const idx = readFileSync(join(ROOT, "supabase/functions/push/index.ts"), "utf8");
  ok("the push function says every void of a member's order — after a stop called off has had its say, and whatever the order-updates switch",
    /if \(!shown && record\.status === "void"\) shown = orderVoidShown\(record\);/.test(idx)
    && idx.indexOf("stopCanceledShown(record") < idx.indexOf("shown = orderVoidShown(record)")
    && idx.indexOf("CUSTOMER_MUTE.orderUpdates") < idx.indexOf("shown = orderVoidShown(record)"));
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
  // 0394 — Remind me when cup orders open: the stop's name (public), cut like the live ping's; one notification a stop.
  const rm = P.reminderShown("WineXpress", "5a10e000-0000-4000-8000-00000000057a"), rm0 = P.reminderShown(null, null);
  ok("a reminder: cup orders are open, for the stop by name — nothing about the member", rm.title === "Cup orders are open" && rm.body === "Order ahead for WineXpress — your usual is one tap on Today." && rm.ring === false, rm);
  ok("a reminder: no name says no name; one notification per stop", rm0.body === "Order ahead — your usual is one tap on Today." && rm.tag === "cups-open:5a10e000-0000-4000-8000-00000000057a" && rm0.tag === "cups-open:-" && P.reminderShown("y".repeat(90), "s").body.includes("y".repeat(60)) && !P.reminderShown("y".repeat(90), "s").body.includes("y".repeat(61)), rm0);
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

  // Just before it is sent, the row as it is now (0383).
  ok("escalation, just before it is sent: a row that could not be read, or was acknowledged meanwhile, is not sent",
    P.stillUnanswered(null) === false && P.stillUnanswered(undefined, 0) === false && P.stillUnanswered({ ack_at: at, claimed_by: null }) === false);
  ok("escalation, just before it is sent: a team alert somebody has claimed is not sent — whatever the reads say",
    P.stillUnanswered({ ack_at: null, claimed_by: "u-sam" }, 0) === false && P.stillUnanswered({ ack_at: null, claimed_by: "u-sam" }) === false);
  ok("escalation, just before it is sent: once the claim exists only the claim counts — reads that claimed nothing (a customer's, another business's) stop nothing",
    P.stillUnanswered({ ack_at: null, claimed_by: null }, 3) === true);
  ok("escalation, before 0383 is applied (no claimed_by on the row): anyone's Got it counts, as it did — and a count not read is none",
    P.stillUnanswered({ ack_at: null }, 1) === false && P.stillUnanswered({ ack_at: null }, 0) === true && P.stillUnanswered({ ack_at: null }, null) === true);
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

// ── 5 · A MUTE AND QUIET HOURS HOLD THE PUSH, NOT THE ALERT (policy.ts 4, 2026-10-12) ────────────────────────────
// Everyone's clock below is read from one instant. 03:30 UTC on 12 Oct 2026 is 11:30 PM the night before in New York
// (EDT) and 8:30 PM in Los Angeles; 03:30 UTC on 15 Jan is 10:30 PM in New York (EST) — the same rule across a clock
// change. The quiet window is the one the Settings picker offers as its default: 10:00pm to 7:00am.
{
  const NIGHT = new Date("2026-10-12T03:30:00Z"), WINTER = new Date("2026-01-15T03:30:00Z"), EVENING = new Date("2026-10-12T01:59:00Z");
  const NY = "America/New_York", LA = "America/Los_Angeles";
  ok("clock: 03:30 UTC in October is 11 PM in New York (EDT) and 8 PM in Los Angeles; in January, 10 PM in New York (EST)",
    P.hourOn(NIGHT, NY) === 23 && P.hourOn(NIGHT, LA) === 20 && P.hourOn(WINTER, NY) === 22, [P.hourOn(NIGHT, NY), P.hourOn(NIGHT, LA), P.hourOn(WINTER, NY)]);
  ok("clock: midnight is hour 0, never 24", P.hourOn(new Date("2026-10-12T04:00:00Z"), NY) === 0, P.hourOn(new Date("2026-10-12T04:00:00Z"), NY));
  ok("clock: a market with no zone, or one this runtime does not know, reads the founding market's clock",
    P.MARKET_ZONE === NY && P.hourOn(NIGHT, null) === 23 && P.hourOn(NIGHT, "") === 23 && P.hourOn(NIGHT, "Not/A_Zone") === 23);

  ok("quiet hours 10pm–7am, across midnight: 10 PM, 11 PM, midnight and 6 AM are inside; 7 AM (the end is not in it) and 9 PM are not",
    [22, 23, 0, 6].every((h) => P.inQuietHours(h, 22, 7)) && ![7, 21, 12].some((h) => P.inQuietHours(h, 22, 7)));
  ok("quiet hours within a day, 1pm–3pm: 1 PM and 2 PM inside, 3 PM and noon not",
    P.inQuietHours(13, 13, 15) && P.inQuietHours(14, 13, 15) && !P.inQuietHours(15, 13, 15) && !P.inQuietHours(12, 13, 15));
  ok("quiet hours: no window when an end is unset, both are the same hour, or an end is not an hour of the day",
    !P.inQuietHours(23, null, 7) && !P.inQuietHours(23, 22, null) && !P.inQuietHours(22, 22, 22) && !P.inQuietHours(23, 22, 25)
    && !P.inQuietHours(23, -1, 7) && !P.inQuietHours(23, 22.5, 7) && !P.inQuietHours(23, "22", "7"));
  // The inbox's own rule (lib/useMyAlerts inQuietHours), compiled from its file and asked the same 24 × 24 × 24
  // questions: the push holds exactly when the inbox holds.
  const inbox = (() => {
    const src = readFileSync(join(ROOT, "lib/useMyAlerts.ts"), "utf8");
    const fn = /function inQuietHours\([\s\S]*?\n\}\n/.exec(src)?.[0];
    if (!fn) return null;
    const out = ts.transpileModule(`${fn}\nmodule.exports = inQuietHours;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const mod = { exports: {} };
    new Function("module", "exports", out)(mod, mod.exports);
    return mod.exports;
  })();
  const disagree = [];
  if (inbox) for (let s = 0; s < 24; s++) for (let e = 0; e < 24; e++) for (let h = 0; h < 24; h++) {
    if (inbox({ getHours: () => h }, s, e) !== P.inQuietHours(h, s, e)) disagree.push([s, e, h]);
  }
  ok("quiet hours: the push and the inbox (lib/useMyAlerts) agree on every hour of every window — 13,824 questions",
    inbox !== null && disagree.length === 0 && inbox({ getHours: () => 0 }, null, 7) === P.inQuietHours(0, null, 7), disagree.slice(0, 4));

  const quiet = { muted_categories: [], quiet_start: 22, quiet_end: 7 };
  const imp = { severity: "important", category: "order" };
  ok("muted: an important in a category the person muted does not ring them; in one they did not mute, it does",
    P.pushHeld(imp, { muted_categories: ["order"] }, EVENING, NY) === "muted"
    && P.pushHeld({ ...imp, category: "money" }, { muted_categories: ["order"] }, EVENING, NY) === null);
  ok("quiet hours: an important at 11:30 PM inside a 10pm–7am window does not ring; at 9:59 PM, before it opens, it does",
    P.pushHeld(imp, quiet, NIGHT, NY) === "quiet hours" && P.pushHeld(imp, quiet, EVENING, NY) === null);
  ok("quiet hours: …the window is the person's market's clock — the same instant is 8:30 PM in Los Angeles, and rings there",
    P.pushHeld(imp, quiet, NIGHT, LA) === null);
  ok("quiet hours: …and holds across midnight and the clock change — 12:30 AM in October, 10:30 PM in January",
    P.pushHeld(imp, quiet, new Date("2026-10-12T04:30:00Z"), NY) === "quiet hours" && P.pushHeld(imp, quiet, WINTER, NY) === "quiet hours");
  ok("a critical always rings: in quiet hours, in a muted category, and both at once",
    P.pushHeld({ severity: "critical", category: "order" }, quiet, NIGHT, NY) === null
    && P.pushHeld({ severity: "critical", category: "order" }, { muted_categories: ["order"] }, EVENING, NY) === null
    && P.pushHeld({ severity: "critical", category: "order" }, { ...quiet, muted_categories: ["order"] }, NIGHT, NY) === null);
  ok("a device test rings in quiet hours — it is a critical, and the person's own (0374)",
    P.pushHeld({ severity: "critical", category: "system", kind: "device_test" }, { ...quiet, muted_categories: ["system"] }, NIGHT, NY) === null);
  ok("no prefs is no mute and no quiet hours; a mute list that is not a list mutes nothing",
    P.pushHeld(imp, null, NIGHT, NY) === null && P.pushHeld(imp, undefined, NIGHT, NY) === null
    && P.pushHeld(imp, { muted_categories: "order" }, EVENING, NY) === null);

  // A team alert, asked person by person.
  const people = [
    { id: "muted-it", prefs: { muted_categories: ["order"] }, timeZone: NY },
    { id: "asleep-in-greenville", prefs: quiet, timeZone: NY },
    { id: "awake-in-la", prefs: quiet, timeZone: LA },
    { id: "no-prefs" },
    { id: "muted-other", prefs: { muted_categories: ["money"], quiet_start: null, quiet_end: null }, timeZone: NY },
  ];
  const team = P.whoRings(imp, people, NIGHT);
  ok("a team alert is asked person by person: the one who muted its category and the one in quiet hours are held; the rest ring",
    team.ring.join() === "awake-in-la,no-prefs,muted-other"
    && JSON.stringify(team.held) === JSON.stringify([{ id: "muted-it", why: "muted" }, { id: "asleep-in-greenville", why: "quiet hours" }]), team);
  const loud = P.whoRings({ severity: "critical", category: "order" }, people, NIGHT);
  ok("…and the same team critical rings every one of them", loud.ring.length === people.length && loud.held.length === 0, loud);
  ok("one person: a personal alert to someone in quiet hours rings nobody — and still nothing is written about it but its row",
    P.whoRings(imp, [people[1]], NIGHT).ring.length === 0);

  // Settings' mutes are the alert vocabulary's categories, so a mute can match (components/NotifPrefs).
  const np = readFileSync(join(ROOT, "components/NotifPrefs.tsx"), "utf8");
  const keys = [...(/const NOTIF_CATS[\s\S]*?\];/.exec(np)?.[0] ?? "").matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);
  ok("Settings' mutes are categories alerts carry (lib/alertKinds, 0232) — a mute that matches nothing would promise silence and keep ringing",
    keys.length >= 6 && keys.every((k) => P.CATEGORY_WORDS[k]), keys);

  // The function asks before it sends. It cannot run here (Deno, the network), so its wiring is read.
  const fn = readFileSync(join(ROOT, "supabase/functions/push/index.ts"), "utf8");
  ok("the push function asks whoRings for every alert's people before it looks up their devices",
    /const ids = await ringingNow\(record, await peopleFor\(record\)\);\s*targets = ids\.length \? await subsFor/.test(fn)
    && /return whoRings\(a, ids\.map\(/.test(fn));
  ok("…a critical skips the question, and a prefs read that fails pings everyone — a failed read is not a mute",
    /if \(!ids\.length \|\| severityOf\(a\.severity\) === "critical"\) return ids;/.test(fn) && /if \(prefs\.error\) return ids;/.test(fn));
  ok("…the clock is the person's market's: profiles.market, then markets.timezone",
    /from\("profiles"\)\.select\("id, market"\)\.in\("id", ids\)/.test(fn) && /from\("markets"\)\.select\("slug, timezone"\)\.in\("slug", markets\)/.test(fn));
}

// ── 5 · A PACK HEARS ABOUT ITS DAY (0399) ────────────────────────────────────────────────────────────────────────
{
  // WineXpress, Sat Oct 24 2026, 11am–2pm Eastern (EDT: 15:00–18:00 UTC); a 6-pack bringing its empties back.
  const pack = { id: "p-1", size: 6, glass: "return", drop_date: "2026-10-24", paid: false, name: NAME, phone: PHONE, total_cents: 3200 };
  const stop = { name: "WineXpress", starts_at: "2026-10-24T15:00:00Z", ends_at: "2026-10-24T18:00:00Z", address: "202 Scuffletown Rd, Simpsonville, SC" };
  const tomorrow = P.packNoticeShown("pickup_tomorrow", pack, stop);
  ok("the evening before: \"Pickup tomorrow\" — the size, the hours, the stop's name; a tag of its own",
    shape(tomorrow) && tomorrow.title === "Pickup tomorrow" && tomorrow.body === "Your 6-pack: 11am–2pm at WineXpress." && tomorrow.tag === "pack:p-1:pickup_tomorrow" && !tomorrow.ring, tomorrow);
  const changed = P.packNoticeShown("pickup_changed", pack, { ...stop, starts_at: "2026-10-24T16:30:00Z", ends_at: "2026-10-24T19:00:00Z" });
  ok("the stop's hours changed: the day and the new hours, said as they stand", changed.title === "Your pickup changed" && changed.body === "Your 6-pack is now Sat, Oct 24, 12:30pm–3pm at WineXpress.", changed);
  const moved = P.packNoticeShown("pack_moved", { ...pack, drop_date: "2026-10-31" }, { ...stop, starts_at: "2026-10-31T15:00:00Z", ends_at: "2026-10-31T18:00:00Z" });
  ok("the crew moved it: the new day and hours", moved.title === "Your pack moved" && moved.body === "Your 6-pack is now Sat, Oct 31, 11am–2pm at WineXpress.", moved);
  const canceled = P.packNoticeShown("pack_canceled", pack, stop), canceledPaid = P.packNoticeShown("pack_canceled", { ...pack, paid: true }, stop);
  ok("the crew canceled it: which day, and what becomes of the money — never the amount",
    canceled.body === "Your 6-pack for Sat, Oct 24 is canceled. Nothing was charged." && canceledPaid.body === "Your 6-pack for Sat, Oct 24 is canceled. What you paid is being refunded.", [canceled, canceledPaid]);
  const noStop = P.packNoticeShown("pickup_tomorrow", pack, null);
  ok("a pack with no stop still has its day: Find Us has where and when", noStop.body === "Your 6-pack: Find Us has where and when.", noStop);
  ok("no lock screen says the member's name, number or what they paid — or the stop's street",
    [tomorrow, changed, moved, canceled, canceledPaid, noStop].every((x) => leaks(x).length === 0 && !x.body.includes("Scuffletown")));
  ok("a kind it does not know sends nothing", P.packNoticeShown("pack_lost", pack, stop) === null && P.packNoticeTold("pack_lost", pack, stop) === null);
  const told = P.packNoticeTold("pickup_tomorrow", pack, stop);
  ok("the email: a subject that says it, the day, the hours, where (the stop's street — a public place), the empties, and the way to the packs",
    told.subject === "GT3 — pickup tomorrow: WineXpress"
    && told.text.startsWith("Your 6-pack is ready for pickup tomorrow, Sat, Oct 24, 11am–2pm at WineXpress (202 Scuffletown Rd, Simpsonville, SC).")
    && told.text.includes("Bringing your empties back") && told.text.endsWith("Your packs: https://app.gt3pb.com/reserve") && !told.text.includes(NAME), told);
  ok("the text: GT3, what it is, and how to stop — under two messages", told.sms.startsWith("GT3: Pickup tomorrow. Your 6-pack: 11am–2pm at WineXpress.") && told.sms.endsWith("Reply STOP to stop.") && told.sms.length <= 320, told.sms);
  ok("no empties line for new glass, nor on any notice but the evening before",
    !P.packNoticeTold("pickup_tomorrow", { ...pack, glass: "new" }, stop).text.includes("empties") && !P.packNoticeTold("pickup_changed", pack, stop).text.includes("empties"));
  ok("clock words: on the hour, and with minutes", P.clockOf(new Date("2026-10-24T15:00:00Z")) === "11am" && P.clockOf(new Date("2026-10-24T16:30:00Z")) === "12:30pm"
    && P.clockOf(new Date("2026-12-24T16:00:00Z")) === "11am");   // EST in December

  // The number a text goes to is lib/texts e164's, the same on every input (Deno cannot import lib/texts).
  const texts = (() => {
    const mod = { exports: {} };
    new Function("module", "exports", "require", ts.transpileModule(readFileSync(join(ROOT, "lib/texts.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(mod, mod.exports, () => ({}));
    return mod.exports;
  })();
  const inputs = [null, "", "(864) 555-0100", "864.555.0100", "8645550100", "1-864-555-0100", "+1 864 555 0100", "+44 20 7946 0958", "555-0100",
    "0864555010", "123-456-7890", "21864555010", "+0123456789", "+1234567", "call me", "+8645550100"];
  const differ = inputs.filter((x) => P.textNumber(x) !== texts.e164(x));
  ok("the push function reads a number as lib/texts does", differ.length === 0, differ);
  const hours = [0, 7, 8, 12, 20, 21, 23].map((h) => [h, P.textQuiet(new Date(Date.UTC(2026, 9, 24, h + 4))), texts.quietHours(new Date(Date.UTC(2026, 9, 24, h + 4)))]);
  ok("…and keeps its night: 9pm to 8am Eastern, as lib/texts", hours.every(([, a, b]) => a === b) && hours.filter(([, a]) => a).map(([h]) => h).join() === "0,7,21,23", hours);

  // Its wiring, read: the function cannot run here.
  const fn = readFileSync(join(ROOT, "supabase/functions/push/index.ts"), "utf8");
  ok("the push function sends a notice once — when the run marks it sent — to the member's own devices",
    /table === "pack_notices" && type === "UPDATE"/.test(fn) && /if \(!record\.sent_at \|\| \(old_record && old_record\.sent_at\)\) return new Response\("skip: not a notice going out"\);/.test(fn)
    && /targets = await subsFor\(\(q\) => q\.eq\("user_id", pack\.user_id\)\);/.test(fn));
  ok("…emails the member's own address and nobody else's (no fallback to the admin list)",
    /async function emailMember\(userId: string, subject: string, body: string\): Promise<boolean> \{[\s\S]{0,260}return em \? await sendEmail\(\[em\], subject, body\) : false;/.test(fn));
  ok("…texts only when texts are on, the number's yes stands, and not at night",
    /if \(Deno\.env\.get\("TEXTS_ON"\) !== "1" \|\| !sid \|\| !token \|\| !from\) return \{ result: "off" \};/.test(fn)
    && fn.indexOf('supabase.rpc("text_consent_standing"') < fn.indexOf("if (textQuiet(new Date()))") && fn.indexOf("if (textQuiet(new Date()))") < fn.indexOf("api.twilio.com"));
  ok("…and writes back what went", /after = \(\) => supabase\.from\("pack_notices"\)\.update\(\{ pushed: devices, emailed, texted: texted\.result, detail: texted\.detail \?\? null \}\)\.eq\("id", record\.id\);/.test(fn)
    && /if \(after\) await after\(\);\s*return new Response\("ok"\);/.test(fn));
}

console.log(`WHAT A PUSH SAYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
