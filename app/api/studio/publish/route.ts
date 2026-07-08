import { NextResponse } from "next/server";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { webflowEnabled, webflowPublish, webflowUnpublish } from "@/lib/webflow";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// Studio → Webflow. Publishes the piece to the GT3 site as a CMS item + publishes the site, marks
// the piece published, and saves the live URL. Outward-facing — intended for owners/leadership.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (s: string) => (s || "").split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

export async function POST(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!webflowEnabled()) return NextResponse.json({ ok: false, error: "Webflow not configured (set WEBFLOW_API_TOKEN + WEBFLOW_SITE_ID + WEBFLOW_COLLECTION_ID)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let content_id = "", action = "publish";
  try { ({ content_id = "", action = "publish" } = await req.json()); } catch { /* */ }
  if (!content_id) return NextResponse.json({ ok: false, error: "content_id required" }, { status: 400 });

  const { data: item } = await supabaseAdmin.from("content_items").select("id, title, caption, webflow_item_id").eq("id", content_id).maybeSingle();
  if (!item) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // The reverse gear: pull the piece off the live site (the Webflow item survives as a draft —
  // recoverable), clear the live URL, and step the workflow back to approved.
  if (action === "unpublish") {
    if (!item.webflow_item_id) return NextResponse.json({ ok: false, error: "not on the site" }, { status: 400 });
    try {
      await webflowUnpublish(item.webflow_item_id);
      await supabaseAdmin.from("content_items").update({ published_url: null, status: "approved" }).eq("id", content_id);
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
    }
  }

  try {
    const { itemId, slug } = await webflowPublish(item.title || "Untitled", toHtml(item.caption || ""));
    const base = process.env.WEBFLOW_PUBLIC_BASE || ""; // e.g. https://gt3pb.com/blog/
    const published_url = base ? `${base.replace(/\/$/, "")}/${slug}` : slug;
    await supabaseAdmin.from("content_items").update({ webflow_item_id: itemId, published_url, status: "published" }).eq("id", content_id);
    return NextResponse.json({ ok: true, webflow_item_id: itemId, published_url });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
