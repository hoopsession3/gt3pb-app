import { NextResponse } from "next/server";
import { adminFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";
import { FLYWHEEL, GOVERNANCE, GTM_PLAYS, STRATEGY_CORE, STRATEGY_REV } from "@/lib/strategyContent";
import type { Playbook } from "@/lib/strategy";

// THE PLAYBOOK, SERVED (IP0 containment, 2026-10-27). GT3's strategy, plays, governance and flywheel left the browser
// bundle — production served them to anyone who opened /playbook. Read here only by owners and admins (is_admin: the
// page's own audience), never cached on the way.
export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store, max-age=0" };

async function get(req: Request) {
  if (!(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: PRIVATE });
  if (!(await tenantFromRequest(req))) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401, headers: PRIVATE });
  const playbook: Playbook = { rev: STRATEGY_REV, core: STRATEGY_CORE, plays: GTM_PLAYS, governance: GOVERNANCE, flywheel: FLYWHEEL };
  return NextResponse.json({ ok: true, playbook }, { headers: PRIVATE });
}

export const GET = route("playbook", get);
