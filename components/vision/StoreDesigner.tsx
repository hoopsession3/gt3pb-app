"use client";

import "./studio.css";
import { failureWords } from "@/lib/failureWords";
import { useDeferredValue, useCallback, useLayoutEffect, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useAppStable } from "@/components/AppProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import { Segmented } from "@/components/controls";
import { haptic } from "@/lib/haptics";
import {
  CATALOG, PILLARS, PILLAR_WORD, allowedKind, clampInside, ftIn, kindOf, parseFtIn, roomStats, snap,
  type Item, type Layout, type Pillar,
} from "@/lib/vision";
import { saveLayout } from "@/lib/visionRead";
import Store3D from "./Store3D";
import PlanView, { KIND_MIME } from "./PlanView";
import { SPLIT_AT, defaultView } from "@/lib/visionStudio";
import { FORMAT, type Plan } from "@/lib/visionPlans";
import Evaluate from "./Evaluate";
import { evaluate as runSpatial, type Finding } from "@/lib/spatial/evaluate";
import { PROFILES, modelOf } from "@/lib/spatial/profiles";
import FlowBar, { figuresOf } from "./FlowBar";
import { useFlow, type Speed } from "./useFlow";
import { InfoRow } from "@/components/kit";
import Sheet from "@/components/Sheet";
import { useStudioSize } from "./useStudioSize";

// THE STORE DESIGNER (R52) — a light AutoCAD for the first GT3 Performance Bar. A plan to scale (inches, a 6-inch snap,
// feet-and-inches everywhere, the distance to each wall while a thing is moved), a 3D view that follows every move, and
// the reason each thing is there. What a plan reviewer circles is said as it happens: outside the walls, two things in
// one place, an aisle under the ADA's 36 inches. Undo and redo; Save writes what changed. The catalog holds the brand —
// cold extraction, nitro, bottles and broth; no espresso (lib/vision).
type View = "plan" | "3d" | "both";
const GROUPS = ["Bar", "Front", "Seating", "Back", "Room"] as const;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);

type KeptDraft = { at: number; draft: Layout };
/** A short fingerprint of a room as saved, so a kept draft is offered only on top of the save it started from. */
function hashOf(l: Layout): number { const t = JSON.stringify(l); let h = 0; for (let k = 0; k < t.length; k++) h = (h * 31 + t.charCodeAt(k)) | 0; return h; }
function keptFor(original: Layout | null | undefined): KeptDraft | null {
  if (!original || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`gt3.studio.draft.${original.id}`);
    if (!raw) return null;
    const k = JSON.parse(raw) as { at: number; base: number; draft: Layout };
    if (k.base !== hashOf(original) || k.draft?.id !== original.id) { localStorage.removeItem(`gt3.studio.draft.${original.id}`); return null; }
    return { at: k.at, draft: k.draft };
  } catch { return null; }
}

export default function StoreDesigner({ layouts, plans = [], initialId = null, canEdit, onSaved }: { layouts: Layout[]; plans?: Plan[]; initialId?: string | null; canEdit: boolean; onSaved: () => void }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const [layoutId, setLayoutId] = useState(initialId && layouts.some((l) => l.id === initialId) ? initialId : layouts[0]?.id ?? "");
  const original = layouts.find((l) => l.id === layoutId) ?? layouts[0];
  const [draft, setDraft] = useState<Layout | null>(original ?? null);
  const [past, setPast] = useState<Layout[]>([]);
  const [future, setFuture] = useState<Layout[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [find, setFind] = useState("");
  // The view: chosen, or the studio's default for its size (the plan alone on a phone; side by side wider).
  const [viewChoice, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  // Flow: guests moving through the room as it's drawn (lib/visionFlow).
  // THE LENS (S1.1b): one saved room, three ways to look at it — Design (the geometry, to edit it), Experience (people
  // through it: the flow, a hypothesis until there are real days), Evaluate (what the Standard, the plan reviewer and the
  // plans that read this room say, the most serious first). A lens is a way of looking, not another designer.
  const [lens, setLens] = useState<"design" | "experience" | "evaluate">("design");
  const flowOn = lens === "experience";
  const [perHour, setPerHour] = useState(60);
  const [speed, setSpeed] = useState<Speed>(30);
  // The studio (S1): its width, the library folded or open, the add sheet, the phone's dock, full screen.
  const { ref: box, size, roomy, width, short } = useStudioSize();
  const [full, setFull] = useState(false);
  const view: View = viewChoice ?? defaultView(width);
  // Narrow: under SPLIT_AT (a phone, an iPad upright, Split View) the drawing takes the whole width — what's picked is a
  // line under it and opens as a sheet, the room's lists sit below. Docked: narrow, or full screen anywhere (full screen
  // wide puts the inspector in a column beside the drawing). Measured on the phone check: an iPad upright gave a 300px
  // side column 40% of its width and drew the plan 480 wide.
  const narrow = width > 0 && width < SPLIT_AT;
  // A phone opens the studio full screen, as an iPhone opens a document (S1.1 — measured: on an iPhone SE the page's own
  // title, tabs and numbers left the drawing 250px tall). Done returns to the vision; once left, it stays left.
  const [autoFull, setAutoFull] = useState(false);
  if (width > 0 && (size === "phone" || short) && !autoFull) { setAutoFull(true); setFull(true); }
  const docked = narrow || full;
  // A PHONE ON ITS SIDE, full screen (IMS1 — measured: the bar wrapped to two lines and an empty "Pick a thing" column took a
  // third of an iPhone 17's width). The plan gets the whole width: the view floats on the canvas, the lens rides in the bar,
  // and the dock comes in only when there is something to show — a thing picked, or Evaluate's list.
  const side = full && short;
  // The canvas's height: the space actually left under it (S1.1 — the gate's question 1). Measured from where the stage
  // sits in its scrolling page to that page's bottom, again when anything resizes; never shorter than a usable canvas.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  // THE SPLIT (S1.1b): side by side on an iPad or a desktop, the line between the plan and the 3D is dragged (or moved
  // with the arrow keys) — a quarter to three quarters for the plan — and kept for the session. A phone stacks them.
  const [split, setSplit] = useState(() => { try { const v = Number(sessionStorage.getItem("gt3.studio.split")); return v >= 0.25 && v <= 0.75 ? v : 0.55; } catch { return 0.55; } });
  const storeEl = useRef<HTMLDivElement | null>(null);
  const splitDrag = useRef<{ x0: number; w: number; s0: number } | null>(null);
  useLayoutEffect(() => { storeEl.current?.style.setProperty("--sa", `${split}fr`); storeEl.current?.style.setProperty("--sb", `${1 - split}fr`); });
  const setSplitKept = useCallback((v: number) => {
    const n = Math.round(Math.min(0.75, Math.max(0.25, v)) * 100) / 100;
    setSplit(n);
    try { sessionStorage.setItem("gt3.studio.split", String(n)); } catch { /* storage refused */ }
  }, []);
  // Which pane the hands are in: marked, so it's clear which one the keys and the wheel are talking to.
  const [activePane, setActivePane] = useState<"plan" | "3d">("plan");
  useEffect(() => {
    if (!stage) return;
    if (full) { stage.style.removeProperty("--stage-h"); return; }
    let sc: HTMLElement | null = stage.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const top = sc ? r.top - sc.getBoundingClientRect().top + sc.scrollTop : r.top + window.scrollY;
      const room = sc ? sc.clientHeight - parseFloat(getComputedStyle(sc).paddingBottom || "0") : window.innerHeight;
      const h = Math.round(Math.min(1400, Math.max(size === "phone" ? 320 : 440, room - top - 14)));
      stage.style.setProperty("--stage-h", `${h}px`);
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(document.documentElement);
    if (sc) ro?.observe(sc);
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [stage, full, size]);
  // The library beside the canvas: open from the start when the studio is roomy, folded otherwise — until a tap says.
  const [libChoice, setLibChoice] = useState<boolean | null>(null);
  const libOpen = libChoice ?? roomy;
  const [addOpen, setAddOpen] = useState(false);
  const [dock, setDock] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  // The details card at the foot of the 3D, measured as it's drawn: its height is what the 3D frames the room above.
  const [cardH, setCardH] = useState(0);
  const cardRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") { setCardH(0); return; }
    const ro = new ResizeObserver(() => setCardH(Math.round(el.getBoundingClientRect().height) + 12));
    ro.observe(el);
    return () => { ro.disconnect(); setCardH(0); };
  }, []);
  // BACK CLOSES THE STUDIO (IMS1). Full screen is a place, so it is a step in the browser's history: Back (a swipe from the
  // edge, Android's back, the browser's arrow) leaves the studio for the vision — never the vision itself — and Done takes
  // the same step back, so no stale step is left behind. Next.js keeps its own state on the step (its patched pushState),
  // and the room, its undo and its unsaved changes stay with the designer, which is never unmounted by it.
  const stepped = useRef(false);
  useEffect(() => {
    if (!full) return;
    if (!stepped.current) { try { window.history.pushState({ gt3Studio: true }, ""); stepped.current = true; } catch { /* no history: Done still works */ } }
    const onPop = () => { if (stepped.current && !(window.history.state as { gt3Studio?: boolean } | null)?.gt3Studio) { stepped.current = false; setDock(false); setFull(false); } };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [full]);
  const leave = useCallback(() => { setDock(false); if (stepped.current) window.history.back(); else setFull(false); }, []);
  const host = useSyncExternalStore(noSubscribe, findHost, noHost);
  // THE APP STEPS BACK BEHIND THE STUDIO (IMS2 — measured: the crew's nav was hidden by the studio but still in the tab order
  // and read out by a screen reader). The page and its nav are made inert while full screen is on; sheets, toasts and the
  // live regions are left as they are, since the studio's own sheets open beside it.
  useEffect(() => {
    if (!full || !host) return;
    const behind = [...host.querySelectorAll<HTMLElement>(":scope > main, :scope > nav, :scope > .skip-link")].filter((el) => !el.hasAttribute("inert"));
    behind.forEach((el) => el.setAttribute("inert", ""));
    return () => behind.forEach((el) => el.removeAttribute("inert"));
  }, [full, host]);

  // A different room, or a fresh read after a save: start from what is saved (React's "adjusting state when a prop
  // changes" — during render, guarded, not an effect).
  const [base, setBase] = useState(original);
  // AN INTERRUPTED SESSION (S1.1b): unsaved changes are kept on this device as they're made, and offered back the next
  // time this room opens — only if the room hasn't been saved since (a draft never lands on a newer save).
  const [kept, setKept] = useState<KeptDraft | null>(() => keptFor(original));
  // The same room read again after its own save keeps its undo history and what's picked (S1.1 — the gate: "save changes
  // and preserve undo/redo history"); another room, or a fresh read from elsewhere, starts clean.
  const [savedId, setSavedId] = useState<string | null>(null);
  // When this session last saved (S1.1b — a quiet save status: "Saved 3:41 PM" on the button's label, nothing permanent).
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // WHAT THE LAST SAVE SENT (IMS4 — measured: an edit made while a save was on its way was replaced by the saved copy when
  // it was read back). When the room comes back after its own save, it takes the saved copy only if nothing was changed
  // since the save left; a newer edit stays on screen, unsaved, and says so.
  const [sent, setSent] = useState<Layout | null>(null);
  // A save that didn't land (IMS4): the edits stay on screen and on this device; the button says Couldn't save · Retry.
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  if (base !== original) {
    const same = !!original && savedId === original.id;
    const newer = same && !!sent && !!draft && draft !== sent;
    setBase(original); if (!newer) setDraft(original ?? null); setSavedId(null); setSent(null);
    if (!same) { setPast([]); setFuture([]); setSel(null); setKept(keptFor(original)); }
  }

  const dirty = !!draft && !!original && JSON.stringify(draft) !== JSON.stringify(original);
  // Leaving the page (closing the tab, reloading) with unsaved changes asks first (IMS4); they're kept on this device too.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!original || kept) return;   // an offer on screen isn't overwritten until it's answered
    try {
      const k = `gt3.studio.draft.${original.id}`;
      if (dirty && draft) localStorage.setItem(k, JSON.stringify({ at: Date.now(), base: hashOf(original), draft }));
      else localStorage.removeItem(k);
    } catch { /* storage refused: nothing kept, nothing lost from the screen */ }
  }, [draft, dirty, original, kept]);
  // The findings, grouped (S1.1c): errors one by one, touching warnings as one. Only errors are drawn on the plan by
  // default; a finding chosen from the list highlights everything it names (focus), until something else is picked.
  // The shared spatial engine (lib/spatial), run as the room's operating model — the model of the plan that uses this room
  // (a storefront when none does). Worked out a moment behind a drag (useDeferredValue), so moving a thing stays smooth.
  const model = modelOf(plans.find((p) => p.layout_id === draft?.id)?.format ?? null);
  const settled = useDeferredValue(draft);
  const found: Finding[] = useMemo(() => (settled ? runSpatial(settled, PROFILES[model]) : []), [settled, model]);
  const bad = useMemo(() => new Set(found.filter((f) => f.level === "error").flatMap((i) => i.ids)), [found]);
  const [focus, setFocus] = useState<string[]>([]);
  const [focusPath, setFocusPath] = useState<Finding["path"] | null>(null);
  const look = (f: Finding) => { pick(f.ids[0]); setFocus(f.ids); setFocusPath(f.path?.length ? f.path : null); };
  const stats = draft ? roomStats(draft) : null;
  const item = draft?.items.find((i) => i.id === sel) ?? null;
  const flow = useFlow(draft ?? EMPTY_ROOM, flowOn && !!draft, perHour, speed);
  const figures = useMemo(() => figuresOf(flow), [flow]);

  /** A change the undo can take back. */
  const commit = useCallback((next: Layout) => {
    setDraft((cur) => { if (cur) setPast((p) => [...p.slice(-59), cur]); return next; });
    setFuture([]);
  }, []);
  const patchItem = (id: string, patch: Partial<Item>, record = true) => {
    if (!draft) return;
    const next = { ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
    if (record) commit(next); else setDraft(next);
  };
  const undo = () => { if (!past.length || !draft) return; setFuture((f) => [draft, ...f]); setDraft(past[past.length - 1]); setPast((p) => p.slice(0, -1)); };
  const redo = () => { if (!future.length || !draft) return; setPast((p) => [...p, draft]); setDraft(future[0]); setFuture((f) => f.slice(1)); };

  /** Pick a thing (or nothing): the phone's dock opens on its peek, never straight onto the whole inspector. */
  const pick = (id: string | null) => { setSel(id); setDock(false); setFocus([]); setFocusPath(null); };
  /** Details for a thing (its bar's ⓘ): the dock pulled up on a phone; wider, the inspector beside the canvas, its first
   *  field ready to type in. */
  const details = (id: string) => {
    setSel(id);
    if (docked) { setDock(true); return; }
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".vz-side .vz-insp input, .vz-side .vz-insp textarea")?.focus({ preventScroll: true }));
  };
  /** A new thing, in the middle of the room — or where it was dropped on the plan. */
  const add = (kind: string, at?: { x: number; y: number }) => {
    if (!draft || !allowedKind(kind)) return;
    const k = kindOf(kind);
    const it: Item = { id: newId(), kind, label: null, x_in: snap(at?.x ?? draft.width_in / 2), y_in: snap(at?.y ?? draft.depth_in / 2), rot: 0, w_in: k.w, d_in: k.d, h_in: k.h,
      why: k.why, pillars: [...k.pillars], sort: draft.items.length + 1 };
    commit({ ...draft, items: [...draft.items, { ...it, ...clampInside(it, draft) }] });
    setSel(it.id); setDock(false);
    haptic("selection");
  };
  const remove = (id: string) => { if (!draft) return; commit({ ...draft, items: draft.items.filter((i) => i.id !== id) }); setSel(null); };
  const turn = (id: string) => {
    const it = draft?.items.find((i) => i.id === id); if (!it || !draft) return;
    const r = ((it.rot + 90) % 360) as Item["rot"];
    patchItem(id, { rot: r, ...clampInside({ ...it, rot: r }, draft) });
  };
  const copy = (id: string) => {
    const it = draft?.items.find((i) => i.id === id); if (!it || !draft) return;
    const c = { ...it, id: newId(), x_in: it.x_in + 12, y_in: it.y_in + 12, sort: draft.items.length + 1 };
    commit({ ...draft, items: [...draft.items, { ...c, ...clampInside(c, draft) }] }); setSel(c.id);
  };

  const save = async () => {
    if (!supabase || !draft || !original || busy) return;
    if (found.some((f) => f.level === "error") && !(await confirm({ title: "Save with problems?", body: `${found.filter((f) => f.level === "error").length} problem(s): things that overlap, sit outside the walls, or can't be reached from the door. Save anyway, or fix them first?`, confirmLabel: "Save anyway" }))) return;
    const snap = draft;
    setBusy(true); setSaveFailed(null);
    const err = await saveLayout(supabase, snap, original.items);
    setBusy(false);
    if (err) { setSaveFailed(failureWords(err, "Couldn't save the room")); toast(failureWords(err, "Couldn't save the room — your changes are still here"), "error"); haptic("error"); return; }
    haptic("success"); toast("Saved — the room, and everything in it.");
    setSavedId(snap.id); setSavedAt(Date.now()); setSent(snap);
    onSaved();
  };
  const newRoom = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("store_layouts").insert({ name: "New room", width_in: 360, depth_in: 480 }).select("id").single();
    if (error) { toast(failureWords(error, "Couldn't make a room"), "error"); return; }
    setLayoutId(String((data as { id: string }).id));
    onSaved();
  };

  // Keys, on a keyboard: arrows nudge (shift: a foot), R turns, Delete takes it out, ⌘Z / ⇧⌘Z.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (e.key === "Escape" && !sel && full) { leave(); return; }
      if (!sel || !draft) return;
      const it = draft.items.find((i) => i.id === sel); if (!it) return;
      const step = e.shiftKey ? 12 : 6;
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (mv[e.key]) { e.preventDefault(); const n = { ...it, x_in: it.x_in + mv[e.key][0], y_in: it.y_in + mv[e.key][1] }; patchItem(sel, clampInside(n, draft)); }
      else if (e.key === "r" || e.key === "R") turn(sel);
      else if (e.key === "Delete" || e.key === "Backspace") remove(sel);
      else if (e.key === "Escape") pick(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!draft) {
    return (
      <div className="vz">
        <p className="vz-sub">No room yet.</p>
        {canEdit && <button type="button" className="btn-pri" onClick={() => void newRoom()}>Start a room</button>}
      </div>
    );
  }

  const name = item ? item.label || kindOf(item.kind).name : "";
  const takeOut = async (it: Item) => { if (await confirm({ title: `Remove ${it.label || kindOf(it.kind).name} from the room?`, body: "Undo brings it back, until you save.", confirmLabel: "Remove from room", danger: true })) remove(it.id); };
  const inspector = item && (
    <Inspector key={item.id} item={item} canEdit={canEdit} room={draft} target={PROFILES[model]}
      onPatch={(p) => patchItem(item.id, p)} onTurn={() => turn(item.id)} onCopy={() => copy(item.id)}
      onRemove={() => void takeOut(item)} onClose={() => { setSel(null); setDock(false); }} />
  );
  // What a plan reviewer would circle, the schedule, the room itself: beside the canvas on a wide studio, under it on a phone.
  const evaluate = draft ? <Evaluate draft={draft} saved={original ?? null} found={found} plans={plans} checkedAs={PROFILES[model]} onLook={(id) => { const f = found.find((x) => x.ids.includes(id)); if (f) look(f); else pick(id); }} /> : null;
  const roomPanels = (
    <>
      {lens === "evaluate" && evaluate}
      {/* Heard as it changes (mounted before its words — spoken.audit); the list itself is below. */}
      <p className="sr-only" aria-live="polite">{busy ? "Saving…" : saveFailed && dirty ? `Couldn't save. Your changes are still here — Retry.` : ""}</p>
      <p className="sr-only" aria-live="polite">{found.length ? `${found.length} ${found.length === 1 ? "thing" : "things"} a plan reviewer would circle.` : ""}</p>
      {lens !== "evaluate" && found.length > 0 && (
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label="What a plan reviewer would circle">
          {found.slice(0, 8).map((f, i) => (
            <p key={i} className={f.level === "error" ? "vz-issue error" : "vz-issue warn"}><button type="button" className="btn-ter" onClick={() => look(f)}>{f.level === "error" ? "Fix" : "Look"}</button> {f.words}</p>
          ))}
          {found.length > 8 && <p className="vz-issue warn">…and {found.length - 8} more.</p>}
        </div>
      )}
      {/* THE SCHEDULE — every thing in the room (a plan set's equipment schedule): its name, its size, its pillars, found
          by typing. A tap picks it on the plan (sliding the plan to it) and in 3D. The drawing carries no numbers (S1.1b),
          so this is the list a screen reader and a long room are read from. */}
      <details className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
        <summary className="font-sans font-bold text-subhead cursor-pointer py-2">Schedule · {draft.items.length} things</summary>
        {draft.items.length > 6 && <label className="prod-f mt-1"><span>Find</span><input type="search" value={find} placeholder="Table, fridge, counter…" onChange={(e) => setFind(e.target.value)} /></label>}
        <div className="k-rows mt-2">
          {draft.items.filter((it) => !find.trim() || `${it.label ?? ""} ${kindOf(it.kind).name}`.toLowerCase().includes(find.trim().toLowerCase())).map((it) => (
            <InfoRow key={it.id} name={it.label || kindOf(it.kind).name}
              meta={`${ftIn(it.w_in)} × ${ftIn(it.d_in)} × ${ftIn(it.h_in)}${it.pillars.length ? ` · ${it.pillars.map((p) => PILLAR_WORD[p]).join(", ")}` : ""}`}
              onClick={() => setSel(it.id)} ariaLabel={`Pick ${it.label || kindOf(it.kind).name}, ${ftIn(it.w_in)} by ${ftIn(it.d_in)}`} />
          ))}
        </div>
      </details>
      {canEdit && (
        <details className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" open={size === "wide" ? true : undefined}>
          <summary className="font-sans font-bold text-subhead cursor-pointer py-2">The room · {ftIn(draft.width_in)} × {ftIn(draft.depth_in)}</summary>
          <RoomFields bare key={`${draft.id}-${draft.name}-${draft.width_in}-${draft.depth_in}-${draft.ceiling_in}`} layout={draft} onChange={(p) => commit({ ...draft, ...p })} />
          <div className="vz-row">
            <button type="button" className="btn-sec btn-sm" onClick={() => void newRoom()}>+ Another room</button>
            {dirty && <button type="button" className="btn-ter" onClick={() => { setDraft(original ?? null); setPast([]); setFuture([]); }}>Discard changes</button>}
          </div>
        </details>
      )}
    </>
  );

  // THE STUDIO (S1 — "the canvas should be the primary experience"). One workspace laid out by its own width
  // (useStudioSize): a thin bar on top; the canvas filling what's left; on a wide studio the library at the left (it folds
  // away) and the inspector at the right; on a phone the inspector docks over the canvas's foot and the library opens as a
  // sheet. Flow floats over the canvas it runs in. Full screen takes the whole display for drawing or showing.
  const lensControl = (
    <Segmented label="Lens" kind="choice" value={lens} onChange={(v) => { haptic("selection"); setLens(v); }}
      options={[{ key: "design", label: "Design" }, { key: "experience", label: "Experience" }, { key: "evaluate", label: `Evaluate${found.length ? ` · ${found.length}` : ""}` }]} />
  );
  const viewControl = <Segmented label="View" kind="choice" value={view} onChange={setView} options={[{ key: "plan", label: "Plan" }, { key: "3d", label: "3D" }, { key: "both", label: "Split" }]} />;
  // The dock earns its place (IMS1): on a phone on its side it comes in for a thing picked or Evaluate's list, else the plan
  // keeps the width.
  // Wider full screen (an iPad, a desktop) the same rule (IMS2 — measured: a 340px column of the room's lists stood beside the
  // plan with nothing picked, a quarter of an iPad on its side). The room's details — its findings, schedule, size — open
  // from the bar's Room button and stay open until closed; a thing picked opens its inspector there as before.
  const contextual = full && (side || !narrow);
  // Full screen under the widest size (a 13-inch iPad upright), the bar's words give way to their marks, so it stays one
  // line with the Room button in it (IMS2 — measured: 80px, two lines, at 1032 wide).
  const compactBar = full && size !== "wide";
  // AN UPRIGHT PHONE OR IPAD, full screen (IMS3 — measured: the bar took two rows, 80px, above the plan). One row on top —
  // Done, the room, undo, redo, save — and everything else in the dock's one row under the plan: the view, the flow, the
  // findings (one mark, its colour the most serious, its number how many) and Add.
  const upright = full && narrow && !side;
  const errors = found.filter((f) => f.level === "error").length;
  const findingsMark = (
    <button type="button" className={`k-chip vz-find${errors ? " error" : found.length ? " warn" : ""}`} aria-pressed={lens === "evaluate"}
      aria-label={found.length ? `${found.length} — Review ${found.length} finding${found.length === 1 ? "" : "s"}${errors ? `, ${errors} serious` : ""} (Evaluate)` : "✓ — nothing to review (Evaluate)"}
      onClick={() => { haptic("selection"); setLens(lens === "evaluate" ? "design" : "evaluate"); }}>
      <i aria-hidden="true" className="vz-find-dot inline-block w-2 h-2 rounded-full" />{found.length || "✓"}
    </button>
  );
  const uprightRow = (
    <div className="vz-dock-row">
      {viewControl}
      <button type="button" className={`k-chip${flowOn ? " on" : ""}`} aria-pressed={flowOn} aria-label="Experience — guests through the room" title="Flow: guests moving through the room on assumed timings — a preview of DayFlow, part of the Experience workspace" onClick={() => { haptic("selection"); setLens(flowOn ? "design" : "experience"); }}>Flow</button>
      {findingsMark}
      {canEdit && <button type="button" className="btn-pri btn-sm" aria-label="Add a fixture" title="Add a fixture" onClick={() => setAddOpen(true)}>+</button>}
    </div>
  );
  // THE DETAILS AT THE FOOT OF THE 3D (IMS4b — measured: beside a wide Split they squeezed the 3D to a 283px column, where
  // the room filled 14% of it; floating, they covered a third of the 3D room). Wider full screen, with the 3D on screen, a
  // thing's details open as a card across the foot of the 3D pane, and the 3D frames the room in the space above it. The
  // plan isn't touched (nothing moves under the finger); the plan alone, they float over its right edge as before.
  const in3d = contextual && !narrow && view !== "plan" && !!item;
  const dockShown = docked && !in3d && !(contextual && !item && lens !== "evaluate" && !(roomOpen && !narrow));
  const overlaid = contextual && dockShown;
  const cover = overlaid && view === "plan" ? Math.round(Math.min(side ? 280 : 340, width * (side ? 0.4 : 0.46))) + 20 : 0;
  const doneButton = <button type="button" className="btn-sec btn-sm" aria-pressed={full} aria-label={full ? "Done — back to the vision" : "Full screen"} title={full ? "Done (Esc)" : "Full screen"} onClick={() => { if (full) leave(); else { setDock(false); setFull(true); } }}>{full ? "Done" : size === "phone" ? "⤢" : "⤢ Full screen"}</button>;
  const studio = (
    <div ref={box} className={`vz-studio ${size === "wide" ? "wide" : size === "mid" ? "mid" : "phone"}${full ? " full" : ""}${narrow ? " narrow" : ""}${short ? " short" : ""}${side ? " side" : ""}${upright ? " upright" : ""}${libOpen && canEdit && size === "wide" && !full ? " lib" : ""}`}>
      <div className="vz-tbar" role="toolbar" aria-label="The store designer">
        <div className="vz-tbar-l">
          {upright && doneButton}
          {canEdit && size === "wide" && (
            <button type="button" className="k-icon-btn glass" aria-pressed={libOpen} aria-label={libOpen ? "Hide the library" : "Show the library"} onClick={() => setLibChoice(!libOpen)}>☰</button>
          )}
          {layouts.length > 1 ? (
            <select aria-label="Which room" value={draft.id} onChange={(e) => setLayoutId(e.target.value)} className="vz-tbar-room">
              {layouts.map((l) => { const pl = plans.find((x) => x.layout_id === l.id); return <option key={l.id} value={l.id}>{l.name}{pl ? ` — phase ${pl.phase}` : ""}</option>; })}
            </select>
          ) : <b className="vz-tbar-name">{draft.name}</b>}
          {!side && !upright && viewControl}
        </div>
        <div className="vz-tbar-r">
          {full && !narrow && (
            <button type="button" className="btn-sec btn-sm" aria-pressed={roomOpen} aria-label={roomOpen ? "Hide the room's details" : "The room's details — findings, schedule, size"} title="The room's details" onClick={() => setRoomOpen((o) => !o)}>Room</button>
          )}
          {canEdit && !upright && !(size === "wide" && libOpen && !full) && <button type="button" className="btn-pri btn-sm" aria-label="Add a fixture" title="Add a fixture" onClick={() => setAddOpen(true)}>{narrow || compactBar ? "+" : "+ Add"}</button>}
          {(size !== "phone" || side) && !upright && lensControl}
          {canEdit && (
            <>
              <button type="button" className="btn-sec btn-sm" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (⌘Z)">↶</button>
              <button type="button" className="btn-sec btn-sm" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (⇧⌘Z)">↷</button>
              <button type="button" className={dirty ? "btn-pri btn-sm" : "btn-sec btn-sm"} onClick={() => void save()} disabled={!dirty || busy}
                aria-label={busy ? "Saving" : dirty && saveFailed ? "Couldn't save · Retry" : dirty ? "Save" : "Saved"}
                title={busy ? "Saving…" : dirty && saveFailed ? `${saveFailed} — your changes are kept on this device. Retry.` : dirty ? "Unsaved changes — save. Until you do, they're kept on this device" : savedAt ? `Saved at ${new Date(savedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Everything is saved"}>
                {busy ? "Saving…" : dirty && saveFailed ? (size === "phone" || side || compactBar ? "Retry" : "Couldn't save · Retry") : dirty ? "Save" : size === "phone" || side || compactBar ? "✓" : "Saved"}</button>
            </>
          )}
          {!upright && doneButton}
        </div>
      </div>

      {/* One line under the bar: the room's numbers and the plans it's drawn for (a size that disagrees with a plan's says so). */}

      {stats && size !== "phone" && (
        // The room's size and seats stay in view; what's secondary — the pillars things are meant to serve (intent, not
        // an assessment) and the plans that use this room — folds under Room summary (IMS4). A plan whose size disagrees
        // still says so on the line.
        <div className="vz-stats vz-stats-line">
          <span><b>{stats.sqft.toLocaleString()}</b> sq ft</span>
          <span><b>{ftIn(draft.width_in)}</b> × <b>{ftIn(draft.depth_in)}</b></span>
          <span><b>{stats.seats}</b> seats</span>
          <span><b>{stats.items}</b> things</span>
          {plans.filter((x) => x.layout_id === draft.id && x.sqft != null && Math.abs(x.sqft - stats.sqft) > x.sqft * 0.1).map((pl) => (
            <span key={pl.id} className="vz-stat-warn">{FORMAT[pl.format].mark} {pl.name} says {pl.sqft!.toLocaleString("en-US")} sq ft</span>
          ))}
          <details className="vz-room-sum">
            <summary>Room summary</summary>
            <div className="vz-room-sum-body">
              <span className="vz-card-s">Pillars things are meant to serve — intent, not an assessment:</span>
              {PILLARS.map((p) => <span key={p}><i className={`inline-block w-2 h-2 rounded-full mr-1 pz-${p}`} />{PILLAR_WORD[p]} <b>{stats.pillars[p]}</b></span>)}
              {plans.filter((x) => x.layout_id === draft.id).map((pl) => <span key={pl.id}>For {FORMAT[pl.format].mark} <b>{pl.name}</b> · phase {pl.phase}</span>)}
            </div>
          </details>
        </div>
      )}

      {kept && (
        <p className="vz-issue warn">
          Unsaved changes to this room from {new Date(kept.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} were kept on this device.{" "}
          <button type="button" className="btn-ter" onClick={() => { commit(kept.draft); setKept(null); haptic("success"); }}>Bring them back</button>{" "}
          <button type="button" className="btn-ter" onClick={() => { try { localStorage.removeItem(`gt3.studio.draft.${kept.draft.id}`); } catch { /* */ } setKept(null); }}>Discard</button>
        </p>
      )}

      <div className="vz-work">
        {canEdit && size === "wide" && libOpen && !full && (
          <aside className="vz-lib mpanel mb-0" aria-label="Add to the room">
            <Library onAdd={(k) => add(k)} drag />
          </aside>
        )}
        <div ref={setStage} className={docked ? "vz-stage docked" : "vz-stage"}>
          <div ref={storeEl} className={view === "both" ? "vz-store both" : "vz-store"}>
            {view !== "3d" && (
              <div className={`vz-pane mpanel mb-0 relative min-w-0 overflow-hidden${view === "both" && activePane === "plan" ? " active" : ""}`} onPointerDownCapture={() => setActivePane("plan")}>
                <PlanView layout={draft} selected={sel} bad={bad} focus={focus} focusPath={focusPath} canEdit={canEdit} onSelect={pick} flow={flow}
                  onMove={(id, at, done) => patchItem(id, at, done)} onResize={(id, p) => patchItem(id, p, false)}
                  onBegin={() => { if (draft) setPast((p) => [...p.slice(-59), draft]); setFuture([]); }}
                  onDropKind={canEdit ? (k, at) => add(k, at) : undefined}
                  onTurn={turn} onCopy={copy} onRemove={(id) => { const it = draft.items.find((i) => i.id === id); if (it) void takeOut(it); }}
                  onDetails={details} cover={cover} />
              </div>
            )}
            {view === "both" && size !== "phone" && (
              <div className="vz-divider" role="separator" aria-orientation="vertical" aria-label="Plan and 3D — drag, or use the arrow keys, to share the space"
                aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(split * 100)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); setSplitKept(split - 0.05); } else if (e.key === "ArrowRight") { e.preventDefault(); setSplitKept(split + 0.05); } else if (e.key === "Home") { e.preventDefault(); setSplitKept(0.55); } }}
                onDoubleClick={() => setSplitKept(0.55)}
                onPointerDown={(e) => { const r = storeEl.current?.getBoundingClientRect(); if (!r) return; e.currentTarget.setPointerCapture?.(e.pointerId); splitDrag.current = { x0: e.clientX, w: r.width, s0: split }; }}
                onPointerMove={(e) => { const d = splitDrag.current; if (d) setSplitKept(d.s0 + (e.clientX - d.x0) / d.w); }}
                onPointerUp={() => { splitDrag.current = null; }} onPointerCancel={() => { splitDrag.current = null; }} />
            )}
            {view !== "plan" && (
              <div className={`vz-pane mpanel mb-0 relative min-w-0${view === "both" && activePane === "3d" ? " active" : ""}`} onPointerDownCapture={() => setActivePane("3d")}>
                <Store3D layout={draft} keep={draft.id} tools inset={in3d ? cardH : 0} selected={sel} onPick={pick} figures={figures} heat={flow?.heat} label={`${draft.name}, in 3D — drag to turn, pinch to come closer`} />
                <p className="vz-hint">Drag to turn · pinch or scroll to zoom · double-tap: corner view</p>
                {in3d && inspector && <div ref={cardRef} className="vz-dock mpanel mb-0 in3d" aria-label="What's picked">{inspector}</div>}
              </div>
            )}
          </div>

          {/* On its side the view floats at the canvas's top left, over the margin the room is centred in (IMS1). */}
          {side && <div className="vz-float-view">{viewControl}</div>}

          {/* FLOW floats over the room it runs in — the plan stays whole on screen while it runs. */}
          {flowOn && (
            <div className="vz-float-flow mpanel mb-0">
              <FlowBar on={flowOn} onToggle={() => setLens("design")} perHour={perHour} onPerHour={setPerHour} speed={speed} onSpeed={setSpeed} frame={flow} floating />
            </div>
          )}

          {/* DOCKED (a phone; full screen): what's picked sits in a dock that is always there — under the drawing on a phone,
              beside it full screen — so picking never moves the drawing under your finger. A phone shows a line (its name,
              size, why) and opens the rest as a sheet over the drawing; full screen shows the inspector in the dock. */}
          {dockShown && (
            // Contextual (IMS2): it comes in over the canvas's edge, not beside it — the plan keeps its size, so picking a thing
            // never moves the drawing under the finger (measured: the column squeezing in shifted the thing picked 14–79px).
            <div className={overlaid ? "vz-dock mpanel mb-0 over" : "vz-dock mpanel mb-0"} aria-label="What's picked">
              {!item ? (narrow ? (
                // A phone (S1.1b): with nothing picked, the dock holds the lens — the drawing keeps the whole height above
                // it (measured: the lens in the bar, or on its own line, cost an iPhone SE a tenth of the plan's size).
                <div className="flex flex-col gap-2">
                  {upright ? uprightRow : size === "phone" && !side && lensControl}
                  {lens === "evaluate" ? evaluate : size === "phone" || upright ? <p className="sr-only">{canEdit ? "Pick a thing on the plan to move, size or turn it." : "Pick a thing on the plan to see why it's there."}</p> : <p className="vz-card-s">{canEdit ? "Pick a thing to move, size or turn it." : "Pick a thing to see why it's there."}</p>}
                </div>) : roomPanels)
                : !narrow ? inspector : (
                <div className="vz-dock-peek">
                  <div className="min-w-0">
                    <b className="font-sans text-body">{name}</b>
                    <p className="vz-card-s">{ftIn(item.w_in)} × {ftIn(item.d_in)}</p>
                  </div>
                  <button type="button" className="btn-sec btn-sm" onClick={() => setDock(true)}>{canEdit ? "Edit" : "Why"}</button>
                </div>
              )}
            </div>
          )}
          {narrow && dock && item && (
            <Sheet open onClose={() => setDock(false)} label={`${name} — its size and why it's there`}>{inspector}</Sheet>
          )}
          {/* The count of findings over the canvas — not on a phone, where the dock holds the lens and "Evaluate · n" says it
              (S1.1c, measured: the chip sat on the lens control). */}
          {full && size !== "phone" && !upright && found.length > 0 && !item && (
            <button type="button" className={found.some((f) => f.level === "error") ? "k-chip vz-pill-issue error" : "k-chip vz-pill-issue"} onClick={() => { haptic("selection"); setLens("evaluate"); }}>
              {/* The one review queue (IMS4): the same findings as Evaluate's count, opening the same list. */}
              Review {found.length} finding{found.length === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {!docked && (
          <aside className="vz-side" aria-label="What's picked, and the room">
            {inspector}
            {!item && canEdit && <p className="vz-card-s">Pick a thing on the plan or in 3D — its size, which way it faces and why it&apos;s there open here.</p>}
            {roomPanels}
          </aside>
        )}
      </div>
      {narrow && !full && <div className="vz-below">{roomPanels}</div>}

      {addOpen && (
        <Sheet open onClose={() => setAddOpen(false)} label="Add to the room" header={<b className="font-sans text-subhead">Add to the room</b>}>
          <Library onAdd={(k) => { add(k); setAddOpen(false); }} />
        </Sheet>
      )}
    </div>
  );

  return full && host ? createPortal(studio, host) : studio;
}

// ── the library: everything the room can hold, found by name or by part of the store; dragged onto the plan or added ──
const SHELF = ["All", ...GROUPS] as const;
function Library({ onAdd, drag = false }: { onAdd: (kind: string) => void; drag?: boolean }) {
  const [q, setQ] = useState("");
  const [shelf, setShelf] = useState<(typeof SHELF)[number]>("All");
  const words = q.trim().toLowerCase();
  const shown = CATALOG.filter((c) => (shelf === "All" || c.group === shelf) && (!words || c.name.toLowerCase().includes(words) || (c.why ?? "").toLowerCase().includes(words)));
  return (
    <div className="vz-library">
      <input type="search" className="vz-lib-q" placeholder="Find a fixture" aria-label="Find a fixture" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="vz-lib-shelves" role="group" aria-label="Part of the store">
        {SHELF.map((g) => <button key={g} type="button" className={`k-chip${shelf === g ? " on" : ""}`} aria-pressed={shelf === g} onClick={() => setShelf(g)}>{g}</button>)}
      </div>
      {shelf === "Bar" && <p className="vz-card-s">The bar — cold, clean, no espresso.</p>}
      <ul className="vz-lib-list">
        {shown.map((c) => (
          <li key={c.kind}>
            <button type="button" className="vz-lib-row" onClick={() => onAdd(c.kind)} draggable={drag}
              onDragStart={drag ? (e) => { e.dataTransfer.setData(KIND_MIME, c.kind); e.dataTransfer.effectAllowed = "copy"; } : undefined}
              aria-label={`Add ${c.name}, ${ftIn(c.w)} by ${ftIn(c.d)}`}>
              <svg viewBox="0 0 14 14" aria-hidden="true"><rect width="14" height="14" rx="3" fill={c.color} /></svg>
              <span className="min-w-0"><b>{c.name}</b><small>{ftIn(c.w)} × {ftIn(c.d)}</small></span>
              <em aria-hidden="true">+</em>
            </button>
          </li>
        ))}
        {!shown.length && <li className="vz-card-s">Nothing by that name. Try another word, or All.</li>}
      </ul>
      {drag && <p className="vz-card-s">Drag one onto the plan to place it, or tap to add it in the middle.</p>}
    </div>
  );
}

const EMPTY_ROOM: Pick<Layout, "width_in" | "depth_in" | "items"> = { width_in: 0, depth_in: 0, items: [] };

// Full screen goes to the app's own root (as the sheets do): inside the scrolling body an iPhone stacks a fixed layer under
// the tab bar.
const noSubscribe = () => () => {};
const findHost = (): HTMLElement | null => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".app") ?? document.body);
const noHost = (): HTMLElement | null => null;

// ── a thing's inspector: what it is, its size, which way it faces, and why it's there ──
function Inspector({ item, canEdit, room, target, onPatch, onTurn, onCopy, onRemove, onClose }: {
  item: Item; canEdit: boolean; room: Layout; target: { name: string; routeIn: number }; onPatch: (p: Partial<Item>) => void; onTurn: () => void; onCopy: () => void; onRemove: () => void; onClose: () => void;
}) {
  const k = kindOf(item.kind);
  const [w, setW] = useState(ftIn(item.w_in)), [d, setD] = useState(ftIn(item.d_in)), [h, setH] = useState(ftIn(item.h_in));
  const [why, setWhy] = useState(item.why ?? "");
  const [label, setLabel] = useState(item.label ?? "");
  const size = (which: "w_in" | "d_in" | "h_in", raw: string, reset: (v: string) => void) => {
    const v = parseFtIn(raw);
    if (v == null || v <= 0 || v > 2400) { reset(ftIn(item[which])); return; }
    const next = { ...item, [which]: v };
    onPatch({ [which]: v, ...clampInside(next, room) });
    reset(ftIn(v));
  };
  const name = item.label || k.name;
  if (!canEdit) {
    return (
      <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
        <div className="vz-row justify-between"><b className="font-sans text-body">{name}</b><button type="button" className="btn-ter" onClick={onClose}>Close details</button></div>
        <p className="vz-card-s">{ftIn(item.w_in)} × {ftIn(item.d_in)}, {ftIn(item.h_in)} tall</p>
        {item.why && <p className="vz-sub">{item.why}</p>}
        {item.pillars.length > 0 && <p className="vz-card-s">Meant to serve — intent, not an assessment:</p>}
        {item.pillars.length > 0 && <div className="vz-pillars">{item.pillars.map((p) => <span key={p} className="vz-pill"><i className={`inline-block w-2 h-2 rounded-full pz-${p}`} />{PILLAR_WORD[p]}</span>)}</div>}
      </div>
    );
  }
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label={`${name} — its size and why it's there`}>
      <div className="vz-row justify-between">
        <b className="font-sans text-body">{k.name}</b>
        <button type="button" className="btn-ter" onClick={onClose}>Close details</button>
      </div>
      {/* PROGRESSIVE DISCLOSURE (IMS4): what's changed most — its name, its size, rotate and duplicate — first; why it's here
          and the pillars it's meant to serve folded under Purpose & experience; removing it apart, at the foot. */}
      <label className="prod-f"><span>Its name in the room</span>
        <input value={label} placeholder={k.name} maxLength={80} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if ((label.trim() || null) !== item.label) onPatch({ label: label.trim() || null }); }} /></label>
      <div className="vz-dims">
        <label className="prod-f"><span>Width</span><input inputMode="text" value={w} onChange={(e) => setW(e.target.value)} onBlur={() => size("w_in", w, setW)} aria-label="Width, in feet and inches" /></label>
        <label className="prod-f"><span>Depth</span><input inputMode="text" value={d} onChange={(e) => setD(e.target.value)} onBlur={() => size("d_in", d, setD)} aria-label="Depth, in feet and inches" /></label>
        <label className="prod-f"><span>Height</span><input inputMode="text" value={h} onChange={(e) => setH(e.target.value)} onBlur={() => size("h_in", h, setH)} aria-label="Height, in feet and inches" /></label>
      </div>
      {/* MEASUREMENT HELP, SHORT (IMS4b): the one line that matters stays; how it's measured opens on asking. */}
      <p className="vz-card-s">Distances shown are to walls, not verified walking clearances.</p>
      <details className="vz-help">
        <summary aria-label="How sizes and distances work">ⓘ How these are measured</summary>
        <ul className="vz-card-s">
          <li>Type a size as 6′ 2″, 6 2 or 74 (inches).</li>
          <li>The lines on the plan run from this thing&apos;s footprint, as drawn and turned, to each wall.</li>
          <li>Walking routes are checked separately, on the room&apos;s 2D footprints, against a {ftIn(target.routeIn)} design target — GT3&apos;s working default for a {target.name.toLowerCase()}. Door swings are counted; chairs pulled out, people and heights are not.</li>
          <li>This is a design check, not a code check. Accessibility, egress and local building rules need a qualified review.</li>
        </ul>
      </details>
      <div className="vz-row">
        <button type="button" className="btn-sec btn-sm" onClick={onTurn}>↻ Rotate</button>
        <button type="button" className="btn-sec btn-sm" onClick={onCopy}>Duplicate</button>
      </div>
      <details className="vz-purpose">
        <summary className="font-sans font-bold text-subhead cursor-pointer py-2">Purpose &amp; experience</summary>
        <div className="flex flex-col gap-2">
          <label className="prod-f"><span>Why it&apos;s here</span>
            <textarea rows={3} value={why} maxLength={1000} onChange={(e) => setWhy(e.target.value)} onBlur={() => { if ((why.trim() || null) !== item.why) onPatch({ why: why.trim() || null }); }} /></label>
          <p className="vz-card-s">The pillars it&apos;s meant to serve — design intent, not an assessment. Whether it meets the Standard is judged in The Standard, with evidence.</p>
          <div className="vz-pillars" role="group" aria-label="The pillars it's meant to serve (intent)">
            {PILLARS.map((p) => {
              const on = item.pillars.includes(p);
              return <button key={p} type="button" className={`k-chip${on ? " on" : ""}`} aria-pressed={on}
                onClick={() => onPatch({ pillars: (on ? item.pillars.filter((x) => x !== p) : [...item.pillars, p]) as Pillar[] })}>{PILLAR_WORD[p]}</button>;
            })}
          </div>
        </div>
      </details>
      <div className="vz-row vz-insp-foot">
        <button type="button" className="btn-del" onClick={onRemove}>Remove from room</button>
      </div>
    </div>
  );
}

// ── the room itself ──
function RoomFields({ layout, onChange, bare = false }: { layout: Layout; onChange: (p: Partial<Layout>) => void; bare?: boolean }) {
  const [name, setName] = useState(layout.name);
  const [w, setW] = useState(ftIn(layout.width_in)), [d, setD] = useState(ftIn(layout.depth_in)), [c, setC] = useState(ftIn(layout.ceiling_in));
  const dim = (which: "width_in" | "depth_in" | "ceiling_in", raw: string, reset: (v: string) => void, lo: number) => {
    const v = parseFtIn(raw);
    if (v == null || v < lo || v > 2400) { reset(ftIn(layout[which])); return; }
    if (v !== layout[which]) onChange({ [which]: v });
    reset(ftIn(v));
  };
  return (
    <div className={bare ? "flex flex-col gap-2" : "vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5"} aria-label="The room">
      {!bare && <b className="font-sans text-subhead">The room</b>}
      <label className="prod-f"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== layout.name) onChange({ name: name.trim() }); }} /></label>
      <div className="vz-dims">
        <label className="prod-f"><span>Width</span><input value={w} onChange={(e) => setW(e.target.value)} onBlur={() => dim("width_in", w, setW, 96)} aria-label="Room width" /></label>
        <label className="prod-f"><span>Depth</span><input value={d} onChange={(e) => setD(e.target.value)} onBlur={() => dim("depth_in", d, setD, 96)} aria-label="Room depth" /></label>
        <label className="prod-f"><span>Ceiling</span><input value={c} onChange={(e) => setC(e.target.value)} onBlur={() => dim("ceiling_in", c, setC, 84)} aria-label="Ceiling height" /></label>
      </div>
      <label className="prod-f"><span>Notes</span><textarea rows={2} defaultValue={layout.notes ?? ""} maxLength={2000} onBlur={(e) => { if ((e.target.value.trim() || null) !== layout.notes) onChange({ notes: e.target.value.trim() || null }); }} /></label>
    </div>
  );
}
