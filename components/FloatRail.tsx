"use client";

import { useEffect, useRef, useState } from "react";

// FLOAT RAIL — the one home for every floating tab (Ask us · Connect · Display). Three promises:
//   MOVABLE    — drag the ≡ grip to slide the rail anywhere along the right edge (persisted).
//   COLLAPSIBLE— one tap folds the whole rail into a slim ‹ handle (persisted); tap to reopen.
//   INSIGHTFUL — expanded tabs say what they DO (label + purpose line), not just an icon.
// Children (the tab components) stay self-contained; the rail only owns placement + fold state.
const POS_KEY = "gt3-rail-pos";
const MIN_KEY = "gt3-rail-min";

export default function FloatRail({ children }: { children: React.ReactNode }) {
  const [bottom, setBottom] = useState(170);
  const [min, setMin] = useState(false);
  const [dragging, setDragging] = useState(false);
  const bottomRef = useRef(170);
  bottomRef.current = bottom;
  const drag = useRef<{ startY: number; startBottom: number } | null>(null);

  const clamp = (b: number) =>
    Math.min(Math.max(b, 88), Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.7));

  useEffect(() => {
    try {
      const p = Number(localStorage.getItem(POS_KEY));
      if (Number.isFinite(p) && p > 0) setBottom(clamp(p));
      setMin(localStorage.getItem(MIN_KEY) === "1");
    } catch { /* ignore */ }
  }, []);

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
    try { localStorage.setItem(POS_KEY, String(bottomRef.current)); } catch { /* ignore */ }
  };
  const toggle = () => setMin((m) => {
    const v = !m;
    try { localStorage.setItem(MIN_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    return v;
  });

  return (
    <div className={`rail${min ? " rail-folded" : ""}${dragging ? " dragging" : ""}`} style={{ bottom }}>
      {min ? (
        <button type="button" className="rail-open" onClick={toggle} aria-expanded={false} aria-label="Open quick actions — ask us, connect, display">‹</button>
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
