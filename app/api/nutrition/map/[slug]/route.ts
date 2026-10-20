import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { callerClient, staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { route } from "@/lib/apiRoute";
import { proMap } from "@/lib/nutrition";

// A COURSE MAP, TO A BUYER (R44; R45 turned which maps round). The Rookie maps are the course's — GT3 Nutrition, the
// purchase (the owner's call, 2026-10-20: "rookies shouldn't be free, only the pillars"). They are not public files: this
// route hands one over only to the crew (they write the course) or to a customer with a live GT3 Nutrition purchase
// (program_access tier pro, 0271 — read as the caller, so the database's own rule says whose row it is). Anyone else is
// told it is part of GT3 Nutrition, not that it is missing. The files are kept in content/nutrition/pro
// (next.config's outputFileTracingIncludes ships them with this route). The free maps are public files; lib/nutrition
// MAPS says which is which.

async function memberHasPro(req: Request, userId: string): Promise<boolean> {
  const sb = callerClient(req);
  if (!sb) return false;
  const { data: cust } = await sb.from("customers").select("id").eq("user_id", userId).maybeSingle();
  const cid = (cust as { id?: string } | null)?.id;
  if (!cid) return false;
  const { data } = await sb.from("program_access").select("tier").eq("customer_id", cid).eq("tier", "pro").is("revoked_at", null).limit(1);
  return !!(data as unknown[] | null)?.length;
}

async function get(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const map = proMap(slug);
  if (!map) return Response.json({ ok: false, error: "There is no map by that name." }, { status: 404 });
  const user = await userFromRequest(req);
  if (!user) return Response.json({ ok: false, error: "Sign in to download the Pro maps." }, { status: 401 });
  const allowed = (await staffFromRequest(req)) || (await memberHasPro(req, user.id));
  if (!allowed) return Response.json({ ok: false, error: "This map is part of GT3 Nutrition." }, { status: 403 });
  const bytes = await readFile(join(process.cwd(), "content", "nutrition", "pro", map.file));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="GT3 Nutrition - ${map.title.replace(/[^\w ·.-]/g, "").replace(/·/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export const GET = route("nutrition/map", get);
