"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { parseRecordParam, recordParam, type RecordKind, type RecordRef } from "@/lib/records";

// RECORDSHEET — one host for every record detail view, opened from anywhere by (kind, id).
//
// This is TaskSheet's pattern, generalised. TaskSheet is the strongest architecture in this repo:
// a provider, an openTask(id, source), and every surface's job shrinks to rendering a chip. It was
// the only entity that had it. Now every kind does, and adding the next one is a line in
// lib/records.ts plus a component below.
//
// TWO THINGS THIS ADDS OVER TaskSheet, both from the same finding — that no record in this app has
// ever had an address:
//
//   1. A RECORD SURVIVES A RELOAD. Opening one writes ?r=kind:id, so the back button works, a
//      refresh keeps you where you were, and you can send somebody a link to a person instead of
//      "go to Team, scroll down, tap the third row".
//   2. IT PRESERVES THE REST OF THE URL. The section param ?s= and anything else stay put. That is
//      not hypothetical: the same class of bug — rebuilding a URL from scratch and dropping every
//      other parameter — is what broke the hire deep link, and it took three attempts to find.

const CrewPerson = dynamic(() => import("./CrewPerson"), { ssr: false });
const CustomerRecord = dynamic(() => import("./CustomerRecord"), { ssr: false });
const ShopOrderRecord = dynamic(() => import("./ShopOrderRecord"), { ssr: false });
const EventRecord = dynamic(() => import("./EventRecord"), { ssr: false });
const StopRecord = dynamic(() => import("./StopRecord"), { ssr: false });

type Ctx = { openRecord: (kind: RecordKind, id: string) => void; closeRecord: () => void };
const RecordCtx = createContext<Ctx>({ openRecord: () => {}, closeRecord: () => {} });
export const useRecord = () => useContext(RecordCtx);

export function RecordProvider({ children }: { children: React.ReactNode }) {
  // Read the address ONCE, lazily, rather than in an effect that calls setState on mount — a link
  // somebody pasted should open on the first render, not after a second one. Guarded for the server
  // pass, where there is no window and the answer is always "nothing open".
  const [ref, setRef] = useState<RecordRef | null>(() => {
    if (typeof window === "undefined") return null;
    try { return parseRecordParam(new URL(window.location.href).searchParams.get("r")); }
    catch { return null; }
  });

  // Write the address without touching anything else in the URL.
  const stamp = useCallback((r: RecordRef | null) => {
    try {
      const u = new URL(window.location.href);
      if (r) u.searchParams.set("r", recordParam(r));
      else u.searchParams.delete("r");
      window.history.replaceState(window.history.state, "", u.pathname + u.search);
    } catch { /* a URL we cannot parse is not worth failing an open over */ }
  }, []);

  const openRecord = useCallback((kind: RecordKind, id: string) => {
    const r = { kind, id };
    setRef(r); stamp(r);
  }, [stamp]);

  const closeRecord = useCallback(() => { setRef(null); stamp(null); }, [stamp]);

  // The browser's own back button should close the sheet rather than leaving it stranded over a
  // page that has moved underneath it.
  useEffect(() => {
    const onPop = () => {
      try { setRef(parseRecordParam(new URL(window.location.href).searchParams.get("r"))); }
      catch { setRef(null); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <RecordCtx.Provider value={{ openRecord, closeRecord }}>
      {children}
      {ref?.kind === "person"     && <CrewPerson      userId={ref.id}     onClose={closeRecord} />}
      {ref?.kind === "customer"   && <CustomerRecord  customerId={ref.id} onClose={closeRecord} />}
      {ref?.kind === "shop_order" && <ShopOrderRecord orderId={ref.id}    onClose={closeRecord} />}
      {ref?.kind === "event"      && <EventRecord     eventId={ref.id}    onClose={closeRecord} />}
      {ref?.kind === "stop"       && <StopRecord      stopId={ref.id}     onClose={closeRecord} />}
    </RecordCtx.Provider>
  );
}

// ── the affordance ────────────────────────────────────────────────────────────────────────────────
// Fifteen places in this app print a record's name and give you nothing to tap. Each was only
// fixable one screen at a time. This makes each of them a one-line change, and — importantly — it
// degrades to plain text when there is no id, so a guest order or an unlinked name never renders a
// button that goes nowhere. A link that half-works is worse than no link.
export function RecordLink({ kind, id, children, className }: {
  kind: RecordKind; id: string | null | undefined; children: React.ReactNode; className?: string;
}) {
  const { openRecord } = useRecord();
  if (!id) return <>{children}</>;
  return (
    <button type="button" className={`rec-link${className ? ` ${className}` : ""}`}
            onClick={(e) => { e.stopPropagation(); openRecord(kind, id); }}>
      {children}
    </button>
  );
}
