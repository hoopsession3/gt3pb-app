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
import { haptic } from "@/lib/haptics";
import { clockTime, dayWithDate, nextWeekdayAt } from "@/lib/dates";
import { isStopAhead, isStopPast, roadAhead, stopIsDue } from "@/lib/road";
import { prepHandoffKey, prepHandoffValue } from "@/lib/eventRecord";
import { goPlanTab } from "@/lib/planNav";
import { wrapOwner } from "@/lib/wrap";
import { LocationEditor } from "@/components/crew/LocationEditor";
import { useConfirm } from "@/components/ConfirmSheet";
import { RecordLink } from "@/components/RecordSheet";
import { useAuth } from "@/components/AuthProvider";
import { canOf } from "@/lib/roles";
import { scrollToAnchor } from "@/lib/anchors";
import GoLine from "@/components/GoLine";

// LIVE CONTROL — the truck's live status board: where it is, whether it is open, what is next.
//
// The largest single component in app/crew/page.tsx and the last of the three lifted here. Rendered
// twice from that page (compact on Live Ops, `manage` on Plan › Route) with a props flag deciding
// which — so the page keeps both call sites and this file keeps the behaviour. The cup-ordering dial
// it used to hold is its own component in Settings since 2026-10-06 (components/crew/CupOrderingDial).

export function LiveControl({ compact = false, manage = false }: { compact?: boolean; manage?: boolean }) {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { setSection } = useOperatorSection();
  // Who can save the cup-ordering dial — the database's own rule (is_admin(): an owner or an admin).
  // Only they get the line to it; a manager who could not save it is not sent to it.
  const { profile } = useAuth();
  const admin = canOf(profile).admin;
  const goDial = () => { setSection("settings"); scrollToAnchor("set-dial"); };
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
  // A stop's venue is picked in its sheet (FieldOpSheet → components/VenuePick), not on this card:
  // the card's own vendor <select> was a second editor for it. Route still reads the book, to group
  // the visits by venue and to say each one's venue and liaison.

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["live_status", "stops"], load);

  // Optimistic flip first (instant), then direct, RLS-protected writes — every UPDATE
  // carries an explicit filter so Supabase's "no UPDATE without WHERE" guard is happy,
  // and it doesn't depend on the admin_set_live RPC (which ran a bare UPDATE).
  const goLive = async (stopId: string) => {
    haptic("live");
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
    // The road rule (lib/road), minus the stop being closed — not the first row in `sort`
    // order, which is how this sentence used to name a stop that had already happened.
    const next = roadAhead(stops.filter((s) => s.id !== finished?.id))[0] ?? null;
    if (!(await confirm(finished
      ? { title: `Close out ${finished.name} and go offline?`, body: `It gets archived off the live screen${next ? `, and ${next.name} is up next` : ""}. Customers stop seeing the truck as live.`, confirmLabel: "Go offline" }
      : { title: "Take the truck offline?", body: "Customers will immediately stop seeing it as live on the Truck page.", confirmLabel: "Go offline" }))) return;
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
    // Close out the just-finished stop and archive it off the live screen (record kept). lib/wrap's
    // write, shared with the record sheets and OwnerDetails — this copy used to skip completed_at,
    // so a stop closed from here never said WHEN it finished.
    if (finished) await wrapOwner(supabase!, { kind: "stop", id: finished.id, archive: true });
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
    if (!(await confirm({ title: `Delete ${nm}?`, body: "This removes the record.", confirmLabel: "Delete", danger: true }))) return;
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
  // The grace is lib/road's (isStopPast), not a second 8 * 3600 * 1000 spelled here.
  const isAhead = (s: Stop) => !isStopPast(s.starts_at) || (s.id === live?.current_stop_id && !!live?.is_live);
  const stale = active.filter((s) => !isAhead(s));
  // THE ROAD, as the instrument reads it: the same rule as the public Find Us page, so the crew and
  // a guest can never disagree about where the truck goes next (lib/road, 2026-10-04).
  const road = roadAhead(active, live?.is_live ? live.current_stop_id : null);
  const nextStop = live?.is_live ? null : road[0] ?? null;
  const nextWhen = nextStop
    ? nextStop.starts_at ? `${dayWithDate(new Date(nextStop.starts_at))} · ${clockTime(nextStop.starts_at)}` : "no date yet"
    : "";
  // Go live is one tap when the stop is today (or underway); anything else — next Saturday, or no
  // date at all — asks first, because going live is the one action in this panel a guest sees.
  const goLiveNext = async () => {
    if (!nextStop) return;
    if (!stopIsDue(nextStop.starts_at) && !(await confirm({
      title: `Go live at ${nextStop.name} now?`,
      body: nextStop.starts_at
        ? `It's on the road for ${nextWhen}. Guests see the truck live there the moment you do.`
        : "It has no date yet. Guests see the truck live there the moment you do.",
      confirmLabel: "Go live now",
    }))) return;
    goLive(nextStop.id);
  };

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
              {/* The stop named here opens its record (2026-10-04) — it was plain text. */}
              <span>{live?.is_live
                ? (curStop ? <RecordLink kind="stop" id={curStop.id}>{curStop.name}</RecordLink> : "on location")
                : nextStop ? <>next · <RecordLink kind="stop" id={nextStop.id}>{nextStop.name}</RecordLink> · {nextWhen}</> : "nothing on the road"}</span>
            </div>
            {live?.is_live
              ? <button className="adm-btn ghost" onClick={pause}>Go offline</button>
              : nextStop
                ? <button className={`adm-btn ${stopIsDue(nextStop.starts_at) ? "primary" : "ghost"} liveinst-go`} onClick={goLiveNext}>Go live</button>
                : <button className="adm-btn ghost liveinst-go" onClick={() => goPlanTab("route", { setSection })}>Plan the next stop</button>}
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
          <button type="button" className="adm-golink" onClick={() => goPlanTab("route", { setSection })}>{road.length > 1 ? `${road.length - 1} more stop${road.length > 2 ? "s" : ""} ahead · ` : ""}Locations · Plan › Route</button>
          {/* The dial's line, where this row used to name it (2026-10-06, the settings round). */}
          {admin && <button type="button" className="adm-golink" onClick={goDial}>Cup-ordering dial ›</button>}
        </div>
      ) : (
      <>
      {/* The card holds the status (outside Route) and Go offline (while live). With the dial gone
          it would be an empty box on Route whenever the truck is offline, so it is drawn only when
          it has something in it. */}
      {(!manage || live?.is_live) && <div className="adm-live">
        {!manage && <div className="adm-live-status">
          <span className={`adm-dot${live?.is_live ? " on" : ""}`} />
          <span><b>{live?.is_live ? "Live now" : "Offline"}</b>{live?.is_live && curStop ? <span className="adm-live-at"> · <RecordLink kind="stop" id={curStop.id}>{curStop.name}</RecordLink></span> : null}</span>
        </div>}
        {/* Status readout above stays manage-only (redundant with the LIVE pill already on the stop
            card below), but the action can't be — this was the only "Go offline" button reachable
            anywhere outside the Now tab's compact instrument, and that one disappears once you're
            past the pulse screen. Hiding it here left no way to end service from Stops at all. */}
        {live?.is_live && <button className="adm-btn ghost" onClick={pause}>Go offline</button>}
      </div>}
      {/* The cup-ordering dial (0137) sat in that card until 2026-10-06 (the settings round). It lives
          in Settings › Ordering & payments now (components/crew/CupOrderingDial): only an owner or an
          admin can save it, and every manager could see it here — an event manager's tap read
          "saved" while the database changed nothing. Route keeps one line to it, for those who can. */}
      {admin && <GoLine to="settings" anchor="set-dial">Cup-ordering dial</GoLine>}
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
            // The road rule (lib/road): the next visit still ahead, else the last one this place
            // had. Past-only never reads as a stale "next" (panel finding). The day is said once —
            // dayWithDate: "This Sat · Oct 10" inside the week, "Sat, Oct 10" outside it.
            const dated = rows.filter((r) => r.starts_at && r.status !== "done" && !r.completed_at)
              .sort((a, b) => new Date(a.starts_at as string).getTime() - new Date(b.starts_at as string).getTime());
            const next = dated.find((r) => isStopAhead(r));
            if (next) return dayWithDate(new Date(next.starts_at as string));
            const last = dated[dated.length - 1];
            return last ? dayWithDate(new Date(last.starts_at as string)) : "undated";
          };
          return groups.map((g) => {
            const editors = g.rows.map((s) => {
              return (
                <LocationEditor
                  key={s.id}
                  kind="stop"
                  row={s}
                  isCur={Boolean(s.id === live?.current_stop_id && live?.is_live)}
                  open={openStopId === s.id}
                  onToggle={() => setOpenStopId(openStopId === s.id ? null : s.id)}
                  onGoLive={goLive}
                  onGoOffline={pause}
                  onArchive={() => archiveStop(s.id)}
                  onChanged={load}
                  venue={g.vendor}
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
