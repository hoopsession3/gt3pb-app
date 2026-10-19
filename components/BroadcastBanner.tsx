"use client";

import { useEffect, useMemo, useRef } from "react";
import { useBroadcastsRead, type Broadcast } from "@/lib/broadcasts";
import { keepHold, letGo } from "@/lib/holds";
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
  const { live, state } = useBroadcastsRead();
  const raw = useDevicePref(DISMISSED);
  const dismissed = useMemo(() => parseDismissed(raw), [raw]);

  const b: Broadcast | undefined = live.find((x) => !dismissed.includes(x.id));
  // ITS PLACE, HELD (R38 — PERF11-06, lib/holds). The bar was read after the first paint and pushed every page down by
  // its height. Until there is a bar, its slot is drawn in the bar's place and, on a phone that saw a bar last time, holds
  // that height until the read lands: shown, the bar takes the slot's place (the shell's own child, as every "under the
  // bar" rule reads it — components/NativeBridge.css, TitleBar, the calendars) and its height is kept for next time; read
  // as none (or dismissed), the slot lets go and forgets it; a read that failed lets go and keeps it — unknown is not none.
  const bar = useRef<HTMLDivElement>(null);
  const shownId = b?.id ?? null;
  useEffect(() => {
    if (state === "reading") return;
    if (shownId) { keepHold("bcast", Math.round(bar.current?.getBoundingClientRect().height ?? 0)); return; }
    letGo("bcast");
    if (state === "read") keepHold("bcast", 0);
  }, [state, shownId]);
  if (!b) return <div className="hold-slot" data-hold="bcast" />;
  // A page here or an https address, or no button (lib/safeLink, R10b).
  const link = safeLink(b.cta_href);

  const dismiss = () => {
    DISMISSED.write(JSON.stringify([...new Set([...dismissed, b.id])].slice(-50)));
  };

  return (
    <div ref={bar} className={`bcast bcast-${b.style}`} role="status" aria-live="polite">
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
