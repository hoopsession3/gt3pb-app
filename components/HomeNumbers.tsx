"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { FLAVORS } from "@/lib/orderAhead";
import { flavorDemand } from "@/lib/brewMath";
import { nextDropDay } from "@/lib/dropDate";
import { addDays, localToday, dayWithDate } from "@/lib/dates";
import { moneyRound } from "@/lib/money";
import { pctChange, changeWords, channelDriver, estMargin, samePoint, paceWords, topOf, type Channels } from "@/lib/home";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "./kit";
import { useOperatorSection } from "./OperatorNav";

// THREE NUMBERS, EACH WITH ITS REASON (2026-10-09, One home — round 2 of the UX plan; Ryan chose the
// three: "Sales, margin, next-drop orders"). Command put twelve figures at equal weight and Money
// opened on five, none of them compared with anything, so the reader had to work out which one
// mattered and whether it was good. Here each number says how it moved against last week and what
// moved it, in words — color is never the only signal — and taps through to where its detail lives.
//
// Who sees what is who could already see it: sales and margin are Money's (admins and owners); the
// next drop is the pickup board's (anyone who manages). Crew see the day's tasks only.

type Report = { revenue_cents?: number; by_channel?: Channels; cogs_pct?: number; error?: string };
type EventPnl = { id: string; kind: string; fixed_cents: number };
type Nums = {
  sales: { now: number; prev: number; driver: ReturnType<typeof channelDriver> } | null;
  margin: { now: number; prev: number; pctOfSales: number | null; fixed: number; cogsPct: number } | null;
  drop: { iso: string; packs: number; then: number | null; top: [string, number] | null } | null;
};

// The row is Needs-you's (.owed-row); what it adds is utilities, not a recipe of its own. The value is
// the one large thing in it; the cause under the name wraps rather than cut a reason in half.
const VALUE = "flex-none text-title3 font-semibold text-cream whitespace-nowrap tabular-nums";
const CAUSE = "text-caption text-cream-muted";
const sign = (cents: number) => `${cents > 0 ? "+" : "−"}${moneyRound(Math.abs(cents))}`;

export default function HomeNumbers({ money, drops }: { money: boolean; drops: boolean }) {
  const { setSection } = useOperatorSection();
  const loader = useCallback(async (): Promise<Nums> => {
    const out: Nums = { sales: null, margin: null, drop: null };
    if (!supabase) return out;
    const sb = supabase;
    const jobs: Promise<void>[] = [];
    if (money) jobs.push((async () => {
      const today = localToday(), weekStart = addDays(today, -6);
      // report_sales has no offset: last week is the 14-day report less the 7-day one.
      const [r14, r7, pnl, evs] = await Promise.all([
        sb.rpc("report_sales", { p_days: 14 }),
        sb.rpc("report_sales", { p_days: 7 }),
        sb.rpc("report_events"),
        sb.from("events").select("id, day").gte("day", addDays(today, -13)).lte("day", today),
      ]);
      const failed = [r14.error, r7.error, pnl.error, evs.error].find(Boolean);
      if (failed) throw new Error(failed.message);
      const a = (r14.data ?? {}) as Report, b = (r7.data ?? {}) as Report;
      if (a.error || b.error) throw new Error(a.error || b.error);
      const now = Number(b.revenue_cents ?? 0), prev = Number(a.revenue_cents ?? 0) - now;
      out.sales = { now, prev, driver: channelDriver(b.by_channel ?? {}, a.by_channel ?? {}) };
      // The week's fixed costs: the events held in it, at what report_events says each one cost.
      const cost = new Map(((pnl.data as EventPnl[] | null) ?? []).filter((e) => e.kind === "event").map((e) => [e.id, e]));
      let fixedNow = 0, fixedPrev = 0;
      for (const e of ((evs.data as { id: string; day: string | null }[] | null) ?? [])) {
        const c = cost.get(e.id);
        if (!c || !e.day || !c.fixed_cents) continue;
        if (e.day >= weekStart) fixedNow += c.fixed_cents; else fixedPrev += c.fixed_cents;
      }
      const cogsPct = Number(b.cogs_pct ?? 0.3);
      const mNow = estMargin(now, cogsPct, fixedNow);
      out.margin = { now: mNow, prev: estMargin(prev, cogsPct, fixedPrev), pctOfSales: now > 0 ? Math.round((mNow / now) * 100) : null, fixed: fixedNow, cogsPct };
    })());
    if (drops) jobs.push((async () => {
      const day = await nextDropDay(sb);
      const [cur, past] = await Promise.all([
        sb.from("drop_orders").select("id, mix, created_at").eq("drop_date", day.iso).is("canceled_at", null),
        sb.from("drop_orders").select("drop_date, created_at").lt("drop_date", day.iso).is("canceled_at", null).order("drop_date", { ascending: false }).limit(300),
      ]);
      const failed = [cur.error, past.error].find(Boolean);
      if (failed) throw new Error(failed.message);
      const rows = (cur.data as { mix: Record<string, number> | null; created_at: string }[] | null) ?? [];
      const before = (past.data as { drop_date: string; created_at: string }[] | null) ?? [];
      const prevISO = before[0]?.drop_date ?? null;
      out.drop = {
        iso: day.iso,
        packs: rows.length,
        then: prevISO ? samePoint(before.filter((o) => o.drop_date === prevISO), prevISO, day.iso, new Date()) : null,
        top: topOf(flavorDemand(rows, FLAVORS)),
      };
    })());
    await Promise.all(jobs);
    return out;
  }, [money, drops]);
  const state = useAsyncData<Nums>(loader, [loader]);
  if (!money && !drops) return null;

  return (
    <div className="adm-sec" id="home-numbers">
      {/* The head stays put while the numbers load, so nothing below it moves when they arrive. */}
      <SectionHeader label="Numbers" right={<button type="button" className="owed-more -my-3.5" onClick={() => setSection("command")}>See all <span aria-hidden="true">›</span></button>} />
      <AsyncSection
        state={state}
        isEmpty={(d) => !d.sales && !d.margin && !d.drop}
        emptyTitle="No numbers yet"
        loadingLabel="Reading the week…"
        errorTitle="Couldn't read this week's numbers"
        errorSub="This is not zero — we could not read them just now."
      >
        {({ sales, margin, drop }) => (
          <div className="owed">
            {sales && (
              <button type="button" className="owed-row" onClick={() => setSection("money")}>
                <span className="owed-row-b">
                  <b>Sales · 7 days</b>
                  <span className={CAUSE}>{changeWords(pctChange(sales.now, sales.prev))}{sales.driver ? ` · ${sales.driver.label} ${sign(sales.driver.deltaCents)}` : ""}</span>
                </span>
                <span className={VALUE}>{moneyRound(sales.now)}</span>
                <span className="owed-c" aria-hidden="true">›</span>
              </button>
            )}
            {margin && (
              <button type="button" className="owed-row" onClick={() => setSection("money")}>
                <span className="owed-row-b">
                  <b>Margin · 7 days, est.</b>
                  <span className={CAUSE}>
                    {changeWords(pctChange(margin.now, margin.prev))}
                    {margin.fixed > 0
                      ? ` · after ${moneyRound(margin.fixed)} in event costs`
                      : ` · ingredients at ${Math.round(margin.cogsPct * 100)}% of sales`}
                  </span>
                </span>
                <span className={VALUE}>{moneyRound(margin.now)}{margin.pctOfSales !== null && <small className="text-footnote font-normal text-cream-muted"> · {margin.pctOfSales}%</small>}</span>
                <span className="owed-c" aria-hidden="true">›</span>
              </button>
            )}
            {drop && (
              <button type="button" className="owed-row" onClick={() => setSection("now")}>
                <span className="owed-row-b">
                  <b>Next drop · {dayWithDate(drop.iso)}</b>
                  <span className={CAUSE}>
                    {drop.then === null ? "The first drop on the books" : paceWords(drop.packs, drop.then)}
                    {drop.top ? ` · most asked: ${drop.top[0]}` : ""}
                  </span>
                </span>
                <span className={VALUE}>{drop.packs} {drop.packs === 1 ? "pack" : "packs"}</span>
                <span className="owed-c" aria-hidden="true">›</span>
              </button>
            )}
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
