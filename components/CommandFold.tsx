"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InfoRow } from "./kit";
import { useCrumb } from "./Crumbs";
import { useBackStep } from "./useBackStep";
import { usePagerLevel } from "./SwipePager";
import { OPEN_PANEL_EVENT } from "@/lib/anchors";

// THE REST OF COMMAND FOLDS (2026-10-12, the Command audit, approved). Command answers one question —
// where does the business need a leader? — and it was 2,979 points tall on an iPhone 17, three and a half
// screens: the initiatives with every milestone, the launch's gates, a Blockers block, the Chief of Staff,
// every goal card and all twelve numbers, each drawn in full under the portfolio. Below today's event, the
// portfolio and the team's week, each of the rest is one row now — its name, one line of how it stands, a
// count — the anatomy of Money's report rows (a <Panel> that says what it holds). A tap opens it as its own
// screen, the way a stop opens from Readiness and a list from Plan: its name is the title, "‹ Command" the
// way back (the bar's ‹, the edge swipe, a swipe toward Command, Android's Back), and the desk keeps its
// crumb, "Command › Goals". Nothing is taken away: each screen is the board it was.
//
// The board behind a row is the same component the row is: it loads once, its row reads from what it loaded,
// and its screen is drawn into Command's view (a portal), so what it holds — a briefing just run, a half-typed
// goal — is still there after Back. Command's own page stays mounted under the view, hidden, so Back finds it
// where it was left. A link to a row's id opens it, as a link to a <Panel> does (lib/anchors); a link to
// anything else on Command, while a row is open, closes the row first.

type Opened = { id: string; title: string };
type Views = { open: Opened | null; show: (o: Opened) => void; slot: HTMLElement | null };
const ViewCtx = createContext<Views | null>(null);

/** Command's page: its rows at rest, or one of them open as its own screen. `back` names where Back goes. */
export function CommandViews({ back, children }: { back: string; children: ReactNode }) {
  const [open, setOpen] = useState<Opened | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const home = useRef<HTMLDivElement>(null);
  // The row that opened the view: focus goes back to it when the view closes, as a sheet gives it back.
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((o: Opened) => {
    if (open?.id === o.id) return;
    if (!open) {
      const at = document.activeElement as HTMLElement | null;
      opener.current = at && home.current?.contains(at) ? at : null;
    }
    setOpen(o);
  }, [open]);
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (open) return;
    const el = opener.current;
    opener.current = null;
    if (!el) return;
    const raf = requestAnimationFrame(() => { if (el.isConnected) el.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(raf);
  }, [open]);
  // A link to something else on Command — the portfolio, today's event — lands on the page, not under a view.
  useEffect(() => {
    if (!open) return;
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id && id !== open.id && document.getElementById(id) && home.current?.contains(document.getElementById(id))) close();
    };
    window.addEventListener(OPEN_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
  }, [open, close]);
  const value = useMemo(() => ({ open, show, slot }), [open, show, slot]);
  return (
    <ViewCtx.Provider value={value}>
      <div ref={home} hidden={!!open}>{children}</div>
      {open && <ViewHead key={open.id} id={open.id} title={open.title} back={back} onBack={close} slot={slot} />}
      <div ref={setSlot} tabIndex={-1} className="focus:outline-none" />
    </ViewCtx.Provider>
  );
}

/** The open view's name and its ways back: the title (a phone's large title; the desk keeps the crumb), the
 *  crumb, the step Back closes, and a swipe toward Command. Focus lands on the title, for a screen reader. */
function ViewHead({ id, title, back, onBack, slot }: { id: string; title: string; back: string; onBack: () => void; slot: HTMLElement | null }) {
  useCrumb("command-view", title, onBack);
  useBackStep(back, onBack);
  usePagerLevel({ keys: ["command", id], current: id, go: (k) => { if (k === "command") onBack(); }, depth: 1 });
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const el = h.current;
    if (el && el.offsetParent !== null) el.focus({ preventScroll: true });
    else slot?.focus({ preventScroll: true });
  }, [slot]);
  return (
    <>
      <h1 ref={h} tabIndex={-1} className="op-head-t desk:hidden mb-3 focus:outline-none">{title}</h1>
      <div data-large-title data-title={title} aria-hidden className="h-0" />
    </>
  );
}

/** One of Command's rows: `title`, `status` (one line), `count`, and `label` — what VoiceOver says, which
 *  names what the row opens. `children` is the board it opens, drawn only while it is open. */
export function CommandFold({ id, title, status, count, label, children }: {
  id: string; title: string; status: ReactNode; count?: number | null; label: string; children: ReactNode;
}) {
  const ctx = useContext(ViewCtx);
  const isOpen = ctx?.open?.id === id;
  const show = ctx?.show;
  const openIt = useCallback(() => show?.({ id, title }), [show, id, title]);
  useEffect(() => {
    const onOpen = (e: Event) => { if ((e as CustomEvent<string>).detail === id) openIt(); };
    window.addEventListener(OPEN_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
  }, [id, openIt]);
  // Outside Command's views (nothing renders one there today) the board is simply drawn.
  if (!ctx) return <div id={id}>{children}</div>;
  return (
    <>
      <div id={isOpen ? undefined : id}>
        <InfoRow name={title} sub={status} onClick={openIt} ariaLabel={label}
          trailing={<>{count != null && <span className="k-count">{count}</span>}<span className="ev-chev" aria-hidden="true">›</span></>} />
      </div>
      {isOpen && ctx.slot && createPortal(<div id={id}>{children}</div>, ctx.slot)}
    </>
  );
}
