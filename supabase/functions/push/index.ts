// Supabase Edge Function — sends native Web Push on order / subscription / booking changes.
// Triggered by Database Webhooks (orders INSERT/UPDATE, subscriptions UPDATE, booking_requests INSERT).
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// Deploy: Supabase dashboard → Edge Functions → "push" → paste → deploy.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

webpush.setVapidDetails(
  "mailto:hello@gt3pb.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DRINKS: Record<string, string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK", tide: "TIDE", forge: "FORGE", hunt: "HUNT", wild: "WILD" };
const firstName = (full?: string | null) => (full || "").trim().split(/\s+/)[0] || "";

// deno-lint-ignore no-explicit-any
async function subsFor(filter: (q: any) => any) {
  const { data } = await filter(supabase.from("push_subscriptions").select("*"));
  // One send per device — dedup by endpoint so a duplicated row can't double-notify.
  const seen = new Set<string>();
  return (data ?? []).filter((s: { endpoint: string }) => (seen.has(s.endpoint) ? false : (seen.add(s.endpoint), true)));
}

async function nameForUser(userId: string) {
  const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return firstName(data?.display_name);
}

Deno.serve(async (req) => {
  try {
    const { table, type, record, old_record } = await req.json();
    let title = "GT3 Performance Bar", message = "", url = "/";
    // deno-lint-ignore no-explicit-any
    let targets: any[] = [];

    if (table === "orders" && type === "INSERT") {
      const names = (record.items ?? []).map((i: string) => DRINKS[i] ?? i).join(" · ");
      title = "New order";
      message = `${record.customer ? record.customer + " · " : ""}${names} — $${(record.total_cents / 100).toFixed(2)}`;
      url = "/admin";
      targets = await subsFor((q) => q.eq("is_admin", true));

    } else if (table === "orders" && type === "UPDATE" && record.user_id) {
      // Only fire on a real status TRANSITION — this is what stops the duplicate spam
      // when the row is rewritten with the same status (optimistic + reconcile, etc.).
      if (old_record && old_record.status === record.status) return new Response("skip: no transition");
      const name = firstName(record.customer);
      const map: Record<string, string> = {
        preparing: name ? `${name}, we’re making your order now.` : "We’re making your order now.",
        ready: name ? `${name}, your order’s ready — come grab it at the bar.` : "Your order’s ready — come grab it at the bar.",
        // 'done' intentionally sends nothing — they already have it in hand.
      };
      if (!map[record.status]) return new Response("skip");
      message = map[record.status];
      targets = await subsFor((q) => q.eq("user_id", record.user_id));

    } else if (table === "subscriptions" && type === "UPDATE" && record.user_id) {
      if (old_record && old_record.status === record.status) return new Response("skip: no transition");
      const name = await nameForUser(record.user_id);
      const map: Record<string, string> = {
        active: name ? `${name}, your subscription’s live — your cups are ready when you are.` : "Your subscription’s live — your cups are ready when you are.",
        past_due: name ? `${name}, your subscription payment didn’t go through — update your card to keep your cups coming.` : "Your subscription payment didn’t go through — update your card to keep your cups coming.",
      };
      if (!map[record.status]) return new Response("skip");
      message = map[record.status];
      url = "/3mpire";
      targets = await subsFor((q) => q.eq("user_id", record.user_id));

    } else if (table === "booking_requests" && type === "INSERT") {
      title = "New booking request";
      message = `${record.name ?? "Someone"}${record.event_date ? " · " + record.event_date : ""}`;
      url = "/admin";
      targets = await subsFor((q) => q.eq("is_admin", true));

    } else {
      return new Response("skip");
    }

    const payload = JSON.stringify({ title, body: message, url });
    await Promise.all(targets.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }));
    return new Response("ok");
  } catch (e) {
    return new Response("err: " + e, { status: 500 });
  }
});
