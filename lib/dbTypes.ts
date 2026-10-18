// THE DATABASE'S TYPES, AT THE FEW PLACES A NAME IS CHOSEN AT RUN TIME (R31, 2026-10-18 — the 10/10 audit, operations F22).
//
// Both clients are typed now (lib/supabase, lib/supabaseAdmin: SupabaseClient<Database>, lib/database.types — written
// from the migrations by scripts/db.types.mjs): a column that doesn't exist, a value of the wrong kind, a row missing a
// column the table requires, or a function called with an argument it doesn't take fails the build instead of answering
// in production. These are the helpers for the places the compiler can't follow by itself.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type Functions = Database["public"]["Functions"];
/** What a database function takes: `ArgsOf<"set_market_live">`. */
export type ArgsOf<F extends keyof Functions> = Functions[F]["Args"];

/** One object per column a run-time column name may be: for "event_id" | "stop_id", `{ event_id } | { stop_id }`. */
export type Keyed<K extends string, V> = K extends string ? { [P in K]: V } : never;

/**
 * `{ [col]: value }` that keeps the column's own name for the compiler. A computed key whose type is a union
 * ("event_id" | "stop_id") is widened by TypeScript to an index — `{ [x: string]: … }` — which no table's row accepts;
 * this says it is one of those columns, each on its own.
 */
export function keyed<K extends string, V>(col: K, value: V): Keyed<K, V> {
  return { [col]: value } as Keyed<K, V>;
}

/**
 * A table whose name is chosen at run time — by a calendar's kind of item, an owner's kind (event or stop), a report's
 * list — is read untyped, as every read was before R31: the compiler can only check a name it can see. Kept to the few
 * readers that pick among tables; `scripts/r31.test.mjs` counts them, so a new one is a decision, not a habit.
 */
export function anyTable(sb: SupabaseClient<Database>, table: string) {
  return (sb as unknown as SupabaseClient).from(table);
}
