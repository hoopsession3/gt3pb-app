"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { failureWords } from "@/lib/failureWords";
import Said from "@/components/Said";
import Num from "./Num";
import { readLedger } from "@/lib/orderLedger";
import type { Layout } from "@/lib/vision";
import { dollars, type Inputs, type MetricKey, type Model } from "@/lib/visionMoney";
import { Segmented } from "@/components/controls";
import { CHANNEL_KIND, CHANNEL_KINDS, contribution, traffic, trafficFlags, type ChannelKind } from "@/lib/visionTraffic";
import { ASSUMED_SERVE_SEC, HOUR_WORD, capacity, checkHours, hours, observedHours } from "@/lib/visionRoom";

// TRAFFIC AND THE ROOM (R55, phase C). Two steps of a plan's case, on the same scenario as its money:
//   Traffic — where the guests come from, channel by channel (reach → first orders → returning guests → orders → sales),
//   what a new guest costs and what one is worth, and whether the channels bring the orders a day the money counts on.
//   The room — what the plan's room can serve in a slow, an average and the peak hour, the people it takes, and the
//   sales the counter can't take when an hour asks for more; the timing behind it, measured or labelled as assumed; GT3's
//   own busiest hour as evidence for the peak. Simulated is said as simulated; observed as observed.
type Set = (p: Partial<Inputs>) => void;

const one = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");

export function TrafficView({ i, set, model, onOpen }: { i: Inputs; set: Set; model: Model; onOpen: (k: MetricKey) => void }) {
  // The engine's own run when the money counts the channels; otherwise the same model, run here to show them.
  const linked = i.demandFrom === "channels";
  const t = model.traffic ?? traffic(i.channels, { repeatPerMonth: i.repeatPerMonth, keptPct: i.keptPct }, i.avgOrderCents, i.cogsPct == null ? null : 100 - i.cogsPct - i.cardFeePct, i.daysOpenPerMonth);
  const parts = contribution(t, i.channels, 12);
  const found = trafficFlags(t, i.channels, linked ? null : i.ordersPerDay, linked ? 0 : i.marketingCents);
  const m12 = t.ok ? t.months[11] : null;
  const reach12 = i.channels.reduce((n, c) => n + (12 >= (c.startMonth || 1) ? c.reach : 0), 0);
  const ch = (k: number, patch: Partial<Inputs["channels"][number]>) => set({ channels: i.channels.map((c, j) => (j === k ? { ...c, ...patch } : c)) });
  return (
    <div className="grid gap-4 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,420px)_minmax(0,1fr)] min-[1100px]:items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          <Segmented label="The money's orders" kind="choice" value={i.demandFrom} onChange={(v) => set({ demandFrom: v })} options={[{ key: "typed", label: "Orders a day, typed" }, { key: "channels", label: "From these channels" }]} />
          <p className="vz-card-s">{linked ? "The money counts the orders these channels bring, month by month, and what they cost as its marketing — change a channel and the money moves." : "The money uses the orders a day typed in Money. Count these channels instead, and they drive it live."}</p>
        </div>
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          <b className="font-sans text-subhead">Where the guests come from</b>
          <p className="vz-card-s">Each channel as you expect it: who it reaches a month, how many of them order a first time, what it costs a month, the month it starts.</p>
          {i.channels.map((c, k) => (
            <div key={k} className="vz-ask">
              <label className="prod-f col-span-2"><span>Channel</span><select value={c.kind} onChange={(e) => ch(k, { kind: e.target.value as ChannelKind })}>{CHANNEL_KINDS.map((x) => <option key={x} value={x}>{CHANNEL_KIND[x].name}</option>)}</select></label>
              <label className="prod-f col-span-2"><span>Its name (optional)</span><input value={c.label} maxLength={60} placeholder={CHANNEL_KIND[c.kind].name} onChange={(e) => ch(k, { label: e.target.value })} /></label>
              <Num label="Reach" unit="people a month" value={c.reach || null} set={(v) => ch(k, { reach: v ?? 0 })} />
              <Num label="First orders" unit="% of reach" value={c.convertPct || null} set={(v) => ch(k, { convertPct: v ?? 0 })} />
              <Num label="Cost" unit="$ a month" cents value={c.costCents || null} set={(v) => ch(k, { costCents: v ?? 0 })} />
              <Num label="Starts" unit="month" value={c.startMonth} set={(v) => ch(k, { startMonth: Math.max(1, Math.round(v ?? 1)) })} />
              <p className="vz-card-s col-span-2">{CHANNEL_KIND[c.kind].says}</p>
              <div className="vz-ask-x"><button type="button" className="btn-ter" onClick={() => set({ channels: i.channels.filter((_, j) => j !== k) })}>Remove</button></div>
            </div>
          ))}
          <button type="button" className="btn-sec btn-sm self-start" onClick={() => set({ channels: [...i.channels, { kind: "local", label: "", reach: 0, convertPct: 0, costCents: 0, startMonth: 1 }] })}>+ A channel</button>
        </div>
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          <b className="font-sans text-subhead">Coming back</b>
          <div className="prod-grid stack-sm mt-0">
            <Num label="Orders a month" unit="by a returning guest" value={i.repeatPerMonth} set={(v) => set({ repeatPerMonth: v })} />
            <Num label="Stay" unit="% month to month" value={i.keptPct} set={(v) => set({ keptPct: v })} />
          </div>
          <p className="vz-card-s">Our own sales count how many guests came back (Money, under what our own sales say) — a start, not a storefront&apos;s number.</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 min-w-0">
        {!t.ok ? <p className="vz-sub">Set {t.missing.join(", ")} to see where the traffic comes from.</p> : (
          <>
            <ol className="vz-funnel" aria-label="Month 12, from reach to sales">
              <li><span>Reach</span><b>{Math.round(reach12).toLocaleString("en-US")}</b><em>people a month</em></li>
              <li><span>First orders</span><b>{one(m12!.newGuests)}</b><em>new guests</em></li>
              <li><span>Coming back</span><b>{one(m12!.returning)}</b><em>guests kept</em></li>
              <li><span>Orders</span><b>{one(m12!.orders)}</b><em>{t.perDay12 != null ? `${one(t.perDay12)} a day` : "a month"}</em></li>
              <li><span>Sales</span><b>{i.avgOrderCents ? dollars(m12!.orders * i.avgOrderCents) : "—"}</b><em>a month</em></li>
            </ol>
            <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4">
              <div className="vz-kpi"><span>A new guest costs</span><b>{t.blendedCac == null ? "—" : dollars(t.blendedCac)}</b></div>
              <div className="vz-kpi"><span>Orders a guest places</span><b>{t.ordersPerGuest == null ? "—" : one(t.ordersPerGuest)}</b></div>
              <div className="vz-kpi"><span>A guest is worth</span><b>{t.ltv == null ? "—" : dollars(t.ltv)}</b></div>
              <div className="vz-kpi"><span>Worth ÷ cost</span><b>{t.ltv != null && t.blendedCac ? `${one(t.ltv / t.blendedCac)}×` : "—"}</b></div>
            </div>
            {found.length > 0 && <div className="flex flex-col gap-1">{found.map((f, k) => <p key={k} className={f.level === "stop" ? "vz-issue error" : "vz-issue warn"}>{f.words}</p>)}</div>}
            <figure className="vz-fig">
              <figcaption className="vz-fig-h"><b>Who brings the orders</b><span>month 12, each channel&apos;s new and returning guests</span></figcaption>
              <div className="vz-bars" role="list">
                {parts.map((p) => (
                  <div key={p.label} role="listitem" className="vz-bar">
                    <span>{p.label}</span>
                    <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect className="bg" x="0" y="0" width="100" height="10" /><rect className="fill" x="0" y="0" width={Math.max(0.5, p.share * 100)} height="10" /></svg>
                    <b>{Math.round(p.share * 100)}% · {one(p.orders)}</b>
                  </div>
                ))}
              </div>
            </figure>
            <div className="vz-cmp-wrap" role="region" aria-label="Each channel's numbers" tabIndex={0}>
              <table className="vz-cmp vz-num">
                <thead><tr><th scope="col">Channel</th><th scope="col">New guests, month 12</th><th scope="col">A new guest costs</th></tr></thead>
                <tbody>{i.channels.map((c, k) => <tr key={k}><th scope="row">{c.label || CHANNEL_KIND[c.kind].name}</th><td>{one(t.months[11].byChannel[k].newGuests)}</td><td>{t.cac[k] == null ? (c.costCents ? "brings no one" : "no cost") : dollars(t.cac[k]!)}</td></tr>)}</tbody>
              </table>
            </div>
            {linked && model.ok && <div className="vz-row"><button type="button" className="btn-sec btn-sm" onClick={() => onOpen("revenue")}>How the sales follow · {dollars(model.months.reduce((n, x) => n + x.revenue, 0))} in 36 months</button></div>}
          </>
        )}
      </div>
    </div>
  );
}

export function RoomView({ i, set, room, model, onOpenRoom, onOpen }: { i: Inputs; set: Set; room: Layout | null; model: Model; onOpenRoom?: () => void; onOpen: (k: MetricKey) => void }) {
  const serve = i.serveSec ?? ASSUMED_SERVE_SEC;
  // The plan's own orders a day — typed, or what the channels bring by month 12 — asked of the room.
  const perDay = i.demandFrom === "channels" ? (model.ok && i.daysOpenPerMonth ? model.months[11].ordersAsked / i.daysOpenPerMonth : null) : i.ordersPerDay;
  const h = hours(perDay, i.hoursOpenPerDay, i.peakFactor, i.slowFactor);
  const cap = room ? capacity(room, serve) : null;
  const checks = cap ? checkHours(h, cap, i.avgOrderCents) : [];
  const avgStaff = i.staffHoursPerDay != null && i.hoursOpenPerDay ? i.staffHoursPerDay / i.hoursOpenPerDay : null;
  const peak = checks.find((c) => c.kind === "peak");
  const [obs, setObs] = useState<ReturnType<typeof observedHours> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const read = async () => {
    if (!supabase) return;
    setErr(null);
    try {
      const { lines } = await readLedger(supabase, { fromIso: new Date(Date.now() - 90 * 86400000).toISOString() });
      setObs(observedHours(lines, "cup"));
    } catch (e) { setErr(failureWords(e as Error, "Couldn't read the sales")); }
  };
  if (!room) return <p className="vz-sub">This plan has no room drawn yet — draw one from its sheet (&ldquo;Save and draw its room&rdquo;), and its capacity shows here.</p>;
  return (
    <div className="grid gap-4 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,420px)_minmax(0,1fr)] min-[1100px]:items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          <b className="font-sans text-subhead">The hours</b>
          <Num label="Seconds to take an order" value={i.serveSec} set={(v) => set({ serveSec: v })} />
          {i.serveSec == null && <p className="vz-issue warn">Assumed {ASSUMED_SERVE_SEC} seconds until it&apos;s timed — time a dozen orders on the truck and set it.</p>}
          <div className="prod-grid stack-sm mt-0">
            <Num label="The peak hour" unit="× the average" value={i.peakFactor} set={(v) => set({ peakFactor: v })} />
            <Num label="A slow hour" unit="× the average" value={i.slowFactor} set={(v) => set({ slowFactor: v })} />
          </div>
          <p className="vz-card-s">The average hour is the money&apos;s orders a day over its hours open{h.normal != null ? ` — ${one(h.normal)} an hour` : " (set both in Money)"}.</p>
        </div>
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          <b className="font-sans text-subhead">Observed: our busiest hour</b>
          <p className="vz-card-s">The truck&apos;s cups, last 90 days: its busiest single hour against the average hour it sold in. Real, on the truck — a storefront&apos;s will differ.</p>
          {!obs ? <button type="button" className="btn-sec btn-sm self-start" onClick={() => void read()}>Read our hours</button>
            : obs.sellingHours === 0 ? <p className="vz-card-s">No paid cups in the last 90 days to learn from.</p> : (
              <>
                <p className="vz-card-s">{obs.sellingHours} hours sold in · {one(obs.avgPerHour!)} cups an average hour · {obs.peakHour} in the busiest — {one(obs.peakFactor!)}× the average.</p>
                <button type="button" className="btn-ter self-start" onClick={() => set({ peakFactor: obs.peakFactor })}>Use {one(obs.peakFactor!)}× as the peak</button>
              </>
            )}
          {err && <Said as="p" className="vz-issue warn">{err}</Said>}
        </div>
      </div>
      <div className="flex flex-col gap-3 min-w-0">
        <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4">
          <div className="vz-kpi"><span>Registers</span><b>{cap!.registers}</b></div>
          <div className="vz-kpi"><span>The counter serves</span><b>{cap!.counterPerHour} an hour</b></div>
          <div className="vz-kpi"><span>Seats</span><b>{cap!.seats}</b></div>
          <div className="vz-kpi"><span>Taps · pickup</span><b>{cap!.taps} · {cap!.pickup}</b></div>
        </div>
        <p className="vz-card-s">Simulated from the room as drawn — {cap!.perRegisterPerHour} orders an hour a register at {serve} seconds an order{i.serveSec == null ? " (assumed)" : ""}.</p>
        {checks.length === 0 ? <p className="vz-sub">Set orders a day and hours open in Money to check the room against the plan&apos;s hours.</p> : (
          <div className="vz-cmp-wrap" role="region" aria-label="Each hour against the counter" tabIndex={0}>
            <table className="vz-cmp vz-num">
              <thead><tr><th scope="col">Hour</th><th scope="col">Orders asked</th><th scope="col">The counter takes</th><th scope="col">Sales it can&apos;t take</th><th scope="col">People on</th></tr></thead>
              <tbody>{checks.map((c) => (
                <tr key={c.kind} className={c.fits ? undefined : "differs"}><th scope="row">{HOUR_WORD[c.kind]}</th><td>{one(c.demand)}</td><td>{c.capacity}{c.fits ? "" : ` (${one(c.overBy)} over)`}</td><td>{c.fits ? "—" : c.salesShortCents != null ? dollars(c.salesShortCents) : "—"}</td><td>{c.staffNeeded}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {peak && !peak.fits && <Said as="p" className="vz-issue error">The peak hour asks for {one(peak.demand)} orders and the counter takes {peak.capacity}: another register or a walk-up window — or a faster order — before the plan counts on those sales.</Said>}
        {peak && avgStaff != null && peak.staffNeeded > avgStaff + 0.5 && <Said as="p" className="vz-issue warn">The money pays for about {one(avgStaff)} people on at a time; the peak needs {peak.staffNeeded}. Shift the hours to the peak, or add them to the money.</Said>}
        <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
          <Segmented label="The money's sales" kind="choice" value={i.capToRoom ? "cap" : "off"} onChange={(v) => set({ capToRoom: v === "cap" })} options={[{ key: "off", label: "As the plan asks" }, { key: "cap", label: "At most the counter's" }]} />
          {i.capToRoom && model.ok && model.capPerMonth != null ? (
            <p className="vz-card-s">The counter takes about {Math.round(model.capPerMonth).toLocaleString("en-US")} orders a month over the hours open.{model.ordersLost > 0 ? ` In ${model.cappedMonths} of 36 months the plan asks for more — ${Math.round(model.ordersLost).toLocaleString("en-US")} orders (${dollars(model.salesLost)}) the money no longer counts.` : " The plan never asks for more, month by month."} <button type="button" className="btn-ter" onClick={() => onOpen("revenue")}>How</button></p>
          ) : <p className="vz-card-s">{i.capToRoom ? "Set the money's numbers to cap its sales by the counter." : "The money counts every order the plan asks for. Cap it, and a month that asks for more than the counter takes counts only what it can."}</p>}
          <p className="vz-card-s">A month&apos;s cap is the counter&apos;s hour over every hour open; the peak hour above can still be past it when the month isn&apos;t.</p>
        </div>
        <p className="vz-card-s">Capacity, not a forecast of who waits or walks out: what the room as drawn can take, against the hours the plan expects.</p>
        {onOpenRoom && <div className="vz-row"><button type="button" className="btn-sec btn-sm" onClick={onOpenRoom}>Open the room</button></div>}
      </div>
    </div>
  );
}
