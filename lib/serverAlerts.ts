import { supabaseAdmin } from "./supabaseAdmin";

// Raise an in-app alert from a server route: write the inbox row, then fan out via the push
// dispatcher (Teams + web push). BEST-EFFORT by contract — a money/order write must NEVER fail
// because alerting did, so every path is wrapped and swallowed. Mirrors the webhook's helper.
type Severity = "critical" | "important" | "fyi";
export async function raiseAlert(a: { severity: Severity; category: string; title: string; body: string; link?: string }): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const { data } = await supabaseAdmin.from("alerts")
      .insert({ severity: a.severity, category: a.category, title: a.title.slice(0, 180), body: a.body.slice(0, 300), link: a.link ?? "/admin" })
      .select("*").single();
    if (!data) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    await fetch(`${url}/functions/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ table: "alerts", type: "INSERT", record: data }),
    });
  } catch { /* best effort — alerting must never break a money/order write */ }
}
