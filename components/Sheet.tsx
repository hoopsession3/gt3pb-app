"use client";

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Icon from "./Icon";
import type { SheetMotionProps } from "./SheetMotion";
import { haptic } from "@/lib/haptics";
import { appHistory } from "@/lib/appHistory";

// The pull and the sideways walk load with the first sheet that opens (components/SheetMotion's header).
const SheetMotion = dynamic<SheetMotionProps>(() => import("./SheetMotion"), { ssr: false });

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// THE canonical popout. One implementation, so the scroll contract, safe-area, keyboard-awareness,
// spring-in, and swipe-to-dismiss are guaranteed identical everywhere — no per-sheet drift. Bottom
// sheet on phones, centered modal ≥520px. Structure: scrim (flex) > panel (flex column) > grab ·
// [header] · body (the only scroll region) · [footer]. Respects prefers-reduced-motion via the global
// guard.
//
// PULL IT DOWN FROM ANYWHERE (2026-10-05, the gesture round). Ryan, with the Inbox open: "I have to hit
// the X button to get out of here." The pull used to live on the grab bar and the title strip only —
// 24px and a header — and the list, where a thumb actually is, scrolled and nothing else. Now the whole
// sheet follows the finger the way an iPhone sheet does (components/useGesture; the rules are
// lib/gesture's): from the grab bar, the header or the footer in either direction (up is a rubber
// band); from the content once it is scrolled to its top and the finger heads down — scrolled down, the
// content scrolls first, as on the phone. The scrim lightens as it goes. Let go past half the sheet (or
// a thumb's reach, for a tall one) — or flick it — and it leaves at the finger's speed; short of that
// it springs back. A field being typed in, a slider, a strip that scrolls sideways keeps its own
// touches; a part that handles its own swipes says so with data-gesture.
//
// ONE DOOR OUT, TWO RULES. Every way of leaving — the pull, a tap outside, Escape, the X (CloseButton)
// — comes through `leave`, so all of them keep the same two promises: a sheet that cannot be left right
// now (`dismissible={false}`: a payment running) stays put, and a form holding typed changes (`dirty`)
// asks "Discard your changes?" instead of throwing them away — the way an iPhone form sheet does. The
// pull makes leaving one flick away, so the second promise is what keeps it from costing anyone a form.
export default function Sheet({
  open, onClose, header, footer, children, className = "", labelledBy, label, bodyRef,
  dirty = false, dismissible = true, page,
}: {
  open: boolean;
  onClose: () => void;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  // Accessible name for the dialog (a11y: dialog-name). Use `labelledBy` to point at a title element,
  // or `label` for a plain string. If neither is given we fall back to "Dialog" so the modal is never
  // nameless — every caller SHOULD pass one of them, but the fallback guarantees axe never fails here.
  label?: string;
  // Optional ref onto the scroll body — for a sheet that needs to control its own scroll position
  // (e.g. auto-scrolling a chat transcript to the latest message). Every sheet shares this one scroll
  // region by contract; this just exposes a handle to it instead of a per-sheet nested scroll div.
  bodyRef?: RefObject<HTMLDivElement | null>;
  /** Something typed here is not saved yet: leaving by any door asks first. The form knows; say so —
   *  here, from the component that renders the sheet, or with useUnsaved from a form inside it. */
  dirty?: boolean;
  /** False while leaving would break something under way (a card being charged): every door holds. */
  dismissible?: boolean;
  /** A sheet that walks a list (the calendar's editor): a sideways swipe goes to the item before or
   *  after. Leave a side out at that end of the list. */
  page?: { prev?: () => void; next?: () => void };
}) {
  // Portal the sheet out of wherever it was rendered (2026-07-30). Most callers live inside
  // <main class="body">, and .body is a stacking-context trap on iOS (-webkit-overflow-scrolling:
  // touch, plus zoom under the readability tiers) — a fixed scrim rendered inside it stacks UNDER
  // the bottom nav (z 30) no matter that the scrim says z 80. That's the "blurred screen with
  // nothing tappable" / "can't reach the sheet's fields" bug (membership sheet screenshot: the
  // scrim's backdrop blur painted, the panel's lower half hid behind the nav). Portal target is
  // .app, NOT document.body: the theme variables (--bg for crew day mode) live on .app, and .app
  // creates no stacking context of its own, so the sheet joins the root context and outranks the
  // nav everywhere. Falls back to body if .app is ever absent.
  const host = useSyncExternalStore(noSubscribe, findHost, noHost);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const ownBody = useRef<HTMLDivElement | null>(null);
  // The sheet's own handle on its scroll body (the pull asks where the finger landed), shared with a
  // caller that passed `bodyRef`. One stable callback, so React does not detach and re-attach it on
  // every render.
  const bodyHandle = useCallback((el: HTMLDivElement | null) => { ownBody.current = el; if (bodyRef) bodyRef.current = el; }, [bodyRef]);
  const restoreRef = useRef<HTMLElement | null>(null);
  // WHO OPENED IT (2026-10-08, the foundations round). Most sheets mount already open ({x && <Sheet open>}),
  // and a field inside with autoFocus takes focus while React commits them — before any effect here runs — so
  // the effect below used to remember that field as "what was focused before", and closing by X, Cancel or
  // Save gave focus back to nobody (<body>): a keyboard or screen-reader user started again from the top of
  // the page. The button that was pressed is read here instead, while the sheet first renders, before any of
  // its children exist.
  const [openedFrom] = useState<HTMLElement | null>(() => (open && typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null));
  const usedOpener = useRef(false);
  const askId = useId();
  const [me] = useState(() => Symbol("sheet"));
  // "Discard your changes?" — open while it holds what to do on "Discard".
  const [ask, setAsk] = useState<(() => void) | null>(null);
  // Exit choreography: when `open` flips false, keep rendering ~220ms with the `out` class so the
  // sheet leaves the way it arrived. Works for every close path since it watches the prop itself;
  // the timeout (not animationend) guarantees unmount even under reduced-motion or missing CSS.
  //
  // THE SHEET THAT NEVER LEFT (2026-10-02). For an always-mounted caller (Checkout, DrinkSheet —
  // `<Sheet open={open}>` with the prop doing the work), a close by Escape or a tap on the scrim
  // went: requestClose → phase "closing" → 210ms → onClose() → parent flips `open` → this effect
  // runs, sees phase is not "open", and returns it unchanged — nothing ever scheduled "closed". The
  // sheet stayed mounted for ever, invisible (opacity 0, pointer-events none), with its scrim still
  // in the DOM — and `body:has(.sheet2-scrim) .rail{display:none}` then hid the quick-action rail
  // for the rest of the visit. Measured on production: tap a drink, tap outside it, the ‹ handle
  // is gone until a reload. The open prop now finishes the job whichever path started it: from
  // "open" it plays the exit; from "closing" (a door inside the sheet already played it) it unmounts.
  //
  // IN AN EFFECT, ON PURPOSE (2026-10-05). For one round this followed the prop while rendering —
  // React's pattern for state derived from a prop, and one lint problem fewer. On the menu it lost a
  // close: "Add to order" closes the drink's sheet and, in the same tap, mounts the checkout behind
  // it; React dropped that render and kept half of what it had set — the prop "seen" closed, the
  // phase still open — and the sheet stayed up, the rail hidden under its scrim. An effect cannot be
  // half-applied. scripts/smoke.ui.mjs walks exactly that path.
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");
  // The pull already carried the sheet off: the stylesheet's exit must not play it again from the top.
  const [gone, setGone] = useState(false);
  // A door inside the sheet started the exit (finish): when the prop follows, the exit has played.
  const selfClosing = useRef(false);
  useEffect(() => {
    if (open) { selfClosing.current = false; setPhase("open"); setGone(false); return; }
    setPhase((p) => (p === "closed" ? p : "closing"));
  }, [open]);
  useEffect(() => {
    if (open || phase !== "closing") return;
    const t = setTimeout(() => setPhase("closed"), selfClosing.current ? 20 : 230);
    return () => clearTimeout(t);
  }, [open, phase]);
  // Most callers mount conditionally ({x && <Sheet open …>}), so the prop never flips — the sheet
  // owns its own exit for the gesture paths: play the out animation, THEN tell the parent to
  // unmount. Buttons inside children that close directly still work (they just skip the animation).
  //
  // A PARENT THAT SAYS NO (2026-10-05). The checkout used to hand the sheet a do-nothing onClose while
  // a card was being charged: a tap outside then faded the sheet out, the parent kept it, and it stayed
  // invisible — with the "Order in." that followed it. A payment holds the sheet with `dismissible`
  // now; and any parent that still declines a close gets its sheet back, on screen, instead of a ghost.
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keptT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNow = useRef(open);
  useLayoutEffect(() => { openNow.current = open; });
  const finish = useCallback((ms: number, played: boolean) => {
    if (closeT.current) return;
    if (played) setGone(true);
    selfClosing.current = true;
    setPhase("closing");
    // Restore focus now, not on a later phase==="closed" — for the common conditionally-mounted
    // caller ({x && <Sheet .../>}) the parent unmounts the whole subtree as soon as onClose fires
    // below, so an effect gated on a future phase transition never gets the chance to run (verified:
    // that transition is also unreachable via this path even when the parent keeps rendering, since
    // phase is already "closing" by the time the open-prop effect would react to onClose's result).
    if (restoreRef.current) {
      const el = restoreRef.current;
      restoreRef.current = null;
      el.focus?.();
    }
    closeT.current = setTimeout(() => {
      closeT.current = null;
      onClose();
      keptT.current = setTimeout(() => {
        keptT.current = null;
        if (!openNow.current) return;
        selfClosing.current = false;
        setPhase("open"); setGone(false);
        const panel = panelRef.current;
        if (panel) { panel.style.transition = ""; panel.style.transform = ""; panel.style.opacity = ""; }
        scrimRef.current?.style.removeProperty("--scrim");
      }, 400);
    }, ms);
  }, [onClose]);
  const requestClose = useCallback(() => finish(210, false), [finish]);
  useEffect(() => () => { if (closeT.current) clearTimeout(closeT.current); if (keptT.current) clearTimeout(keptT.current); }, []);

  // A sheet that cannot be left right now says so with a small give, the way a held iPhone sheet does.
  // FELT AS WELL AS SEEN (2026-10-05, the haptics round): the give is the boundary feel — nothing
  // further that way. The pull's own refusal (components/SheetMotion) says the same.
  const nudge = useCallback(() => {
    haptic("boundary");
    panelRef.current?.animate?.([{ transform: "translateY(0)" }, { transform: "translateY(7px)" }, { transform: "translateY(0)" }], { duration: 260, easing: "ease-out" });
  }, []);
  // Forms inside the sheet that say they hold unsaved changes (useUnsaved) — read when someone leaves.
  const inner = useRef(new Map<symbol, boolean>());
  const unsaved = useCallback(() => dirty || [...inner.current.values()].some(Boolean), [dirty]);
  // "Discard your changes?" is asked from here, whichever door asked it — a tap outside, Escape, the X,
  // the pull, the sideways walk — and it arrives with the warning feel: stop, something would be lost.
  const askFor = useCallback((go: () => void) => { haptic("warning"); setAsk(() => go); }, []);
  /** THE ONE DOOR OUT — see the header. `go` is how this particular way out leaves. */
  const leave = useCallback((go: () => void) => {
    if (!dismissible) { nudge(); return; }
    if (unsaved()) { askFor(go); return; }
    go();
  }, [dismissible, unsaved, nudge, askFor]);
  const attempt = useCallback(() => leave(requestClose), [leave, requestClose]);
  const door = useMemo(() => ({
    leave,
    mark: (id: symbol, d: boolean) => { if (d) inner.current.set(id, true); else inner.current.delete(id); },
  }), [leave]);

  // BACK CLOSES THE SHEET (2026-10-08, the navigation round, approved). An open sheet is a step in the app's
  // history (lib/appHistory): Back — Android's, the browser's — comes here first, and goes through the same
  // door as Escape: a held sheet stays, a form with typed changes asks, and with that question showing, Back
  // answers it "Keep editing". True when the sheet is leaving.
  const onBack = useEffectEvent((): boolean => {
    if (ask) { setAsk(null); return false; }
    if (!dismissible) { nudge(); return false; }
    if (unsaved()) { askFor(requestClose); return false; }
    requestClose();
    return true;
  });
  // Open sheets, newest on top: Escape belongs to the top one. Every sheet used to listen on the window
  // and close itself, so one keypress closed a sheet AND the sheet it was opened from — taking the
  // inner one's unsaved form with it.
  useEffect(() => {
    if (phase !== "open") return;
    stack.push(me);
    const end = appHistory()?.step({ back: () => onBack() });
    return () => { end?.(); const i = stack.lastIndexOf(me); if (i >= 0) stack.splice(i, 1); };
  }, [phase, me]);
  const onEscape = useEffectEvent((e: KeyboardEvent) => {
    // A field that uses Escape itself (an inline edit cancelling) has said so with preventDefault.
    if (e.key !== "Escape" || e.defaultPrevented || stack[stack.length - 1] !== me) return;
    if (ask) { setAsk(null); return; }
    attempt();
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => onEscape(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus management: remember what was focused when the sheet opens, move focus into the panel;
  // restore it once the exit animation finishes and the sheet actually unmounts (phase === "closed"),
  // not on the `open` prop flip — closing plays out over ~210-230ms and shouldn't yank focus early.
  useEffect(() => {
    if (phase !== "open") return;
    const opener = !usedOpener.current ? openedFrom : null;
    usedOpener.current = true;
    restoreRef.current = opener ?? (document.activeElement as HTMLElement) ?? null;
    const raf = requestAnimationFrame(() => {
      if (panelRef.current?.contains(document.activeElement)) return;   // a field inside took focus itself (autoFocus)
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [phase, openedFrom]);
  // Unmounted by its parent (X, Cancel, Save — the common case): focus goes back to the opener, unless it
  // has already gone somewhere real.
  useEffect(() => () => {
    const el = restoreRef.current;
    if (!el || !el.isConnected) return;
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return;
    requestAnimationFrame(() => el.focus?.());
  }, []);
  useEffect(() => {
    if (phase !== "closed" || !restoreRef.current) return;
    const el = restoreRef.current;
    restoreRef.current = null;
    requestAnimationFrame(() => el.focus?.());
  }, [phase]);
  const onTab = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Tab" || stack[stack.length - 1] !== me) return;
    const scope = (ask ? scrimRef.current?.querySelector<HTMLElement>(".sheet2-ask-scrim") : null) ?? panelRef.current;
    const items = Array.from(scope?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  useEffect(() => {
    if (phase === "closed") return;
    const onKeyDown = (e: KeyboardEvent) => onTab(e);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase]);

  // ── the pull (components/SheetMotion) ──
  const live = !!host && phase === "open";

  if (phase === "closed" || !host) return null;
  const out = phase === "closing" ? (gone ? " out gone" : " out") : "";
  const keep = () => { setAsk(null); requestAnimationFrame(() => panelRef.current?.focus()); };
  return createPortal(
    <div className={`sheet2-scrim${out}`} ref={scrimRef} onClick={attempt}>
      <div className={`sheet2 ${className}${out}`} ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : (label ?? "Dialog")} inert={ask ? true : undefined}
        onClick={(e) => e.stopPropagation()}>
        {live && <SheetMotion panel={panelRef} scrim={scrimRef} body={ownBody} asking={!!ask} dismissible={dismissible} unsaved={unsaved}
          ask={askFor} requestClose={requestClose} finish={finish} page={page} />}
        <SheetCtx.Provider value={door}>
          <div className="sheet2-grab" aria-hidden />
          {header && <div className="sheet2-head">{header}</div>}
          <div className="sheet2-body" ref={bodyHandle}>{children}</div>
          {footer && <div className="sheet2-foot">{footer}</div>}
        </SheetCtx.Provider>
      </div>
      {/* The question an iPhone form sheet asks, where it asks it: over the sheet, at the thumb. */}
      {ask && (
        <div className="sheet2-ask-scrim" role="alertdialog" aria-modal="true" aria-labelledby={askId} onClick={(e) => { e.stopPropagation(); keep(); }}>
          <div className="sheet2-ask-card" onClick={(e) => e.stopPropagation()}>
            <p className="sheet2-ask-t" id={askId}>Discard your changes?</p>
            <p className="sheet2-ask-s">What you typed here isn&apos;t saved yet.</p>
            <button type="button" className="sheet2-ask-go" onClick={() => { const go = ask; setAsk(null); go(); }}>Discard changes</button>
            <button type="button" className="sheet2-ask-no" autoFocus onClick={keep}>Keep editing</button>
          </div>
        </div>
      )}
    </div>,
    host,
  );
}

// Where a sheet is portaled (see the note at the top of Sheet): read once the page is there, nothing on
// the server.
const noSubscribe = () => () => {};
const findHost = () => document.querySelector<HTMLElement>(".app") ?? document.body;
const noHost = () => null;

// Open sheets, oldest first — the top one answers Escape, and the edge swipe back stands down while
// any is open (it would walk the screen behind the sheet).
const stack: symbol[] = [];
export const sheetOpen = (): boolean => stack.length > 0;

const SheetCtx = createContext<{ leave: (go: () => void) => void; mark: (id: symbol, dirty: boolean) => void } | null>(null);

/** The open sheet's door out, for a control inside it that leaves (or walks away from) the form —
 *  null outside a sheet. `door(go)` does `go` now, or after "Discard changes", or not at all while
 *  the sheet is held (see the header). */
export const useSheetDoor = () => useContext(SheetCtx)?.leave ?? null;

/** A form inside a sheet says it holds typed changes that are not saved — the sheet asks before any
 *  way out discards them. For a form the sheet's own renderer cannot see (a body component). */
export function useUnsaved(dirty: boolean): void {
  const ctx = useContext(SheetCtx);
  const [id] = useState(() => Symbol("form"));
  useEffect(() => { ctx?.mark(id, dirty); }, [ctx, id, dirty]);
  useEffect(() => () => ctx?.mark(id, false), [ctx, id]);
}

/** A form's Cancel — or any button inside a sheet that leaves it — through the same door as the X. */
export function LeaveButton({ onClick, className, disabled, style, children }: { onClick: () => void; className?: string; disabled?: boolean; style?: CSSProperties; children: ReactNode }) {
  const leave = useSheetDoor();
  return <button type="button" className={className} disabled={disabled} style={style} onClick={() => (leave ? leave(onClick) : onClick())}>{children}</button>;
}

/**
 * THE CLOSE BUTTON — one of them.
 *
 * "Close this panel" was written out 42 times as a raw <button className="qd-x">, under 38 different
 * CSS class names across the app. Eleven of the 42 carried no title and no aria-label, which makes
 * an icon-only button an unlabelled control — a screen reader announces "button" and stops. Thirty-
 * four repeated an inline style={{ marginLeft: "auto" }} that .qd-x has set in CSS since line 2365,
 * so the inline copy was doing nothing at all.
 *
 * One copy of the correct markup is cheaper than 42 chances to forget the label. Inside a sheet it is
 * one of the sheet's doors out (2026-10-05): a form with typed changes asks before the X loses them.
 */
export function CloseButton({ onClick, label = "Close", className = "qd-x" }: {
  onClick: () => void; label?: string; className?: string;
}) {
  const leave = useSheetDoor();
  return (
    <button type="button" className={className} onClick={() => (leave ? leave(onClick) : onClick())} title={label} aria-label={label}>
      <Icon name="close" />
    </button>
  );
}
