"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// BREADCRUMBS — orientation for deep crew views (e.g. Prep › Atlanta BeltLine). A deep view
// registers a crumb for its lifetime via useCrumb(); the trail renders in the section header with
// the section as a clickable root that pops you back out. Generic on purpose: any future drilldown
// opts in with one hook call, no coupling to this file.
type Crumb = { id: string; label: string; go?: () => void };
const Ctx = createContext<{ crumbs: Crumb[]; push: (c: Crumb) => void; remove: (id: string) => void }>({ crumbs: [], push: () => {}, remove: () => {} });
export const useCrumbs = () => useContext(Ctx);

export function CrumbProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const push = useCallback((c: Crumb) => setCrumbs((cur) => [...cur.filter((x) => x.id !== c.id), c]), []);
  const remove = useCallback((id: string) => setCrumbs((cur) => cur.filter((x) => x.id !== id)), []);
  return <Ctx.Provider value={{ crumbs, push, remove }}>{children}</Ctx.Provider>;
}

// Register a crumb while this component is mounted. Pass label=null to show none. `go` steps back to
// the level above this crumb (kept in a ref so an unstable handler doesn't thrash the effect).
export function useCrumb(id: string, label: string | null, go?: () => void) {
  const { push, remove } = useCrumbs();
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!label) { remove(id); return; }
    push({ id, label, go: () => goRef.current?.() });
    return () => remove(id);
  }, [id, label, push, remove]);
}

export function Breadcrumbs({ root }: { root: string }) {
  const { crumbs } = useCrumbs();
  if (crumbs.length === 0) return null;
  const rootGo = crumbs[0]?.go; // root pops back to the section list (the outermost crumb's "up")
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {rootGo ? <button type="button" className="crumb-lk crumb-root" onClick={rootGo}>{root}</button> : <span className="crumb-root">{root}</span>}
      {crumbs.map((c, i) => {
        const isLeaf = i === crumbs.length - 1;
        return (
          <span key={c.id} className="crumb">
            <em className="crumb-sep" aria-hidden>›</em>
            {!isLeaf && c.go ? <button type="button" className="crumb-lk" onClick={c.go}>{c.label}</button> : <span aria-current={isLeaf ? "page" : undefined}>{c.label}</span>}
          </span>
        );
      })}
    </nav>
  );
}
