import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// public: read-only ledger count, high-water mark and applied numbers, so a release can be checked without a credential; no names, no SQL
// WHAT HAS ACTUALLY BEEN APPLIED TO THIS DATABASE — the read side of 0304's ledger.
//
// 0304 built the write side: every migration from 0304 forward ends with record_migration(), and
// scripts/drift.check.mjs fails the release if one forgets. Its own comment says why:
//
//     "Otherwise the database cannot say what has been applied to it, and the next person to ask
//      has to guess from this directory — which is exactly how '28 pending' happened."
//
// The database CAN say. Nothing asks it. On 2026-09-29 three migrations (0326, 0327, 0328) sat
// unapplied against production for ten hours while the app served a first real customer order with
// the wrong queue state, and the only way to find out was to open the SQL editor and run a select
// by hand. A ledger nobody can read from outside one browser tab is a ledger that answers the
// question only for whoever is already logged in and already suspicious.
//
// ── WHY NUMBERS AND NOT NAMES ──────────────────────────────────────────────────────────────────
// This route is deliberately unauthenticated, because the thing that needs it is a check running on
// a laptop or in CI with no session — and a check that requires a credential is a check that gets
// skipped. So it returns numbers and nothing else. `count` is how many rows the ledger holds;
// `max_seq` is the highest sequence recorded; `seqs` (below) the sequence numbers themselves. None
// says what any migration DID, and nothing here is a secret: it is the shape of the answer, not its
// contents.
//
// Two integers are enough to catch both ways the directory and the database drift apart:
//
//   files above max_seq        →  migrations written but never applied   (2026-09-29: 0326–0328)
//   count below the file count →  a gap somewhere below the high mark    (one skipped mid-history)
//
// What two integers CANNOT do is name which one is missing in the gap case. scripts/
// migrations.pending.mjs refuses to guess there rather than printing a confident wrong list — the
// same refusal schema.snapshot.mjs makes, for the same reason.
//
// ── AND THE NUMBERS (2026-10-11) ───────────────────────────────────────────────────────────────
// `seqs` is every recorded sequence number, ascending — numbers still, never names. It exists
// because of a migration held back ON PURPOSE: 0376 waits for an iPhone build while 0377–0380
// went ahead, and to two integers a held migration and a forgotten one look the same, so the
// production gate (scripts/verify.prod.mjs) went red on every run until it landed. With the
// numbers the gate checks that the one missing IS the one held (supabase/held.json) and names
// anything else. Sent only when the list is whole: a capped read (PostgREST's row limit) would be
// a confident partial answer, so then it is left out and the two integers decide alone.
//
// ── NOT ON /api/health ─────────────────────────────────────────────────────────────────────────
// It would have been one more field on a route that already round-trips the database. It is not,
// because /api/health answers "is this app up" for an uptime monitor hitting it every few minutes,
// and "is this schema current" is a different question asked on a different clock. One route, one
// question; a monitor should not be paying for a check it never reads.
// ── KEPT HALF A MINUTE (R19, 2026-10-17 — the 10/10 audit, API F18) ────────────────────────────────────────────────
// Public, uncached, and three reads of the ledger each time: a loop from anywhere was three database reads a request,
// for ever. The checks that ask — the scheduled production check every half hour, a release run by hand — need an answer
// a few times an hour, and one half a minute old is as good as a new one. So the answer is kept: by the platform's edge
// (s-maxage), and by this instance (a loop that changes the address to dodge the edge still costs the database one read
// of the three a half minute, an instance). A counter would have been a database write on every request, and one caller's
// loop could have spent the count every check shares; keeping the answer has nothing to spend. A failure is never kept.
const KEEP_MS = 30_000;
const READ_MS = 8_000;   // a read that hangs is a 503, never a wait every caller on this instance shares (R19 review)
// The edge keeps it only for what is left of this instance's half minute — never longer than an answer is kept here, and
// never served stale after (R19 review: kept here, then kept again there with stale-while-revalidate, it was ninety).
const kept_for = (ageMs: number) => ({ "cache-control": `public, s-maxage=${Math.max(0, Math.floor((KEEP_MS - ageMs) / 1000))}` });
const noStore = { "cache-control": "no-store" };
type Answer = { status: number; body: Record<string, unknown> };
let kept: { at: number; answer: Answer } | null = null;
// THE ONE READ OUT, SHARED UNTIL IT SETTLES (R19 review, third pass). Shared until each caller's deadline only, a read
// that hung was left running and the next caller started another: one more hung read every eight seconds. Now the read is
// one until it answers — and it stops at its own deadline (aborted), so it always does — and each caller waits for it no
// longer than READ_MS.
let ledger: Promise<Answer> | null = null;
const askLedger = () => (ledger ??= readLedger().finally(() => { ledger = null; }));

async function read(): Promise<Answer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Answer>((done) => { timer = setTimeout(() => done({ status: 503, body: { ok: false } }), READ_MS); });
  try { return await Promise.race([askLedger(), late]); } finally { clearTimeout(timer); }
}

// The numbers come a page at a time (R19 review, third pass): PostgREST answers at most its row limit (Supabase's is a
// thousand) to one read, so a ledger past it was never whole, never kept — every ask three reads again.
const PAGE = 1000;

async function readLedger(): Promise<Answer> {
  if (!supabaseAdmin) return { status: 503, body: { ok: false, why: "db unconfigured" } };
  const stop = new AbortController();
  const deadline = setTimeout(() => stop.abort(), READ_MS);
  try {
    // count: exact + head — the row count without shipping 326 rows over the wire.
    const { count, error: countErr } = await supabaseAdmin
      .from("schema_migrations").select("version", { count: "exact", head: true }).abortSignal(stop.signal);
    if (countErr) throw countErr;

    // The high-water mark. One row, ordered on an indexed integer.
    const { data: top, error: topErr } = await supabaseAdmin
      .from("schema_migrations").select("seq").order("seq", { ascending: false }).limit(1).abortSignal(stop.signal).maybeSingle();
    if (topErr) throw topErr;

    // A failed read is not an empty ledger. If either call had errored we are in the catch below;
    // reaching here with count === null means PostgREST answered without a count header, which is
    // not the same as "zero migrations" and must not be reported as a number.
    if (count === null || count === undefined) return { status: 503, body: { ok: false, why: "no count returned" } };

    // The numbers (above), a page at a time — in a fixed order (two migrations share a number: the name breaks the tie),
    // up to twenty pages. A failed or short read here costs only the exact answer, never the two integers.
    let seqs: number[] | undefined;
    try {
      const list: number[] = [];
      for (let at = 0, pages = 0; at < count && pages < 20; pages++) {
        const { data: rows, error: seqErr } = await supabaseAdmin
          .from("schema_migrations").select("seq").order("seq", { ascending: true }).order("version", { ascending: true })
          .range(at, at + PAGE - 1).abortSignal(stop.signal);
        if (seqErr || !rows || rows.length === 0) break;
        at += rows.length;
        for (const r of rows as { seq?: unknown }[]) if (Number.isInteger(r.seq)) list.push(r.seq as number);
      }
      if (list.length === count) seqs = list;
    } catch { /* the two integers stand alone */ }

    return { status: 200, body: { ok: true, count, max_seq: (top as { seq?: number } | null)?.seq ?? null, ...(seqs ? { seqs } : {}) } };
  } catch {
    // Deliberately no error text: this route is public. The caller learns it could not be answered,
    // which is all it needs to print NOT CHECKED instead of a false pass.
    return { status: 503, body: { ok: false } };
  } finally {
    clearTimeout(deadline);
  }
}

async function get() {
  const now = Date.now();
  if (kept && now - kept.at < KEEP_MS) return NextResponse.json(kept.answer.body, { status: kept.answer.status, headers: kept_for(now - kept.at) });
  // Callers that arrive while it is being read share the one read (askLedger), each for READ_MS at most.
  const answer = await read();
  // Kept only whole: an answer without the numbers (a capped or failed third read) is sent, not kept — the next caller
  // asks again for the exact one (R19 review).
  const whole = answer.status === 200 && Array.isArray(answer.body.seqs);
  if (whole) kept = { at: Date.now(), answer };
  return NextResponse.json(answer.body, { status: answer.status, headers: whole ? kept_for(0) : noStore });
}

export const GET = route("migrations", get);
