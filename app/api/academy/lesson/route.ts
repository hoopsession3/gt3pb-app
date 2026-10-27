import { NextResponse } from "next/server";
import { adminFromRequest, staffFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";
import { LESSONS } from "@/lib/academyLessons";
import { lessonClass } from "@/lib/academyClass";

// A LESSON, SERVED (IP0b containment, 2026-10-28). What each Academy module teaches — its sections, its knowledge check
// and the answers, the founders' note — left the browser bundle: production served all of it to anyone who opened
// /academy. Read here one lesson at a time, only for a signed-in member of staff (the Academy's audience), never cached.
//
// A RESTRICTED lesson (lib/academyClass: process specifics) answers the recipe audience — RESTRICTED_AUDIENCE, staff today,
// owners and admins in one line once Ryan decides who may read recipes (the same decision as the cookbook's).
const RESTRICTED_AUDIENCE: "staff" | "admin" = "staff";
export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store, max-age=0" };

async function get(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: PRIVATE });
  if (!(await tenantFromRequest(req))) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401, headers: PRIVATE });
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  const lesson = Object.prototype.hasOwnProperty.call(LESSONS, slug) ? LESSONS[slug] : null;
  if (!lesson) return NextResponse.json({ ok: false, error: "no such lesson" }, { status: 404, headers: PRIVATE });
  if (lessonClass(slug) === "restricted" && RESTRICTED_AUDIENCE === "admin" && !(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: PRIVATE });
  return NextResponse.json({ ok: true, lesson }, { headers: PRIVATE });
}

export const GET = route("academy/lesson", get);
