"use client";

import { useMemo, useState } from "react";
import { COPILOTS, COPILOT_CATS, type Copilot } from "@/lib/copilots";
import { sectionsForRole, SECTION_LABEL, type OpSection } from "./OperatorNav";

// The ✦ launcher — one front door to every AI operation in GT3. Reads the registry (lib/copilots),
// shows only the copilots whose home section this role can reach (access is inherited from the nav,
// never a second list to drift), and routes you straight there. Search matches label, blurb & area.
// This is the "do" half of the QuickDock; "ask" (the pocket-brain chat) is the other tab.
export default function CopilotLauncher({ role, onPick }: { role: string; onPick: (section: OpSection) => void }) {
  const [q, setQ] = useState("");
  const allowed = useMemo(() => new Set(sectionsForRole(role)), [role]);
  const query = q.trim().toLowerCase();

  const groups = useMemo(() => {
    const match = (c: Copilot) =>
      allowed.has(c.section) &&
      (!query || `${c.label} ${c.desc} ${c.cat} ${SECTION_LABEL[c.section]}`.toLowerCase().includes(query));
    return COPILOT_CATS
      .map((cat) => ({ cat, items: COPILOTS.filter((c) => c.cat === cat && match(c)) }))
      .filter((g) => g.items.length > 0);
  }, [allowed, query]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="cl">
      <div className="cl-head">
        <span className="cl-eye">✦ Copilots · what do you want to do?</span>
        <input
          className="cl-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search operations — “transcribe”, “brew”, “pipeline”…"
          autoFocus
          aria-label="Search AI copilots"
        />
      </div>

      {total === 0 ? (
        <div className="cl-empty">No copilot matches “{q.trim()}”. Try “note”, “event”, “stock” or “campaign”.</div>
      ) : (
        <div className="cl-list">
          {groups.map((g) => (
            <div key={g.cat} className="cl-group">
              <div className="cl-cat">{g.cat}</div>
              {g.items.map((c) => (
                <button key={c.id} type="button" className="cl-op" onClick={() => onPick(c.section)}>
                  <span className="cl-op-main">
                    <b className="cl-op-label">{c.label}</b>
                    <span className="cl-op-desc">{c.desc}</span>
                  </span>
                  <span className="cl-op-go">
                    <span className="cl-op-sec">{SECTION_LABEL[c.section]}</span>
                    <span className="cl-op-arrow" aria-hidden>→</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
