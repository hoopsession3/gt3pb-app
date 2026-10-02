"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// THE OPERATOR SECTION — which console section is open, shared by the nav (rendered in the shell)
// and the crew page, URL-backed and persisted. Lifted out of OperatorNav.tsx on 2026-10-02 so the
// shell can hold the PROVIDER (tiny, needed on every page) without carrying the NAV (the whole
// console bar, needed on /crew only) into every guest's bundle. OperatorNav re-exports these, so
// every existing `from "./OperatorNav"` import still resolves; new code may import from here.

export type OpSection = "day" | "now" | "ask" | "command" | "prep" | "plan" | "studio" | "brew" | "garage" | "driver" | "notes" | "money" | "customers" | "team" | "settings";

const Ctx = createContext<{ section: OpSection; setSection: (s: OpSection) => void; back: () => boolean; canGoBack: boolean; groupId: string | null; setGroupId: (g: string | null) => void }>({ section: "day", setSection: () => {}, back: () => false, canGoBack: false, groupId: null, setGroupId: () => {} });
export const useOperatorSection = () => useContext(Ctx);

export const VALID = new Set<OpSection>(["day", "now", "command", "prep", "plan", "studio", "brew", "garage", "driver", "notes", "money", "customers", "team", "settings"]);

export function OperatorSectionProvider({ children }: { children: React.ReactNode }) {
  const [section, setSectionState] = useState<OpSection>("day");
  // The active nav GROUP (lane). Sections can belong to two lanes; the tapped tab wins the
  // ambiguity. Null = resolve from the section (first lane that contains it).
  const [groupId, setGroupId] = useState<string | null>(() => { try { return localStorage.getItem("gt3-op-group"); } catch { return null; } });
  const setGroup = useCallback((g: string | null) => { setGroupId(g); try { if (g) localStorage.setItem("gt3-op-group", g); } catch { /* ignore */ } }, []);
  // URL-backed sections: a section change is a real browser-history entry (/crew?s=prep), so the
  // native Back button, the phone's swipe-back, and deep-links all work. `depth` tracks how many
  // section entries WE pushed this visit — the console back button uses it to know when to exit crew.
  const sectionRef = useRef<OpSection>("day");
  const depthRef = useRef(0);
  const [depth, setDepth] = useState(0);
  const apply = (s: OpSection) => { sectionRef.current = s; setSectionState(s); try { localStorage.setItem("gt3-op-section", s); } catch { /* ignore */ } };

  useEffect(() => {
    // Hydrate: a ?s= deep-link wins, else the last section you were on.
    try {
      let resolved: OpSection | null = null;
      const q = new URL(window.location.href).searchParams.get("s");
      if (q && VALID.has(q as OpSection)) { apply(q as OpSection); resolved = q as OpSection; }
      else { const ls = localStorage.getItem("gt3-op-section"); if (ls && VALID.has(ls as OpSection)) { apply(ls as OpSection); resolved = ls as OpSection; } }
      // Stamp the resolved section into the URL so the base history entry is addressable — native
      // back returns HERE (not blank), the section is deep-linkable, and swipe-back has an anchor.
      // replaceState (not push): we're labelling the entry we're already on, not adding one.
      if (window.location.pathname.startsWith("/crew")) {
        const cur = resolved ?? sectionRef.current;
        const u = new URL(window.location.href);
        if (u.searchParams.get("s") !== cur) {
          // KEEP EVERY OTHER PARAM. This used to write the literal `/crew?s=${cur}`, which is not a
          // normalisation — it is a new URL with one parameter in it, and everything else on the
          // way in was dropped before any component could read it. That silently killed the
          // customer card's "Bring X onto the crew" link (?s=team&promote=<id>): the section landed,
          // the id did not, and the roster opened having been told nothing. The ?a= anchor links
          // survived only by timing. Mutate the URL instead of rebuilding it.
          u.searchParams.set("s", cur);
          window.history.replaceState({ gt3s: cur }, "", u.pathname + u.search);
        }
      }
    } catch { /* ignore */ }
    // Back/forward (button or swipe): read the section out of the URL and apply it.
    const onPop = () => {
      try {
        const q = new URL(window.location.href).searchParams.get("s");
        if (q && VALID.has(q as OpSection) && q !== sectionRef.current) apply(q as OpSection);
      } catch { /* ignore */ }
      depthRef.current = Math.max(0, depthRef.current - 1);
      setDepth(depthRef.current);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setSection = useCallback((s: OpSection) => {
    if (s === sectionRef.current) return;
    apply(s);
    try {
      if (window.location.pathname.startsWith("/crew")) {
        // Same rule as the hydrate above: navigating a section must not discard whatever else the
        // URL is carrying. A deep-link parameter that survives arrival and then dies on the first
        // tab tap is arguably worse than one that never arrived.
        const u = new URL(window.location.href);
        u.searchParams.set("s", s);
        window.history.pushState({ gt3s: s }, "", u.pathname + u.search);
        depthRef.current += 1; setDepth(depthRef.current);
      }
    } catch { /* ignore */ }
  }, []);

  // Console back button: if we pushed section history, let the browser walk it back; otherwise the
  // caller leaves crew mode (‹ → /3mpire). popstate applies the resulting section.
  const back = useCallback((): boolean => {
    if (depthRef.current > 0) { try { window.history.back(); } catch { /* ignore */ } return true; }
    return false;
  }, []);
  return <Ctx.Provider value={{ section, setSection, back, canGoBack: depth > 0, groupId, setGroupId: setGroup }}>{children}</Ctx.Provider>;
}

