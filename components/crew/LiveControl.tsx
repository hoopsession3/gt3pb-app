"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useOperatorSection } from "@/components/OperatorNav";
import { SectionHeader } from "@/components/kit";
import EmptyState from "@/components/EmptyState";
import InlineCreate from "@/components/InlineCreate";
import Icon from "@/components/Icon";
import type { Stop, LiveStatus, Vendor } from "@/lib/db";
import { haptic, HAPTIC } from "@/lib/haptics";
import { relativeDay, nextWeekdayAt } from "@/lib/dates";
import { prepHandoffKey, prepHandoffValue } from "@/lib/eventRecord";
import { goPlanTab } from "@/lib/planNav";
import { LocationEditor } from "@/components/crew/LocationEditor";

// LIVE CONTROL — the truck's live status board: where it is, whether it is open, what is next.
//
// The largest single component in app/crew/page.tsx and the last of the three lifted here. Rendered
// twice from that page (compact on the dashboard, full under Live Ops) with a props flag deciding
// which — so the page keeps both call sites and this file keeps the behaviour.

export function LiveControl({ compact = false, manage = false }: { compact?: boolean; manage?: boolean }) {
  const { toast } = useApp();
  const { setSection } = useOperatorSection();
  const openPrep = (id: string) => { try { localStorage.setItem(prepHandoffKey, prepHandoffValue("stop", id)); } catch { /* ignore */ } setSection("prep"); };
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [err, setErr] = useState("");
  const [posBusy, setPosBusy] = useState(false);
  const [openStopId, setOpenStopId] = useState<string | null>(null); // single-open accordion
  const [showArchStops, setShowArchStops] = useState(false);
  const [showPastStops, setShowPastStops] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: s, error: se }, { data: l }, { data: vs }] = await Promise.all([
      supabase.from("stops").select("*").order("sort"),
      supabase.from("live_status").select("*").maybeSingle(),
      supabase.from("vendors").select("*").order("sort"), // may not exist pre-0034
    ]);
    if (se) setErr(se.message); else setErr("");
    if (s) setStops(s as Stop[]);
    if (l) setLive(l as LiveStatus);
    if (vs) setVendors((vs as Vendor[]).filter((v) => !v.archived_at));
  }, []);
  // link a stop to a vendor → denormalize the public location onto the (public) stop row
  const linkVendor = async (stopId: string, v: Vendor | null) => {
    const p: Partial<Stop> = { vendor_id: v?.id ?? null };
    if (v) { p.name = v.name; p.address = v.address; p.location_text = v.location_text; p.lat = v.lat; p.lng = v.lng; }
    await supabase!.from("stops").update(p).eq("id", stopId);
    toast(v ? `Linked to ${v.name}` : "Unlinked");
    load();
  };

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["live_status", "stops"], load);

  // Optimistic flip first (instant), then direct, RLS-protected writes — every UPDATE
  // carries an explicit filter so Supabase's "no UPDATE without WHERE" guard is happy,
  // and it doesn't depend on the admin_set_live RPC (which ran a bare UPDATE).
  const goLive = async (stopId: string) => {
    haptic(HAPTIC.arm);
    setLive((l) => ({ id: 1, current_stop_id: stopId, is_live: true, next_eta: l?.next_eta ?? null }));
    // Authoritative + atomic via the SECURITY-DEFINER RPC (demotes other stops, promotes this
    // one, upserts live_status) — same robustness path as go-offline, not piecemeal client writes.
    const { error } = await supabase!.rpc("admin_set_live", { stop: stopId, live: true });
    if (error) {
      setErr(error.message);
      toast(error.message.includes("not authorized") ? "Go live failed — your account isn't an owner/admin." : `Couldn't go live — ${error.message}`, "error");
      load();
      return;
    }
    // Verify against the source of truth before claiming success.
    const { data: chk } = await supabase!.from("live_status").select("is_live").eq("id", 1).maybeSingle();
    if (!chk || (chk as { is_live: boolean }).is_live !== true) {
      setErr("Go live didn't persist — confirm your owner role (RLS).");
      toast("Go live didn't save — see banner.", "error");
    } else {
      toast("Truck is LIVE — members updated");
    }
    load();
  };
  const pause = async () => {
    // Going offline closes out the current stop: it's archived off the live screen and the
    // next stop on the route becomes the visible "next". Confirm — it drops the truck for all.
    const finished = stops.find((s) => s.id === live?.current_stop_id) ?? null;
    const next = stops.find((s) => !s.archived_at && s.status !== "done" && s.id !== finished?.id) ?? null;
    const msg = finished
      ? `Close out ${finished.name} and go offline?\n\nIt gets archived off the live screen${next ? `, and ${next.name} is up next` : ""}. Customers stop seeing the truck as live.`
      : "Take the truck OFFLINE?\n\nCustomers will immediately stop seeing it as live on the Truck page.";
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    stopBroadcast();
    setLive((l) => (l ? { ...l, is_live: false, current_stop_id: null, truck_lat: null, truck_lng: null, pos_updated_at: null } : { id: 1, current_stop_id: null, is_live: false, next_eta: null }));
    // Authoritative, atomic go-offline via the SECURITY-DEFINER RPC — clears is_live,
    // current_stop_id and the live position, and demotes the live stop, all server-side.
    // (Replaces the piecemeal client writes that could report success without sticking.)
    const { error } = await supabase!.rpc("admin_set_offline");
    if (error) {
      setErr(error.message);
      toast(error.message.includes("not authorized") ? "Go offline failed — your account isn't an owner/admin." : `Couldn't go offline — ${error.message}`, "error");
      load();
      return;
    }
    // Archive the just-finished stop off the live screen (record kept).
    if (finished) await supabase!.from("stops").update({ status: "done", archived_at: new Date().toISOString() }).eq("id", finished.id);
    // Verify against the source of truth — never claim offline if it didn't take.
    const { data: chk } = await supabase!.from("live_status").select("is_live").eq("id", 1).maybeSingle();
    if (chk && (chk as { is_live: boolean }).is_live === true) {
      setErr("Go offline didn't persist — confirm your owner role (RLS).");
      toast("Go offline didn't save — see banner.", "error");
    } else {
      toast(next ? `Offline — ${next.name} is next` : "Truck is offline");
    }
    load();
  };
  // One-shot pin of this phone's GPS as the truck's live position.
  const pinHere = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { toast("Location isn't available on this device", "error"); return; }
    setPosBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const { error } = await supabase!.rpc("admin_set_truck_pos", { lat: p.coords.latitude, lng: p.coords.longitude });
        setPosBusy(false);
        if (error) { setErr(error.message); toast(`Couldn't pin location — ${error.message}`, "error"); }
        else toast("Location pinned — members see the dot move");
      },
      (e) => { setPosBusy(false); toast(`Location error: ${e.message}`, "error"); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Continuous broadcast — stream the phone's GPS so the customer dot actually MOVES,
  // not just a stale one-shot pin. A screen wake lock keeps it alive while open.
  const watchRef = useRef<number | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastWriteRef = useRef(0);
  const [broadcasting, setBroadcasting] = useState(false);

  const stopBroadcast = () => {
    if (watchRef.current != null && typeof navigator !== "undefined") navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    setBroadcasting(false);
  };

  const startBroadcast = async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { toast("Location isn't available on this device", "error"); return; }
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      wakeRef.current = wl ? await wl.request("screen") : null;
    } catch { /* wake lock is optional */ }
    watchRef.current = navigator.geolocation.watchPosition(
      async (p) => {
        const now = Date.now();
        if (now - lastWriteRef.current < 8000) return; // throttle to ~1 write / 8s
        lastWriteRef.current = now;
        await supabase!.rpc("admin_set_truck_pos", { lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (e) => { toast(`Location error: ${e.message}`, "error"); stopBroadcast(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    setBroadcasting(true);
    toast("Broadcasting live location — the dot moves with you");
  };

  // Stop streaming on unmount (ref-based so it doesn't depend on a memoized callback).
  useEffect(() => () => {
    if (watchRef.current != null && typeof navigator !== "undefined") navigator.geolocation.clearWatch(watchRef.current);
    wakeRef.current?.release().catch(() => {});
  }, []);
  const posLabel = live?.is_live
    ? live?.pos_updated_at
      ? `Pinned ${new Date(live.pos_updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "Location not pinned yet"
    : "";
  const addStop = async (name: string) => {
    const { data, error } = await supabase!.from("stops").insert({ name, status: "upcoming", sort: stops.length }).select("id").single();
    if (error) { setErr(error.message); toast(`Couldn't add — ${error.message}`, "error"); }
    else { if (data) setOpenStopId((data as { id: string }).id); toast("Location added — fill in its details"); }
    load();
  };
  // "Stop here again" (0226 route redesign): a repeat visit clones the place's identity — name,
  // location, vendor link, menu/rig — into a fresh stop. The place stays ONE place on the route;
  // only the visit is new. (A real recurrence engine is deliberately not built — a clone + date is
  // the flexible version of it.)
  // 2026-07-29: used to leave the new visit fully undated ("Set its date & time.") — every repeat
  // stop meant re-typing a time the crew had just typed for the template. Prefilled to the next
  // occurrence of the template's own weekday/time instead; still just a starting point; the date
  // picker is right there to change it if this particular repeat lands differently.
  const stopAgain = async (tpl: Stop) => {
    const starts_at = tpl.starts_at ? nextWeekdayAt(new Date(tpl.starts_at)).toISOString() : null;
    const { data, error } = await supabase!.from("stops").insert({
      name: tpl.name, location_text: tpl.location_text, address: tpl.address, lat: tpl.lat, lng: tpl.lng,
      vendor_id: tpl.vendor_id ?? null, rig: tpl.rig ?? null, menu_tier: tpl.menu_tier ?? null,
      order_ahead_enabled: tpl.order_ahead_enabled ?? false, pickup_enabled: tpl.pickup_enabled ?? false,
      status: "upcoming", sort: stops.length, starts_at,
    }).select("id").single();
    if (error) { toast(`Couldn't add the visit — ${error.message}`, "error"); return; }
    if (data) setOpenStopId((data as { id: string }).id);
    toast(starts_at
      ? `${tpl.name} — new visit added for ${new Date(starts_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}. Check the date & time.`
      : `${tpl.name} — new visit added. Set its date & time.`);
    load();
  };
  // Archive a location out of the active list (keeps the record). If it was live, close it.
  const archiveStop = async (id: string) => {
    const wasLive = id === live?.current_stop_id;
    // If it's the live stop, take the truck offline authoritatively first (atomic RPC).
    if (wasLive) await supabase!.rpc("admin_set_offline");
    await supabase!.from("stops").update({ archived_at: new Date().toISOString(), status: "upcoming" }).eq("id", id);
    toast("Location archived");
    setOpenStopId(null);
    load();
  };
  const restoreStop = async (id: string) => {
    await supabase!.from("stops").update({ archived_at: null }).eq("id", id);
    toast("Location restored");
    load();
  };
  const deleteStop = async (id: string, nm: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete ${nm}? This removes the record.`)) return;
    await supabase!.from("stops").delete().eq("id", id);
    load();
  };
  const curStop = stops.find((s) => s.id === live?.current_stop_id);
  const active = stops.filter((s) => !s.archived_at);
  const archived = stops.filter((s) => s.archived_at);
  // Road-ahead partition (mirrors /truck's 8h grace): a visit whose start is >8h past — and isn't the
  // stop we're live at — is stale. It must not sit in the active route as a current LOCATION row; it
  // folds into "Past visits" below instead of vanishing (the auto-archive cron files it eventually,
  // but the UI can't wait on that). One definition, shared by the route grouping and Past visits.
  const graceMs = Date.now() - 8 * 3600 * 1000;
  const isAhead = (s: Stop) => !s.starts_at || new Date(s.starts_at).getTime() > graceMs || (s.id === live?.current_stop_id && !!live?.is_live);
  const stale = active.filter((s) => !isAhead(s));

  return (
    <div className="adm-sec">
      <SectionHeader label="Live truck" right={!compact ? <InlineCreate label="+ Add location" placeholder="Location name" onCreate={addStop} /> : undefined} />
      {err && <div className="adm-attn" role="alert">Backend error: {err}</div>}
      {compact ? (
        /* THE TRUCK INSTRUMENT — one panel, not a stack of floating cards (owner call). Row 1 is
           the state (LED · live-at/offline · the one primary action); the stop list and broadcast
           controls are rows of the same instrument, not separate cards. */
        <div className={`liveinst${live?.is_live ? " on" : ""}`}>
          <div className="liveinst-row main">
            <span className={`adm-dot${live?.is_live ? " on" : ""}`} />
            <div className="liveinst-state">
              <b>{live?.is_live ? "LIVE" : "OFFLINE"}</b>
              <span>{live?.is_live ? (curStop?.name ?? "on location") : (active[0] ? `next · ${active[0].name}` : "no stops scheduled")}</span>
            </div>
            {live?.is_live
              ? <button className="adm-btn ghost" onClick={pause}>Go offline</button>
              : (active[0] && <button className="adm-btn primary liveinst-go" onClick={() => goLive(active[0].id)}>Go live</button>)}
          </div>
          {live?.is_live ? (
            <div className="liveinst-row">
              {!broadcasting && !live?.pos_updated_at && <span className="liveinst-warn">Map dot off —</span>}
              <span className="liveinst-sub">{broadcasting ? <><Icon name="dot" /> Broadcasting — dot moves with you</> : posLabel}</span>
              {broadcasting
                ? <button className="adm-btn ghost" onClick={stopBroadcast}>Stop</button>
                : <span style={{ display: "flex", gap: 8 }}><button className="adm-btn ghost" onClick={pinHere} disabled={posBusy}>{posBusy ? "Pinning…" : "Pin once"}</button><button className="adm-btn primary" onClick={startBroadcast}>Broadcast</button></span>}
            </div>
          ) : null}
          <button type="button" className="adm-golink" onClick={() => goPlanTab("route", { setSection })}>{active.length > 1 ? `${active.length - 1} more location${active.length > 2 ? "s" : ""} · ` : ""}Locations &amp; ordering dial · Plan › Route</button>
        </div>
      ) : (
      <>
      <div className="adm-live">
        {!manage && <div className="adm-live-status">
          <span className={`adm-dot${live?.is_live ? " on" : ""}`} />
          <span><b>{live?.is_live ? "Live now" : "Offline"}</b>{live?.is_live && curStop ? <span className="adm-live-at"> · {curStop.name}</span> : null}</span>
        </div>}
        {/* The ordering dial (0137): when cup pre-orders open. Same rule everywhere — menu sheet,
            checkout, and the charge API. Pack reserves are always open regardless. Prep-day work,
            so it lives in Plan › Truck stops; the Now panel stays go-live/offline/broadcast only. */}
        {!compact && <div className="adm-lead">
          <span className="adm-lead-k">Cup orders open</span>
          <div className="adm-lead-opts" role="radiogroup" aria-label="When cup pre-orders open">
            {([[0, "Live only"], [2, "2h before"], [4, "4h before"], [8, "8h before"]] as const).map(([h, label]) => (
              <button key={h} type="button" role="radio" aria-checked={(live?.preorder_lead_h ?? 4) === h}
                className={`adm-lead-opt${(live?.preorder_lead_h ?? 4) === h ? " on" : ""}`}
                onClick={async () => {
                  setLive((l) => (l ? { ...l, preorder_lead_h: h } : l));
                  const { error } = await supabase!.from("live_status").update({ preorder_lead_h: h }).eq("id", 1);
                  if (error) { toast(`Couldn't save — ${error.message}`, "error"); load(); }
                  else toast(h === 0 ? "Cups sell only while you're live" : `Cup orders open ${h}h before a stop`);
                }}>{label}</button>
            ))}
          </div>
        </div>}
        {/* Status readout above stays manage-only (redundant with the LIVE pill already on the stop
            card below), but the action can't be — this was the only "Go offline" button reachable
            anywhere outside the Now tab's compact instrument, and that one disappears once you're
            past the pulse screen. Hiding it here left no way to end service from Stops at all. */}
        {live?.is_live && <button className="adm-btn ghost" onClick={pause}>Go offline</button>}
      </div>
      {!manage && live?.is_live && (
        <>
          {!broadcasting && !live?.pos_updated_at && (
            <div className="adm-attn" role="alert">Customers can&apos;t see the truck on the map yet — tap <b>Broadcast live</b> so the dot tracks you.</div>
          )}
          <div className="adm-live adm-live-pos">
            <div className="adm-live-status"><span className="h-sub">{broadcasting ? <><Icon name="dot" /> Broadcasting — dot moves with you</> : posLabel}</span></div>
            {broadcasting ? (
              <button className="adm-btn ghost" onClick={stopBroadcast}>Stop</button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="adm-btn ghost" onClick={pinHere} disabled={posBusy}>{posBusy ? "Pinning…" : "Pin once"}</button>
                <button className="adm-btn primary" onClick={startBroadcast}>Broadcast live</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* THE ROUTE, BY PLACE (0226 redesign): the same location never reads as two locations.
          Stops group under their PLACE — the vendor when linked, else the normalized name — with
          the visits nested inside and "+ Stop here again" for repeats. Single-visit unlinked
          one-offs stay flat rows (a card of one is chrome, not clarity). */}
      <div className="ev-list" style={{ marginTop: 12 }}>
        {(() => {
          // Road AHEAD only — stale (past) visits are partitioned out at component scope (`isAhead`)
          // and rendered under "Past visits" below, so the same location never reads as two places.
          const placeKey = (s: Stop) => s.vendor_id ? `v:${s.vendor_id}` : `t:${(s.name || s.location_text || s.address || "").trim().toLowerCase()}`;
          const groups: { key: string; vendor: Vendor | null; rows: Stop[] }[] = [];
          for (const s of active.filter(isAhead)) {
            const k = placeKey(s);
            let g = groups.find((x) => x.key === k);
            if (!g) { g = { key: k, vendor: s.vendor_id ? vendors.find((v) => v.id === s.vendor_id) ?? null : null, rows: [] }; groups.push(g); }
            g.rows.push(s);
          }
          const fmtNext = (rows: Stop[]) => {
            // Mirrors /truck: 8h grace, done/completed visits excluded. Past-only reads "last ·",
            // never a stale "next ·" (panel finding).
            const live = rows.filter((r) => r.starts_at && r.status !== "done" && !r.completed_at);
            const dated = live.map((r) => new Date(r.starts_at as string)).sort((a, b) => a.getTime() - b.getTime());
            const next = dated.find((d) => d.getTime() > Date.now() - 8 * 3600 * 1000);
            // Relative + absolute, so the weekday can't misread as "next Saturday" (relativeDay: This Sat · Jul 18).
            if (next) return `${relativeDay(next)} · ${next.toLocaleDateString([], { month: "short", day: "numeric" })}`;
            const last = dated[dated.length - 1];
            return last ? `${relativeDay(last)} · ${last.toLocaleDateString([], { month: "short", day: "numeric" })}` : "undated";
          };
          let idx = -1;
          return groups.map((g) => {
            const editors = g.rows.map((s) => {
              idx += 1;
              return (
                <LocationEditor
                  key={s.id}
                  kind="stop"
                  row={s}
                  index={idx}
                  isCur={Boolean(s.id === live?.current_stop_id && live?.is_live)}
                  open={openStopId === s.id}
                  onToggle={() => setOpenStopId(openStopId === s.id ? null : s.id)}
                  onGoLive={goLive}
                  onGoOffline={pause}
                  onArchive={() => archiveStop(s.id)}
                  onChanged={load}
                  vendors={vendors}
                  onLinkVendor={(v) => linkVendor(s.id, v)}
                  onOpenPrep={() => openPrep(s.id)}
                  nameOverride={g.vendor?.name ?? null}
                />
              );
            });
            if (g.rows.length === 1 && !g.vendor) return <div key={g.key}>{editors}</div>;
            return (
              <div className="place-card" key={g.key}>
                <div className="place-head">
                  <b>{g.vendor?.name ?? g.rows[0].name}</b>
                  <span className="place-sub">{g.rows.length > 1 ? `${g.rows.length} visits` : "1 visit"}{g.vendor ? " · vendor-linked" : ""}{g.vendor?.status === "pending" ? " · pending" : ""}</span>
                  <span className="place-next">{fmtNext(g.rows)}</span>
                </div>
                {editors}
                <button type="button" className="place-again" onClick={() => {
                  // Template = the NEWEST visit by date (sort order isn't recency — quick-add paths
                  // insert with sort 0; panel finding), so the clone carries the latest flags.
                  const byDate = [...g.rows].sort((a, b) => new Date(a.starts_at ?? 0).getTime() - new Date(b.starts_at ?? 0).getTime());
                  stopAgain(byDate[byDate.length - 1] ?? g.rows[g.rows.length - 1]);
                }}><Icon name="plus" /> Stop here again — new visit, same place</button>
              </div>
            );
          });
        })()}
      </div>
      {active.length === 0 && <EmptyState title="No locations yet" sub={`Tap + Add location to create one${archived.length ? ", or reopen one below" : ""}.`} />}
      {active.length > 0 && stale.length === active.length && <EmptyState title="Nothing on the road ahead" sub="Every location's last visit has passed. See Past visits below, or tap + Add location." />}

      {/* PAST VISITS — stale (past-dated) unarchived stops fold here instead of vanishing from the
          route or lingering as a false "next" location. They stay one tap from restore/again. */}
      {stale.length > 0 && (
        <div className="ev-archived">
          <button className="ev-arch-head" onClick={() => setShowPastStops((v) => !v)} aria-expanded={showPastStops}>
            Past visits · {stale.length}<span className={`ev-chev${showPastStops ? " open" : ""}`}>›</span>
          </button>
          {showPastStops && stale
            .slice()
            .sort((a, b) => new Date(b.starts_at ?? 0).getTime() - new Date(a.starts_at ?? 0).getTime())
            .map((s) => {
              const when = s.starts_at ? new Date(s.starts_at).toLocaleDateString([], { month: "short", day: "numeric" }) : null;
              return (
                <div className="ev-arch-row" key={s.id}>
                  <span className="ev-arch-name">{s.name || "Untitled location"}{when ? ` · ${when}` : ""}</span>
                  <button className="ev-arch-btn" onClick={() => stopAgain(s)}>Stop again</button>
                  <button className="ev-arch-btn" onClick={() => archiveStop(s.id)}>Archive</button>
                </div>
              );
            })}
        </div>
      )}

      {archived.length > 0 && (
        <div className="ev-archived">
          <button className="ev-arch-head" onClick={() => setShowArchStops((v) => !v)} aria-expanded={showArchStops}>
            Archived locations · {archived.length}<span className={`ev-chev${showArchStops ? " open" : ""}`}>›</span>
          </button>
          {showArchStops && archived.map((s) => (
            <div className="ev-arch-row" key={s.id}>
              <span className="ev-arch-name">{s.name || "Untitled location"}</span>
              <button className="ev-arch-btn" onClick={() => restoreStop(s.id)}>Restore</button>
              <button className="ev-arch-btn del" onClick={() => deleteStop(s.id, s.name)}>Delete</button>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ───────────────────────── meeting notes (in-app system of record) ─────────────────────────
