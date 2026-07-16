"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { type PerfMix } from "@/lib/delivery";
import { etToday } from "@/lib/dates";
import AssignTaskSheet from "./AssignTaskSheet";
import Sheet from "./Sheet";
import { SectionHeader, InfoRow } from "@/components/kit";
import Icon from "@/components/Icon";

// SUNDAY DELIVERY OPS — the crew side of the delivery debrief, in DropOps' shape: one summary
// sentence (units, one hero thought), the Saturday brew totals (incl. Performance combos), and a
// name-by-name run list that folds until delivery day. Driver logs one of three outcomes per stop;
// "held" flips the order into the pickup queue and raises a crew alert. Realtime like everything
// else — channel name unique per subscription (the twice-shipped crash class).

type DOrder = {
  id: string; name: string; phone: string | null;
  address_street: string; address_city: string; address_zip: string; access_instructions: string | null;
  pack_size: number; rise_count: number; flow_count: number; dusk_count: number;
  performance_count: number; performance_mix: PerfMix; refill_count: number; new_count: number;
  total_cents: number; payment_status: string; status: string;
  driver_outcome: string | null; empties_expected: number; empties_collected: number | null;
  delivery_date: string; canceled_at: string | null;
};

const STATUS_NEXT: Record<string, string> = { received: "brewed", brewed: "out_for_delivery" };
const STATUS_LABEL: Record<string, string> = {
  received: "Received", brewed: "Brewed", out_for_delivery: "Out for delivery",
  delivered: "Delivered", held_for_pickup: "HELD — pickup", issue: "Issue",
};
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function DeliveryOps() {
  const [rows, setRows] = useState<DOrder[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState<boolean | null>(null);
  const [assign, setAssign] = useState(false);
  const [packout, setPackout] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    // the next delivery day with anything on it (today counts — Sunday IS the run);
    // delivery_date is an ET business-day key (lib/delivery.ts), so "today" must be ET too
    const today = etToday();
    const { data } = await supabase.from("delivery_orders").select("*")
      .gte("delivery_date", today).is("canceled_at", null)
      .order("delivery_date").order("address_zip").limit(200);
    const all = (data ?? []) as DOrder[];
    const d = all[0]?.delivery_date ?? null;
    setDate(d);
    setRows(all.filter((o) => o.delivery_date === d));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("delivery_orders", load);

  const setStatus = async (o: DOrder, status: string) => {
    if (!supabase) return;
    await supabase.from("delivery_orders").update({ status }).eq("id", o.id);
    load();
  };
  // Outcomes (swap done / fresh / hold / not home) are logged in DRIVER MODE only (/driver) —
  // one writer, so the recorded flow can't drift between two button sets again. This card is the
  // HQ monitor/debrief face: statuses, brew totals, packout, assign.

  if (!date || rows.length === 0) return null; // quiet until a delivery exists

  const bottles = rows.reduce((a, o) => a + o.pack_size, 0);
  const refills = rows.reduce((a, o) => a + o.refill_count, 0);
  const fresh = rows.reduce((a, o) => a + o.new_count + o.performance_count, 0);
  const revenue = rows.reduce((a, o) => a + o.total_cents, 0);
  const perF = { RISE: 0, FLOW: 0, DUSK: 0 } as Record<string, number>;
  rows.forEach((o) => { perF.RISE += o.rise_count; perF.FLOW += o.flow_count; perF.DUSK += o.dusk_count; });
  // Premium ($14) adds are dynamic (whatever's flagged bulk-orderable) — sum by slug so the crew
  // brews the right ones. Legacy orders with base|addin keys still sum into the total.
  const prettySlug = (s: string) => s.replace(/[-_|]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const premiumMix: Record<string, number> = {};
  rows.forEach((o) => Object.entries(o.performance_mix || {}).forEach(([k, n]) => { if (n) premiumMix[prettySlug(k)] = (premiumMix[prettySlug(k)] || 0) + (n as number); }));
  const premiumTotal = rows.reduce((a, o) => a + o.performance_count, 0);
  const heldQueue = rows.filter((o) => o.status === "held_for_pickup");
  const doneCount = rows.filter((o) => o.status === "delivered" || o.status === "held_for_pickup").length;
  const isRunDay = date === etToday();
  const showList = listOpen ?? isRunDay;
  const dLabel = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    // Standard white-card treatment (matches .mpanel / the boxed .oo sibling) so Sunday delivery sits
    // in the same container rhythm as the other Live Ops panels instead of rendering bare. Kit
    // SectionHeader replaces the ad-hoc .dops-head; each stop is a kit InfoRow. Logic is untouched.
    <section className="mpanel" style={{ marginTop: 14, padding: "0 15px 14px" }} aria-label="Sunday delivery">
      <SectionHeader label="Sunday delivery" annotation={`${dLabel} · ${rows.length} order${rows.length === 1 ? "" : "s"}`} />
      <p className="dops-sum">
        <b>{bottles}</b> bottles ({refills} refills · {fresh} fresh) · <b>{dollars(revenue)}</b> paid on order
        {heldQueue.length > 0 && <> · <b className="dl-held">{heldQueue.length} held for pickup</b></>}
      </p>
      <div className="dops-brew">Brew: <b>{(["RISE", "FLOW", "DUSK"] as const).filter((f) => perF[f] > 0).map((f) => `${perF[f]}× ${f}`).join(" · ") || "—"}</b>
        {premiumTotal > 0 && <> · Premium: <b>{Object.keys(premiumMix).length ? Object.entries(premiumMix).map(([k, n]) => `${n}× ${k}`).join(" · ") : premiumTotal}</b></>}
      </div>
      <a className="dops-driver-link" href="/driver"><Icon name="truck" /> Open the driver run — map &amp; turn-by-turn <Icon name="arrowRight" /></a>
      <button type="button" className="dops-assign-link" onClick={() => setAssign(true)}><Icon name="team" /> Assign this run to a driver <Icon name="arrowRight" /></button>
      <button type="button" className="dops-assign-link" onClick={() => setPackout(true)}><Icon name="package" /> Vehicle packout plan <Icon name="arrowRight" /></button>
      {assign && <AssignTaskSheet defaultTitle={`Sunday delivery run — ${rows.length} stop${rows.length === 1 ? "" : "s"} · ${bottles} bottles`} dueOn={date} category="ops" onClose={() => setAssign(false)} />}
      {packout && <DeliveryPackout bottles={bottles} orders={rows.length} refills={refills} onClose={() => setPackout(false)} />}
      <button type="button" className="dops-prog" onClick={() => setListOpen(!showList)} aria-expanded={showList}>
        <span><b>{doneCount}/{rows.length}</b> stops done</span>
        <span>{showList ? "▾" : "▸"}</span>
      </button>
      {showList && (
        <div className="k-rows">
          {rows.map((o) => (
            <div key={o.id} style={o.status === "delivered" ? { opacity: 0.5 } : undefined}>
              <InfoRow
                lead="ZIP"
                leadSub={o.address_zip}
                name={o.name}
                nameExtra={<>
                  {o.refill_count > 0 && <span className="dops-chip ret">SWAP ×{o.refill_count}</span>}
                  <span className={`dops-chip ${o.status === "held_for_pickup" ? "new" : "ret"}`}>{STATUS_LABEL[o.status]}</span>
                </>}
                trailing={<span className="dops-total">{dollars(o.total_cents)} <Icon name="check" /></span>}
                meta={<>
                  <b>{o.pack_size} bottles</b> — {[o.rise_count && `${o.rise_count}× RISE`, o.flow_count && `${o.flow_count}× FLOW`, o.dusk_count && `${o.dusk_count}× DUSK`, o.performance_count && `${Object.entries(o.performance_mix || {}).map(([k, n]) => `${n}× ${prettySlug(k)}`).join(" · ") || `${o.performance_count}× premium`}`].filter(Boolean).join(" · ")}
                  <br />{o.address_street}, {o.address_city} {o.address_zip}{o.access_instructions ? <> · <em>{o.access_instructions}</em></> : null}
                  <div className="dops-drive">
                    <a className="dops-nav" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${o.address_street}, ${o.address_city} ${o.address_zip}`)}`} target="_blank" rel="noopener noreferrer"><Icon name="compass" /> Navigate</a>
                    {o.phone ? <a className="dops-tel" href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>📞 Call {o.name.split(" ")[0]}</a> : null}
                  </div>
                  {o.empties_collected != null && o.empties_collected !== o.empties_expected && (
                    <><br /><em className="dl-held">Empties short: {o.empties_collected}/{o.empties_expected}</em></>
                  )}
                  <div className="dops-actions">
                    {STATUS_NEXT[o.status] && (
                      <button type="button" className="dops-check" onClick={() => setStatus(o, STATUS_NEXT[o.status])}>→ {STATUS_LABEL[STATUS_NEXT[o.status]]}</button>
                    )}
                    {o.status === "out_for_delivery" && (
                      <a className="dops-mini" href="/driver">Log the outcome in driver mode →</a>
                    )}
                  </div>
                </>}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Deterministic vehicle packout for the whole Sunday run — scales the cooler/ice plan from the
// bottle loadout to the day's total bottles. Uses the qd-sheet · dp-body popout (bulletproof scroll).
function DeliveryPackout({ bottles, orders, refills, onClose }: { bottles: number; orders: number; refills: number; onClose: () => void }) {
  const coolers = Math.max(1, Math.ceil(bottles / 24));      // ~24 glass bottles upright per hard cooler
  const gelPacks = coolers * 5;                               // 4–6 per cooler; 5 is the safe middle
  const returnBins = refills > 0 ? Math.max(1, Math.ceil(refills / 30)) : 0;
  return (
    <Sheet open onClose={onClose} label="Vehicle packout" header={<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><div><div className="dp-eyebrow"><Icon name="package" /> Vehicle packout · Sunday run</div><div className="dp-title">{bottles} bottles · {orders} stop{orders === 1 ? "" : "s"}</div></div><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" /></button></div>}>
          <div className="brew-spec"><b>{coolers}</b> hard cooler{coolers === 1 ? "" : "s"} (24–48 qt) · <b>{gelPacks}</b> gel packs (pre-frozen){returnBins > 0 ? <> · <b>{returnBins}</b> empties bin{returnBins === 1 ? "" : "s"}</> : ""}</div>
          <div className="brew-block-h">Pack them in</div>
          <div className="brew-ing">
            <div className="brew-ing-row"><b>{coolers}×</b><span>Hard cooler with dividers or foam sleeves — GT3 glass upright, no clinking. ~24 bottles per cooler.</span></div>
            <div className="brew-ing-row"><b>{gelPacks}×</b><span>Gel/ice packs ONLY (no loose ice on glass), pre-frozen overnight. 2 flat on the floor, 1–2 on the caps per cooler.</span></div>
            {returnBins > 0 && <div className="brew-ing-row"><b>{returnBins}×</b><span>Empties bin/crate for the {refills} bottles coming back on today&rsquo;s swaps.</span></div>}
          </div>
          <div className="brew-block-h">Before you pull off</div>
          <ul className="brew-checks">
            <li>Pre-chill the coolers ~1 hr; target internal temp ≤ 38°F.</li>
            <li>Load coolers low and flat in the cargo area, braced so nothing slides on the drive.</li>
            <li>Run the AC — keep the cabin ≤ 65°F and the coolers out of direct sun.</li>
            <li>Stops are ordered by ZIP on the driver run — pull them in that order so glass rides cold to the last porch.</li>
          </ul>
    </Sheet>
  );
}
