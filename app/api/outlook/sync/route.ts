import { NextResponse } from "next/server";
import { ownerFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refresh, graph, eventToGraph, graphToEvent, outlookConfigured } from "@/lib/msgraph";
import { route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";

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
    const kept = await supabaseAdmin.from("outlook_connection").update({
      access_token: t.access_token, refresh_token: t.refresh_token ?? data.refresh_token,
      expires_at: new Date(Date.now() + ((t.expires_in || 3600) - 60) * 1000).toISOString(),
    }).eq("id", 1);
    // This run has its token either way; a refreshed token not kept is said (R12b, F4) — Microsoft may have retired the
    // old refresh token with this answer, and the next sync would fail with nothing in the log to say why.
    if (kept.error) console.error(`outlook: refreshed the token but couldn't keep it — ${kept.error.message}`);
  }
  return { token: token!, base: data.calendar_id ? `/me/calendars/${data.calendar_id}` : "/me" };
}

async function post(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // THE CALLER'S OWN CALENDAR (R15, 2026-10-17 — the 10/10 audit, API F24). The sync read and wrote events with no tenant:
  // every tenant's events — private bookings included — went to whichever Outlook was connected. It reads, maps and pulls
  // the owner's own tenant's. (The connection itself is still one per deployment — outlook_connection has no tenant —
  // which is right while there is one; 0305's guard blocks a second until it is.)
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401 });
  if (!outlookConfigured()) return NextResponse.json({ ok: false, error: "Outlook isn't configured." }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let conn;
  try { conn = await validToken(); } catch (e) { return NextResponse.json({ ok: false, error: `Token refresh failed: ${errorMessage(e, 200)}` }, { status: 502 }); }
  if (!conn) return NextResponse.json({ ok: false, error: "Outlook isn't connected yet." }, { status: 400 });
  const { token, base } = conn;

  const now = new Date().toISOString();
  const fromD = new Date(Date.now() - 7 * 864e5), toD = new Date(Date.now() + 120 * 864e5);
  const fromDay = fromD.toISOString().slice(0, 10), toDay = toD.toISOString().slice(0, 10);
  let pushed = 0, updated = 0, pulled = 0, unmapped = 0;

  try {
    // ── PUSH: our events → Outlook ──
    const { data: ours, error: oursErr } = await supabaseAdmin.from("events")
      .select("id, title, day, day_label, location_text, blurb, outlook_event_id")
      .eq("tenant_id", tenant).is("archived_at", null).not("day", "is", null).gte("day", fromDay).lte("day", toDay).limit(100);
    // A calendar that could not be read is not an empty one: "Pushed 0" would say the sync ran (R15).
    if (oursErr) return NextResponse.json({ ok: false, error: "Couldn't read the calendar just now — try again." }, { status: 503 });
    for (const e of (ours ?? []) as any[]) {
      const body = JSON.stringify(eventToGraph(e));
      if (e.outlook_event_id) {
        try { await graph(token, `${base}/events/${e.outlook_event_id}`, { method: "PATCH", body }); updated++; } catch { /* skip one */ }
      } else {
        try {
          const g = await graph(token, `${base}/events`, { method: "POST", body });
          if (g?.id) {
            // Pushed, and remembered as pushed — or taken back (R12b, F4): an event in Outlook with no mapping here was
            // pushed again on the next sync, a duplicate each time.
            const mapped = await supabaseAdmin.from("events").update({ outlook_event_id: g.id, outlook_synced_at: now }).eq("tenant_id", tenant).eq("id", e.id);
            if (mapped.error) { unmapped++; try { await graph(token, `${base}/events/${g.id}`, { method: "DELETE" }); } catch { /* the next sync says it again */ } }
            else pushed++;
          }
        } catch { /* skip one */ }
      }
    }

    // ── PULL: Outlook events we don't own → our calendar ──
    const view = await graph(token, `${base}/calendarView?startDateTime=${fromD.toISOString()}&endDateTime=${toD.toISOString()}&$top=100&$select=id,subject,start,end,location,categories`);
    const items: any[] = view?.value ?? [];
    const { data: mapped, error: mappedErr } = await supabaseAdmin.from("events").select("outlook_event_id").eq("tenant_id", tenant).not("outlook_event_id", "is", null);
    // Which Outlook events are already ours, or the pull stops (R15): an unread list is an empty one, and every event in
    // the window would be pulled in again as a copy.
    if (mappedErr) return NextResponse.json({ ok: false, error: "Pushed — but couldn't read which Outlook events are already here, so nothing was pulled. Try again." }, { status: 503 });
    const known = new Set((mapped ?? []).map((m: any) => m.outlook_event_id));
    for (const g of items) {
      if (!g?.id || known.has(g.id)) continue;                       // already mapped (ours or previously pulled)
      if (Array.isArray(g.categories) && g.categories.includes("GT3")) continue; // ours, not yet mapped — skip
      const ev = graphToEvent(g);
      if (!ev.day) continue;
      const { error } = await supabaseAdmin.from("events").insert({
        tenant_id: tenant, title: (ev.title || "Outlook event").slice(0, 200), day: ev.day, category: "admin",
        location_text: ev.location_text, outlook_event_id: ev.outlook_event_id, outlook_synced_at: now,
      });
      if (!error) pulled++;
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessage(e, 300) }, { status: 502 });
  }

  const note = `Pushed ${pushed}, updated ${updated}, pulled ${pulled}${unmapped ? ` · ${unmapped} not pushed (couldn't keep the link — next sync tries again)` : ""}`;
  const noted = await supabaseAdmin.from("outlook_connection").update({ last_sync_at: now, last_sync_note: note }).eq("id", 1);
  if (noted.error) console.warn(`outlook: synced, but the sync's note wasn't kept — ${noted.error.message}`);
  return NextResponse.json({ ok: true, pushed, updated, pulled, unmapped, note });
}

export const POST = route("outlook/sync", post);
