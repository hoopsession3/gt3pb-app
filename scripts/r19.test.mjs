// R19 — THE 10/10 AUDIT, ROUND NINETEEN, RUN (2026-10-17; Ryan: "Keep working to improve to a 10").
//
//   · the uptime check is named (operations F6): with HEALTH_PROBE_SECRET set, only a check carrying it feeds the
//     watchdog — app/api/health, run;
//   · the public migrations ledger is kept half a minute — by the edge and by the instance — so a loop costs the
//     database nothing past one read (API F18) — app/api/migrations, run.
//
// The route is compiled from its TypeScript and called with a Request, as Next calls it; the database is a recorder.
// Nothing here talks to Supabase; the secret is made up.
import { NextResponseShim, routeLoader } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };

// ── app/api/health: the probe, named ─────────────────────────────────────────────────────────────────────────────────
{
  const stamps = [];
  let down = false;
  const admin = {
    from: (table) => ({
      select: () => Promise.resolve(down ? { error: { message: "the database didn't answer" } } : { error: null, count: 1 }),
      upsert: (row) => { stamps.push({ table, row }); return Promise.resolve({ error: null }); },
    }),
  };
  const R = routeLoader({ "next/server": { NextResponse: NextResponseShim }, "@/lib/supabaseAdmin": { supabaseAdmin: admin } })("app/api/health/route.ts");
  const get = async (path = "/api/health", headers = {}) => { const r = await R.GET(new Request(`https://app.example.test${path}`, { headers })); return { status: r.status, body: await r.json() }; };

  delete process.env.HEALTH_PROBE_SECRET;
  let r = await get();
  ok("health, no probe secret set: any outside check is the probe — ok, and the watchdog stamped (as before)", r.status === 200 && r.body.ok === true && stamps.length === 1 && stamps[0].table === "ops_heartbeat", { r, stamps });
  await get("/api/health?from=app");
  ok("health: the app's own check never feeds it", stamps.length === 1, stamps.length);
  const b = await get("/api/health?from=app-build");
  ok("health: the build question is answered without the database", b.status === 200 && b.body.ok === true && "build" in b.body && stamps.length === 1, b);

  process.env.HEALTH_PROBE_SECRET = "made-up-probe-secret-for-tests";
  r = await get();
  ok("health, the secret set: a check that doesn't carry it — the same ok answer, and no stamp", r.status === 200 && r.body.ok === true && stamps.length === 1, { r, stamps: stamps.length });
  await get("/api/health", { "x-health-probe": "made-up-probe-secret-for-testS" });
  ok("health: a wrong secret is no probe", stamps.length === 1, stamps.length);
  await get("/api/health", { "x-health-probe": "made-up-probe-secret-for-tests" });
  ok("health: the check that carries it feeds the watchdog", stamps.length === 2, stamps.length);
  await get("/api/health?from=app", { "x-health-probe": "made-up-probe-secret-for-tests" });
  ok("health: …and the app's own check still never does", stamps.length === 2, stamps.length);
  // R19 review: a check that sends the header is told whether it was taken — a mismatch fails the check, not the watchdog.
  r = await get("/api/health", { "x-health-probe": "made-up-probe-secret-for-tests" });
  const wrong = await get("/api/health", { "x-health-probe": "not-the-site's-secret" });
  const plain = await get();
  ok("health: a check that sends the header is told whether it is the probe — true, or false for a secret that differs",
    r.body.probe === true && wrong.body.probe === false && wrong.status === 200 && wrong.body.ok === true, [r.body, wrong.body]);
  ok("health (review): …and a check that sends none is told too — probe: false while the site has a secret — so a site given one before its check was is never quiet",
    plain.body.probe === false && plain.body.ok === true, plain.body);
  const app = await get("/api/health?from=app");
  ok("health: the app's own question carries no probe field", !("probe" in app.body) && app.body.ok === true, app.body);
  process.env.HEALTH_PROBE_SECRET = "  made-up-probe-secret-for-tests\n";
  const before = stamps.length;
  const trimmed = await get("/api/health", { "x-health-probe": "made-up-probe-secret-for-tests " });
  ok("health: both read trimmed — a secret pasted with its newline is the same secret", trimmed.body.probe === true && stamps.length === before + 1, trimmed.body);
  process.env.HEALTH_PROBE_SECRET = "   ";
  const blank = await get();
  ok("health: a secret that is only spaces is no secret — every outside check is the probe, as unset", stamps.length === before + 2 && blank.body.ok === true, stamps.length - before);
  process.env.HEALTH_PROBE_SECRET = "made-up-probe-secret-for-tests";
  // R19 review: a preview deployment may share production's database — it never feeds production's watchdog.
  process.env.VERCEL_ENV = "preview";
  const before2 = stamps.length;
  const preview = await get("/api/health", { "x-health-probe": "made-up-probe-secret-for-tests" });
  ok("health (review): a preview deployment answers the probe and stamps nothing", preview.body.probe === true && stamps.length === before2, { stamps: stamps.length - before2 });
  process.env.VERCEL_ENV = "production";
  await get("/api/health", { "x-health-probe": "made-up-probe-secret-for-tests" });
  ok("health (review): …production does", stamps.length === before2 + 1, stamps.length - before2);
  delete process.env.VERCEL_ENV;
  const n2 = stamps.length;
  down = true;
  r = await get("/api/health", { "x-health-probe": "made-up-probe-secret-for-tests" });
  ok("health: the database down is a 503, never a stamp", r.status === 503 && r.body.ok === false && stamps.length === n2, r);
  delete process.env.HEALTH_PROBE_SECRET;
}

// ── app/api/migrations: the public ledger, kept half a minute (API F18) ─────────────────────────────────────────────
{
  const reads = [];
  let failing = false, capped = false, hang = false, rows = [422, 423, 424], cap = 1000, aborted = 0;
  // A PostgREST builder as the route uses it: each read awaited after abortSignal(); a hung read answers only its abort.
  const admin = {
    rpc: async () => { reads.push("rpc"); return { data: true, error: null }; },
    from: (table) => {
      reads.push(table);
      let head = false, span = null, signal = null;
      const answer = () => {
        if (head) return Promise.resolve(failing ? { count: null, error: { message: "down" } } : { count: rows.length, error: null });
        if (span) {
          if (capped) return Promise.resolve({ data: null, error: { message: "range not satisfiable" } });
          const [a, b] = span, n = Math.min(b - a + 1, cap);   // PostgREST's row limit (Supabase's: a thousand)
          return Promise.resolve({ data: rows.slice(a, a + n).map((seq) => ({ seq })), error: null });
        }
        return Promise.resolve({ data: { seq: rows[rows.length - 1] }, error: null });
      };
      const q = {
        select: (_c, o) => { head = !!o?.head; return q; },
        order: () => q, limit: () => q,
        range: (a, b) => { span = [a, b]; return q; },
        abortSignal: (sig) => { signal = sig; return q; },
        maybeSingle: () => (hang ? new Promise((_, no) => signal?.addEventListener("abort", () => { aborted++; no(new Error("aborted")); })) : answer()),
        then: (yes, no) => answer().then(yes, no),
      };
      return q;
    },
  };
  const R = routeLoader({ "next/server": { NextResponse: NextResponseShim }, "@/lib/supabaseAdmin": { supabaseAdmin: admin } })("app/api/migrations/route.ts");
  const get = async (ip = "198.51.100.7") => { const r = await R.GET(new Request("https://app.example.test/api/migrations", { headers: { "x-forwarded-for": ip } })); return { status: r.status, cache: r.headers.get("cache-control"), body: await r.json() }; };
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    const first = await get();
    ok("ledger: answered — the count, the high mark and the numbers — and the edge may keep it half a minute, never served stale after",
      first.status === 200 && first.body.count === 3 && first.body.max_seq === 424 && first.body.seqs?.length === 3 && first.cache === "public, s-maxage=30", first);
    const n = reads.length;
    ok("ledger: one answer is three reads, and nothing is written (no counter to spend)", n === 3 && !reads.includes("rpc"), reads);
    for (let i = 0; i < 25; i++) await get(`203.0.113.${i}`);
    ok("ledger: a loop — from one address or twenty-five — inside the half minute reads the database no more", reads.length === n, reads.length - n);
    clock += 20_000;
    const later = await get();
    ok("ledger (review): an answer twenty seconds old is kept by the edge for the ten left — no answer is ever more than half a minute old",
      later.cache === "public, s-maxage=10" && later.body.count === 3, later.cache);
    clock -= 20_000;
    const together = await Promise.all([1, 2, 3].map(() => get()));
    ok("ledger: …and every caller is answered the same", together.every((x) => x.status === 200 && x.body.count === 3));
    clock += 30_001;
    const [a, b] = await Promise.all([get(), get()]);
    ok("ledger: past the half minute it is read again — once, for the callers that arrived together", reads.length === n + 3 && a.body.count === 3 && b.body.count === 3, reads.length - n);
    clock += 30_001;
    failing = true;
    const down = await get();
    ok("ledger: a read that failed is a 503 the edge may not keep", down.status === 503 && down.body.ok === false && down.cache === "no-store", down);
    failing = false;
    const back = await get();
    ok("ledger: …and is never kept here either — the next ask reads again and is answered", back.status === 200 && back.body.count === 3, back);
    clock += 30_001;
    capped = true;
    const m = reads.length;
    const part = await get(), part2 = await get();
    ok("ledger (review): an answer without the numbers (their read failed) is sent with the two integers, not kept — the next caller asks again",
      part.status === 200 && part.body.count === 3 && !("seqs" in part.body) && part.cache === "no-store" && part2.cache === "no-store" && reads.length === m + 6, { part, reads: reads.length - m });
    capped = false;
    clock += 30_001;
    hang = true;
    const keepTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...a) => keepTimeout(fn, ms === 8_000 ? 0 : ms, ...a);   // the read's deadline, now
    let hung;
    try { hung = await get(); await new Promise((r) => keepTimeout(r, 20)); } finally { globalThis.setTimeout = keepTimeout; hang = false; }
    ok("ledger (review): a read that hangs is a 503 at its deadline — not a wait every caller on the instance shares", hung.status === 503 && hung.cache === "no-store", hung);
    ok("ledger (third pass): …and the read itself is stopped at its deadline — never one more hung read for each caller", aborted === 1, aborted);
    const after = await get();
    ok("ledger (review): …and the next ask reads again", after.status === 200 && after.body.seqs?.length === 3, after);
    // A ledger past PostgREST's row limit: read a page at a time, whole, and kept.
    clock += 30_001;
    rows = Array.from({ length: 2345 }, (_, i) => i + 1);
    const p0 = reads.length;
    const big = await get();
    ok("ledger (third pass): a ledger past a thousand rows is read a page at a time — whole, and kept",
      big.status === 200 && big.body.count === 2345 && big.body.seqs?.length === 2345 && big.body.seqs[2344] === 2345 && big.cache === "public, s-maxage=30"
        && reads.length === p0 + 2 + 3, { status: big.status, n: big.body.seqs?.length, reads: reads.length - p0 });
    clock += 30_001;
    cap = 0;
    const none = await get();
    ok("ledger (third pass): …a page that comes back empty is no answer of the numbers — the two integers, not kept",
      none.status === 200 && none.body.count === 2345 && !("seqs" in none.body) && none.cache === "no-store", { status: none.status, cache: none.cache });
    cap = 1000; rows = [422, 423, 424];
  } finally { Date.now = realNow; }
}

// ── the audit's buckets are the app's (R19 review) ──────────────────────────────────────────────────────────────────
{
  const { BUCKET_CAPS } = await import("./security.audit.mjs");
  const BT = routeLoader()("lib/bucketTakes.ts");
  ok("audit: every bucket the app writes to (lib/bucketTakes) is one the security audit holds to a size and types — and no other",
    JSON.stringify([...BUCKET_CAPS].sort()) === JSON.stringify(Object.keys(BT.BUCKET_TAKES).sort()), { audit: BUCKET_CAPS, app: Object.keys(BT.BUCKET_TAKES) });
}

console.log(`R19 — ROUND NINETEEN: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
