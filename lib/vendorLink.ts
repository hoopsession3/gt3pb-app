import { supabase } from "./supabase";
import { raiseAlertClient } from "./clientAlerts";

// FIND-OR-CREATE a vendor by name — the one path that keeps stops/events bound to the vendor book
// without duplicating it (audit P0·2 / P0·3). If a vendor with this name already exists (case-
// insensitive), return it. Otherwise create it as PENDING and ping owners for approval (0191), so a
// venue added on the fly from a truck stop or a meeting note is reviewed, never a silent orphan or a
// second copy. Shared by the calendar quick-add, the stop editor, and the note→ops agent.
export async function findOrCreatePendingVendor(
  name: string,
  opts?: { sort?: number; source?: string },
): Promise<{ id: string; created: boolean } | null> {
  if (!supabase) return null;
  const nm = name.trim();
  if (!nm) return null;
  const { data: found } = await supabase.from("vendors").select("id").ilike("name", nm).limit(1);
  if (found && found.length) return { id: found[0].id as string, created: false };
  const { data: made, error } = await supabase
    .from("vendors")
    .insert({ name: nm, status: "pending", sort: opts?.sort ?? 0 })
    .select("id")
    .single();
  if (error || !made) return null;
  const id = (made as { id: string }).id;
  await raiseAlertClient({
    severity: "important",
    category: "booking",
    kind: "vendor_pending",
    title: `New venue needs approval — ${nm}`,
    body: `Auto-added from ${opts?.source ?? "a truck stop"}. Review the contact details & approve in Plan › Vendors.`,
    link: "/crew?s=plan",
    subjectId: id,
  });
  return { id, created: true };
}
