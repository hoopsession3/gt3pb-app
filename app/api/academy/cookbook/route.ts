import { NextResponse } from "next/server";
import { adminFromRequest, staffFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";
import { COOKBOOK } from "@/lib/academyCookbook";

// THE COOKBOOK, SERVED (IP0 containment, 2026-10-27). The recipes, ratios and process specs left the Academy's browser
// bundle — production served every one of them to anyone who opened /academy, signed in or not. They are read here,
// only for a signed-in caller the database says may read them, and never cached on the way.
//
// COOKBOOK_AUDIENCE is who that is. "staff" is the Academy's own audience today (is_staff: every role but member). Ryan's
// open decision — owners only, or owners plus named brewers — narrows it here: "admin" is owners and admins.
const COOKBOOK_AUDIENCE: "staff" | "admin" = "staff";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store, max-age=0" };

async function get(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: PRIVATE });
  if (COOKBOOK_AUDIENCE === "admin" && !(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: PRIVATE });
  // The cookbook is GT3's own, in code — one tenant today. A caller with no tenant on the session gets nothing (R-002).
  if (!(await tenantFromRequest(req))) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401, headers: PRIVATE });
  return NextResponse.json({ ok: true, cookbook: COOKBOOK }, { headers: PRIVATE });
}

export const GET = route("academy/cookbook", get);
