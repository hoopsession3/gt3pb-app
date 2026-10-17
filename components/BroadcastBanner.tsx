"use client";

import { useMemo } from "react";
import { useLiveBroadcasts, type Broadcast } from "@/lib/broadcasts";
import Icon from "@/components/Icon";
import { btn } from "./Button";
import { safeLink } from "@/lib/safeLink";
import { devicePref, useDevicePref } from "@/lib/devicePref";

// BROADCAST BANNER — the live announcement bar every user sees. Reads the broadcasts RLS lets this
// viewer see (active + in-window + their audience), shows the newest one they haven't dismissed, and
// updates in real time when staff publish or toggle. Dismissal is per-broadcast (localStorage), so a
// message doesn't nag after it's been read; a brand-new broadcast still shows.
const KEY = "gt3-bcast-dismissed";
// Kept on the phone and read as a store (lib/devicePref, R17): every mounted banner hears a dismissal.
const DISMISSED = devicePref(KEY);
const parseDismissed = (raw: string | null): string[] => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };

export default function BroadcastBanner() {
  const live = useLiveBroadcasts();
  const raw = useDevicePref(DISMISSED);
  const dismissed = useMemo(() => parseDismissed(raw), [raw]);

  const b: Broadcast | undefined = live.find((x) => !dismissed.includes(x.id));
  if (!b) return null;
  // A page here or an https address, or no button (lib/safeLink, R10b).
  const link = safeLink(b.cta_href);

  const dismiss = () => {
    DISMISSED.write(JSON.stringify([...new Set([...dismissed, b.id])].slice(-50)));
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
