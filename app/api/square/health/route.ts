import { NextResponse } from "next/server";
import { SQUARE_BASE, squareHeaders } from "@/lib/squareServer";
import { ownerFromRequest } from "@/lib/apiAuth";

// Card-connection check (owner-gated). The Web SDK's init failure is one generic sentence with
// zero visibility; this asks Square directly with the SERVER token and reports the exact
// mismatch in plain words. The token itself never leaves this route — only booleans and
// location ids (which are public client values anyway).
export async function GET(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "Owners only." }, { status: 403 });

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const appId = process.env.NEXT_PUBLIC_SQUARE_APP_ID || "";
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID || "";
  const env = process.env.NEXT_PUBLIC_SQUARE_ENV || "sandbox";

  const appEnv = appId.startsWith("sandbox-") ? "sandbox" : appId.startsWith("sq0idp-") ? "production" : appId ? "unknown" : "missing";
  const checks: { name: string; ok: boolean; note: string }[] = [
    { name: "Server token", ok: Boolean(token), note: token ? "present" : "SQUARE_ACCESS_TOKEN is not set in the host env" },
    { name: "App ID", ok: Boolean(appId), note: appId ? `${appEnv} app` : "NEXT_PUBLIC_SQUARE_APP_ID is not set" },
    { name: "Location ID", ok: Boolean(locationId), note: locationId || "NEXT_PUBLIC_SQUARE_LOCATION_ID is not set" },
    { name: "Environment", ok: appEnv === env || appEnv === "missing", note: appEnv === env ? env : `app ID looks ${appEnv} but NEXT_PUBLIC_SQUARE_ENV is ${env} — the card form loads the ${env} SDK` },
  ];

  if (token) {
    try {
      const res = await fetch(`${SQUARE_BASE}/v2/locations`, { headers: squareHeaders(token), cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        checks.push({ name: "Square account", ok: false, note: data?.errors?.[0]?.detail || `Square answered ${res.status} — the token may be for the other environment (${SQUARE_BASE.includes("sandbox") ? "sandbox" : "production"} API)` });
      } else {
        const locs = ((data?.locations ?? []) as { id: string; name?: string; status?: string }[]).map((l) => ({ id: l.id, name: l.name ?? "", status: l.status ?? "" }));
        const hit = locs.find((l) => l.id === locationId);
        checks.push({ name: "Square account", ok: true, note: `${locs.length} location${locs.length === 1 ? "" : "s"} on the account` });
        checks.push({
          name: "Location match",
          ok: Boolean(hit && hit.status === "ACTIVE"),
          note: hit ? (hit.status === "ACTIVE" ? `${hit.name} (${hit.id}) — active` : `${hit.name} is ${hit.status}`)
            : `${locationId || "(none)"} is not on this account — its locations: ${locs.map((l) => `${l.id} (${l.name})`).join(", ") || "none"}`,
        });
      }
    } catch {
      checks.push({ name: "Square account", ok: false, note: "Couldn't reach Square from the server — try again." });
    }
  }

  return NextResponse.json({ ok: checks.every((c) => c.ok), checks });
}
