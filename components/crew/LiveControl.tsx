"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
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
import { dayWithDate, nextWeekdayAt } from "@/lib/dates";
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
import { useWakeLock } from "@/lib/useWakeLock";
import GoLine from "@/components/GoLine";
import Button from "../Button";
import { mayGoLive, stopName, truckAction, truckSays, type TruckRead } from "@/lib/liveOps";
import { useMinute } from "@/lib/useMinute";
import { StatusRow } from "@/components/crew/StatusRow";
import { authedFetch } from "@/lib/authedFetch";
import { stopCanceledToast } from "@/lib/stopCancel";
import { wrote } from "@/lib/wrote";
import { useLatestRead } from "@/lib/useLatestRead";

// Go live's checks, loaded with the first tap on Go live (it opens on a tap, as the console's other sheets do).
const GoLiveSheet = dynamic(() => import("@/components/crew/GoLiveSheet"), { ssr: false });

// LIVE CONTROL — the truck's live status board: where it is, whether it is open, what is next.
//
// The largest single component in app/crew/page.tsx and the last of the three lifted here. Rendered
// twice from that page (compact on Live Ops, `manage` on Plan › Route) with a props flag deciding
// which — so the page keeps both call sites and this file keeps the behaviour. The cup-ordering dial
// it used to hold is its own component in Settings since 2026-10-06 (components/crew/CupOrderingDial).
//
// ON LIVE OPS, ONE ROW (2026-10-12, the Live Ops round, approved). The instrument was ~195 points on a quiet day:
// OFFLINE, the next stop, Go live, "1 more stop ahead · truck stops · plan › lists", "cup-ordering dial ›". It is the
// truck's row now (components/crew/StatusRow, the words lib/liveOps truckSays'): "Off the road · next: Wine Express ·
// Sat 11:00am" with Go live, or "Live at Wine Express · 42 min left" with Go offline; a tap on the line folds open, in
// place, everything the instrument held — the stop's record, the map dot and its broadcast, the stops list, the dial.
// Nothing removed, only folded. It still stays mounted under the Pass (app/crew/page.tsx), so a broadcast goes on.

export function LiveControl({ compact = false, manage = false }: { compact?: boolean; manage?: boolean }) {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { setSection } = useOperatorSection();
  // Who can save the cup-ordering dial — the database's own rule (is_admin(): an owner or an admin).
  // Only they get the line to it; a manager who could not save it is not sent to it.
  const { profile } = useAuth();
  const admin = canOf(profile).admin;
  // WHO MAY GO LIVE (2026-10-12): the database's test, read as it reads it (lib/liveOps mayGoLive). Go live, Go offline,
  // the map dot's Pin once and Broadcast, and Plan the next stop each call a function or write a table that asks
  // is_admin(); an event manager was drawn all of them and refused each tap. They see the truck's state, and none of it.
  const canLive = mayGoLive(profile);
  const now = useMinute();
  const [open, setOpen] = useState(false);              // the row's fold, on Live Ops
  const [asking, setAsking] = useState<Stop | null>(null); // Go live's checks, open for this stop
  const goDial = () => { setSection("settings"); scrollToAnchor("set-dial"); };
  const openPrep = (id: string) => { try { localStorage.setItem(prepHandoffKey, prepHandoffValue("stop", id)); } catch { /* ignore */ } setSection("prep"); };
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  // When the truck's position was last pinned — its own row, the crew's alone (R6, 0402: off live_status, which everyone
  // may read). Shown here as "Pinned 3:04pm"; no customer page draws the position.
  const [pinnedAt, setPinnedAt] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [posBusy, setPosBusy] = useState(false);
  const [openStopId, setOpenStopId] = useState<string | null>(null); // single-open accordion
  const [showArchStops, setShowArchStops] = useState(false);
  const [showPastStops, setShowPastStops] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  // A READ THAT FAILS IS SAID, EVERY TIME (2026-10-12, the Live Ops round). The instrument drew OFFLINE before its first
  // read had answered, and again when that read failed — live_status's error was never looked at, so a truck that was
  // live read as offline to anyone whose read did not go through — and a later read that failed kept whatever the last
  // one said, silently. The read's state is its own now: still reading, failed (the first read or any later one — the
  // row says "Couldn't read the truck", with Try again, never a state it does not know), or ready. A live_status with no
  // row is a truck off the road, which is what the database says; a stop list or a live_status that did not answer is a
  // failure. The venue book is Route's grouping only (and may not exist before 0034), so its failure is not the truck's.
  const [read, setRead] = useState<TruckRead>("loading");

  // Read, then set — the newest read's answer only (R17, lib/useLatestRead).
  const readBoard = useLatestRead();
  const load = useCallback(() => readBoard(async () => (supabase ? await Promise.all([
      supabase.from("stops").select("*").order("sort"),
      supabase.from("live_status").select("*").maybeSingle(),
      supabase.from("vendors").select("*").order("sort"), // may not exist pre-0034
      // the crew's own row since 0402 (applied 2026-10-15): live_status, which everyone may read, holds no position
      supabase.from("truck_position").select("pos_updated_at").maybeSingle(),
    ]) : null), (r) => {
    if (!r) return;
    const [s, l, vs, tp] = r;
    const failed = s.error ?? l.error;
    if (failed) { setErr(failed.message); setRead("failed"); return; }
    setErr("");
    setRead("ready");
    setStops((s.data as Stop[] | null) ?? []);
    setLive((l.data as LiveStatus | null) ?? null);
    setPinnedAt(((tp.data as { pos_updated_at?: string | null } | null)?.pos_updated_at) ?? null);
    if (vs.data) setVendors((vs.data as Vendor[]).filter((v) => !v.archived_at));
  }), [readBoard]);
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
      toast("Go live didn't save — the truck still reads as off the road. Confirm your account is an owner or an admin.", "error");
    } else {
      toast("The truck is live — guests see it on Find Us");
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
    setLive((l) => (l ? { ...l, is_live: false, current_stop_id: null } : { id: 1, current_stop_id: null, is_live: false, next_eta: null }));
    setPinnedAt(null);
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
      toast("Go offline didn't save — the truck still reads as live. Confirm your account is an owner or an admin.", "error");
    } else {
      toast(next ? `Off the road — ${next.name} is next` : "The truck is off the road");
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
        else { setPinnedAt(new Date().toISOString()); toast("Location pinned"); }
      },
      (e) => { setPosBusy(false); toast(`Location error: ${e.message}`, "error"); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Continuous broadcast — stream the phone's GPS, not just a one-shot pin. For the crew: no customer page draws the
  // position (the route map went, b6af016), and since 0402 none can read it (R6). The screen stays on while it broadcasts (lib/useWakeLock — the
  // Pass's hook too, which asks again whenever the app comes back to the screen).
  const watchRef = useRef<number | null>(null);
  const lastWriteRef = useRef(0);
  const [broadcasting, setBroadcasting] = useState(false);
  useWakeLock(broadcasting);

  const stopBroadcast = () => {
    if (watchRef.current != null && typeof navigator !== "undefined") navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setBroadcasting(false);
  };

  const startBroadcast = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { toast("Location isn't available on this device", "error"); return; }
    watchRef.current = navigator.geolocation.watchPosition(
      async (p) => {
        const now = Date.now();
        if (now - lastWriteRef.current < 8000) return; // throttle to ~1 write / 8s
        lastWriteRef.current = now;
        const { error } = await supabase!.rpc("admin_set_truck_pos", { lat: p.coords.latitude, lng: p.coords.longitude });
        if (!error) setPinnedAt(new Date().toISOString());
      },
      (e) => { toast(`Location error: ${e.message}`, "error"); stopBroadcast(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    setBroadcasting(true);
    toast("Broadcasting the truck's location");
  };

  // Stop streaming on unmount (ref-based so it doesn't depend on a memoized callback). Opening the
  // Pass no longer unmounts this (app/crew/page.tsx keeps it under the Pass), so service does not
  // stop the dot; leaving Live Ops does, as it always has. The wake lock goes with useWakeLock's own cleanup.
  useEffect(() => () => {
    if (watchRef.current != null && typeof navigator !== "undefined") navigator.geolocation.clearWatch(watchRef.current);
  }, []);
  const posLabel = live?.is_live
    ? pinnedAt
      ? `Pinned ${new Date(pinnedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
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
    // If it's the live stop, take the truck offline authoritatively first (atomic RPC) — and if the truck could not be
    // taken offline, the stop stays where it is: archived under a live truck, it was a location no one could see the
    // truck at (R12b, F4: both answers were dropped, and "Location archived" said either way).
    if (wasLive && !wrote(await supabase!.rpc("admin_set_offline"), toast, "Couldn't take the truck offline first, so the location stays")) return;
    if (!wrote(await supabase!.from("stops").update({ archived_at: new Date().toISOString(), status: "upcoming" }).eq("id", id), toast, "Couldn't archive the location")) { load(); return; }
    toast("Location archived");
    setOpenStopId(null);
    load();
  };
  const restoreStop = async (id: string) => {
    // A canceled visit (0391) comes back uncanceled too — only sent when the row carries the columns.
    const was = stops.find((x) => x.id === id);
    if (!wrote(await supabase!.from("stops").update(was?.canceled_at ? { archived_at: null, canceled_at: null, cancel_reason: null } : { archived_at: null }).eq("id", id), toast, "Couldn't restore the location")) return;
    toast("Location restored");
    load();
  };
  // CALL A VISIT OFF (0391, H5 of the customer audit): the server cancels it as you (owners and admins), tells the cup
  // orders placed for it and the packs for its day, and gives you the paid ones to refund in Square.
  const cancelStop = async (id: string, reason: string): Promise<boolean> => {
    const res = await authedFetch("/api/crew/stops/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }) });
    const d = await res.json().catch(() => ({})) as { error?: string; already?: boolean; cups?: number; told?: number; paid?: number; packs?: number };
    if (!res.ok) { toast(d.error || "Couldn't cancel it — try again.", "error"); return false; }
    haptic("success");
    // R3b: "N cup orders told" counted the guests too, who have no address with us — they read it on their order's page.
    toast(d.already ? "Already canceled." : stopCanceledToast(d));
    setOpenStopId(null);
    load();
    return true;
  };
  const deleteStop = async (id: string, nm: string) => {
    if (!(await confirm({ title: `Delete ${nm}?`, body: "This removes the record.", confirmLabel: "Delete", danger: true }))) return;
    if (!wrote(await supabase!.from("stops").delete().eq("id", id), toast, `Couldn't delete ${nm}`)) return;
    toast(`${nm} deleted`);
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
  // GO LIVE ASKS FIRST, EVERY TIME (2026-10-12, the Live Ops round — the owner approved the pre-flight). It went live in
  // one tap when the stop was due, and asked "Go live at X now?" when it was not. It opens Go live's checks now — is the
  // stop due, is a phone on the Pass and can it ring, is the stop on the map, and how many people will be told
  // (components/crew/GoLiveSheet, lib/liveOps preflight) — for any stop, from this row and from the Route list's "Go live
  // at this location", and goes live from there (goLive above: its haptic plays once, on the sheet's confirm). Only for
  // who the database lets go live.
  const askGoLive = (s: Stop | null | undefined) => { if (s && canLive) setAsking(s); };
  const checks = asking && <GoLiveSheet stop={asking} onClose={() => setAsking(null)} onGo={() => { void goLive(asking.id); }} />;

  if (compact) {
    const truck = { read, live: !!live?.is_live, at: curStop ?? null, next: nextStop, nowMs: now };
    const says = truckSays(truck);
    const act = truckAction(truck, canLive);
    const failed = read === "failed";
    // The stop the row names: the live one, or the next on the road.
    const named = (live?.is_live ? curStop : nextStop) ?? null;
    const action = act === "retry"
      ? <Button kind="secondary" compact className="shrink-0" onClick={() => { void load(); }} aria-label="Read the truck again">Try again</Button>
      : act === "go-offline"
        ? <Button kind="secondary" compact className="shrink-0" onClick={pause} aria-label={`Go offline${curStop ? ` — closes out ${stopName(curStop)}` : ""}`}>Go offline</Button>
        : act === "go-live"
          ? <Button kind={nextStop && stopIsDue(nextStop.starts_at) ? "primary" : "secondary"} compact className="shrink-0" aria-haspopup="dialog"
              onClick={() => askGoLive(nextStop)} aria-label={`Go live at ${stopName(nextStop)} — shows what is ready first`}>Go live</Button>
          : act === "plan"
            ? <Button kind="secondary" compact className="shrink-0" onClick={() => goPlanTab("route", { setSection })}>Plan the next stop</Button>
            : null;
    return (
      <>
        {/* THE TRUCK, ONE ROW (2026-10-12): its state in words and its one action; a tap on the line folds open what the
            instrument held — the stop's record, the map dot and its broadcast, the stops list, the dial. A read that did
            not answer folds nothing open: the line tries again. */}
        <StatusRow label="The truck" says={says} onTap={() => { if (failed) void load(); else setOpen((o) => !o); }}
          tapLabel={failed ? `${says.text}. Tries again.` : `${says.text}. ${open ? "Hides" : "Shows"} the stop, the map dot and the stops list.`}
          expanded={failed ? undefined : open} controls="truck-more" action={action}>
          <div id="truck-more" className="px-4 pb-1 border-t border-line">
            {/* The stop's record, a whole row to the thumb: the name in the line was a 66×15-point link. */}
            {named && (
              <RecordLink kind="stop" id={named.id} className="flex w-full items-center justify-between gap-3 min-h-11 py-2 no-underline">
                <span className="min-w-0 truncate">{live?.is_live ? "Open the stop" : "Open the next stop"} · {stopName(named)}</span>
                <span aria-hidden="true" className="text-cream-muted">›</span>
              </RecordLink>
            )}
            {live?.is_live && (
              <div className="flex flex-wrap items-center gap-2.5 min-h-11 py-1.5 border-t border-line">
                <span className="flex-1 min-w-0 text-footnote text-cream-muted">{broadcasting ? <><Icon name="dot" /> Broadcasting the truck&apos;s location</> : posLabel}</span>
                {canLive && (broadcasting
                  ? <Button kind="secondary" compact onClick={stopBroadcast}>Stop</Button>
                  : <span className="flex gap-2"><Button kind="secondary" compact onClick={pinHere} disabled={posBusy}>{posBusy ? "Pinning…" : "Pin once"}</Button><Button kind="primary" compact onClick={startBroadcast}>Broadcast</Button></span>)}
              </div>
            )}
            <button type="button" className="adm-golink hit-y-44" onClick={() => goPlanTab("route", { setSection })}>{road.length > 1 ? `${road.length - 1} more stop${road.length > 2 ? "s" : ""} ahead · ` : ""}Truck stops · Plan › Lists</button>
            {/* The dial's line, where this row used to name it (2026-10-06, the settings round). */}
            {admin && <button type="button" className="adm-golink hit-y-44" onClick={goDial}>Cup-ordering dial ›</button>}
          </div>
        </StatusRow>
        {checks}
      </>
    );
  }

  return (
    <div className="adm-sec">
      {/* On Plan it is the list Lists opens as Truck stops (2026-10-10), and says so; on Live Ops it is the instrument. */}
      <SectionHeader label={manage ? "Truck stops" : "Live truck"} right={!compact ? <InlineCreate label="+ Add location" placeholder="Location name" onCreate={addStop} /> : undefined} />
      {err && <div className="adm-attn" role="alert">Backend error: {err}</div>}
      {checks}
      {/* The card holds the status (outside Route) and Go offline (while live). With the dial gone
          it would be an empty box on Route whenever the truck is offline, so it is drawn only when
          it has something in it. */}
      {(!manage || (live?.is_live && canLive)) && <div className="adm-live">
        {!manage && <div className="adm-live-status">
          <span className={`adm-dot${live?.is_live ? " on" : ""}`} />
          <span><b>{live?.is_live ? "Live now" : "Off the road"}</b>{live?.is_live && curStop ? <span className="adm-live-at"> · <RecordLink kind="stop" id={curStop.id}>{curStop.name}</RecordLink></span> : null}</span>
        </div>}
        {/* Status readout above stays manage-only (redundant with the LIVE pill already on the stop
            card below), but the action can't be — this was the only "Go offline" button reachable
            anywhere outside the Now tab's compact instrument, and that one disappears once you're
            past the pulse screen. Hiding it here left no way to end service from Stops at all. */}
        {live?.is_live && canLive && <Button kind="secondary" compact onClick={pause}>Go offline</Button>}
      </div>}
      {/* The cup-ordering dial (0137) sat in that card until 2026-10-06 (the settings round). It lives
          in Settings › Business › Ordering & delivery now (components/crew/CupOrderingDial): only an owner or an
          admin can save it, and every manager could see it here — an event manager's tap read
          "saved" while the database changed nothing. Route keeps one line to it, for those who can. */}
      {admin && <GoLine to="settings" anchor="set-dial">Cup-ordering dial</GoLine>}
      {!manage && live?.is_live && canLive && (
        <>
          <div className="adm-live adm-live-pos">
            <div className="adm-live-status"><span className="h-sub">{broadcasting ? <><Icon name="dot" /> Broadcasting the truck&apos;s location</> : posLabel}</span></div>
            {broadcasting ? (
              <Button kind="secondary" compact onClick={stopBroadcast}>Stop</Button>
            ) : (
              <div className="flex gap-2">
                <Button kind="secondary" compact onClick={pinHere} disabled={posBusy}>{posBusy ? "Pinning…" : "Pin once"}</Button>
                <Button kind="primary" compact onClick={startBroadcast}>Broadcast live</Button>
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
                  onGoLive={canLive ? (id) => askGoLive(stops.find((x) => x.id === id)) : undefined}
                  onGoOffline={canLive ? pause : undefined}
                  onArchive={() => archiveStop(s.id)}
                  onCancel={(why) => cancelStop(s.id, why)}
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
                  <Button kind="secondary" compact onClick={() => stopAgain(s)}>Stop again</Button>
                  <Button kind="secondary" compact onClick={() => archiveStop(s.id)}>Archive</Button>
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
              <span className="ev-arch-name">{s.name || "Untitled location"}{s.canceled_at ? ` · canceled${s.cancel_reason ? ` — ${s.cancel_reason}` : ""}` : ""}</span>
              <Button kind="secondary" compact onClick={() => restoreStop(s.id)}>Restore</Button>
              <Button kind="destructive" onClick={() => deleteStop(s.id, s.name)}>Delete</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── meeting notes (in-app system of record) ─────────────────────────
