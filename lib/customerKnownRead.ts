import type { SupabaseClient } from "@supabase/supabase-js";
import type { KnownRows } from "./customerKnown";
export { knownFrom } from "./customerKnown";

// THE READ BEHIND lib/customerKnown — a signed-in customer's own rows, through their own session.
//
// Every table here has an own-row read policy (customers 0151, orders 0005, shop_orders 0271,
// delivery_orders 0139, drop_orders, business_accounts and business_orders 0187), so this asks with
// the customer's JWT and the database decides what is theirs. Loaded only when somebody is signed in
// (components/useCustomerKnown imports it on demand), so a guest's first load never carries it — nor
// the resolver, which rides along from here.
//
// A source that fails is left out: this is a prefill, and the cost of a missing source is an empty
// box the customer fills in, never a wrong value. `failed` says how many, so "we know nothing" and
// "we could not ask" stay two different answers.

type Got<T> = { row: T | null; failed: boolean };
const one = <T,>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Got<T>> =>
  Promise.resolve(q).then(
    ({ data, error }) => ({ row: error ? null : ((Array.isArray(data) ? data[0] : data) as T) ?? null, failed: !!error }),
    () => ({ row: null, failed: true }),
  );

export type KnownRowsRead = { rows: Omit<KnownRows, "email" | "displayName" | "market">; failed: number };

export async function readKnownRows(sb: SupabaseClient, userId: string): Promise<KnownRowsRead> {
  const latest = (table: string, cols: string, notCanceled = false) => {
    let q = sb.from(table).select(cols).eq("user_id", userId);
    if (notCanceled) q = q.is("canceled_at", null);
    return q.order("created_at", { ascending: false }).limit(1);
  };
  const [customer, lastCup, lastShop, lastDelivery, lastPack, business, lastOffice] = await Promise.all([
    one<NonNullable<KnownRows["customer"]>>(sb.from("customers").select("name, phone, email").eq("user_id", userId).limit(1)),
    one<NonNullable<KnownRows["lastCup"]>>(latest("orders", "customer")),
    one<NonNullable<KnownRows["lastShop"]>>(latest("shop_orders", "ship_name, ship_address")),
    one<NonNullable<KnownRows["lastDelivery"]>>(latest("delivery_orders", "name, phone, address_street, address_city, address_zip, access_instructions", true)),
    one<NonNullable<KnownRows["lastPack"]>>(latest("drop_orders", "name, phone", true)),
    one<NonNullable<KnownRows["business"]>>(sb.from("business_accounts").select("company, contact_name, contact_phone, contact_email, address_street, address_city, address_zip, headcount").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1)),
    one<NonNullable<KnownRows["lastOffice"]>>(latest("business_orders", "access_instructions, address_street", true)),
  ]);
  const all = [customer, lastCup, lastShop, lastDelivery, lastPack, business, lastOffice];
  return {
    rows: { customer: customer.row, lastCup: lastCup.row, lastShop: lastShop.row, lastDelivery: lastDelivery.row, lastPack: lastPack.row, business: business.row, lastOffice: lastOffice.row },
    failed: all.filter((p) => p.failed).length,
  };
}
