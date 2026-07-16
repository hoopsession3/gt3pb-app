"use client";

import { COPILOTS, COPILOT_CATS } from "@/lib/copilots";
import { useOperatorSection, SECTION_LABEL } from "./OperatorNav";
import Icon from "@/components/Icon";

// The owner's AI catalog — the full surface area of every AI operation the business runs, grouped by
// department. This is the governance/overview view (all copilots, unfiltered): "here is everything
// the AI can do and where it lives." Staff RUN these from the ✦ launcher, which filters the same
// registry to each person's role — so this and the launcher can never drift (one source, lib/copilots).
export default function CopilotDirectory() {
  const { setSection } = useOperatorSection();
  const groups = COPILOT_CATS.map((cat) => ({ cat, items: COPILOTS.filter((c) => c.cat === cat) })).filter((g) => g.items.length > 0);

  return (
    <div className="cl cl-dir">
      <p className="set-lead">
        {COPILOTS.length} AI copilots across {groups.length} departments. Staff run them from the <Icon name="star" /> launcher —
        it shows each person only the copilots their role can reach. Jump to any one here.
      </p>
      <div className="cl-list">
        {groups.map((g) => (
          <div key={g.cat} className="cl-group">
            <div className="cl-cat">{g.cat} · {g.items.length}</div>
            {g.items.map((c) => (
              <button key={c.id} type="button" className="cl-op" onClick={() => setSection(c.section)}>
                <span className="cl-op-main">
                  <b className="cl-op-label">{c.label}</b>
                  <span className="cl-op-desc">{c.desc}</span>
                </span>
                <span className="cl-op-go">
                  <span className="cl-op-sec">{SECTION_LABEL[c.section]}</span>
                  <span className="cl-op-arrow" aria-hidden><Icon name="arrowRight" /></span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
