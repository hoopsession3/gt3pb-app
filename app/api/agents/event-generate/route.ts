import { NextResponse } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { claimSafeDeep } from "@/lib/claimGuard";
import { addDays, dayFromKey, etToday, weekdayOf } from "@/lib/dates";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// EVENT GENERATOR — from a few notes ("me & Kayla talked about the Beltline event and Mercedes-Benz
// Buckhead this weekend"), draft a full plan: the events, a team COLLABORATION NOTE (house-format
// recap), and an ACTION-ITEM to-do list linked to the right event. Two phases, both staff-gated:
//   • preview  → POST { notes }            → returns the proposed plan (no writes)
//   • commit   → POST { commit: <plan> }   → writes events + note + todos, all relationally linked

const CATS = ["admin", "ops", "event", "content"];

const TOOL: ToolDef = {
  name: "event_plan",
  description: "Turn the notes into events, a collaboration note, and an action-item to-do list.",
  input_schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        description: "Each distinct event OR truck stop mentioned. Resolve relative dates ('this weekend') against the provided calendar.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            kind: { type: "string", enum: ["event", "stop"], description: "'stop' = the truck physically parks and serves on the ground (market, run club, pop-up, vending spot). 'event' = a booked show / gig / party / catering. When in doubt or the user says 'add a stop', use 'stop'." },
            date: { type: "string", description: "YYYY-MM-DD, or empty if truly unknown." },
            day_label: { type: "string", description: "Short label like SAT/SUN." },
            location: { type: "string", description: "Venue / area if mentioned." },
            state: { type: "string", description: "2-letter state if known (e.g. GA), else empty." },
            county: { type: "string", description: "County/city if known, else empty." },
            blurb: { type: "string", description: "One line on the event/stop — menu/setup notes captured from the discussion." },
          },
          required: ["title"],
        },
      },
      collaboration_note: {
        type: "object",
        description: "A note to anchor team collaboration on this planning.",
        properties: {
          title: { type: "string" },
          summary: { type: "string", description: "Markdown recap in GT3 house format: a '## Action Items' block (bold title + one-line description) then '## 1. Topic' sections with bullets. Grounded only in the notes." },
        },
        required: ["title", "summary"],
      },
      action_items: {
        type: "array",
        description: "Concrete to-dos from the discussion. Link each to the event it serves via event_index (0-based into events), or null if general.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Imperative and specific." },
            category: { type: "string", enum: CATS },
            event_index: { type: ["integer", "null"], description: "Index into events[], or null." },
          },
          required: ["title", "category"],
        },
      },
    },
    required: ["events", "collaboration_note", "action_items"],
  },
};

// Takes a day KEY, not a Date. The previous version read the server's clock three times —
// getDay(), getDate() and toISOString() — all of which are UTC on Vercel. On a Saturday evening
// the server already believes it is Sunday, so "the coming Saturday" resolved a WEEK late.
function weekendDates(todayKey: string) {
  const sat = addDays(todayKey, (6 - dayFromKey(todayKey).getDay() + 7) % 7);
  return { sat, sun: addDays(sat, 1) };
}

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  // ── COMMIT: write the (reviewed) plan ──
  if (body.commit) {
    const plan = body.commit;
    const user = await userFromRequest(req);
    const created: any = { events: [], note: null, todos: 0 };
    try {
      // 1) events + truck stops — a 'stop' is the truck on the ground (→ stops table, dated via
      //    starts_at so it shows on the route); an 'event' is a booked show (→ events table).
      const eventIds: (string | null)[] = []; // only events get an id here (action items FK to events)
      for (const e of (plan.events ?? [])) {
        if (e._skip) { eventIds.push(null); continue; }
        if (e.kind === "stop") {
          const startsAt = e.date ? new Date(`${e.date}T11:00:00-04:00`).toISOString() : null; // 11a ET default
          const { data } = await supabaseAdmin.from("stops").insert({
            name: String(e.title || "New stop").slice(0, 200), location_text: e.location || null,
            starts_at: startsAt, status: "upcoming", notes: e.blurb || null, sort: 0,
          }).select("id, name").single();
          eventIds.push(null);
          if (data) created.events.push({ id: data.id, title: data.name, kind: "stop" });
          continue;
        }
        const { data } = await supabaseAdmin.from("events").insert({
          title: String(e.title || "New event").slice(0, 200), day: e.date || null, day_label: e.day_label || null,
          location_text: e.location || null, state: e.state || null, county: e.county || null, blurb: e.blurb || null,
          category: "event", sort: 0,
        }).select("id, title").single();
        if (data) { eventIds.push(data.id); created.events.push({ id: data.id, title: data.title, kind: "event" }); } else eventIds.push(null);
      }
      // 2) collaboration note (anchored to the first event)
      let noteId: string | null = null;
      if (plan.collaboration_note?.title) {
        const { data } = await supabaseAdmin.from("meeting_notes").insert({
          title: String(plan.collaboration_note.title).slice(0, 200), summary: plan.collaboration_note.summary || null,
          met_on: etToday(), source: "manual",
          event_id: eventIds.find(Boolean) ?? null, created_by: user?.id ?? null,
        }).select("id, title").single();
        if (data) { noteId = data.id; created.note = { id: data.id, title: data.title }; }
      }
      // 3) action items → todos, linked to event + note
      const rows = (plan.action_items ?? []).filter((a: any) => !a._skip && a.title?.trim()).map((a: any) => {
        const idx = typeof a.event_index === "number" ? a.event_index : null;
        const ev = idx != null ? plan.events?.[idx] : null;
        return {
          title: String(a.title).slice(0, 300), category: CATS.includes(a.category) ? a.category : "ops",
          due_on: ev?.date || null, event_id: (idx != null ? eventIds[idx] : null) ?? null,
          meeting_note_id: noteId, created_by: user?.id ?? null,
        };
      });
      if (rows.length) { const { data } = await supabaseAdmin.from("todos").insert(rows).select("id"); created.todos = data?.length ?? 0; }
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
    }
    return NextResponse.json({ ok: true, created });
  }

  // ── PREVIEW: draft the plan from notes ──
  const notes = String(body.notes ?? "").slice(0, 8000);
  if (!notes.trim()) return NextResponse.json({ ok: false, error: "notes required" }, { status: 400 });
  const todayIso = etToday();
  const dow = weekdayOf(todayIso);
  const { sat, sun } = weekendDates(todayIso);

  let plan: any = null;
  try {
    const r = await callClaude({ label: "event-generate",
      model: MODELS.sonnet, maxTokens: 1800, temperature: 0.2,
      system: `You are the planning agent for GT3 Performance Bar, a mobile beverage truck run by a small owner-led crew. Turn casual planning notes into a clean, structured plan: the events AND truck stops discussed, a team collaboration note (GT3 house format — a '## Action Items' block then numbered '## N. Topic' sections), and concrete action-item to-dos linked to the right item. Classify each item with kind: a 'stop' is the truck physically parking and serving on the ground (market, run club, pop-up, vending spot — these go on the public route); an 'event' is a booked show / gig / party / catering. If the user says "add a stop" or describes the truck setting up somewhere, use kind 'stop'. Be grounded: only what's in the notes — never invent venues, dates, or tasks. Use real GT3 menu names if mentioned (Nature Aide, salted maple latte, nitro cold brew). Today is ${dow}, ${todayIso}. "This weekend" = Saturday ${sat} and Sunday ${sun}. Always answer with the event_plan tool.`,
      messages: [{ role: "user", content: notes }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "event_plan" },
    });
    plan = r.toolUses.find((t) => t.name === "event_plan")?.input ?? null;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
  if (!plan) return NextResponse.json({ ok: false, error: "no plan" }, { status: 502 });
  // Deterministic backstop (F5 — output claim-guard): event blurbs can reach public listings and the
  // collaboration note is a stored, re-read record — hold the whole plan to the bar before it previews.
  const guard = claimSafeDeep(plan);
  if (!guard.ok) {
    console.warn(`[event-generate] claim-guard tripped on "${guard.hit}" (${guard.path}) — plan blocked`);
    return NextResponse.json({ ok: false, error: "The plan needs review — try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, plan });
}
