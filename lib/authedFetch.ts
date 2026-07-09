import { supabase } from "./supabase";

// One fetch wrapper for the customer commerce surfaces (Checkout, OrderFunnel, SubscriptionCard)
// that each hand-rolled the same "pull the access token off the current session, attach it as a
// bearer header" block before every POST. A signed-out guest just gets no Authorization header —
// every consumer here already treats that as "guest checkout," not an error, so this stays silent
// rather than throwing.
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  const headers = { ...(init.headers || {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
  return fetch(url, { ...init, headers });
}
