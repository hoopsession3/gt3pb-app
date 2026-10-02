import { NextResponse } from "next/server";
import { staffFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canvaEnabled, canvaAutofill, canvaExport } from "@/lib/canva";
import { route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";

export const runtime = "nodejs";
export const maxDuration = 60;

// Studio → Canva. action "design": autofill the GT3 brand template from the piece's copy and save
// the editable design link. action "export": render the finished design to a PNG and save its URL.
async function post(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // R-002: the service role bypasses RLS, so a content_id from the request body has to be
  // proven to belong to the caller's tenant rather than assumed. With the filter, an id from
  // another tenant reads nothing and updates nothing instead of reading and updating theirs.
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401 });
  if (!canvaEnabled()) return NextResponse.json({ ok: false, error: "Canva not configured (set CANVA_ACCESS_TOKEN + CANVA_BRAND_TEMPLATE_ID)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let content_id = "", action = "design";
  try { ({ content_id = "", action = "design" } = await req.json()); } catch { /* */ }
  if (!content_id) return NextResponse.json({ ok: false, error: "content_id required" }, { status: 400 });

  const { data: item } = await supabaseAdmin.from("content_items").select("id, title, hook, caption, canva_design_id").eq("id", content_id).eq("tenant_id", tenant).maybeSingle();
  if (!item) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  try {
    if (action === "export") {
      if (!item.canva_design_id) return NextResponse.json({ ok: false, error: "make the design first" }, { status: 400 });
      const url = await canvaExport(item.canva_design_id, "png");
      await supabaseAdmin.from("content_items").update({ export_url: url }).eq("id", content_id).eq("tenant_id", tenant);
      return NextResponse.json({ ok: true, export_url: url });
    }
    const { id, editUrl } = await canvaAutofill({ title: item.title || "", hook: item.hook || "", caption: item.caption || "" });
    await supabaseAdmin.from("content_items").update({ canva_design_id: id, canva_edit_url: editUrl }).eq("id", content_id).eq("tenant_id", tenant);
    return NextResponse.json({ ok: true, canva_design_id: id, canva_edit_url: editUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessage(e, 300) }, { status: 502 });
  }
}

export const POST = route("studio/canva", post);
