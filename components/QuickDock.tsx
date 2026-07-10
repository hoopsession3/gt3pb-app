"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth, roleOf, LEADERSHIP_ROLES } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import AskGT3 from "./AskGT3";
import Sheet from "@/components/Sheet";

// QuickDock — a floating, always-accessible launcher for the crew's two most-used quick actions:
// Ask GT3 (the pocket-brain chat) and a fast Note capture (jot/speak → saved as a meeting note to
// expand later). Lives in the app shell so it's reachable from any crew page without hunting tabs.
// Staff-only; Note is leadership-only (meeting_notes is leadership-owned). Public/customers never see it.
export default function QuickDock() {
  const { profile, user } = useAuth();
  const role = roleOf(profile);
  const isStaff = role !== "member";
  const isLeadership = LEADERSHIP_ROLES.includes(role);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"ask" | "note">("ask");

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!isStaff) return null;

  return (
    <>
      <button type="button" className={`qd-fab${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={open ? "Close quick actions" : "Quick actions — Ask GT3 or take a note"}>
        {open ? "✕" : "✦"}
      </button>

      {open && (
        <Sheet open onClose={() => setOpen(false)} header={<div style={{ display: "flex", alignItems: "center" }}><button type="button" className={`qd-tab${mode === "ask" ? " on" : ""}`} onClick={() => setMode("ask")}>✦ Ask GT3</button>{isLeadership && <button type="button" className={`qd-tab${mode === "note" ? " on" : ""}`} onClick={() => setMode("note")}>✎ Quick note</button>}<button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)} aria-label="Close">✕</button></div>}>
          {mode === "ask" ? <AskGT3 /> : <QuickNote userId={user?.id ?? null} onSaved={() => setOpen(false)} />}
        </Sheet>
      )}
    </>
  );
}

// Quick note capture — type or speak a line, save it as a meeting note (lands in Plan to expand later).
function QuickNote({ userId, onSaved }: { userId: string | null; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const mic = () => {
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR(); recRef.current = rec;
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => { const t = e.results[0][0].transcript; setText((p) => (p ? `${p} ${t}` : t)); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true); rec.start();
  };

  const save = async () => {
    const t = text.trim();
    if (!t || saving || !supabase) return;
    setSaving(true); setMsg("");
    const firstLine = t.split("\n")[0].trim();
    const title = (firstLine.length > 80 ? `${firstLine.slice(0, 78)}…` : firstLine) || "Quick note";
    const body = t.length > firstLine.length ? t : null;
    const { error } = await supabase.from("meeting_notes").insert({ title, body, source: "manual", created_by: userId });
    setSaving(false);
    if (error) { setMsg("Couldn't save — try again."); return; }
    setText(""); setMsg("Saved to Plan ▸ Notes");
    setTimeout(onSaved, 700);
  };

  return (
    <div className="qd-note">
      <div className="qd-note-row">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot it down — a thought, a to-do, a reminder…" rows={4} autoFocus />
        {SR && <button type="button" className={`oa-mic${listening ? " on" : ""}`} onClick={mic} aria-label="Speak your note">🎙</button>}
      </div>
      <div className="qd-note-foot">
        <span className="qd-note-msg">{msg || "Saves as a note in Plan — expand it there later."}</span>
        <button type="button" className="oa-send" onClick={save} disabled={saving || !text.trim()}>{saving ? "Saving…" : "Save note"}</button>
      </div>
    </div>
  );
}
