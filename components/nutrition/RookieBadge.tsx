"use client";

// THE ROOKIE BADGE (R44) — earned when every Rookie lesson is done. Unearned, it waits in outline with what is left;
// earned, it draws itself in (the playbook's line-draw). The heartbeat — GT3's one signature haptic — plays where it is
// earned, under the finger that marked the last lesson complete (components/PrimalLesson), never here on a page load:
// nothing buzzes before a touch, and good news is felt once.

export function BadgeMark({ earned }: { earned: boolean }) {
  return (
    <svg className={earned ? "nu-badge-mark fx-draw" : "nu-badge-mark"} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="32" cy="32" r="27" strokeWidth="2.5" pathLength={1} style={{ "--d": 0 } as React.CSSProperties} />
      <circle cx="32" cy="32" r="21" strokeWidth="1.2" strokeDasharray={earned ? undefined : "2 4"} pathLength={earned ? 1 : undefined} style={{ "--d": 250 } as React.CSSProperties} />
      <path d="M22 33l7 7 14-15" strokeWidth="3.5" pathLength={1} style={{ "--d": 700 } as React.CSSProperties} />
    </svg>
  );
}

export default function RookieBadge({ earned, done, total }: { earned: boolean; done: number; total: number }) {
  const left = Math.max(0, total - done);
  return (
    <div className={`nu-badge${earned ? " earned fx-pop" : ""}`} role="group" aria-label={earned ? "Rookie badge, earned" : `Rookie badge, ${left} lesson${left === 1 ? "" : "s"} to go`}>
      <BadgeMark earned={earned} />
      <div className="nu-badge-x">
        <span className="nu-badge-n">{earned ? "Earned" : "Your badge"}</span>
        <span className="nu-badge-t">Return to Primal · Rookie</span>
        <span className="nu-badge-s">{earned ? "Every Rookie lesson done. You won't be a rookie for long." : `${left} of ${total} Rookie lesson${total === 1 ? "" : "s"} to go.`}</span>
      </div>
    </div>
  );
}
