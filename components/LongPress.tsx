"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import Sheet, { CloseButton } from "./Sheet";
import Icon, { type IconName } from "./Icon";
import { claimTouch, hushClick, touchTaken } from "./useGesture";
import { haptic } from "@/lib/haptics";

// A ROW'S MENU, ON A LONG PRESS (2026-10-08, the navigation round: redesign 3, approved by Ryan).
//
// The common things done to a row — an order moved on a stage, a flag snoozed, a stop gone live at — took
// open, scroll and tap. On an iPhone a row that has actions answers a long press with them, and here one
// does: a finger held still for HOLD ms (one that moves is scrolling or swiping, and the press stands
// down), the phone ticks and the row's menu rises — its actions by name, in a sheet. From then the touch is
// the press's: no swipe, pull or edge swipe takes it, and the lift that ends it taps nothing — not the row,
// and not the menu that rose under the finger. A right-click, the keyboard's menu key and Android's own long
// press raise it too; a mouse held down does not (it is selecting, or about to drag). A press in a field is
// the field's (select, paste).
//
// Every action stays where it was on the row: the menu is a faster way to the same buttons, never the only
// one, so a keyboard or a screen reader loses nothing. The row keeps its own element: useLongPress hands
// back what to put on it (`bind`, and the class `pressable`) and the menu to draw (`menu`, a sheet, drawn in
// the shell); a row drawn in a list, where a hook cannot be called per row, is drawn by <LongPress>'s children.

/** `current`: the row is where you already are (a menu of places — the sections a title opens): it says so to a
 *  screen reader, and its mark (a check) is drawn in gold. */
export type MenuItem = { key: string; label: string; icon?: IconName; danger?: boolean; current?: boolean; run: () => void };

/** How long a finger rests on a row before its menu rises (iOS's own is about half a second). */
export const HOLD = 450;
/** How far a finger may drift and still be pressing, not scrolling (iOS allows 10pt). */
export const DRIFT = 8;
/** A press here is the field's own: select, paste. */
const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export type Press = {
  /** Spread on the row's own element, and give it the class `pressable` (app/tailwind.css: on a touch screen
   *  the row's words start no selection and iOS shows no callout, so the press is the row's). */
  bind: HTMLAttributes<HTMLElement> & { "data-long-press"?: "" };
  /** The menu, while it is up. Draw it anywhere: it is a sheet, drawn in the shell. */
  menu: ReactNode;
};

export function useLongPress(title: string, items: MenuItem[]): Press {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const from = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  // The menu rose and the finger is still down.
  const held = useRef(false);
  if (items.length === 0) return { bind: {}, menu: null };

  // This row's own: not a field's, not a row inside it, and not the menu's (a sheet drawn elsewhere, whose
  // events still travel React's tree through here).
  const ours = (e: { currentTarget: Element; target: EventTarget | null }) => {
    const t = e.target instanceof Element ? e.target : null;
    return !!t && e.currentTarget.contains(t) && t.closest("[data-long-press]") === e.currentTarget && !t.closest(FIELD);
  };
  const stop = () => {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
    from.current = null;
  };
  const rise = (touch: boolean) => {
    if (touch) claimTouch();
    held.current = true;
    haptic("medium");
    setOpen(true);
  };
  const close = () => { held.current = false; setOpen(false); };

  return {
    bind: {
      "data-long-press": "",
      onPointerDown: (e) => {
        held.current = false;
        stop();
        if (e.pointerType === "mouse" || e.button !== 0 || !ours(e)) return;
        const touch = e.pointerType === "touch";
        from.current = { x: e.clientX, y: e.clientY, touch };
        timer.current = window.setTimeout(() => {
          timer.current = null;
          const f = from.current;
          from.current = null;
          // A swipe or a pull that already has the touch keeps it.
          if (!f || (f.touch && touchTaken())) return;
          rise(f.touch);
        }, HOLD);
      },
      onPointerMove: (e) => {
        const a = from.current;
        if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) > DRIFT) stop();
      },
      onPointerUp: () => {
        stop();
        if (held.current) { held.current = false; hushClick(); }
      },
      onPointerCancel: stop,
      onPointerLeave: stop,
      onContextMenu: (e) => {
        if (!ours(e)) return;
        e.preventDefault();
        stop();
        if (!open && !held.current) rise(false);
      },
      onClickCapture: (e) => {
        if (held.current && e.target instanceof Node && e.currentTarget.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
      },
    },
    menu: open ? <RowMenu title={title} items={items} onClose={close} /> : null,
  };
}

/** A row drawn in a list: `children` draws it with what the press hands it. */
export default function LongPress({ title, items, children }: {
  /** What the menu is about: the order, the flag, the stop. */
  title: string;
  items: MenuItem[];
  children: (press: Press) => ReactNode;
}) {
  const press = useLongPress(title, items);
  return <>{children(press)}{press.menu}</>;
}

/** The menu itself: the row's actions by name, each with its sign on the right as iOS draws them, and the
 *  one that cannot be taken back in red, last. */
export function RowMenu({ title, items, onClose, label }: { title: string; items: MenuItem[]; onClose: () => void; label?: string }) {
  // While it is up, the browser's own menu stays down: Android's long press, or the right-click's, would land
  // on whatever rose under the finger or the pointer.
  useEffect(() => {
    const hush = (e: Event) => e.preventDefault();
    window.addEventListener("contextmenu", hush, true);
    return () => window.removeEventListener("contextmenu", hush, true);
  }, []);
  return (
    <Sheet open onClose={onClose} label={label ?? `${title} — actions`}
      header={<div className="acs-head select-none"><span className="isheet-title min-w-0 truncate">{title}</span><CloseButton onClick={onClose} className="isheet-x" /></div>}>
      <div className="acs-rows select-none" data-row-menu="">
        {items.map((it) => (
          <button key={it.key} type="button" className="acs-row min-h-11" aria-current={it.current ? "true" : undefined} onClick={() => { onClose(); it.run(); }}>
            <span className="acs-row-x"><b className={it.danger ? "text-red!" : undefined}>{it.label}</b></span>
            {it.icon && <span className={`acs-row-c${it.danger ? " text-red!" : ""}${it.current ? " text-gold2!" : ""}`} aria-hidden><Icon name={it.icon} /></span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
