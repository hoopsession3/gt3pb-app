"use client";

import { useRef, useState } from "react";
import { useLatest } from "@/lib/useLatest";
import { devicePref, useDevicePref } from "@/lib/devicePref";

// FLOAT RAIL — the one home for every floating tab (Ask us · Connect · Display). Three promises:
//   MOVABLE    — drag the ≡ grip to slide the rail anywhere along the right edge (persisted).
//   COLLAPSIBLE— one tap folds the whole rail into a slim ‹ handle (persisted); tap to reopen.
//   INSIGHTFUL — expanded tabs say what they DO (label + purpose line), not just an icon.
// Children (the tab components) stay self-contained; the rail only owns placement + fold state.
const POS_KEY = "gt3-rail-pos";
const MIN_KEY = "gt3-rail-min";

// Where the rail was left and whether it is folded: kept on the phone, read as stores (lib/devicePref, R17) — the
// defaults on the server and while hydrating, the phone's own after, with no effect setting state as it mounts.
const POS = devicePref(POS_KEY), MIN = devicePref(MIN_KEY);

export default function FloatRail({ children }: { children: React.ReactNode }) {
  const keptPos = useDevicePref(POS), keptMin = useDevicePref(MIN);
  const [dragged, setBottom] = useState<number | null>(null);   // where a drag in this tab put it
  // Folded by default — a first-time visitor gets one compact "‹" tab, not three stacked panels
  // sitting over whatever's on the page below (on /3mpire the expanded rail used to land right on
  // top of the "Become a member" button). A tap reveals the full insightful labels same as always;
  // an explicit prior choice (open or folded) is still honored once the phone has one.
  const min = keptMin === null ? true : keptMin === "1";
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startBottom: number } | null>(null);

  // The floor clears the floating tier: the crew nav (87px, measured — it was written down as 68)
  // + 16 + the 54px quick-actions button + 12 clearance = 169. The phone's home-indicator inset is
  // added in the style below rather than guessed here, because the nav grows by exactly that much.
  // scripts/design.ratchet.mjs paints the folded handle beside that button, with and without it.
  const clamp = (b: number) =>
    Math.min(Math.max(b, 170), Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.7));

  const keptAt = Number(keptPos);
  const bottom = dragged ?? (keptPos !== null && Number.isFinite(keptAt) && keptAt > 0 ? clamp(keptAt) : 170);
  const bottomRef = useLatest(bottom);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startY: e.clientY, startBottom: bottomRef.current };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setBottom(clamp(drag.current.startBottom - (e.clientY - drag.current.startY)));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    POS.write(String(bottomRef.current));
  };
  const toggle = () => MIN.write(min ? "0" : "1");

  return (
    // NOT ON A PHONE (2026-10-08, the iPhone chrome round, approved): on a phone the rail's handle sat on
    // the content of every screen. There its tabs have homes of their own — Ask us beside the account
    // button, Connect and Display in the account menu and the crew's More, Display in Settings too — and
    // the rail stays in the frame (desktop, iPad), where there is room beside the page. Those homes open
    // their own sheets (components/HelpSheets, Concierge's ConciergeDoor): a folded rail draws no tabs at all.
    // NOT ON THE DESK either (2026-10-09, redesign 5): the canvas runs to the window's edge, and the rail's tabs
    // have the same homes there as on a phone — Ask us in the header, Connect in More, Display in Settings.
    <div className={`rail${min ? " rail-folded" : ""}${dragging ? " dragging" : ""} phone:hidden! desk:hidden!`} style={{ bottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))` }}>
      {min ? (
        <button type="button" className="rail-open hit-44" onClick={toggle} aria-expanded={false} aria-label="Open quick actions — ask us, connect, display">‹</button>
      ) : (
        <>
          <div className="rail-head">
            <button
              type="button" className="rail-grip" aria-label="Drag to move the quick actions"
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            >≡</button>
            <button type="button" className="rail-fold" onClick={toggle} aria-expanded aria-label="Collapse quick actions">›</button>
          </div>
          {children}
        </>
      )}
    </div>
  );
}
