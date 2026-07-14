import { supabase } from "./supabase";
import { raiseAlertClient } from "./clientAlerts";

// THE one vendor resolver (0226). Every surface that turns a typed name into a vendor — the stop
// editor, the vendor book, booking promote, the pipeline composer, the note→ops agent, the event
// copilot, the calendar quick-add — goes through resolveVendor, so the app has ONE matching rule:
//   1. exact name (case-insensitive) → link the existing vendor;
//   2. ≥40% trigram-similar name(s) → DON'T create; hand back the candidates so the human decides
//      (link it · add it as a location of it · create distinct). The DB guard (0226) backstops
//      any path that skips this — an unconfirmed look-alike insert is refused by Postgres itself.
//   3. no match → create (pending by default, with the owner-approval alert; deliberate surfaces
//      pass status:'approved').
// The old findOrCreatePendingVendor (exact-match-or-create) is gone: exact-or-silently-create is
// how Wine Express became three vendors.

export type VendorMatch = { id: string; name: string; status: string; sim: number };

export type ResolveVendorOutcome =
  | { kind: "linked"; id: string; created: false }
  | { kind: "created"; id: string; created: true; pending: boolean }
  | { kind: "similar"; candidates: VendorMatch[] }
  | { kind: "error"; message: string };

export type ResolveDecision =
  | { linkTo: string }            // the human picked an existing vendor
  | { createDistinct: true };     // the human said "no, this really is a new vendor"

const esc = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export async function similarVendors(name: string, threshold = 0.4): Promise<VendorMatch[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("similar_vendors", { p_name: name, p_threshold: threshold });
  if (error || !data) return [];
  return data as VendorMatch[];
}

export async function resolveVendor(
  name: string,
  opts?: {
    sort?: number;
    source?: string;                      // for the approval alert copy
    status?: "pending" | "approved";      // default 'pending' (owner reviews on-the-fly venues)
    vendorType?: string | null;
    extra?: Record<string, unknown>;      // e.g. booking promote's poc_* fields
    decision?: ResolveDecision;           // the human's answer to a prior 'similar' outcome
  },
): Promise<ResolveVendorOutcome> {
  if (!supabase) return { kind: "error", message: "offline" };
  const nm = name.trim();
  if (!nm) return { kind: "error", message: "no name" };

  // The human already decided: link the existing vendor.
  if (opts?.decision && "linkTo" in opts.decision) return { kind: "linked", id: opts.decision.linkTo, created: false };

  // 1 · exact (case-insensitive) — always links, never asks. ACTIVE vendors only (panel finding:
  // matching an archived vendor would resurrect merged-away dupes and link work to records no
  // list renders — the guard, similar_vendors, and the dupe report all exclude archived; so must this).
  const { data: found } = await supabase.from("vendors").select("id")
    .ilike("name", esc(nm)).is("archived_at", null).neq("status", "archived").limit(1);
  if (found && found.length) return { kind: "linked", id: found[0].id as string, created: false };

  // 2 · look-alikes → the caller shows the confirm sheet (unless the human already said distinct).
  const createDistinct = !!(opts?.decision && "createDistinct" in opts.decision);
  if (!createDistinct) {
    const candidates = await similarVendors(nm);
    if (candidates.length) return { kind: "similar", candidates };
  }

  // 3 · create. confirmed_distinct only when the human explicitly said so — a clean-miss create
  // stays unflagged, and the DB guard re-checks it (covers a race with another session).
  const status = opts?.status ?? "pending";
  const { data: made, error } = await supabase
    .from("vendors")
    .insert({
      name: nm,
      status,
      sort: opts?.sort ?? 0,
      ...(opts?.vendorType ? { vendor_type: opts.vendorType } : {}),
      ...(opts?.extra ?? {}),
      ...(createDistinct ? { confirmed_distinct: true } : {}),
    })
    .select("id")
    .single();
  if (error) {
    // Raced: another session minted a look-alike between our check and the insert — the DB guard
    // caught it. Surface its candidate so the human still gets the choice.
    if (/similar_vendor/.test(error.message)) {
      try {
        const d = JSON.parse((error as { details?: string }).details ?? "{}") as { id?: string; name?: string; sim?: number };
        if (d.id && d.name) return { kind: "similar", candidates: [{ id: d.id, name: d.name, status: "approved", sim: d.sim ?? 0.4 }] };
      } catch { /* fall through to the generic error */ }
      const candidates = await similarVendors(nm);
      if (candidates.length) return { kind: "similar", candidates };
    }
    return { kind: "error", message: error.message };
  }
  const id = (made as { id: string }).id;
  if (status === "pending") {
    await raiseAlertClient({
      severity: "important",
      category: "booking",
      kind: "vendor_pending",
      title: `New venue needs approval — ${nm}`,
      body: `Auto-added from ${opts?.source ?? "a truck stop"}. Review the contact details & approve in Plan › Vendors.`,
      link: "/crew?s=plan",
      subjectId: id,
    });
  }
  return { kind: "created", id, created: true, pending: status === "pending" };
}

// Add a place under an existing vendor (the "same partner, different site" answer on the confirm
// sheet — Wine Express gains a location instead of the book gaining a spelling).
export async function addVendorLocation(
  vendorId: string,
  loc: { label: string; address?: string | null; location_text?: string | null; lat?: number | null; lng?: number | null },
): Promise<{ id: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("vendor_locations")
    .insert({ vendor_id: vendorId, label: loc.label.trim() || "Location", address: loc.address ?? null, location_text: loc.location_text ?? null, lat: loc.lat ?? null, lng: loc.lng ?? null })
    .select("id")
    .single();
  if (error || !data) return null;
  return data as { id: string };
}
