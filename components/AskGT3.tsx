"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import EventGenerator from "./EventGenerator";

// Ask GT3 — the crew's grounded pocket-brain chat (recipes, the why, gear, stock, how-to).
// Shared by the Ask tab and the floating QuickDock so there's ONE assistant, not two. Voice in
// via Web Speech API where available; errors render inline as assistant messages (no toast dep).
// It also ACTS on a couple of asks: say "create an event" and it opens the event builder.
type ChatMsg = { role: "user" | "assistant"; content: string };
const QUICK = ["Create an event from my notes", "We have an inspection in GA — what to expect?", "How do I make a Rise?", "What's in Nature Aide?", "What gear do we have?"];

// Open the event builder when the crew asks to create one — robust to how people actually say it
// ("plan a pop-up Saturday", "set up a market run", "book us for a wedding"), but NOT on questions
// ("what's the plan for the market?") — those go to the chat.
const EVENT_VERB = "(create|make|generate|build|plan|add|set\\s?up|start|new|schedule|book|host|run|organi[sz]e)";
const EVENT_NOUN = "(events?|pop-?ups?|markets?(?:\\s*runs?)?|farmers?\\s*markets?|gigs?|bookings?|appearances?|festivals?|fairs?|weddings?|part(?:y|ies)|corporate\\s*events?|private\\s*events?|vendor\\s*events?|truck\\s*stops?)";
const EVENT_INTENT = new RegExp(`\\b${EVENT_VERB}\\b[^.?!]*\\b${EVENT_NOUN}\\b`, "i");
const QUESTION_START = /^\s*(what|how|why|when|where|who|which|whose|is|are|do|does|did|can|could|should|would|will|tell me|explain)(['’]?s)?\b/i;
const isCreateEvent = (t: string) => EVENT_INTENT.test(t) && !QUESTION_START.test(t);

// Keep the whole message as context when it has real detail beyond the command; else start blank.
function eventSeed(text: string): string {
  const detail = text
    .replace(new RegExp(`\\b${EVENT_VERB}\\b`, "ig"), "").replace(new RegExp(`\\b${EVENT_NOUN}\\b`, "ig"), "")
    .replace(/\b(a|an|the|me|us|for|please|from my notes|new|lets?|let's|i|we|want|to|need)\b/ig, "")
    .replace(/[^a-z0-9]/ig, "");
  return detail.length >= 3 ? text.trim() : "";
}

export default function AskGT3() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [genNotes, setGenNotes] = useState<string | null>(null); // non-null → event builder open
  const recRef = useRef<{ stop: () => void } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy || !supabase) return;
    // Event-creation intent → open the builder (seeded) instead of just chatting.
    if (isCreateEvent(q)) {
      setMsgs((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "On it — opening the event builder. Add a couple details (where, when, what's on) and I'll draft the event, a team note, and the to-dos for you to review." }]);
      setInput(""); setGenNotes(eventSeed(q));
      return;
    }
    const next: ChatMsg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await authedFetch("/api/agents/operator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const j = await r.json();
      const reply = j.ok ? (j.reply || "…")
        : String(j.error ?? "").includes("ANTHROPIC") ? "I'm not switched on yet — Ryan needs to add the API key, then I'll be ready."
        : `Sorry — ${j.error ?? "something went wrong"}.`;
      setMsgs((m) => [...m, { role: "assistant", content: reply }]);
    } catch { setMsgs((m) => [...m, { role: "assistant", content: "Couldn't reach me just now — try again in a sec." }]); }
    setBusy(false);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const mic = () => {
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR(); recRef.current = rec;
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput(t); send(t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true); rec.start();
  };

  return (
    <div className="oa">
      <div className="oa-log">
        {msgs.length === 0 && (
          <div className="oa-empty">Ask me anything — recipes, why we serve what we serve, what gear we have, what&apos;s in stock, or how to run the cart. I answer from GT3&apos;s playbook, and I&apos;ll tell you to check with Ryan if it isn&apos;t written down.</div>
        )}
        {msgs.map((m, i) => <div key={i} className={`oa-msg ${m.role}`}>{m.content}</div>)}
        {busy && <div className="oa-msg assistant oa-typing"><span></span><span></span><span></span></div>}
        <div ref={endRef} />
      </div>
      <div className="oa-quick">
        {QUICK.map((q) => <button key={q} type="button" className="oa-chip" onClick={() => send(q)} disabled={busy}>{q}</button>)}
      </div>
      <div className="oa-input">
        {SR && <button type="button" className={`oa-mic${listening ? " on" : ""}`} onClick={mic} aria-label="Speak your question">🎙</button>}
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(input); }} placeholder="Ask GT3…" enterKeyHint="send" />
        <button type="button" className="oa-send" onClick={() => send(input)} disabled={busy || !input.trim()}>Ask</button>
      </div>
      {genNotes !== null && (
        <EventGenerator
          initialNotes={genNotes}
          onClose={() => setGenNotes(null)}
          onCreated={() => setMsgs((m) => [...m, { role: "assistant", content: "Done — your event, team note, and to-dos are created. Find the event under Events." }])}
        />
      )}
    </div>
  );
}
