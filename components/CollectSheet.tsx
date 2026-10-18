"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Sheet, { CloseButton } from "./Sheet";
import { COLLECT_VIA, VIA_LABEL, VIA_HINT, HOUSE_LABEL, HOUSE_HINT, houseReasonOk, type CollectVia, type OnTheHouse } from "@/lib/collect";
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
//
// ON THE HOUSE (0432 — R27 of the 10/10 audit, database F17; Ryan: "Owner/admin, with a reason"). "Free cup or credit"
// takes the free cup redeemed or the credit used for the member today, and the database refuses it when nothing was
// taken off. An owner or admin (`house`) has a fourth answer for that: On the house, with why — the reason is the record.

export type CollectAsk = { who: string; cents: number; handOff?: boolean; house?: boolean };
export type CollectAnswer = CollectVia | "unpaid" | OnTheHouse;

export function useCollectSheet(): [(a: CollectAsk) => Promise<CollectAnswer | null>, ReactNode] {
  const [ask, setAsk] = useState<CollectAsk | null>(null);
  const [why, setWhy] = useState<string | null>(null);   // on the house: the reason being written (null: not asked)
  const whyRef = useRef<HTMLInputElement>(null);
  const writing = why !== null;
  useEffect(() => { if (writing) whyRef.current?.focus(); }, [writing]);   // the card pressed is gone: the caret is in its field
  const resolver = useRef<((v: CollectAnswer | null) => void) | null>(null);

  const settle = useCallback((v: CollectAnswer | null) => {
    const r = resolver.current; resolver.current = null;
    setAsk(null); setWhy(null);
    r?.(v);
  }, []);

  const open = useCallback((a: CollectAsk) => {
    resolver.current?.(null); // a question asked over an unanswered one: the first was not answered
    return new Promise<CollectAnswer | null>((resolve) => { resolver.current = resolve; setWhy(null); setAsk(a); });
  }, []);

  const title = ask ? `${money(ask.cents)} from ${ask.who}` : "";
  const node = ask ? (
    // A reason being written for On the house (0432): leaving asks first, as any form holding typed words does.
    <Sheet open onClose={() => settle(null)} label={`Collect ${title}`} dirty={!!why?.trim()}
      header={<div className="collect-head"><b>Collect {title}</b><CloseButton onClick={() => settle(null)} /></div>}>
      <p className="dp-hint collect-q">{ask.handOff ? "Still owed. How did they pay?" : "How did they pay?"}</p>
      <div className="collect-ways">
        {COLLECT_VIA.map((v) => (
          <button key={v} type="button" className="dl-card collect-way" onClick={() => settle(v)}>
            <b>{VIA_LABEL[v]}</b>
            <span>{VIA_HINT[v]}</span>
          </button>
        ))}
        {ask.house && why === null && (
          <button type="button" className="dl-card collect-way" onClick={() => setWhy("")}>
            <b>{HOUSE_LABEL}</b>
            <span>{HOUSE_HINT}</span>
          </button>
        )}
      </div>
      {ask.house && why !== null && (
        <form className="mt-3" noValidate onSubmit={(e) => { e.preventDefault(); if (houseReasonOk(why)) settle({ house: why }); }}>
          <label className="auth-label" htmlFor="collect-why">Why it&rsquo;s on the house</label>
          {/* Why, not who: the reason stays with the order in the books, after a member's name is gone. */}
          <input id="collect-why" ref={whyRef} className="auth-input" type="text" maxLength={200} autoComplete="off" enterKeyHint="done"
            placeholder="Spilled drink, staff meal, made it wrong…" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button type="submit" className="btn-pri btn-wide mt-3" disabled={!houseReasonOk(why)}>
            <span>Put it on the house</span>
          </button>
        </form>
      )}
      {ask.handOff && (
        <button type="button" className="collect-skip" onClick={() => settle("unpaid")}>Hand it over unpaid</button>
      )}
    </Sheet>
  ) : null;

  return [open, node];
}
