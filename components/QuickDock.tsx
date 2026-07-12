"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth, roleOf } from "./AuthProvider";
import { useOperatorSection } from "./OperatorNav";
import { supabase } from "@/lib/supabase";
import { haptic, HAPTIC } from "@/lib/haptics";
import AskGT3 from "./AskGT3";
import CopilotLauncher from "./CopilotLauncher";
import Sheet from "@/components/Sheet";

// QuickDock — a floating, always-accessible launcher for the crew's two most-used quick actions:
// Ask GT3 (the pocket-brain chat) and a fast Note capture (jot/speak → a real note, private by
// default). Lives in the app shell so it's reachable from any crew page without hunting tabs.
// Staff-only (0170 opened notes to all staff — RLS owns who reads what, not this button).
export default function QuickDock() {
  const { profile, user } = useAuth();
  const role = roleOf(profile);
  const isStaff = role !== "member";
  const { setSection } = useOperatorSection();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"do" | "ask" | "note">("do");

  // My Day's "✎ Note to self" chip (and anything else) can summon the note pane directly.
  useEffect(() => {
    const onNote = () => { setMode("note"); setOpen(true); };
    window.addEventListener("gt3-quick-note", onNote);
    return () => window.removeEventListener("gt3-quick-note", onNote);
  }, []);
  // Anything can summon the copilot launcher (the "do" front door) directly.
  useEffect(() => {
    const onDo = () => { setMode("do"); setOpen(true); };
    window.addEventListener("gt3-quick-do", onDo);
    return () => window.removeEventListener("gt3-quick-do", onDo);
  }, []);

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
      <button type="button" className={`qd-fab${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={open ? "Close quick actions" : "Quick actions — run a copilot, ask GT3, or take a note"}>
        {open ? "✕" : "✦"}
      </button>

      {open && (
        <Sheet open onClose={() => setOpen(false)} label="Quick actions" header={<div style={{ display: "flex", alignItems: "center" }}><button type="button" className={`qd-tab${mode === "do" ? " on" : ""}`} onClick={() => setMode("do")}>✦ Do</button><button type="button" className={`qd-tab${mode === "ask" ? " on" : ""}`} onClick={() => setMode("ask")}>Ask GT3</button><button type="button" className={`qd-tab${mode === "note" ? " on" : ""}`} onClick={() => setMode("note")}>✎ Note</button><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)} aria-label="Close">✕</button></div>}>
          {mode === "do" ? <CopilotLauncher role={role} onPick={(s) => { setSection(s); setOpen(false); }} />
            : mode === "ask" ? <AskGT3 />
            : <QuickNote userId={user?.id ?? null} onSaved={() => setOpen(false)} />}
        </Sheet>
      )}
    </>
  );
}

// Quick note capture — type or speak a line, pick who sees it (just you by default), save.
// Lands in Business › Notes to expand later.
const QN_VIS = [
  { v: "private", label: "🔒 Just me" },
  { v: "team", label: "👥 Team" },
  { v: "collab", label: "🤝 Team + comments" },
] as const;
function QuickNote({ userId, onSaved }: { userId: string | null; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [vis, setVis] = useState<"private" | "team" | "collab">("private");
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
    const { error } = await supabase.from("meeting_notes").insert({ title, body, source: "manual", created_by: userId, visibility: vis });
    setSaving(false);
    if (error) { setMsg("Couldn't save — try again."); return; }
    haptic(HAPTIC.add);
    setText(""); setMsg(vis === "private" ? "Saved — just for you, under Business › Notes" : "Saved to Business › Notes");
    setTimeout(onSaved, 700);
  };

  return (
    <div className="qd-note">
      <div className="qd-note-row">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot it down — a thought, a to-do, a reminder…" rows={4} autoFocus />
        {SR && <button type="button" className={`oa-mic${listening ? " on" : ""}`} onClick={mic} aria-label="Speak your note">🎙</button>}
      </div>
      <div className="qd-note-vis" role="radiogroup" aria-label="Who can see this note">
        {QN_VIS.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={vis === o.v} className={`qd-vis-chip${vis === o.v ? " on" : ""}`} onClick={() => setVis(o.v)}>{o.label}</button>
        ))}
      </div>
      <div className="qd-note-foot">
        <span className="qd-note-msg">{msg || "Saves under Business › Notes — expand it there later."}</span>
        <button type="button" className="oa-send" onClick={save} disabled={saving || !text.trim()}>{saving ? "Saving…" : "Save note"}</button>
      </div>
    </div>
  );
}
