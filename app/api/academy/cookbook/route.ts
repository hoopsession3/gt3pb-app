import { NextResponse } from "next/server";
import { adminFromRequest, staffFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";
import { publishedBook } from "@/lib/recipeBook";
import { PRODUCTS } from "@/lib/academy";

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
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401, headers: PRIVATE });
  // 0476: the PUBLISHED version of each recipe over the built-in one — the same book Ask GT3 answers from — with where each
  // came from (version, date, who published it), the people who can publish, and whether this caller is one of them.
  const book = await publishedBook(tenant);
  const canPublish = !!(await adminFromRequest(req));
  // Each drink's menu name, for the Recipes list (a recipe made in the app carries its own).
  const names = Object.fromEntries(Object.keys(book.cookbook).map((k) => [k, PRODUCTS.find((p) => p.key === k)?.name ?? book.cookbook[k]?.name ?? k]));
  return NextResponse.json({ ok: true, cookbook: book.cookbook, sources: book.sources, publishers: book.publishers, people: book.people, canPublish, names }, { headers: PRIVATE });
}

export const GET = route("academy/cookbook", get);
