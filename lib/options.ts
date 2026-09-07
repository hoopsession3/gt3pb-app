// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SMALL CLOSED LISTS — one owner, one fetch, one fallback.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// An interface audit found the same column offered as a picker on one screen and a free-text box on
// another, and inventory status carrying TWO DIFFERENT hard-coded lists in two editors that both
// write it. 0306 moved those vocabularies into public.option_sets and exposed them as v_options.
//
// The constants below did not go away, and that is deliberate. They are the SEED the table was
// built from and the fallback a picker uses when the fetch fails — so a network blip degrades to
// exactly today's behaviour rather than to an empty dropdown, which would be a worse failure than
// the free text this replaces. What they stopped being is a second source of truth.
//
// Rule for anything added here: it belongs in option_sets only if it is genuinely JUST a list. The
// moment a value needs its own columns, relationships or lifecycle — markets, vendors, profiles —
// it gets its own table and this module is not involved.

export type OptionSetKey = "inventory_unit" | "inventory_status" | "doc_kind" | "menu_timing" | "agreement_activity";
export type Option = { value: string; label: string };

/** Seeds for 0306, and the offline fallback. Order matches the `sort` column. */
export const FALLBACK: Record<OptionSetKey, Option[]> = {
  inventory_unit: [
    { value: "each", label: "each" }, { value: "case", label: "case" },
    { value: "pack", label: "pack" }, { value: "gallon", label: "gallon" },
    { value: "lb", label: "lb" }, { value: "oz", label: "oz" },
    { value: "set", label: "set" }, { value: "box", label: "box" },
  ],
  // The UNION of the two lists that were live. Both editors wrote this column and rows exist under
  // both vocabularies, so choosing one list would have orphaned the other's rows.
  inventory_status: [
    { value: "On Hand", label: "On Hand" }, { value: "In Transit", label: "In Transit" },
    { value: "Backorder", label: "Backorder" }, { value: "Low", label: "Low" },
    { value: "Out", label: "Out" }, { value: "Consumed", label: "Consumed" },
    { value: "Returned", label: "Returned" },
  ],
  // 0309. What an operator's agreement says they actually DO — the duties field this app did not
  // have. Kept here as the offline fallback for the same reason as the others: an empty scope
  // picker on a bad connection is worse than a stale one.
  agreement_activity: [
    { value: "serve", label: "Serving and events" },
    { value: "brew", label: "Brewing" },
    { value: "deliver", label: "Delivery driving" },
    { value: "prep", label: "Prep and pack-out" },
    { value: "sourcing", label: "Buying and supply runs" },
    { value: "maintenance", label: "Rig and equipment upkeep" },
    { value: "market_lead", label: "Leading the market" },
    { value: "sales", label: "Selling accounts" },
  ],
  doc_kind: [
    { value: "permit", label: "Permit" }, { value: "coi", label: "Certificate of insurance" },
    { value: "receipt", label: "Receipt" }, { value: "invoice", label: "Invoice" },
    { value: "contract", label: "Contract" }, { value: "inspection", label: "Inspection" },
    { value: "other", label: "Other" },
  ],
  menu_timing: [
    { value: "BEFORE", label: "Before" }, { value: "DURING", label: "During" },
    { value: "AFTER", label: "After" },
  ],
};

/** A value already on a row that the list no longer offers — a retired option, or one typed in
 *  before the picker existed. It is kept and shown rather than silently dropped, because a select
 *  that cannot represent its own current value is how an edit quietly changes a field nobody
 *  touched. Returns the list to render, current value included, order preserved. */
export function withCurrent(list: Option[], current: string | null | undefined): Option[] {
  const v = (current ?? "").trim();
  if (!v || list.some((o) => o.value === v)) return list;
  return [...list, { value: v, label: `${v} (not on the list)` }];
}

/** Label for a stored value, falling back to the value itself so an unknown one still reads. */
export function labelFor(list: Option[], value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return list.find((o) => o.value === v)?.label ?? v;
}
