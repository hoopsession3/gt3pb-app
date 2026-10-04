"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import Sheet, { CloseButton } from "./Sheet";
import { COLLECT_VIA, VIA_LABEL, VIA_HINT, type CollectVia } from "@/lib/collect";
import { money } from "@/lib/money";

// COLLECT AT THE WINDOW — the one sheet for "how did they pay?", shared by the pass and the pickup
// board (2026-10-04, 0341). Two big answers, each saying what it does to the count, because the two
// are not the same write (lib/collect.ts): cash goes in the till and is counted here; the reader is
// Square and is counted there. Telling the crew so at the tap is what stops the same money being
// rung on Square AND counted here.
//
// `handOff` is the guard on "Picked up": an order still owed cannot leave the window without the
// question being asked. The third answer is honest about what it is — handing it over unpaid — and
// is quiet, not hidden: a comp or a regular who settles up later is a real thing that happens.
//
//   const [askCollect, collectSheet] = useCollectSheet();
//   const how = await askCollect({ who: "Dana", cents: 850, handOff: true });   // "cash" | "card_reader" | "unpaid" | null
//   …
//   {collectSheet}
//
// A promise, like useConfirm, so the handler reads as a straight line; null on every dismissal.
// Mounted by its host rather than at the app root: only two boards ask this question.

export type CollectAsk = { who: string; cents: number; handOff?: boolean };
export type CollectAnswer = CollectVia | "unpaid";

export function useCollectSheet(): [(a: CollectAsk) => Promise<CollectAnswer | null>, ReactNode] {
  const [ask, setAsk] = useState<CollectAsk | null>(null);
  const resolver = useRef<((v: CollectAnswer | null) => void) | null>(null);

  const settle = useCallback((v: CollectAnswer | null) => {
    const r = resolver.current; resolver.current = null;
    setAsk(null);
    r?.(v);
  }, []);

  const open = useCallback((a: CollectAsk) => {
    resolver.current?.(null); // a question asked over an unanswered one: the first was not answered
    return new Promise<CollectAnswer | null>((resolve) => { resolver.current = resolve; setAsk(a); });
  }, []);

  const title = ask ? `${money(ask.cents)} from ${ask.who}` : "";
  const node = ask ? (
    <Sheet open onClose={() => settle(null)} label={`Collect ${title}`}
      header={<div className="collect-head"><b>Collect {title}</b><CloseButton onClick={() => settle(null)} /></div>}>
      <p className="dp-hint collect-q">{ask.handOff ? "Still owed. How did they pay?" : "How did they pay?"}</p>
      <div className="collect-ways">
        {COLLECT_VIA.map((v) => (
          <button key={v} type="button" className="dl-card collect-way" onClick={() => settle(v)}>
            <b>{VIA_LABEL[v]}</b>
            <span>{VIA_HINT[v]}</span>
          </button>
        ))}
      </div>
      {ask.handOff && (
        <button type="button" className="collect-skip" onClick={() => settle("unpaid")}>Hand it over unpaid</button>
      )}
    </Sheet>
  ) : null;

  return [open, node];
}
