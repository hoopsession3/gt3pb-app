"use client";

import { useEffect, useState } from "react";
import { useLiveBroadcasts, type Broadcast } from "@/lib/broadcasts";
import Icon from "@/components/Icon";
import { btn } from "./Button";
import { safeLink } from "@/lib/safeLink";

// BROADCAST BANNER — the live announcement bar every user sees. Reads the broadcasts RLS lets this
// viewer see (active + in-window + their audience), shows the newest one they haven't dismissed, and
// updates in real time when staff publish or toggle. Dismissal is per-broadcast (localStorage), so a
// message doesn't nag after it's been read; a brand-new broadcast still shows.
const KEY = "gt3-bcast-dismissed";
const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };

export default function BroadcastBanner() {
  const live = useLiveBroadcasts();
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => { setDismissed(readDismissed()); }, []);

  const b: Broadcast | undefined = live.find((x) => !dismissed.includes(x.id));
  if (!b) return null;
  // A page here or an https address, or no button (lib/safeLink, R10b).
  const link = safeLink(b.cta_href);

  const dismiss = () => {
    const next = [...new Set([...dismissed, b.id])].slice(-50);
    setDismissed(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <div className={`bcast bcast-${b.style}`} role="status" aria-live="polite">
      <div className="bcast-x">
        <b className="bcast-t">{b.title}</b>
        {b.body && <span className="bcast-b">{b.body}</span>}
      </div>
      {b.cta_label && link && (
        <a className={btn("quiet", { className: "bcast-cta" })} href={link.href} target={link.kind === "web" ? "_blank" : undefined} rel="noreferrer">{b.cta_label}</a>
      )}
      <button type="button" className="bcast-close hit-44" onClick={dismiss} aria-label="Dismiss"><Icon name="close" /></button>
    </div>
  );
}
