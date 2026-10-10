"use client";

import { useEffect } from "react";
import { apiUrl } from "@/lib/native";

// AN OPEN TAB COMES BACK CURRENT (2026-10-10). Ryan sent a screenshot of the menu — "this still
// cluttered" — that was the menu from before the night's release: the serif paragraph, "Tap any
// drink", every ingredient line. Production was serving the new one; his Safari tab had been open
// since before it and was still running the build it loaded. Pages are fetched network-first
// (public/sw.js), so any load is current, and a crash from a missing chunk heals itself
// (lib/deploySkew) — but a tab that never reloads and never crashes keeps showing the old screens.
//
// So: when the tab comes back after a minute or more away (switched to, or restored from the back-
// forward cache), it asks /api/health which build is live, and a different one means a reload — the
// same thing the user would do, done for them. Not while anyone is typing or a sheet is open: then
// the tab stays as it is and the next return asks again. The iPhone app ships its screens in the
// app and updates through the App Store, so it never asks; nor does a build that does not know its
// own commit (a local one).
export const AWAY_MS = 60_000;

/** Something the person may be in the middle of: a focused field, an open sheet, or words in a field on
 *  screen. A field filled in for them counts too — losing someone's typing costs more than a stale screen. */
export function busyHere(doc: Document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return true;
  if (doc.querySelector('[role="dialog"]')) return true;
  return [...doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=number], input[type=search]")]
    .some((f) => !f.readOnly && !f.disabled && f.offsetParent !== null && f.value.trim() !== "");
}

export default function FreshTab() {
  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_COMMIT;
    if (!mine || process.env.NEXT_PUBLIC_GT3_TARGET === "app") return;
    let awaySince = document.visibilityState === "hidden" ? Date.now() : 0;
    let asking = false;
    const back = async () => {
      if (!awaySince || Date.now() - awaySince < AWAY_MS || asking) { awaySince = 0; return; }
      awaySince = 0;
      asking = true;
      try {
        const r = await fetch(apiUrl("/api/health"), { cache: "no-store" });
        const live = r.ok ? (await r.json())?.build?.commit : null;
        if (typeof live === "string" && live && live !== mine && !busyHere(document)) window.location.reload();
      } catch { /* offline: the next return asks again */ } finally { asking = false; }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") awaySince = Date.now(); else void back(); };
    // Safari restores a page it kept whole (the back-forward cache) without a visibility change.
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) { awaySince = awaySince || Date.now() - AWAY_MS; void back(); } };
    const onHide = () => { awaySince = Date.now(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);
  return null;
}
