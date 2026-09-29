import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

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
// skipped. So it returns two integers and nothing else. `count` is how many rows the ledger holds;
// `max_seq` is the highest sequence recorded. Neither says what any migration DID, and nothing here
// is a secret: it is the shape of the answer, not its contents.
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
// ── NOT ON /api/health ─────────────────────────────────────────────────────────────────────────
// It would have been one more field on a route that already round-trips the database. It is not,
// because /api/health answers "is this app up" for an uptime monitor hitting it every few minutes,
// and "is this schema current" is a different question asked on a different clock. One route, one
// question; a monitor should not be paying for a check it never reads.
export async function GET() {
  const noStore = { "cache-control": "no-store" };
  if (!supabaseAdmin) return NextResponse.json({ ok: false, why: "db unconfigured" }, { status: 503, headers: noStore });
  try {
    // count: exact + head — the row count without shipping 326 rows over the wire.
    const { count, error: countErr } = await supabaseAdmin
      .from("schema_migrations").select("version", { count: "exact", head: true });
    if (countErr) throw countErr;

    // The high-water mark. One row, ordered on an indexed integer.
    const { data: top, error: topErr } = await supabaseAdmin
      .from("schema_migrations").select("seq").order("seq", { ascending: false }).limit(1).maybeSingle();
    if (topErr) throw topErr;

    // A failed read is not an empty ledger. If either call had errored we are in the catch below;
    // reaching here with count === null means PostgREST answered without a count header, which is
    // not the same as "zero migrations" and must not be reported as a number.
    if (count === null || count === undefined) {
      return NextResponse.json({ ok: false, why: "no count returned" }, { status: 503, headers: noStore });
    }

    return NextResponse.json({
      ok: true,
      count,
      max_seq: (top as { seq?: number } | null)?.seq ?? null,
    }, { headers: noStore });
  } catch {
    // Deliberately no error text: this route is public. The caller learns it could not be answered,
    // which is all it needs to print NOT CHECKED instead of a false pass.
    return NextResponse.json({ ok: false }, { status: 503, headers: noStore });
  }
}
