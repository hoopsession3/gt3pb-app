"use client";

import "./studio.css";
import PlanView from "./PlanView";
import { ftIn, type Layout } from "@/lib/vision";

// THE ROOM, DRAWN TO SCALE (IMS8 P6) — on the investor's room slide, beside the 3D: the Studio's own plan renderer
// (components/vision/PlanView) fed the link's geometry, read-only (canEdit false: nothing moves, nothing is saved, no
// draft is kept). Pan and zoom like any drawing; Fit brings the whole room back. No artwork stands in for a room.
const noop = () => {};
const NONE = new Set<string>();

export default function RoomToScale({ layout }: { layout: Layout }) {
  return (
    <figure className="vp-plan">
      <div className="vp-planbox">
        <div className="vz-planbox">
          <PlanView layout={layout} selected={null} bad={NONE} canEdit={false} flow={null}
            onSelect={noop} onMove={noop} onResize={noop} onBegin={noop} onTurn={noop} onCopy={noop} onRemove={noop} onDetails={noop} />
        </div>
      </div>
      <figcaption>Drawn to scale · {ftIn(layout.width_in)} × {ftIn(layout.depth_in)}</figcaption>
    </figure>
  );
}
