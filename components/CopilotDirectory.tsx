"use client";

import { COPILOTS, COPILOT_CATS } from "@/lib/copilots";
import { useOperatorSection, SECTION_LABEL } from "./OperatorNav";
import { InfoRow } from "@/components/kit";
import Icon from "@/components/Icon";

// The owner's AI catalog — the full surface area of every AI operation the business runs, grouped by
// department. This is the governance/overview view (all copilots, unfiltered): "here is everything
// the AI can do and where it lives." Staff RUN these from the ✦ launcher, which filters the same
// registry to each person's role — so this and the launcher can never drift (one source, lib/copilots).
//
// Each row is a kit InfoRow (label → name, desc → sub, destination section → trailing) instead of the
// old one-off .cl-op button family. onClick + a trailing caret beside the destination badge is the
// app's established "this row jumps elsewhere" convention (see GtmCard's Mondays/Aug 1 rows) — matched
// here rather than reinventing the removed custom arrow. Category grouping (.cl-list/.cl-group/.cl-cat)
// and the intro copy (.set-lead) are unchanged; only the row itself moved onto the kit primitive.
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
            <div className="k-rows">
              {g.items.map((c) => (
                <InfoRow
                  key={c.id}
                  name={c.label}
                  sub={c.desc}
                  trailing={<>
                    <span className="cl-op-sec">{SECTION_LABEL[c.section]}</span>
                    <span className="k-caret" aria-hidden="true">›</span>
                  </>}
                  onClick={() => setSection(c.section)}
                  ariaLabel={`Open ${c.label} — ${SECTION_LABEL[c.section]}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
