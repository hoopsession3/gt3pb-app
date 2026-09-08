"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet from "./Sheet";
import Icon from "./Icon";
import { prepHandoffKey, prepHandoffValue } from "@/lib/eventRecord";
import { goPlanTab } from "@/lib/planNav";
import {
  isGuestFacing, looksLocationQualified, money, nameDriftLine, placeLine, sortGaps, stopGapFix,
  stopOwedLine, stopStatusLabel, whenLabel,
} from "@/lib/stopRecord";

// ONE TRUCK STOP, WHOLE (0315).
//
// Sixteen tables reference a stop. None of them had a screen that showed one.
//
// The header does one unusual thing on purpose: when the stored name is behind the venue's, it says
// so IN THE HEADER, above everything else, and offers the fix. That is not decoration — it is the
// only problem in this app a GUEST can see. Renaming a venue leaves every scheduled visit storing
// the old name, that name mirrors into field_ops (0222), and field_ops is the single query the
// public Find Us page reads. Someone looking up where the truck is gets the old name.
//
// The fix is a button, not a trigger. saveName exists, so some stop names WERE typed on purpose, and
// silently overwriting those is a worse morning than being told the name is stale.

type Rec = {
  id: string; name: string | null; canonical_name: string | null; name_is_stale: boolean | null;
  location_text: string | null; address: string | null; lat: number | null; lng: number | null;
  starts_at: string | null; ends_at: string | null; status: string | null;
  completed_at: string | null; archived_at: string | null;
  when_label: string | null; time_label: string | null;
  plan_days: number | null; note: string | null; notes: string | null;
  menu_tier: string | null; tag_label: string | null; rig: string | null;
  power_available: boolean | null; water_available: boolean | null;
  order_ahead_enabled: boolean | null; pickup_enabled: boolean | null;
  vendor_id: string | null; vendor_name: string | null; vendor_address: string | null; vendor_status: string | null;
  crew_brief: string | null; dress_code: string | null; recap: string | null;
  is_live_now: boolean | null;
  tasks: number | null; tasks_done: number | null; tasks_open: number | null; tasks_critical_open: number | null;
  staff: number | null; approvals: number | null; schedule_items: number | null; menu_items: number | null;
  orders: number | null; orders_cents: number | null;
  incidents: number | null; brews: number | null; content_items: number | null;
  phase: string | null; days_away: number | null;
};
type Gap = { gap: string; detail: string; severity: string };
type Data = { stop: Rec | null; gaps: Gap[] };

const when = (r: Rec) => {
  if (!r.starts_at) return "no date";
  const d = new Date(r.starts_at);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
};

export default function StopRecord({ stopId, onClose }: { stopId: string; onClose: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { stop: null, gaps: [] };
    const [s, g] = await Promise.all([
      supabase.from("v_stop_record").select("*").eq("id", stopId).maybeSingle(),
      supabase.from("v_stop_gaps").select("gap, detail, severity").eq("stop_id", stopId),
    ]);
    if (s.error) throw new Error(s.error.message);
    return { stop: (s.data as Rec) ?? null, gaps: (g.data as Gap[]) ?? [] };
  }, [stopId]);
  const state = useAsyncData<Data>(loader, [stopId]);
  const reload = state.reload;

  const resync = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("resync_stop_from_vendor", { p_stop: stopId });
    setBusy(false);
    // supabase-js resolves with { error } rather than throwing — surface the database's own sentence,
    // which is written to be read by this crew.
    if (error) { toast(error.message, "error"); return; }
    const row = Array.isArray(data) ? data[0] : data;
    const from = (row as { old_name?: string } | null)?.old_name;
    const to = (row as { new_name?: string } | null)?.new_name;
    toast(from && to ? `Renamed "${from}" to "${to}"` : "Synced from the venue");
    reload();
  };

  const openPrep = () => {
    try { localStorage.setItem(prepHandoffKey, prepHandoffValue("stop", stopId)); } catch { /* ignore */ }
    window.location.href = "/crew?s=prep";
  };

  return (
    <Sheet open onClose={onClose} label="Truck stop"
      header={<div className="cp-head">
        <b>Truck stop</b>
        <button type="button" className="qd-x" onClick={onClose} title="Close"><Icon name="close" /></button>
      </div>}>
      <AsyncSection state={state} isEmpty={({ stop }) => !stop}
        emptyTitle="No such stop" emptySub="It may have been removed, or the link is stale."
        loadingLabel="Loading…" errorTitle="Couldn't load this stop">
        {({ stop, gaps }) => {
          const s = stop!;
          const sorted = sortGaps(gaps);
          const drift = s.name_is_stale ? nameDriftLine(s.name, s.canonical_name) : null;
          const qualified = s.name_is_stale ? looksLocationQualified(s.name, s.canonical_name) : false;
          const place = placeLine({ location_text: s.location_text ?? s.address });
          const owed = stopOwedLine(s);

          return (
            <>
              {/* what it is ───────────────────────────────────────────────────────────────── */}
              <div className="so-id">
                <div className="cp-id-t">
                  <b>{s.canonical_name?.trim() || s.name?.trim() || "Unnamed stop"}</b>
                  <span>{when(s)} · {whenLabel(s.phase, s.days_away)}</span>
                </div>
                <span className={`so-pill ${s.is_live_now ? "so-us" : s.status === "done" ? "so-nobody" : "so-carrier"}`}>
                  {s.is_live_now ? "Live now" : stopStatusLabel(s.status)}
                </span>
              </div>

              {/* The name question, at the top, because a guest can see it — and deliberately WITHOUT
                  a recommended direction. The first version of this block said the stop was stale and
                  offered one button to overwrite it from the venue. Then it ran against production:
                  all three live stops disagreed, and all three had the better name. So it shows both
                  and lets a person choose. */}
              {drift && (
                <div className="str-drift">
                  <b>{drift}</b>
                  <p>
                    Guests looking up where the truck is see the stop&rsquo;s.
                    {qualified && <> This one reads like the venue plus a location or a slot — which usually
                      means the venue needs a second location on file, not that the stop needs renaming.</>}
                  </p>
                  <div className="str-drift-b">
                    <button type="button" className="so-move" disabled={busy} onClick={resync}>
                      {busy ? "…" : `Use "${s.canonical_name}" on this stop`}
                    </button>
                    {/* NOT an <a href="/crew?s=plan&a=vendors">. That was the first version and it
                        silently did nothing: ?a= is an anchor, and #vendors does not exist because
                        VendorsAdmin only mounts once the tab is selected. lib/planNav owns the one
                        mechanism that actually lands you there. */}
                    <button type="button" className="cp-go" onClick={() => goPlanTab("vendors")}>
                      Edit the venue instead <span aria-hidden="true">›</span>
                    </button>
                  </div>
                </div>
              )}

              {owed && <p className={`evr-owed${s.phase === "past" && s.status !== "done" ? " due" : ""}`}>{owed}</p>}

              {/* what else disagrees ──────────────────────────────────────────────────────── */}
              {sorted.filter((g) => g.gap !== "name_drift").length > 0 && (
                <div className="cp-block evr-gaps">
                  <div className="cp-block-h">
                    <span>Needs sorting</span>
                    <b>{sorted.filter((g) => g.gap !== "name_drift").length}</b>
                  </div>
                  {sorted.filter((g) => g.gap !== "name_drift").map((g) => (
                    <div className={`evr-gap sev-${g.severity}`} key={g.gap}>
                      <b>{g.detail}{isGuestFacing(g.gap) && <span className="str-guest">guests see this</span>}</b>
                      <i>{stopGapFix(g.gap)}</i>
                    </div>
                  ))}
                </div>
              )}

              {/* where ────────────────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Where</span>
                  <b>{s.lat != null && s.lng != null ? "pinned" : <span className="dim">no pin</span>}</b>
                </div>
                <p className="cp-line">{place || <span className="dim">No address on this stop.</span>}</p>
                {s.vendor_id ? (
                  <p className="cp-line">
                    Venue: <b>{s.vendor_name}</b>
                    {s.vendor_status === "pending" ? <span className="dim"> · pending approval</span> : null}
                  </p>
                ) : (
                  <p className="cp-line dim">
                    Not linked to a venue. Typing the name again next time is how one place becomes three.
                  </p>
                )}
                <p className="cp-line dim">
                  {s.power_available === true ? "Power on site" : s.power_available === false ? "No power" : "Power unknown"}
                  {" · "}
                  {s.water_available === true ? "water on site" : s.water_available === false ? "no water" : "water unknown"}
                  {s.rig ? ` · ${s.rig}` : ""}
                  {s.order_ahead_enabled ? " · order-ahead on" : ""}
                  {s.pickup_enabled ? " · pickup on" : ""}
                </p>
              </div>

              {/* what's on it ─────────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>On it</span>
                  <b>{Number(s.tasks_done ?? 0)}/{Number(s.tasks ?? 0)} done</b>
                </div>
                <div className="so-kpis" style={{ marginTop: 10, marginBottom: 0 }}>
                  <span className="so-kpi"><b>{Number(s.tasks_critical_open ?? 0)}</b><i>critical open</i></span>
                  <span className="so-kpi"><b>{Number(s.staff ?? 0)}</b><i>crew</i></span>
                  <span className="so-kpi"><b>{Number(s.menu_items ?? 0)}</b><i>menu</i></span>
                  <span className="so-kpi"><b>{Number(s.schedule_items ?? 0)}</b><i>run of show</i></span>
                  <span className="so-kpi"><b>{Number(s.brews ?? 0)}</b><i>brews</i></span>
                  {Number(s.incidents ?? 0) > 0 &&
                    <span className="so-kpi"><b>{s.incidents}</b><i>incidents</i></span>}
                </div>
                <button type="button" className="cp-go" onClick={openPrep} style={{ marginTop: 10 }}>
                  Open the prep checklist <span aria-hidden="true">›</span>
                </button>
              </div>

              {/* what it took ─────────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Took</span>
                  <b>{Number(s.orders ?? 0) > 0 ? money(s.orders_cents) : "—"}</b>
                </div>
                {Number(s.orders ?? 0) > 0 ? (
                  <p className="cp-line"><b>{s.orders}</b> order{Number(s.orders) === 1 ? "" : "s"} through the app.</p>
                ) : (
                  <p className="cp-line dim">No app orders on this stop. Walk-ups go through Square and land in Sales.</p>
                )}
              </div>

              {/* the brief and the write-up ───────────────────────────────────────────────── */}
              {(s.crew_brief || s.dress_code || s.recap || s.note || s.notes) && (
                <div className="cp-block">
                  <div className="cp-block-h"><span>Notes</span><b>{s.dress_code || ""}</b></div>
                  {(s.note || s.notes) && <p className="cp-line">{s.note || s.notes}</p>}
                  {s.crew_brief && <p className="cp-line"><b>Crew:</b> {s.crew_brief}</p>}
                  {s.recap && <p className="cp-line" style={{ whiteSpace: "pre-line" }}><b>After:</b> {s.recap}</p>}
                </div>
              )}

              <p className="so-foot">
                {s.menu_tier ? `${s.menu_tier} menu` : "stop"}
                {s.tag_label ? ` · ${s.tag_label}` : ""}
                {Number(s.plan_days ?? 1) > 1 ? ` · ${s.plan_days} days` : ""}
                {s.archived_at ? " · archived" : ""}
              </p>
            </>
          );
        }}
      </AsyncSection>
    </Sheet>
  );
}
