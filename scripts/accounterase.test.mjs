// DELETING AN ACCOUNT, IN ITS ORDER — every branch of lib/accountErase against stand-ins (A3 of the account audit).
//
// The finding, as a sentence: deleting an account cancelled the membership at Square, removed the photos and revoked Sign
// in with Apple before the database's erasure, which could still say no — and then the account was left standing without
// them. The audit's test, by name: "a route test with the erase forced to fail". The database goes first now; what lies
// outside it is done from 0404's queue, which the erasure writes in its own transaction (scripts/db.erasequeue.test.mjs
// runs that for real). What is real here is compiled from lib/accountErase; Square, Apple, storage and Supabase are stood
// in for. Nothing here talks to any of them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const E = libLoader()("lib/accountErase.ts");
ok("compiled: lib/accountErase", typeof E.eraseAccount === "function");

const ON_ITS_WAY = { code: "order_on_its_way", message: "You have an order on its way. Once it is picked up or delivered, you can delete your account here." };
/** A person's account and what the database would queue when it is deleted (0404's trigger), as rows with a ticket. */
function world(over = {}) {
  const calls = [];
  const s = {
    blockers: [], blockersAfter: null, apple: true, markOk: true,
    deleteOk: true,
    queued: [
      { kind: "square_subscription", ref: "SQ-SUB-LIVE" }, { kind: "square_customer", ref: "SQ-CUST-7Q2X" },
      { kind: "apple_token", ref: "r.token" }, { kind: "photo", ref: "avatars/u1/face.jpg" },
    ],
    outside: { square_subscription: ["ok"], square_customer: ["ok"], apple_token: ["ok"], photo: ["ok"] },   // answers per try
    deleted: false, ticketOnAccount: null, rows: [],
    queue: true,                  // 0404 pasted (false: no queue yet — arrives-with: 0404)
    before: [{ id: "direct-0", kind: "square_customer", ref: "SQ-CUST-7Q2X" }, { id: "direct-1", kind: "apple_token", ref: "r.token" }, { id: "direct-2", kind: "photo", ref: "avatars/u1/face.jpg" }],
    ...over,
  };
  let n = 0;
  const steps = {
    async blockers() { calls.push(["blockers"]); if (s.deleted) return []; return s.blockersAfter && calls.filter((c) => c[0] === "blockers").length > 1 ? s.blockersAfter : s.blockers; },
    async hasApple() { calls.push(["hasApple"]); return s.apple; },
    newTicket() { return "tkt-1"; },
    async outside() { calls.push(["outside"]); return s.before.map((b) => ({ ...b })); },
    async markTicket(id, t) { calls.push(["mark", t]); if (!s.markOk) return false; s.ticketOnAccount = t; return true; },
    async deleteAccount() {
      calls.push(["delete"]);
      if (!s.deleteOk) return { ok: false, error: "Database error deleting user" };
      s.deleted = true;
      // 0404's trigger, in the deleting transaction: the queue exists exactly when the deletion does
      s.rows = s.queued.map((q) => ({ id: `f${++n}`, ...q, ticket: s.ticketOnAccount }));
      return { ok: true };
    },
    async claim(t) { calls.push(["claim", t]); if (!s.queue) return null; return s.rows.filter((r) => r.ticket === t && !r.taken).map((r) => { r.taken = true; return { id: r.id, kind: r.kind, ref: r.ref }; }); },
    async run(f) {
      calls.push(["run", f.kind]);
      const a = (s.outside[f.kind] ?? []).shift() ?? "fail";
      if (a === "throw") throw new Error("socket hang up");
      return a === "ok" ? { ok: true } : { ok: false, error: `${f.kind} failed` };
    },
    async finish(f, okd, err) { calls.push(["finish", f.id, okd, err ?? null, !!f.direct]); if (okd) s.rows = s.rows.filter((r) => r.id !== f.id); },
    async handOff(f) { calls.push(["handOff", f.id, !!f.direct]); },
  };
  return { s, steps, calls, names: () => calls.map((c) => c[0]) };
}
const outside = (w) => w.calls.filter((c) => c[0] === "run");

// ── the audit's test: the erase forced to fail ──
{
  const w = world({ deleteOk: false, blockersAfter: [ON_ITS_WAY] });
  const a = await E.eraseAccount("u1", w.steps);
  ok("forced to fail: the database refuses (an order placed a moment ago) — 409, in its words", a.status === 409 && a.body.blockers?.[0]?.code === "order_on_its_way" && a.body.error === ON_ITS_WAY.message, a);
  ok("forced to fail: NOTHING outside the database was touched — no Square, no Apple, no photo — and nothing was queued to be",
    outside(w).length === 0 && !w.names().includes("claim") && w.s.rows.length === 0, w.names());
}
{
  const w = world({ deleteOk: false });
  const a = await E.eraseAccount("u1", w.steps);
  ok("forced to fail, for no reason it can name: 500, filed as an error by route(), and still nothing outside touched",
    a.status === 500 && /deleteUser failed/.test(a.thrown ?? "") && outside(w).length === 0, { a, calls: w.names() });
}

// ── before anything changes ──
{
  const w = world({ blockers: null });
  const a = await E.eraseAccount("u1", w.steps);
  ok("unavailable: what stands in the way can't be asked — 503, nothing else done", a.status === 503 && w.names().join() === "blockers", { a, calls: w.names() });
}
{
  const w = world({ blockers: [ON_ITS_WAY] });
  const a = await E.eraseAccount("u1", w.steps);
  ok("blocked: answered before anything changes — no ticket, no delete", a.status === 409 && a.body.blockers.length === 1 && w.names().join() === "blockers", { a, calls: w.names() });
}
{
  const w = world({ markOk: false });
  const a = await E.eraseAccount("u1", w.steps);
  ok("the ticket can't be written: 503, nothing deleted", a.status === 503 && !w.names().includes("delete"), { a, calls: w.names() });
}

// ── the database first, then what is outside it ──
{
  const w = world();
  const a = await E.eraseAccount("u1", w.steps);
  const order = w.names();
  ok("done: the order — asked, Apple read, the ticket written, the account deleted, then its own steps outside",
    order.slice(0, 6).join() === "blockers,hasApple,outside,mark,delete,claim" && order.indexOf("run") > order.indexOf("delete"), order);
  ok("done: its own rows, by the ticket it wrote", w.calls.find((c) => c[0] === "claim")?.[1] === "tkt-1" && w.calls.find((c) => c[0] === "mark")?.[1] === "tkt-1");
  ok("done: each step outside once — the membership cancelled, the saved card's profile removed, Apple told, the photo removed",
    outside(w).map((c) => c[1]).sort().join() === "apple_token,photo,square_customer,square_subscription", outside(w));
  ok("done: every step finished and gone, nothing handed to the crew", w.s.rows.length === 0 && !w.names().includes("handOff"));
  ok("done: 200 — Apple was told, the membership is cancelled", a.status === 200 && a.body.ok && a.body.appleManual === false && a.body.membershipPending === false, a);
}
{
  const w = world({ outside: { square_subscription: ["503", "503"], square_customer: ["ok"], apple_token: ["ok"], photo: ["ok"] } });
  const a = await E.eraseAccount("u1", w.steps);
  const sub = w.s.rows.find((r) => r.kind === "square_subscription");
  ok("Square down: the cancel is tried twice, then handed to the crew (an alert that rings), and the rest still done",
    w.calls.filter((c) => c[0] === "run" && c[1] === "square_subscription").length === 2 && w.calls.some((c) => c[0] === "handOff" && c[1] === sub?.id)
    && w.s.rows.length === 1 && outside(w).filter((c) => c[1] !== "square_subscription").length === 3, w.calls);
  ok("Square down: the account is deleted all the same, and the person is told the membership's cancel is still going through",
    a.status === 200 && a.body.membershipPending === true, a);
  ok("Square down: the failure is recorded with why", w.calls.some((c) => c[0] === "finish" && c[1] === sub?.id && c[2] === false && /failed/.test(c[3])));
}
{
  const w = world({ outside: { square_subscription: ["503", "ok"], square_customer: ["ok"], apple_token: ["ok"], photo: ["ok"] } });
  const a = await E.eraseAccount("u1", w.steps);
  ok("Square answers on the second try: done, nothing handed off", a.body.membershipPending === false && !w.names().includes("handOff"), w.calls);
}
{
  const w = world({ outside: { square_subscription: ["ok"], square_customer: ["ok"], apple_token: ["fail", "fail"], photo: ["throw", "throw"] } });
  const a = await E.eraseAccount("u1", w.steps);
  ok("Apple doesn't confirm: the person is told how to end Sign in with Apple in Settings (appleManual), and the row is handed off (let go)",
    a.body.appleManual === true && w.calls.some((c) => c[0] === "handOff" && w.calls.find((x) => x[0] === "finish" && x[1] === c[1] && x[2] === false)), w.calls);
  ok("a step that throws counts as failed — handed to the crew, not a crash", a.status === 200 && w.calls.filter((c) => c[0] === "handOff").length === 2, a);
}
{
  const w = world({ queued: [{ kind: "photo", ref: "vip/u1/badge.jpg" }] });
  const a = await E.eraseAccount("u1", w.steps);
  ok("signed in with Apple, but no token was ever kept to revoke: appleManual — the Settings step is theirs", a.body.appleManual === true, a);
}
{
  const w = world({ apple: false, queued: [] });
  const a = await E.eraseAccount("u1", w.steps);
  ok("no Apple, nothing outside: 200, nothing to tell", a.status === 200 && a.body.appleManual === false && a.body.membershipPending === false && outside(w).length === 0, a);
}

// ── arrives-with: 0404 — before it is pasted there is no queue ──
{
  const w = world({ queue: false, outside: { square_customer: ["fail", "fail"], apple_token: ["ok"], photo: ["ok"] } });
  const a = await E.eraseAccount("u1", w.steps);
  ok("before 0404: no queue — what was read before the delete is done directly, after it, and nothing before it",
    a.status === 200 && outside(w).map((c) => c[1]).sort().join() === "apple_token,photo,square_customer,square_customer"
    && w.names().indexOf("outside") < w.names().indexOf("delete") && w.names().indexOf("run") > w.names().indexOf("delete"), w.calls);
  ok("before 0404: a direct step that fails is handed to the crew the old way (marked direct), and Apple told is Apple told",
    w.calls.some((c) => c[0] === "handOff" && c[2] === true) && a.body.appleManual === false, { calls: w.calls, a });
}
{
  const w = world({ queue: false, deleteOk: false, blockersAfter: [ON_ITS_WAY] });
  const a = await E.eraseAccount("u1", w.steps);
  ok("before 0404 and refused: still nothing outside touched", a.status === 409 && outside(w).length === 0, w.names());
}

// ── the route hands lib/accountErase the real steps, and says what deleting means first ──
const rt = readFileSync(join(ROOT, "app/api/account/erase/route.ts"), "utf8");
const post = rt.slice(rt.indexOf("async function post("));
ok("route: nothing outside the database is changed by post() itself — no Square call, no revoke, no removal; it only reads what is there (arrives-with: 0404)",
  /const answer = await eraseAccount\(user\.id, steps\);/.test(post) && !/fetch\(/.test(post) && !/revoke\(/.test(post) && !/\.remove\(/.test(post));
ok("route: the steps outside are the queue's (0404) — claimed by ticket, finished, handed off",
  /admin\.rpc\("claim_erasure_followups", \{ p_ticket: ticket, p_limit: 20 \}\)/.test(rt) && /admin\.rpc\("finish_erasure_followup"/.test(rt)
  && /admin\.rpc\("erasure_followup_alert", \{ p_id: f\.id \}\)/.test(rt) && /app_metadata: \{ erasure_ticket: ticket \}/.test(rt));
ok("route: GET says what deleting means — what stands in the way, a membership it will cancel, an office order it stops",
  /membership: \(subs \?\? \[\]\)\.length > 0,/.test(rt) && /\.from\("business_accounts"\)\.select\("company"\)\s*\.eq\("user_id", user\.id\)\.eq\("standing_active", true\)/.test(rt));
ok("route: a photo step removes only from the two photo buckets", /if \(slash < 1 \|\| !\(PHOTO_BUCKETS as readonly string\[\]\)\.includes\(bucket\) \|\| !path\)/.test(rt));

console.log(`\nACCOUNT ERASE ORDER: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
