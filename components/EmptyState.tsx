// Designed empty state — a hairline-framed editorial message instead of a flat
// gray line. Optional action (e.g. operator "+ Add").
// role is opt-in: pass it where this replaces a loading spinner (a live transition a screen-reader
// user won't otherwise notice), e.g. AsyncSection's error/empty branches. Statically-rendered
// EmptyStates (already-loaded data that's just empty) don't need it — nothing is "changing" there.
export default function EmptyState({ title, sub, action, role }: { title: string; sub?: string; action?: React.ReactNode; role?: "status" | "alert" }) {
  return (
    <div className="empty" role={role} aria-live={role === "alert" ? "assertive" : role === "status" ? "polite" : undefined}>
      <div className="empty-t">{title}</div>
      {sub && <div className="empty-s">{sub}</div>}
      {action && <div className="empty-a">{action}</div>}
    </div>
  );
}
