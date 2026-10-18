"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useHydrated } from "@/lib/clientState";

// THE OPERATOR SECTION — which console section is open, shared by the nav (rendered in the shell)
// and the crew page, URL-backed and persisted. Lifted out of OperatorNav.tsx on 2026-10-02 so the
// shell can hold the PROVIDER (tiny, needed on every page) without carrying the NAV (the whole
// console bar, needed on /crew only) into every guest's bundle. OperatorNav re-exports these, so
// every existing `from "./OperatorNav"` import still resolves; new code may import from here.

export type OpSection = "day" | "now" | "ask" | "command" | "prep" | "plan" | "studio" | "brew" | "garage" | "driver" | "notes" | "money" | "catalog" | "customers" | "team" | "settings";

// addressGen (R33 — the audit's FE11-01): moves each time the router changes the address's query, so a screen that
// reads a one-time parameter (the console's ?a=) reads it again after a navigation the page didn't reload for.
const Ctx = createContext<{ section: OpSection; setSection: (s: OpSection) => void; back: () => boolean; canGoBack: boolean; groupId: string | null; setGroupId: (g: string | null) => void; addressGen: number }>({ section: "day", setSection: () => {}, back: () => false, canGoBack: false, groupId: null, setGroupId: () => {}, addressGen: 0 });
export const useOperatorSection = () => useContext(Ctx);

export const VALID = new Set<OpSection>(["day", "now", "command", "prep", "plan", "studio", "brew", "garage", "driver", "notes", "money", "catalog", "customers", "team", "settings"]);

/** The section a page arrives on: ?s= when it names one, else the one the phone kept, else none. Reads the address and
 *  storage — called while rendering once this is the browser, and by the arrival's effect. */
function arrivalSection(): OpSection | null {
  try {
    const q = new URL(window.location.href).searchParams.get("s");
    if (q && VALID.has(q as OpSection)) return q as OpSection;
    const ls = localStorage.getItem("gt3-op-section");
    if (ls && VALID.has(ls as OpSection)) return ls as OpSection;
  } catch { /* ignore */ }
  return null;
}

/**
 * THE ADDRESS, FOLLOWED (R33, 2026-10-18 — the audit's FE11-01). The section was read from ?s= once, as the app loaded,
 * and again only on back/forward (popstate). A link opened through the router — a tapped order alert on the iPhone
 * (NativeBridge), a universal link, the task sheet's goal link — changed the address and nothing else: the Pass didn't
 * open, and its ?a= opened it later, at the next section tap. This reads the router's own address (useSearchParams) and
 * hands each change to the provider. In a Suspense of its own: on a page drawn ahead of time it draws nothing until the
 * browser has the address, and nothing around it waits (Next: useSearchParams outside Suspense draws the whole tree in
 * the browser).
 */
function AddressWatch({ onAddress }: { onAddress: (path: string, search: string) => void }) {
  const path = usePathname() ?? "";
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => { onAddress(path, search); }, [path, search, onAddress]);
  return null;
}

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

  // ARRIVAL: a ?s= deep-link wins, else the last section you were on. Read once this is the browser (lib/clientState) —
  // "day" on the server and while hydrating, as before — and set while rendering (R17): it was an effect that set state
  // as it mounted. What is outside React — the ref, the phone's memory, the address — follows in the effect below.
  const hydrated = useHydrated();
  const [arrived, setArrived] = useState(false);
  if (hydrated && !arrived) {
    setArrived(true);
    const first = arrivalSection();
    if (first && first !== section) setSectionState(first);
  }

  // The ref follows the section in the commit's layout pass — before any screen's effect can call setSection (a child's
  // effects run before this provider's own). The arrival sets the section while rendering, and a ref left at "day" until
  // the effect below made a cold open of a Pass link push a second /crew?s=now: a ‹ Back that went nowhere (the R17
  // review, F4).
  useLayoutEffect(() => { sectionRef.current = section; }, [section]);

  const stamped = useRef(false);   // the arrival is stamped once
  useEffect(() => {
    if (!arrived || stamped.current) return;
    stamped.current = true;
    try {
      if (arrivalSection()) { try { localStorage.setItem("gt3-op-section", section); } catch { /* ignore */ } }
      // Stamp the resolved section into the URL so the base history entry is addressable — native
      // back returns HERE (not blank), the section is deep-linkable, and swipe-back has an anchor.
      // replaceState (not push): we're labelling the entry we're already on, not adding one.
      if (window.location.pathname.startsWith("/crew")) {
        const cur = section;
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
    // The arrival only: a later section change is stamped by setSection, and a back/forward by the address itself.
  }, [arrived, section]);

  // A navigation the router made (R33 — FE11-01): /crew?s=… opened from an alert, a universal link or a sheet's link is
  // that section now, and the query's move is counted (addressGen) for the screens that read a one-time parameter.
  // The section's own pushState (setSection) lands here too, already applied — and changes nothing.
  const [addressGen, setAddressGen] = useState(0);
  const lastSearch = useRef<string | null>(null);
  const followAddress = useCallback((path: string, search: string) => {
    if (lastSearch.current !== null && lastSearch.current !== search) setAddressGen((g) => g + 1);
    lastSearch.current = search;
    if (!path.startsWith("/crew")) return;
    const q = new URLSearchParams(search).get("s");
    if (q && VALID.has(q as OpSection) && q !== sectionRef.current) apply(q as OpSection);
  }, []);

  useEffect(() => {
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
  // One value per change (R25 — the 10/10 audit, performance F19): a new object each render re-drew every reader of this
  // context whenever the shell drew again — the whole console among them.
  const canGoBack = depth > 0;
  const value = useMemo(() => ({ section, setSection, back, canGoBack, groupId, setGroupId: setGroup, addressGen }), [section, setSection, back, canGoBack, groupId, setGroup, addressGen]);
  return (
    <Ctx.Provider value={value}>
      <Suspense fallback={null}><AddressWatch onAddress={followAddress} /></Suspense>
      {children}
    </Ctx.Provider>
  );
}

