"use client";

import type { ReactNode } from "react";
import { useOperatorSection, type OpSection } from "./OperatorSection";
import { scrollToAnchor } from "@/lib/anchors";

// ONE LINE TO WHERE IT LIVES NOW (2026-10-06, the settings round). When Settings gathered the things
// that change a feature, each one left its old spot — Money's payment switches, the calendar's Outlook
// connect, Route's ordering dial, Team's invites. A screen that simply lost a control reads as broken
// to the person who used it there yesterday, so each old spot keeps one line, in the tertiary button
// style, that goes to the control's new home and opens its panel there (lib/anchors). Settings uses
// the same line for the one thing it sends back out: changing someone's role, on Team's roster.
//
// scripts/smoke.cjs reads every <GoLine> and holds its `to` to a real section and its `anchor` to an
// id that exists — a line that lands nowhere is the defect it was built to avoid.
export default function GoLine({ to, anchor, children }: { to: OpSection; anchor: string; children: ReactNode }) {
  const { setSection } = useOperatorSection();
  return (
    <div style={{ margin: "12px 0 6px" }}>
      <button type="button" className="btn-ter" onClick={() => { setSection(to); scrollToAnchor(anchor); }}>{children} ›</button>
    </div>
  );
}
