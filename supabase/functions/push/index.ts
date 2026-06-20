// Supabase Edge Function — sends native Web Push on order/booking changes.
// Triggered by Database Webhooks (orders INSERT/UPDATE, booking_requests INSERT).
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// Deploy: Supabase dashboard → Edge Functions → new function "push" → paste → deploy.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

webpush.setVapidDetails(
  "mailto:hello@gt3pb.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DRINKS: Record<string, string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK", tide: "TIDE", forge: "FORGE", hunt: "HUNT", wild: "WILD" };

// deno-lint-ignore no-explicit-any
async function subsFor(filter: (q: any) => any) {
  const { data } = await filter(supabase.from("push_subscriptions").select("*"));
  return data ?? [];
}

Deno.serve(async (req) => {
  try {
    const { table, type, record } = await req.json();
    let title = "GT3PB", message = "", url = "/";
    // deno-lint-ignore no-explicit-any
    let targets: any[] = [];

    if (table === "orders" && type === "INSERT") {
      const names = (record.items ?? []).map((i: string) => DRINKS[i] ?? i).join(" · ");
      title = "🔔 New order"; message = `${names} — $${(record.total_cents / 100).toFixed(2)}`; url = "/admin";
      targets = await subsFor((q) => q.eq("is_admin", true));
    } else if (table === "orders" && type === "UPDATE" && record.user_id) {
      const msg: Record<string, string> = { preparing: "Your order is being made", ready: "Your order is ready — come grab it!", done: "Order picked up. Enjoy." };
      if (!msg[record.status]) return new Response("skip");
      message = msg[record.status];
      targets = await subsFor((q) => q.eq("user_id", record.user_id));
    } else if (table === "booking_requests" && type === "INSERT") {
      title = "🔔 New booking request"; message = `${record.name ?? "Someone"}${record.event_date ? " · " + record.event_date : ""}`; url = "/admin";
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
