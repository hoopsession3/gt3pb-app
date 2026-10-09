"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import Skeleton from "@/components/Skeleton";
import { supabase } from "@/lib/supabase";
import { officeQuote, windowHours } from "@/lib/office";
import { etToday } from "@/lib/dates";
import { useOfficeSettings } from "@/components/useOfficeSettings";
import Icon from "@/components/Icon";
import SignIn from "@/components/SignIn";
import OfficeCalendar from "@/components/OfficeCalendar";
import { money } from "@/lib/money";
import { haptic } from "@/lib/haptics";
import { useRealtimeTable } from "@/lib/realtime";
import { refusalText } from "@/lib/refusal";
import {
  STAGES, changeable, cutoffLabel, dayLabel, deliveryState, invoiceState, legacyHome, nextDelivery, programLine, relDay, requestState, stageOf,
  type LegacyAccount, type LegacyInvoice, type LegacyOrder, type OfficeAccount, type OfficeDelivery, type OfficeHome,
} from "@/lib/officeStatus";
import type { RequestKind } from "@/lib/officeChange";

// The sheets load with the first tap that opens one (a client reads this page far more than they change it).
const OfficeChangeSheet = dynamic(() => import("@/components/OfficeChangeSheet"), { ssr: false });
const OfficeAskSheet = dynamic(() => import("@/components/OfficeAskSheet"), { ssr: false });

// YOUR GT3 — the office client's home (2026-10-07, Phase 2A-2 of the B2B report; the mock's screen A).
// Ryan: "They should be able in real time see their GT3 calendar where they can manage their order
// super easy." Until now this page was one account, one weekly switch and "Text us": one Monday's
// change was a text to GT3, nobody but the person who booked could see the deliveries, and nothing on
// it moved while it was open. Now, from office_home (0359) in one call:
//
//   · the next delivery, live — scheduled, brewed, on the way, delivered — with Change and Skip, and
//     when changes close, in the delivery's own city;
//   · the calendar: six weeks of deliveries, a skip still there to undo; tap a day to change it;
//   · the weekly order (the holder's to pause or resize, through set_office_standing, 0354);
//   · requests to GT3 with their answers, invoices with Pay, the recent deliveries, the jugs.
//
// Everyone the company has on its account sees it (0359's member read), at their locations, and what
// each may do is the database's answer (can_change, can_request), not the screen's guess. The page
// listens to the company's deliveries, changes and requests, so a colleague's skip or the driver
// leaving shows up without a refresh. Until 0359 is pasted office_home isn't there (PGRST202) and the
// page reads the tables the way it did, and offers no per-delivery change it could not save.
export default function OfficeScreen() {
  const { ready, user, enabled } = useAuth();
  const { toast } = useApp();
  const router = useRouter();
  const [home, setHome] = useState<OfficeHome | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{ id: string; skip?: boolean } | null>(null);
  const [asking, setAsking] = useState<RequestKind | null>(null);
  // The clock the cutoffs are read against moves while the page is open: at 6 PM the card stops
  // offering a change the database would refuse, without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  // Live price/minimum (owner-editable via Settings) — what the weekly order quotes before 0359, and
  // the weekly generator bills (0354).
  const settings = useOfficeSettings();

  // Before 0359: the account and its orders, read as they were (RLS 0187 / 0354: the holder's own).
  const loadLegacy = useCallback(async (): Promise<OfficeHome | null | "error"> => {
    if (!supabase || !user) return null;
    const { data: a, error: eAcct } = await supabase.from("business_accounts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    // A failed fetch must never render identically to "never signed up" — an existing business
    // customer hitting a transient error would otherwise see their whole account vanish.
    if (eAcct) return "error";
    const ac = (a as LegacyAccount) ?? null;
    if (!ac) return null;
    // COMING UP, THEN RECENT (0358): the next ones, soonest first; then the last ones made, newest first.
    const cols = "id, delivery_date, delivery_window, gallons, total_cents, status, payment_status";
    const today = etToday();
    const [up, past, i] = await Promise.all([
      supabase.from("business_orders").select(cols).is("canceled_at", null).gte("delivery_date", today).order("delivery_date").limit(6),
      supabase.from("business_orders").select(cols).is("canceled_at", null).lt("delivery_date", today).order("delivery_date", { ascending: false }).limit(6),
      supabase.from("invoices").select("id, amount_cents, status, issued_at, terms, due_at").eq("business_id", ac.id).order("issued_at", { ascending: false }).limit(8),
    ]);
    if (up.error || past.error || i.error) toast("Some account details didn't load — try refreshing", "error");
    return legacyHome(ac, (up.data as LegacyOrder[]) ?? [], (past.data as LegacyOrder[]) ?? [], (i.data as LegacyInvoice[]) ?? [], today, settings.priceCents, settings.minGallons);
  }, [user, toast, settings.priceCents, settings.minGallons]);

  const load = useCallback(async () => {
    if (!supabase || !user) return;
    const { data, error } = await supabase.rpc("office_home");
    let next: OfficeHome | null | "error" = (data as OfficeHome | null) ?? null;
    if (error) next = (await import("@/lib/schemaSkew")).isMissingFunction(error) ? await loadLegacy() : "error";
    // No company yet: an account booked before the company spine (0355) still reads the old way.
    else if (!next) next = await loadLegacy();
    if (next === "error") { setLoadError(true); setLoaded(true); return; }
    setLoadError(false); setHome(next); setLoaded(true);
  }, [user, loadLegacy]);
  useEffect(() => { if (ready && user) load(); }, [ready, user, load]);

  // Live: the company's deliveries (the crew brewing, the driver leaving, a colleague's skip), every
  // change, every request and its answer.
  const cid = home && !home.legacy ? home.company.id : "";
  useRealtimeTable([
    { table: "business_orders", filter: `company_id=eq.${cid}` },
    { table: "office_order_changes", filter: `company_id=eq.${cid}` },
    { table: "company_requests", filter: `company_id=eq.${cid}` },
  ], load, { enabled: !!cid });

  // TWO CHANGES, ONE CHECKED DOOR (2026-10-07, 0354). The weekly order on or off and its gallons, as
  // set_office_standing(): the holder's own account, never under the minimum. It answers with the row
  // as saved, and the page reads its home again rather than trust the optimistic guess. Until 0354 is
  // pasted the function isn't there (PGRST202) and the old write is still allowed, so the page makes
  // the old write: the same two columns and the same values, through the old door.
  const patch = async (acct: OfficeAccount, p: { standing_active?: boolean; standing_gallons?: number }) => {
    if (!supabase || busy) return; setBusy(true);
    setHome((h) => h && { ...h, programs: h.programs.map((g) => (g.account?.id === acct.id ? { ...g, account: { ...acct, ...p } } : g)) });
    const via = await supabase.rpc("set_office_standing", { p_account: acct.id, p_active: p.standing_active ?? null, p_gallons: p.standing_gallons ?? null });
    let error = via.error;
    // Loaded only when a save fails: the helper is the house's one test for "not pasted yet".
    if (error && (await import("@/lib/schemaSkew")).isMissingFunction(error)) {
      // A write that matched no row saved nothing: in the seconds after 0354 lands, before the API has
      // seen the new function, the old door is already shut — so that says "couldn't save", not saved.
      const old = await supabase.from("business_accounts").update(p).eq("id", acct.id).select("id");
      error = old.error ?? (old.data?.length ? null : error);
    }
    setBusy(false);
    // Under the minimum, set_office_standing refuses with a sentence a person can act on ("The minimum
    // is 4 gallons a week."), and that is what the toast says: lib/refusal reads which errors are
    // refusals, for every office screen. A failure that is not one says "try again".
    if (error) toast(refusalText(error) ?? "Couldn't save — try again", "error");
    else if (p.standing_active === false) haptic("toggleOff");
    else if (p.standing_active) haptic("toggleOn");
    else haptic("selection");
    load();
  };

  if (enabled && ready && !user) return <SignIn />;
  if (!ready || (enabled && !loaded)) return <section className="screen" id="s-office"><Masthead eyebrow="Your GT3" right={<AccountPill />} /><Skeleton variant="card" count={1} /><Skeleton variant="row" count={3} /></section>;

  const h = home;
  const minGallons = h ? (h.legacy ? settings.minGallons : h.min_gallons) : settings.minGallons;
  const next = h ? nextDelivery(h.agenda) : null;
  const placeOf = (d: OfficeDelivery | null) => {
    if (!h || !d) return null;
    const l = h.locations.find((x) => x.id === d.location_id) ?? (h.locations.length === 1 ? h.locations[0] : null);
    return l ? (l.label || l.street) : null;
  };
  const open = (d: OfficeDelivery, skip?: boolean) => { if (h && !h.legacy) setSheet({ id: d.id, skip }); };
  const sheetD = sheet && h ? h.agenda.find((d) => d.id === sheet.id) ?? null : null;

  return (
    <section className="screen office-portal" id="s-office">
      <Watermark variant="landing" />
      <Masthead eyebrow="Your GT3" right={<AccountPill />} />

      {loadError ? (
        <div className="op-none">
          <div className="op-none-ic"><Icon name="warning" /></div>
          <h1>Couldn&rsquo;t load your account.</h1>
          <p>Something went wrong loading your office delivery details.</p>
          <button type="button" className="handle" onClick={() => load()}><span>Try again</span></button>
        </div>
      ) : !h ? (
        <div className="op-none">
          <div className="op-none-ic"><Icon name="jar" /></div>
          <h1>Bring GT3 to the office.</h1>
          <p>Fresh cold-extract in amber gallon jugs, delivered Monday 5–8&nbsp;AM, empties swapped for full each week. {settings.minGallons}-gallon minimum.</p>
          <button type="button" className="handle" onClick={() => router.push("/delivery")}><span>Set up office delivery <Icon name="arrowRight" /></span></button>
        </div>
      ) : (<>
        <h1 className="op-h">{h.company.name}</h1>
        {h.locations.length === 1 && (h.locations[0].street || h.locations[0].label) && (
          <p className="m-0 font-sans text-footnote text-cream-muted">{[h.locations[0].label, h.locations[0].street, h.locations[0].city].filter((x, k, a) => x && a.indexOf(x) === k).join(" · ")}</p>
        )}

        {/* the next delivery, live */}
        {next ? <NextCard d={next} h={h} place={placeOf(next)} now={now} onChange={() => open(next)} onSkip={() => open(next, true)} onAsk={() => setAsking("service_issue")} /> : (
          <div className="op-card"><span className="op-k">Next delivery</span><p className="op-sub">Nothing on the schedule in the next six weeks{h.programs.some((p) => p.status === "paused") ? " — the weekly order is paused" : ""}.</p></div>
        )}

        {/* the calendar */}
        {!h.legacy && h.agenda.length > 0 && (
          <div className="op-list">
            <SectionHeader label="Your calendar" annotation="six weeks ahead" />
            <OfficeCalendar agenda={h.agenda} today={h.today} now={now} onPick={(d) => open(d)} />
          </div>
        )}
        {h.legacy && h.agenda.length > 0 && (
          <div className="op-list">
            <SectionHeader label="Coming up" />
            {h.agenda.map((o) => (
              <div key={o.id} className="op-row">
                <div className="op-row-x"><b>{dayLabel(o.date, true)}</b><span>{Math.round(o.gallons)} gal · {windowHours(o.window)}</span></div>
                <div className={`op-row-pay p-${o.payment_status}`}>{o.payment_status === "paid" ? "paid" : "scheduled"}</div>
              </div>
            ))}
          </div>
        )}

        {/* the weekly order */}
        {h.programs.length > 0 && (
          <div className="op-list">
            <SectionHeader label="Weekly order" />
            {h.programs.map((p) => {
              const a = p.account;
              const price = p.price_per_gallon_cents || settings.priceCents;
              const gal = a?.standing_gallons ?? p.gallons ?? minGallons;
              const where = h.locations.length > 1 ? h.locations.find((l) => l.id === p.location_id) : null;
              if (!a?.mine) {
                return (
                  <div key={p.id} className="op-row">
                    <div className="op-row-x"><b>{programLine(p)}</b><span>{Math.round(p.gallons)} gal{where ? ` · ${where.label || where.street}` : ""}</span></div>
                    <div className={`op-row-pay ${p.status === "active" ? "p-open" : ""}`}>{p.status === "active" ? "on" : p.status}</div>
                  </div>
                );
              }
              return (
                <div key={p.id} className="op-card">
                  <div className="op-card-h"><span className="op-k">{where ? `Weekly · ${where.label || where.street}` : "Standing weekly"}</span><button type="button" className={`op-switch${a.standing_active ? " on" : ""}`} onClick={() => patch(a, { standing_active: !a.standing_active })} aria-pressed={a.standing_active} aria-label="Weekly order on" disabled={busy}><span className="op-switch-k" /></button></div>
                  {a.standing_active ? (
                    <>
                      <p className="op-sub">{programLine(p)} — we brew the night before.</p>
                      <div className="op-gal">
                        <span className="op-k">Gallons / delivery</span>
                        <div className="op-step">
                          <button type="button" onClick={() => patch(a, { standing_gallons: Math.max(minGallons, gal - 1) })} disabled={busy || gal <= minGallons} aria-label="Fewer">−</button>
                          <span className="op-gal-v">{gal}</span>
                          <button type="button" onClick={() => patch(a, { standing_gallons: gal + 1 })} disabled={busy} aria-label="More">+</button>
                        </div>
                      </div>
                      <div className="op-quote"><span>{gal} gal × {money(price)} · {h.company.billing_terms === "prepaid" ? "prepaid" : "net terms"}</span><b>{money(officeQuote(gal, { priceCents: price, minGallons }).totalCents)}</b></div>
                    </>
                  ) : <p className="op-sub">Paused — no deliveries. Flip it back on anytime.</p>}
                </div>
              );
            })}
          </div>
        )}

        {/* requests to GT3, and the door to send one */}
        {!h.legacy && (h.requests.length > 0 || h.can_request) && (
          <div className="op-list">
            <SectionHeader label="Requests" right={h.can_request ? <button type="button" className="btn-ter" onClick={() => setAsking("extra_delivery")}>Ask GT3</button> : undefined} />
            {h.requests.length === 0 && <p className="op-sub">An extra delivery, an event, another location, a billing question — ask, and it lands with the crew. The answer comes back here.</p>}
            {h.requests.map((r) => {
              const st = requestState(r.status);
              return (
                <div key={r.id} className="op-row items-start">
                  <div className="op-row-x min-w-0">
                    <b>{r.label}</b>
                    <p className="m-0 mt-px line-clamp-2 font-sans text-caption text-cream-muted">{r.body}</p>
                    {r.resolution && <p className="m-0 mt-1 font-sans text-footnote text-cream">GT3: {r.resolution}</p>}
                  </div>
                  <div className={`op-row-pay ${st.key === "done" ? "p-paid" : st.key === "declined" ? "" : "p-open"}`}>{st.label}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* invoices */}
        {h.invoices.length > 0 && (
          <div className="op-list">
            <SectionHeader label="Invoices" />
            {h.invoices.map((v) => {
              const st = invoiceState(v, h.today);
              return (
                <div key={v.id} className="op-row">
                  <div className="op-row-x"><b>{money(v.amount_cents)}</b><span>{new Date(v.issued_at).toLocaleDateString([], { month: "short", day: "numeric" })} · {v.terms === "net30" ? "net 30" : v.terms === "net15" ? "net 15" : "due on receipt"}</span></div>
                  <div className="flex items-center gap-3">
                    <div className={`op-row-pay p-${st.key === "paid" ? "paid" : "open"}`}>{st.label}</div>
                    {v.pay_url && st.key !== "paid" && <a className="btn-sec" href={v.pay_url} target="_blank" rel="noopener noreferrer">Pay</a>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* recent deliveries, newest first, with what each one owes */}
        {h.recent.length > 0 && (
          <div className="op-list">
            <SectionHeader label="Recent" />
            {h.recent.map((o) => (
              <div key={o.id} className="op-row">
                <div className="op-row-x"><b>{dayLabel(o.date, true)}</b><span>{Math.round(o.gallons)} gal · {deliveryState(o).label.toLowerCase()}</span></div>
                <div className={`op-row-pay p-${o.payment_status}`}>{o.payment_status === "paid" ? "paid" : o.payment_status === "invoiced" ? "invoiced" : money(o.total_cents)}</div>
              </div>
            ))}
          </div>
        )}

        {/* jug balance */}
        <div className="op-jugs">
          <div><span className="op-k">Amber jugs with you</span><span className="op-jugs-sub">Empties swapped for full each delivery</span></div>
          <div className="op-jugs-v">{h.jugs}</div>
        </div>

        {h.legacy && <p className="op-fine">Questions or a one-off change? Text us — we confirm every route the Friday before.</p>}
      </>)}
      <ClosingBeat />

      {h && sheetD && (
        <OfficeChangeSheet key={sheetD.id} delivery={sheetD} place={placeOf(sheetD)} canChange={h.can_change} canRequest={h.can_request}
          minGallons={minGallons} now={now} startSkip={!!sheet?.skip} onClose={() => setSheet(null)} onChanged={load} />
      )}
      {h && !h.legacy && asking && <OfficeAskSheet companyId={h.company.id} startKind={asking} onClose={() => setAsking(null)} onSent={load} />}
    </section>
  );
}

// The next delivery, as it walks: scheduled · brewed · on the way · delivered. Change and Skip until
// its cutoff (Skip opens the sheet with the skip on, for a Save and a reason); after it, one button
// that asks GT3. A role that only reads sees the card and no buttons.
function NextCard({ d, h, place, now, onChange, onSkip, onAsk }: { d: OfficeDelivery; h: OfficeHome; place: string | null; now: number; onChange: () => void; onSkip: () => void; onAsk: () => void }) {
  const stage = stageOf(d);
  const st = deliveryState(d);
  const cut = cutoffLabel(d.cutoff_at, d.market, now);
  const can = h.can_change && changeable(d, now);
  const live = d.date === h.today && stage >= 1 && stage < 3;
  return (
    <div className="op-card" aria-live="polite">
      <div className="op-card-h">
        <span className="op-k">Next delivery{live ? " · live" : ""}</span>
        <span className={`font-sans font-semibold text-footnote ${st.key === "missed" ? "text-warn" : st.key === "delivered" ? "text-ok" : "text-cream-muted"}`}>{st.label}</span>
      </div>
      <h2 className="mt-2 mb-0 font-sans font-bold text-title2 leading-tight text-cream">{relDay(d.date, h.today, true)} · {windowHours(d.window)}</h2>
      <p className="op-sub">
        {Math.round(d.gallons)} gal cold brew{place ? ` · ${place}` : ""}{d.moved_from ? ` · moved from ${dayLabel(d.moved_from)}` : ""}
        {d.client_note ? <><br />For the driver: {d.client_note}</> : null}
      </p>
      {stage >= 0 && (
        <ol className="grid grid-cols-4 gap-1.5 mt-3.5 mb-0 p-0 list-none" aria-label={`${st.label} — step ${stage + 1} of 4`}>
          {STAGES.map((s, i) => (
            <li key={s} className="flex flex-col gap-1.5">
              <span className={`block h-1 rounded-pill ${i <= stage ? "bg-gold2" : "bg-line2"}`} />
              <span className={`font-sans text-caption2 ${i === stage ? "text-cream font-semibold" : "text-cream-dim"}`}>{s}</span>
            </li>
          ))}
        </ol>
      )}
      {st.key === "missed" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-4">
          <span className="font-sans text-footnote text-cream-muted">The crew has been told, and GT3 will be in touch.</span>
          {!h.legacy && h.can_request && <button type="button" className="btn-ter" onClick={onAsk}>Tell GT3 more</button>}
        </div>
      )}
      {!h.legacy && (h.can_change || h.can_request) && stage === 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-4">
          {can ? (
            <>
              <button type="button" className="btn-sec" onClick={onChange}>Change</button>
              <button type="button" className="btn-ter" onClick={onSkip}>Skip</button>
              {cut && <span className="ml-auto font-sans text-caption text-cream-muted">Changes close {cut.when}</span>}
            </>
          ) : h.can_request ? (
            <>
              <button type="button" className="btn-sec" onClick={onChange}>Ask for a change</button>
              {cut && <span className="ml-auto font-sans text-caption text-cream-muted">Changes closed {cut.when}</span>}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
