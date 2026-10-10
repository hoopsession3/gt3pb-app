import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { route } from "@/lib/apiRoute";
import { callerKey, mapsConfigured, snapshot } from "@/lib/appleMaps";
import { isUuid } from "@/lib/uuid";

// public: the map image of a public stop's or event's own place on Find Us, from Apple Maps — by the row's id, never a point a caller names; bounded in the shared store
// THE MAP ON FIND US (2026-10-10, Find Us 10). The page asks for the picture of the place it already shows — the
// field_ops row by its id — and this reads that row's own pin and hands back Apple's image (lib/appleMaps snapshot).
// A caller cannot name a point: an id that is not a public row with a pin is a 404, so this is no free Apple Maps
// for anyone else. The image is the same for everyone until the pin moves (the page puts the pin in the address it
// asks for, `v`), so the CDN keeps it a day and Apple is asked about once a stop. Past the CDN, the limiter
// (rate_limit_hit, 0154): 60 a minute for one caller, 600 an hour for the app — Apple's free tier is 25,000 a day.
const PER_CALLER = { windowMs: 60_000, max: 60 };
const PER_APP = { windowMs: 3_600_000, max: 600 };
const none = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

async function get(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("stop") ?? "";
  if (!isUuid(id) || !mapsConfigured() || !supabaseAdmin) return none(404);
  const [mine, all] = await Promise.all([
    supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `map:${callerKey(req)}`, p_window_ms: PER_CALLER.windowMs, p_max: PER_CALLER.max }),
    supabaseAdmin.rpc("rate_limit_hit", { p_bucket: "map:all", p_window_ms: PER_APP.windowMs, p_max: PER_APP.max }),
  ]);
  if (mine.data === false || all.data === false) return none(429);
  // scoped-by: is_public — only a public row, one a storefront shows anyone signed out, answers, and only with Apple's
  // picture of its own pin; a private row of any tenant, or no row, is the same 404.
  const { data } = await supabaseAdmin.from("field_ops").select("lat, lng").eq("id", id).eq("is_public", true).maybeSingle();
  const lat = Number(data?.lat), lng = Number(data?.lng);
  if (!data || !Number.isFinite(lat) || !Number.isFinite(lng) || data.lat == null || data.lng == null) return none(404);
  const img = await snapshot({ lat, lng, scheme: u.searchParams.get("scheme") === "light" ? "light" : "dark" }).catch(() => null);
  if (!img) return none(502);
  return new Response(img.body, { headers: { "content-type": img.type, "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } });
}

export const GET = route("map", get);
