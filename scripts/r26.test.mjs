// R26 — AN ID THAT ISN'T ONE IS A 400 (2026-10-18 — the 10/10 audit, API F14's last; Ryan: "Keep working to improve to a
// 10"). Four routes took an id from the body and asked the database with it — a cup, pack or delivery cancel, a pack moved
// to another day, a customer told, a person brought onto the crew — and one that wasn't an id came back as the database's
// refusal: a 500 on the move, "couldn't cancel" on a cancel. Each is run here as Next runs it, compiled from its
// TypeScript: a malformed id (a word, a number, an id with a letter too many) is a 400 before anything is asked of the
// database, and a real one goes on. (0431, the business day and money never below zero, is run in db.r26.test.mjs.)
import { routeLoader, NextResponseShim } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
Object.assign(process.env, { RESEND_API_KEY: "re_made_up_key", NOTIFY_FROM_EMAIL: "GT3 <hello@example.test>", NEXT_PUBLIC_SUPABASE_URL: "https://made-up.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "made-up-public-key" });

const ID = "0c426000-0000-4000-8000-0000000000a1";
const BAD = ["not-an-id", 42, `${ID}0`, "", null];
const asked = [];
// A database that writes down every question and answers none — a malformed id must never reach it.
const db = new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : (...a) => { asked.push([String(k), ...a]); return db; }) });
db.auth = { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } };
const shims = {
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": { supabaseAdmin: db },
  "@/lib/apiAuth": { userFromRequest: async () => ({ id: ID, email: "sam@example.test" }), staffFromRequest: async () => true, ownerFromRequest: async () => true,
    tenantFromRequest: async () => "00000000-0000-0000-0000-000000000001", callerClient: () => db },
  "@/lib/serverAlerts": { raiseAlert: async () => {}, raiseAlertOnce: async () => true },
  "@/lib/apiRoute": { route: (_n, f) => f, isJsonObject: (v) => !!v && typeof v === "object" && !Array.isArray(v) },
  // the caller's own client (orders/cancel runs the cancel as the person): the same recorder
  "@supabase/supabase-js": { createClient: () => db },
};
const post = async (rel, body) => {
  const R = routeLoader(shims)(rel);
  asked.length = 0;
  const r = await R.POST(new Request(`https://app.example.test/api/x`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer made-up" }, body: JSON.stringify(body) }));
  return { status: r.status, asked: asked.length };
};

for (const bad of BAD) {
  const c = await post("app/api/orders/cancel/route.ts", { channel: "cup", id: bad });
  ok(`orders/cancel: id ${JSON.stringify(bad)} — a 400, the database never asked`, c.status === 400 && c.asked === 0, c);
  const m = await post("app/api/reserve/move/route.ts", { id: bad, toDate: "2026-10-24" });
  ok(`reserve/move: id ${JSON.stringify(bad)} — a 400, the database never asked`, m.status === 400 && m.asked === 0, m);
  const n = await post("app/api/notify/route.ts", { kind: "order_ready", id: bad });
  ok(`notify: id ${JSON.stringify(bad)} — a 400, the database never asked`, n.status === 400 && n.asked === 0, n);
  const w = await post("app/api/team/welcome/route.ts", { kind: "bring_on", user_id: bad });
  ok(`team/welcome: user_id ${JSON.stringify(bad)} — a 400 before the person is looked for`, w.status === 400, w);
}
const stop = await post("app/api/reserve/move/route.ts", { id: ID, toDate: "2026-10-24", stopId: "not-a-stop" });
ok("reserve/move: a stop named that isn't an id is refused — not quietly read as the day's first", stop.status === 400 && stop.asked === 0, stop);
// A real id goes on to the database (whatever it answers then is the route's own business, tested in its own file).
const real = await post("app/api/reserve/move/route.ts", { id: ID, toDate: "2026-10-24" }).catch((e) => ({ status: "threw", error: String(e) }));
ok("reserve/move: a real id goes on and asks the database", real.status !== 400 || real.asked > 0, real);

console.log(`\nR26 — AN ID THAT ISN'T ONE IS A 400: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
