"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Sheet from "./Sheet";
import Gt3Mark from "./Gt3Mark";

// Render the assistant's light markdown — **bold** becomes real bold (guests were seeing raw
// asterisks). Newlines are already handled by the bubble's white-space:pre-wrap.
function rich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) => {
    const b = /^\*\*([^*]+)\*\*$/.exec(seg);
    return b ? <strong key={i}>{b[1]}</strong> : <span key={i}>{seg}</span>;
  });
}

// GUEST CONCIERGE — a friendly floating host on the customer app. Answers menu/visit/booking/
// membership questions by calling the public /api/concierge route (grounded + claim-safe). No login.
// Built on the canonical Sheet (was its own hand-rolled scrim/panel/scroll-body before — same visual
// contract, just duplicated by hand instead of shared, which is exactly what Sheet exists to prevent).

type Msg = { role: "user" | "assistant"; content: string };
const GREETING = "Hey — I'm the GT3 concierge. Ask me what's good to order, where the truck is, or how to book us for an event.";
const CHIPS = ["What should I get before a workout?", "Where's the truck right now?", "Book the truck for my event", "How does membership work?"];

export default function Concierge() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy, open]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/concierge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }) });
      const j = await r.json();
      setMsgs((p) => [...p, { role: "assistant", content: j.ok ? j.reply : (j.error || "Sorry — I couldn't answer that just now. Try the menu or booking page.") }]);
    } catch {
      setMsgs((p) => [...p, { role: "assistant", content: "I'm having trouble connecting. Please try again in a moment." }]);
    }
    setBusy(false);
  };

  return (
    <>
      <button type="button" className={`conc-fab${open ? " hide" : ""}`} onClick={() => setOpen(true)} aria-label="Ask the GT3 concierge">
        {/* The real brand "3" (public/brand/gt3-3.png, the same pixel-exact glyph Gt3Mark uses) — not
            an emoji standing in for it. */}
        <img className="conc-fab-i" src="/brand/gt3-3.png" alt="" aria-hidden="true" /><span className="rail-txt"><b>Ask us</b><i>menu · hours · booking</i></span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="concierge-title" bodyRef={bodyRef}
        header={
          <div className="conc-head">
            <div className="conc-head-l"><span className="conc-badge"><Gt3Mark tone="cream" /></span><div><div className="conc-title" id="concierge-title">Concierge</div></div></div>
            <button type="button" className="conc-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
        }
        footer={
          <>
            <form className="conc-inbar" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <input className="conc-in" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a question…" aria-label="Message" maxLength={500} />
              <button type="submit" className="conc-send" disabled={busy || !input.trim()} aria-label="Send">↑</button>
            </form>
            <div className="conc-foot">Answers come from our menu &amp; schedule. For allergies or medical questions, ask the crew at the window.</div>
          </>
        }>
        {msgs.map((m, i) => <div key={i} className={`conc-msg ${m.role}`}>{m.role === "assistant" ? rich(m.content) : m.content}</div>)}
        {busy && <div className="conc-msg assistant conc-typing"><span /><span /><span /></div>}
        {msgs.length === 1 && (
          <div className="conc-chips">
            {CHIPS.map((c) => <button key={c} type="button" className="conc-chip" onClick={() => send(c)}>{c}</button>)}
          </div>
        )}
      </Sheet>
    </>
  );
}
