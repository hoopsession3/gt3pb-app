import type { ReactNode } from "react";

// The kit's eyebrow, with the live dot when the thing it names is happening now (Today's lead and card; the ticket).
export default function Eyebrow({ live, children }: { live?: boolean; children: ReactNode }) {
  return <div className={`k-eyb${live ? " live" : ""}`}>{live && <span className="livedot" />}{children}</div>;
}
