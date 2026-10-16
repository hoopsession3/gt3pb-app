import { supabase } from "./supabase";
import { apiUrl } from "./native";
import { ROUTE_DEADLINE_MS, withDeadline } from "./deadline";

// One fetch wrapper for the customer commerce surfaces (Checkout, OrderFunnel, SubscriptionCard)
// that each hand-rolled the same "pull the access token off the current session, attach it as a
// bearer header" block before every POST. A signed-out guest just gets no Authorization header —
// every consumer here already treats that as "guest checkout," not an error, so this stays silent
// rather than throwing.
//
// In the iPhone app the /api routes are on the web, not beside the page (2026-10-06): apiUrl makes
// the address absolute there and leaves it exactly as it was on the web (lib/native).
//
// A deadline on every call (R11, lib/deadline): ROUTE_DEADLINE_MS unless the caller names a tighter one — the payment POSTs
// pass PAY_DEADLINE_MS, so a charge whose answer never comes says "tap Pay to retry" instead of holding the sheet shut.
export async function authedFetch(url: string, init: RequestInit = {}, opts: { deadlineMs?: number } = {}): Promise<Response> {
  const accessToken = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  const headers = { ...(init.headers || {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
  return withDeadline(opts.deadlineMs ?? ROUTE_DEADLINE_MS)(apiUrl(url), { ...init, headers });
}
