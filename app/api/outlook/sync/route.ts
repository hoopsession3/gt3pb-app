import { NextResponse } from "next/server";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refresh, graph, eventToGraph, graphToEvent, outlookConfigured } from "@/lib/msgraph";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// OUTLOOK TWO-WAY SYNC (owner-only). Push our events → Outlook (create/update, mapped by
// outlook_event_id so it's idempotent) and pull Outlook events we don't own → our calendar as
// 'admin' items. Window: 7 days back to 120 ahead. Refreshes the access token when expired.

async function validToken(): Promise<{ token: string; base: string } | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from("outlook_connection").select("*").eq("id", 1).maybeSingle();
  if (!data?.refresh_token) return null;
  let token: string | null = data.access_token ?? null;
  const exp = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (!token || exp < Date.now()) {
    const t = await refresh(data.refresh_token);
    token = t.access_token;
    await supabaseAdmin.from("outlook_connection").update({
      access_token: t.access_token, refresh_token: t.refresh_token ?? data.refresh_token,
      expires_at: new Date(Date.now() + ((t.expires_in || 3600) - 60) * 1000).toISOString(),
    }).eq("id", 1);
  }
  return { token: token!, base: data.calendar_id ? `/me/calendars/${data.calendar_id}` : "/me" };
}

export async function POST(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!outlookConfigured()) return NextResponse.json({ ok: false, error: "Outlook isn't configured." }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let conn;
  try { conn = await validToken(); } catch (e: any) { return NextResponse.json({ ok: false, error: `Token refresh failed: ${String(e?.message ?? e).slice(0, 200)}` }, { status: 502 }); }
  if (!conn) return NextResponse.json({ ok: false, error: "Outlook isn't connected yet." }, { status: 400 });
  const { token, base } = conn;

  const now = new Date().toISOString();
  const fromD = new Date(Date.now() - 7 * 864e5), toD = new Date(Date.now() + 120 * 864e5);
  const fromDay = fromD.toISOString().slice(0, 10), toDay = toD.toISOString().slice(0, 10);
  let pushed = 0, updated = 0, pulled = 0;

  try {
    // ── PUSH: our events → Outlook ──
    const { data: ours } = await supabaseAdmin.from("events")
      .select("id, title, day, day_label, location_text, blurb, outlook_event_id")
      .is("archived_at", null).not("day", "is", null).gte("day", fromDay).lte("day", toDay).limit(100);
    for (const e of (ours ?? []) as any[]) {
      const body = JSON.stringify(eventToGraph(e));
      if (e.outlook_event_id) {
        try { await graph(token, `${base}/events/${e.outlook_event_id}`, { method: "PATCH", body }); updated++; } catch { /* skip one */ }
      } else {
        try {
          const g = await graph(token, `${base}/events`, { method: "POST", body });
          if (g?.id) { await supabaseAdmin.from("events").update({ outlook_event_id: g.id, outlook_synced_at: now }).eq("id", e.id); pushed++; }
        } catch { /* skip one */ }
      }
    }

    // ── PULL: Outlook events we don't own → our calendar ──
    const view = await graph(token, `${base}/calendarView?startDateTime=${fromD.toISOString()}&endDateTime=${toD.toISOString()}&$top=100&$select=id,subject,start,end,location,categories`);
    const items: any[] = view?.value ?? [];
    const { data: mapped } = await supabaseAdmin.from("events").select("outlook_event_id").not("outlook_event_id", "is", null);
    const known = new Set((mapped ?? []).map((m: any) => m.outlook_event_id));
    for (const g of items) {
      if (!g?.id || known.has(g.id)) continue;                       // already mapped (ours or previously pulled)
      if (Array.isArray(g.categories) && g.categories.includes("GT3")) continue; // ours, not yet mapped — skip
      const ev = graphToEvent(g);
      if (!ev.day) continue;
      const { error } = await supabaseAdmin.from("events").insert({
        title: (ev.title || "Outlook event").slice(0, 200), day: ev.day, category: "admin",
        location_text: ev.location_text, outlook_event_id: ev.outlook_event_id, outlook_synced_at: now,
      });
      if (!error) pulled++;
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }

  const note = `Pushed ${pushed}, updated ${updated}, pulled ${pulled}`;
  await supabaseAdmin.from("outlook_connection").update({ last_sync_at: now, last_sync_note: note }).eq("id", 1);
  return NextResponse.json({ ok: true, pushed, updated, pulled, note });
}
