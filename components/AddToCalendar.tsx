"use client";

import { useEffect, useRef, useState } from "react";
import { buildIcs, googleCalUrl, withBuffer, type CalEvent } from "@/lib/ics";
import Icon from "@/components/Icon";

const BUFFERS: { v: number; label: string }[] = [
  { v: 0, label: "None" }, { v: 30, label: "30m" }, { v: 60, label: "1h" }, { v: 90, label: "90m" }, { v: 120, label: "2h" },
];

// Self-serve "Add to calendar" — no shared mailbox, no login. The assignee taps it and the
// event/stop drops into THEIR own calendar: .ics for Apple/Outlook (and any app), a one-tap
// Google link. Stable UID per event/stop so re-adding updates rather than duplicates.

export default function AddToCalendar({ ev, label = "Add to calendar", defaultBuffer = 0 }: { ev: CalEvent | null; label?: string; defaultBuffer?: number }) {
  const [open, setOpen] = useState(false);
  const [buffer, setBuffer] = useState(defaultBuffer);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setBuffer(defaultBuffer); }, [defaultBuffer]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  if (!ev) return null;
  const out = withBuffer(ev, buffer);

  const downloadIcs = () => {
    const blob = new Blob([buildIcs(out, new Date())], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(ev.title || "gt3-event").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setOpen(false);
  };

  return (
    <div className="atc" ref={ref}>
      <button type="button" className="atc-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}><Icon name="calendar" /> {label}</button>
      {open && (
        <div className="atc-menu" role="menu">
          {!ev.allDay && (
            <div className="atc-buf">
              <span className="atc-buf-h">Buffer before</span>
              <div className="atc-buf-row">
                {(BUFFERS.some((b) => b.v === defaultBuffer) ? BUFFERS : [...BUFFERS, { v: defaultBuffer, label: `${defaultBuffer}m` }].sort((a, b) => a.v - b.v)).map((b) => (
                  <button key={b.v} type="button" className={`atc-buf-c${buffer === b.v ? " on" : ""}`} onClick={() => setBuffer(b.v)} aria-pressed={buffer === b.v}>{b.label}</button>
                ))}
              </div>
            </div>
          )}
          <button type="button" className="atc-item" role="menuitem" onClick={downloadIcs}>Apple / Outlook <span>.ics file</span></button>
          <a className="atc-item" role="menuitem" href={googleCalUrl(out)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>Google Calendar <span>opens Google</span></a>
        </div>
      )}
    </div>
  );
}
