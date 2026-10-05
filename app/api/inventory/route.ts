/* eslint-disable @typescript-eslint/no-explicit-any */
// Inventory bridge → reads the GT3 `inventory_items` table in Postgres (system-of-record as of
// 0041; migrated off the read-only Notion bridge). Staff-only. Same shape the event-prep
// have-vs-need + restock logic already consumes, so callers are unchanged.

import { createClient } from "@supabase/supabase-js";
import { staffFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";
import { isMissingColumn } from "@/lib/schemaSkew";

async function get(req: Request) {
  if (!(await staffFromRequest(req))) return Response.json({ enabled: false, items: [], error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!url || !anon || !token) return Response.json({ enabled: false, items: [] });

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // inventory_status (0205) = inventory_items + reconciled on-hand from the ledger, so reorder math
  // reflects real consumption, not just hand-edited qty.
  const { data, error } = await sb.from("inventory_status").select("*");
  if (error) return Response.json({ enabled: true, error: error.message, items: [] });

  // WHO EACH SHELF IS BOUGHT FROM, AS A LINK (0347: inventory_items.vendor_id). Read from the table, not
  // the view: inventory_status is `select i.*` and Postgres fixed its columns when it was created, so a
  // column added since is not in it. Any other failure is said (linkError), not shown as unlinked.
  // arrives-with: 0347 — until it is pasted the link is not there, and every shelf reads as its typed name.
  const links = await sb.from("inventory_items").select("id, vendor_id");
  const linkOf = new Map<string, string | null>();
  if (!links.error) for (const l of (links.data ?? []) as { id: string; vendor_id: string | null }[]) linkOf.set(l.id, l.vendor_id);
  const linkError = links.error && !isMissingColumn(links.error) ? links.error.message : undefined;

  const num = (v: any) => (typeof v === "number" ? v : v == null ? null : Number(v));
  const items = (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name || "—",
    qty: num(r.qty),
    onHand: num(r.effective_on_hand),
    eventReady: num(r.qty_event_ready),
    reorderPoint: num(r.reorder_point),
    status: r.status ?? null,
    unit: r.unit ?? null,
    category: r.category ?? null,
    useCases: r.use_cases ?? [],
    requiredFor: r.required_for ?? [],
    critical: r.critical ?? false,
    reorderLink: r.reorder_link ?? null,
    vendor: r.vendor ?? null,
    notes: r.notes ?? null,
    // Which city's shelf (0288). Two cities' shelves are different rows; without this the register
    // could not say whose shelf it was showing, or correct a count on the right one.
    market: r.market ?? null,
    vendorId: linkOf.get(r.id) ?? null,
  }));

  return Response.json({ enabled: true, items, ...(linkError ? { linkError } : {}) });
}

export const GET = route("inventory", get);
