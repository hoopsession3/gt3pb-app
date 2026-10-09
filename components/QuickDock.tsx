"use client";

import { useEffect, useState } from "react";
import { useAuth, roleOf } from "./AuthProvider";
import { useOperatorSection } from "./OperatorNav";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import AskGT3 from "./AskGT3";
import LogPurchase from "./LogPurchase";
import CopilotLauncher from "./CopilotLauncher";
import Sheet, { CloseButton, useUnsaved } from "@/components/Sheet";
import Icon from "@/components/Icon";
import { Segmented } from "@/components/controls";
import { useDictation } from "./useDictation";

/** The page was opened with ?ask=1 — a link that means "open Ask GT3". False on the server. */
function askOnLoadParam(): boolean {
  if (typeof window === "undefined") return false;
  try { return new URL(window.location.href).searchParams.get("ask") === "1"; } catch { return false; }
}

// QuickDock — a floating, always-accessible launcher for the crew's two most-used quick actions:
// Ask GT3 (the pocket-brain chat) and a fast Note capture (jot/speak → a real note, private by
// default). Lives in the app shell so it's reachable from any crew page without hunting tabs.
// Staff-only (0170 opened notes to all staff — RLS owns who reads what, not this button).
export default function QuickDock() {
  const { profile, user } = useAuth();
  const role = roleOf(profile);
  const isStaff = role !== "member";
  const { setSection } = useOperatorSection();

  // A page loaded with ?ask=1 starts with Ask GT3 open (see "ASK GT3, IN ONE TAP" below). Read in the
  // initializer, not an effect: on the server there is no address and the dock renders nothing (no
  // profile there, so no staff), so the first client render cannot disagree with the server's HTML.
  const [askOnLoad] = useState(askOnLoadParam);
  const [open, setOpen] = useState(askOnLoad);
  const [mode, setMode] = useState<"do" | "ask" | "note" | "spend">(askOnLoad ? "ask" : "do");

  // My Day's "✎ Note to self" chip (and anything else) can summon the note pane directly.
  useEffect(() => {
    const onNote = () => { setMode("note"); setOpen(true); };
    window.addEventListener("gt3-quick-note", onNote);
    return () => window.removeEventListener("gt3-quick-note", onNote);
  }, []);
  // A purchase is logged where it happens — the register, the pump — not at a desk on the Money tab
  // (2026-10-04). Money › Spend's "Log a purchase" opens this same sheet, so there is one capture form.
  useEffect(() => {
    const onSpend = () => { setMode("spend"); setOpen(true); };
    window.addEventListener("gt3-log-purchase", onSpend);
    return () => window.removeEventListener("gt3-log-purchase", onSpend);
  }, []);
  // Anything can summon the copilot launcher (the "do" front door) directly.
  useEffect(() => {
    const onDo = () => { setMode("do"); setOpen(true); };
    window.addEventListener("gt3-quick-do", onDo);
    return () => window.removeEventListener("gt3-quick-do", onDo);
  }, []);
  // ASK GT3, IN ONE TAP (2026-10-08). Ryan had to text a new teammate "click the star on bottom right
  // corner, click ask gt3 in top menu" — the dock opens on its copilots, and Ask was the second tab.
  // The first-day guide's "Ask GT3 now" sends gt3-quick-ask. A link carries ?ask=1 (one Ryan can text:
  // app.gt3pb.com/crew?ask=1): the dock STARTS open on Ask when the page loads with it (askOnLoad,
  // above — state that starts right, rather than state set by an effect), and this takes it off the
  // address so a reload or Back does not open it again. Staff only, like the dock: a member's ?ask=1
  // renders nothing, because the dock does not render for a member at all.
  useEffect(() => {
    const onAsk = () => { setMode("ask"); setOpen(true); };
    window.addEventListener("gt3-quick-ask", onAsk);
    return () => window.removeEventListener("gt3-quick-ask", onAsk);
  }, []);
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("ask") !== "1") return;
      url.searchParams.delete("ask");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { /* an address that will not parse is left as it is */ }
  }, []);

  // Escape is the sheet's (components/Sheet): it closes the top sheet only, and asks first when a
  // note or a purchase is half typed. This dock's own Escape closed it directly, around both.

  if (!isStaff) return null;

  return (
    <>
      {/* On a phone the button is the crew header's ✦, beside search (2026-10-08, the iPhone chrome round):
          floating, it sat over the content of every crew screen. The frame keeps it. On the desk (2026-10-09,
          redesign 5) it is the header's ✦ again: nothing floats over the canvas, and the four tools of the header
          — quick actions, search, the guide, the inbox — read as one toolbar. */}
      <button type="button" className={`k-icon-btn lg qd-fab${open ? "" : " pri"} phone:hidden! desk:hidden!`} onClick={() => setOpen((o) => !o)} aria-label={open ? "Close quick actions" : "Quick actions — run a copilot, ask GT3, take a note, or log a purchase"}>
        {open ? <Icon name="close" /> : <Icon name="sparkles" />}
      </button>

      {open && (
        <Sheet open onClose={() => setOpen(false)} label="Quick actions" header={<div className="flex items-center gap-2"><Segmented label="Quick actions" value={mode} onChange={setMode} options={[{ key: "do", label: <><Icon name="sparkles" /> Do</> }, { key: "ask", label: "Ask GT3" }, { key: "note", label: "Note" }, { key: "spend", label: "Spend" }]} /><CloseButton onClick={() => setOpen(false)} /></div>}>
          {mode === "do" ? <CopilotLauncher role={role} onPick={(s) => { setSection(s); setOpen(false); }} />
            : mode === "ask" ? <AskGT3 />
            : mode === "spend" ? <LogPurchase onDone={() => setOpen(false)} />
            : <QuickNote userId={user?.id ?? null} onSaved={() => setOpen(false)} />}
        </Sheet>
      )}
    </>
  );
}

// Quick note capture — type or speak a line, pick who sees it (just you by default), save.
// Lands in Business › Notes to expand later.
const QN_VIS: { v: "private" | "team" | "collab"; label: string; icon: IconNameQD }[] = [
  { v: "private", label: "Just me", icon: "lock" },
  { v: "team", label: "Team", icon: "team" },
  { v: "collab", label: "Team + comments", icon: "partners" },
];
type IconNameQD = "lock" | "team" | "partners";
function QuickNote({ userId, onSaved }: { userId: string | null; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [vis, setVis] = useState<"private" | "team" | "collab">("private");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // The SAME recogniser Ask GT3 uses, one tab over in this same sheet. It was a second copy of the
  // twelve lines — which is why the mic one tab over got an <Icon> on 2026-09-12 and this one kept
  // its emoji until the duplication was closed. This appends rather than sends: a note is written
  // in pieces, a question is asked once.
  const dictate = useDictation((t) => setText((p) => (p ? `${p} ${t}` : t)));
  // A note half written is asked about before a swipe, a tap outside or Escape takes the dock away.
  useUnsaved(!!text.trim());

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
    haptic("success");
    setText(""); setMsg(vis === "private" ? "Saved — just for you, under Business › Notes" : "Saved to Business › Notes");
    setTimeout(onSaved, 700);
  };

  return (
    <div className="qd-note">
      <div className="qd-note-row">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot it down — a thought, a to-do, a reminder…" rows={4} autoFocus />
        {dictate.supported && <button type="button" className={`k-icon-btn oa-mic${dictate.listening ? " on" : ""}`} onClick={dictate.toggle}
          aria-label={dictate.listening ? "Stop listening" : "Speak your note"} aria-pressed={dictate.listening}><Icon name="mic" size={19} /></button>}
      </div>
      <div className="qd-note-vis" role="radiogroup" aria-label="Who can see this note">
        {QN_VIS.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={vis === o.v} className={`k-chip${vis === o.v ? " on" : ""}`} onClick={() => setVis(o.v)}><Icon name={o.icon} /> {o.label}</button>
        ))}
      </div>
      <div className="qd-note-foot">
        <span className="qd-note-msg">{msg || "Saves under Business › Notes — expand it there later."}</span>
        <button type="button" className="btn-pri" onClick={save} disabled={saving || !text.trim()}>{saving ? "Saving…" : "Save note"}</button>
      </div>
    </div>
  );
}
