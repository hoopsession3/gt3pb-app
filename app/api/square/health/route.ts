import { NextResponse } from "next/server";
import { SQUARE_BASE, squareHeaders, squareDeadline } from "@/lib/squareServer";
import { ownerFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";

// Card-connection check (owner-gated). The Web SDK's init failure is one generic sentence with
// zero visibility; this asks Square directly with the SERVER token and reports the exact
// mismatch in plain words. The token itself never leaves this route — only booleans and
// location ids (which are public client values anyway).
async function get(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "Owners only." }, { status: 403 });

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const appId = process.env.NEXT_PUBLIC_SQUARE_APP_ID || "";
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID || "";

  const appEnv = appId.startsWith("sandbox-") ? "sandbox" : appId.startsWith("sq0idp-") ? "production" : appId ? "unknown" : "missing";
  const checks: { name: string; ok: boolean; note: string }[] = [
    { name: "Server token", ok: Boolean(token), note: token ? "present" : "SQUARE_ACCESS_TOKEN is not set in the host env" },
    { name: "App ID", ok: Boolean(appId), note: appId ? `${appEnv} app` : "NEXT_PUBLIC_SQUARE_APP_ID is not set" },
    { name: "Location ID", ok: Boolean(locationId), note: locationId || "NEXT_PUBLIC_SQUARE_LOCATION_ID is not set" },
    // One side, from the app ID (R14 — the 10/10 audit, F5): the card form (lib/square) and the charges (lib/squareServer)
    // both follow its prefix. NEXT_PUBLIC_SQUARE_ENV is retired — this check read it, and called a production app red
    // whenever the retired variable was unset.
    { name: "Environment", ok: appEnv === "sandbox" || appEnv === "production" || appEnv === "missing", note: appEnv === "unknown" ? "the app ID is neither a sandbox- nor a production (sq0idp-) ID — check it in Square's developer dashboard" : appEnv === "missing" ? "follows the app ID, once it is set" : `${appEnv} — the card form and the charges both follow the app ID` },
  ];

  if (token) {
    try {
      const res = await fetch(`${SQUARE_BASE}/v2/locations`, { headers: squareHeaders(token), cache: "no-store", signal: squareDeadline() });
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

export const GET = route("square/health", get);
