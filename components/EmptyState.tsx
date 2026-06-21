// Designed empty state — a hairline-framed editorial message instead of a flat
// gray line. Optional action (e.g. operator "+ Add").
export default function EmptyState({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-t">{title}</div>
      {sub && <div className="empty-s">{sub}</div>}
      {action && <div className="empty-a">{action}</div>}
    </div>
  );
}
