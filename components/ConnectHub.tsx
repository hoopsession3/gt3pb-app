"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import Gt3Mark from "@/components/Gt3Mark";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { CONNECT_GROUPS, CONNECT_LEADERSHIP, CONNECT_PRIMARY } from "@/lib/connect";
import { useFocusTrap } from "@/lib/useFocusTrap";
import Icon from "@/components/Icon";

// CONNECT HUB — a floating, intent-driven "link tree." Pull it up anytime someone asks where to find
// GT3: it asks what they're here for ("Wanna order?", "Learn the brew?", "Connect?") and drops down
// the right links, plus a QR of the site to scan straight off the screen. Side-docked with a slow
// raise so it's there when needed, never in the way.
export default function ConnectHub() {
  const { profile } = useAuth();
  // Investor brief — deliberately owner/admin only, NOT the standard leadership tier
  // (LEADERSHIP_ROLES includes event_manager, who shouldn't see it). Keep this list local.
  const isLeader = ["owner", "admin"].includes(roleOf(profile));
  const groups = isLeader ? [...CONNECT_GROUPS, CONNECT_LEADERSHIP] : CONNECT_GROUPS;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(0); // which intent is expanded
  const [qr, setQr] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  useEffect(() => {
    QRCode.toDataURL(CONNECT_PRIMARY, { margin: 1, width: 320, color: { dark: "#15120D", light: "#ffffff" } })
      .then(setQr).catch(() => setQr(""));
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`chub${open ? " open" : ""}`} ref={ref}>
      <button type="button" className="chub-tab" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label="Connect with GT3">
        <span className="chub-tab-i" aria-hidden>{open ? <Icon name="close" /> : "✳"}</span>
        <span className="rail-txt"><b>Connect</b><i>links · socials · order</i></span>
      </button>

      {open && (
        <div className="chub-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-label="Connect with GT3">
          <div className="chub-head"><Gt3Mark tone="cream" /><span className="chub-head-s">What are you here for?</span></div>

          <div className="chub-groups">
            {groups.map((g, i) => {
              const on = group === i;
              const lead = g === CONNECT_LEADERSHIP;
              return (
                <div key={g.q} className={`chub-grp${on ? " on" : ""}${lead ? " chub-grp-lead" : ""}`}>
                  <button type="button" className="chub-q" aria-expanded={on} onClick={() => setGroup(on ? -1 : i)}>
                    <span>{g.q}{lead && <span className="chub-lead-tag">owner</span>}</span><span className="chub-q-chev" aria-hidden>⌄</span>
                  </button>
                  {on && (
                    <div className="chub-links">
                      {g.links.map((l) => {
                        const internal = l.href.startsWith("/");
                        const inner = (
                          <>
                            <span className="chub-badge">{l.badge}</span>
                            <span className="chub-link-t"><b>{l.label}</b>{l.sub && <span>{l.sub}</span>}</span>
                            <span className="chub-go" aria-hidden>{internal ? "›" : <Icon name="externalLink" />}</span>
                          </>
                        );
                        return internal ? (
                          <button key={l.href + l.label} type="button" className="chub-link" onClick={() => { setOpen(false); router.push(l.href); }}>{inner}</button>
                        ) : (
                          <a key={l.href + l.label} className="chub-link" href={l.href} target="_blank" rel="noopener noreferrer">{inner}</a>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {qr && (
            <div className="chub-qr">
              <img src={qr} alt="Scan for gt3pb.com" width={96} height={96} />
              <span>Scan to keep GT3 in your pocket</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
