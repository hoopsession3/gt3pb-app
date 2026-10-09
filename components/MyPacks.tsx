"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { mixSummary, dollars, emptyMix, dropForStop, nextDrop, dropDateKey, type Mix, type GlassPath } from "@/lib/orderAhead";
import { authedFetch } from "@/lib/authedFetch";
import { haptic } from "@/lib/haptics";
import { nearDay } from "@/lib/dates";
import Icon from "@/components/Icon";
import { useConfirm } from "./ConfirmSheet";
import { isSettled } from "@/lib/settled";

// YOUR PACK — the customer's own reservations, right on /reserve. Reserving is only half the
// product: coming back should show what you've got coming, live (staff checking you off at the
// truck flips the card to "picked up" in realtime), with the two self-service moves that matter —
// change it (prefills the form; the new reservation replaces this one) or cancel it (definer RPC,
// 0136; a paid cancel routes the refund flag to the crew inbox). Renders nothing when signed out
// or when there's nothing upcoming — the reserve form stays the hero.
export type PackStage = "reserved" | "preparing" | "ready" | "en_route" | "picked_up";
export type MyPack = {
  id: string; name: string; phone: string | null; size: number; glass: GlassPath;
  mix: Partial<Mix>; total_cents: number; paid: boolean; drop_date: string;
  picked_up: boolean; bottles_returned: boolean; stage?: PackStage | null; canceled_at: string | null;
  // Paid at the window (0341): settled without `paid` when it was the card reader — lib/collect.
  payment_status?: string | null; collected_at?: string | null; collected_via?: string | null;
};

// What the customer sees for each stage the crew sets — plain, reassuring, present-tense.
const STAGE_VIEW: Record<PackStage, { label: string; note: string }> = {
  reserved: { label: "Reserved", note: "we brew it fresh for drop day" },
  preparing: { label: "Preparing", note: "we're brewing your pack now" },
  ready: { label: "Ready", note: "brewed and waiting for you" },
  en_route: { label: "On the way", note: "your pack is heading out" },
  picked_up: { label: "Picked up", note: "enjoy — see you at the next drop" },
};
const PACK_STEPS: PackStage[] = ["preparing", "ready", "en_route", "picked_up"];

// Humanize the near-term pickup week (Today / Tomorrow / This Sat); keep the absolute weekday +
// date for pickup days a week or more out. The rule is lib/dates' nearDay — this was one of its two
// private copies (MemberInbox had the other).
export const packDayLabel = (p: { drop_date: string }): string => nearDay(p.drop_date);
export const packMix = (p: { mix: Partial<Mix> }): Mix => ({ ...emptyMix(), ...p.mix });

export default function MyPacks({ onChange, refreshKey, collapsible }: { onChange?: (p: MyPack) => void; refreshKey?: string; collapsible?: boolean }) {
  const confirm = useConfirm();
  const { user } = useAuth();
  const { toast } = useApp();
  const [rows, setRows] = useState<MyPack[]>([]);
  const rowsRef = useRef<MyPack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null); // pack id showing the day picker
  // In the order-ahead flow (collapsible), a stack of existing packs used to wall off the size
  // picker — you scrolled past every card to reach "Order ahead." Collapse them to one summary row
  // by default so the primary action (place a new order) stays at the top; tap to expand & manage.
  const [listOpen, setListOpen] = useState(false);
  // The same upcoming-drop days the order form offers (real stops, still open) — so "move it"
  // can only land on a day the truck will actually be out.
  const [days, setDays] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("stops").select("starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
      .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(8)
      .then(({ data }) => {
        const seen = new Set<string>();
        const opts: { key: string; label: string }[] = [];
        for (const st of (data ?? []) as { starts_at: string }[]) {
          const d = dropForStop(st.starts_at);
          if (d.cutoff.getTime() <= Date.now()) continue;
          const key = st.starts_at.slice(0, 10);
          if (seen.has(key)) continue; seen.add(key);
          opts.push({ key, label: packDayLabel({ drop_date: key }) });
        }
        // Same fallback the reserve API uses: no scheduled stops → the Saturday cadence.
        if (opts.length === 0 && (data ?? []).length === 0) {
          const fb = nextDrop();
          opts.push({ key: dropDateKey(fb.sat), label: packDayLabel({ drop_date: dropDateKey(fb.sat) }) });
        }
        setDays(opts.slice(0, 4));
      });
  }, [user]);

  const moveDay = async (p: MyPack, toDate: string) => {
    if (busy) return;
    setBusy(p.id);
    try {
      const res = await authedFetch("/api/reserve/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, toDate }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "Couldn't move it — try again.", "error"); return; }
      haptic("success");
      toast(`Moved to ${packDayLabel({ drop_date: toDate })} — see you then.`);
      setMoving(null); load();
    } finally { setBusy(null); }
  };

  const load = useCallback(async () => {
    if (!supabase || !user) { setRows([]); return; }
    // Yesterday's date-floor keeps today's drop visible all day regardless of timezone drift.
    const floor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase.from("drop_orders").select("*")
      .eq("user_id", user.id).is("canceled_at", null).gte("drop_date", floor)
      .order("drop_date").order("created_at");
    const next = (data as MyPack[]) ?? [];
    // The realtime money moment: a pack flipping to PAID while you watch gets the settle buzz.
    // Paid at the window counts: the crew's tap is the moment the money settled (0341).
    if (rowsRef.current.some((prev) => { const cur = next.find((n) => n.id === prev.id); return cur && !isSettled(prev) && isSettled(cur); })) haptic("paid");
    rowsRef.current = next;
    setRows(next);
  }, [user]);

  useEffect(() => { load(); }, [load, refreshKey]);
  // Live: staff checking off pickup at the truck flips this card in front of the customer.
  useRealtimeTable({ table: "drop_orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });

  const cancel = async (p: MyPack) => {
    if (!supabase || busy) return;
    const day = packDayLabel(p);
    // "Will follow shortly" overpromised a timeline this flow doesn't actually enforce — canceling
    // only flags it for a staff-processed refund, same fix as /api/orders/cancel's customer message.
    const ok0 = await confirm({
      title: `Cancel your ${p.size}-pack for ${day}?`,
      body: p.paid ? `You paid ${dollars(p.total_cents / 100)} — we'll flag it for a refund and the crew will process it.` : "Nothing was charged.",
      confirmLabel: "Cancel pack", cancelLabel: "Keep it", danger: true,
    });
    if (!ok0) return;
    setBusy(p.id);
    // Route (not the raw RPC) so canceling also pings the crew + texts/emails the customer.
    const ok = await authedFetch("/api/orders/cancel", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "pickup", id: p.id }),
    }).then((r) => r.ok ? r.json() : null).then((d) => d?.ok === true).catch(() => false);
    setBusy(null);
    if (!ok) { toast("Couldn't cancel — it may already be picked up. Ask at the truck.", "error"); load(); return; }
    toast(p.paid ? "Canceled — flagged for a refund" : "Reservation canceled");
    load();
  };

  if (!user || rows.length === 0) return null;
  // Grouped by PICKUP DAY — three packs for one Saturday read as one plan ("Sat · 3 packs · 18
  // bottles"), not three look-alike rows. Tap a row for the mix + the self-service moves.
  const byDay = new Map<string, MyPack[]>();
  for (const p of rows) { const g = byDay.get(p.drop_date) ?? []; g.push(p); byDay.set(p.drop_date, g); }
  // Collapse the stack to one summary row in the order-ahead flow so it never buries the size picker.
  const canCollapse = !!collapsible && rows.length >= 2;
  const collapsed = canCollapse && !listOpen;
  const atPickup = rows.filter((x) => !isSettled(x)).length;
  const summary = `${rows.length} packs · ${rows.reduce((s, x) => s + x.size, 0)} bottles${atPickup ? ` · ${atPickup} at pickup` : ""}`;
  return (
    <div className={`mypacks${collapsed ? " collapsed" : ""}`}>
      {canCollapse ? (
        <button type="button" className="mypacks-h mypacks-toggle" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
          <span>Your packs <em>{summary}</em></span>
          <span className="mypacks-car">{listOpen ? "▾" : "▸"}</span>
        </button>
      ) : (
        <div className="mypacks-h">Your pack{rows.length > 1 ? "s" : ""}</div>
      )}
      {!collapsed && [...byDay.entries()].map(([day, group]) => (
        <div key={day} className="mypack-day">
          {group.length > 1 && (
            <div className="mypack-dayh">
              <b>{packDayLabel({ drop_date: day })}</b>
              <span>{group.length} packs · {group.reduce((s, x) => s + x.size, 0)} bottles · {group.filter(isSettled).length ? `${group.filter(isSettled).length} paid` : ""}{group.some((x) => !isSettled(x)) ? `${group.filter(isSettled).length ? " · " : ""}${group.filter((x) => !isSettled(x)).length} at pickup` : ""}</span>
            </div>
          )}
          {group.map((p) => {
        const isOpen = open === p.id;
        return (
          <div className={`mypack pay-${p.picked_up ? "done" : isSettled(p) ? "paid" : "due"}${isOpen ? " open" : ""}`} key={p.id}>
            <button type="button" className="mypack-row" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
              <span className="mypack-main">
                <b>{p.size}-pack{group.length > 1 ? "" : ` · ${packDayLabel(p)}`}</b>
                <span className="mypack-sub">{mixSummary(packMix(p)) || "your mix"} · #{p.id.slice(0, 6).toUpperCase()}</span>
              </span>
              <span className="mypack-rt">
                <span className={`k-tag${p.picked_up ? "" : isSettled(p) ? " ok mypack-paid" : " gold"}`}>{p.picked_up ? <><Icon name="check" /> picked up</> : isSettled(p) ? <><Icon name="check" /> paid</> : "$ at pickup"}</span>
                <span className="mypack-car">{isOpen ? "▾" : "▸"}</span>
              </span>
            </button>
            {isOpen && (
              <>
                <div className="mypack-mix">{mixSummary(packMix(p)) || "—"} · {p.glass === "return" ? "bringing bottles back" : "new glass"} · {dollars(p.total_cents / 100)}</div>
                {/* Live fulfillment tracker — the crew's stage, shown to the customer. */}
                {(() => {
                  const stage = (p.stage ?? (p.picked_up ? "picked_up" : "reserved")) as PackStage;
                  const view = STAGE_VIEW[stage] ?? STAGE_VIEW.reserved;
                  const curIdx = PACK_STEPS.indexOf(stage); // -1 while 'reserved'
                  return (
                    <>
                      <div className="mypack-track" role="img" aria-label={`Status: ${view.label}`}>
                        {PACK_STEPS.map((s, i) => (
                          <span key={s} className={`mypack-dot${i <= curIdx ? " on" : ""}${i === curIdx ? " now" : ""}`} title={STAGE_VIEW[s].label} />
                        ))}
                      </div>
                      <div className="mypack-st">
                        <b>{view.label}</b> — {view.note}{stage === "reserved" ? ` · #${p.id.slice(0, 6).toUpperCase()}` : ""}
                      </div>
                    </>
                  );
                })()}
                {!p.picked_up && (
                  <>
                    <div className="mypack-actions">
                      {days.some((d) => d.key !== p.drop_date) && (
                        <button type="button" className="btn-sec" onClick={() => setMoving(moving === p.id ? null : p.id)} aria-expanded={moving === p.id}>Move day</button>
                      )}
                      {/* Paid at the window: the money is in the crew's hands, so changing or
                          canceling it is theirs too — the database refuses it from here (0341),
                          and a button that can only fail is not offered. */}
                      {onChange && !p.collected_at && <button type="button" className="btn-sec" onClick={() => onChange(p)}>Change the pack</button>}
                      {!p.collected_at && <button type="button" className="btn-del" onClick={() => cancel(p)} disabled={busy === p.id}>{busy === p.id ? "Canceling…" : "Cancel"}</button>}
                    </div>
                    {p.collected_at && <p className="mypack-paidnote">Paid at the window — to change or cancel it, ask the crew.</p>}
                    {moving === p.id && (
                      <div className="mypack-move">
                        <span>Pick the new day — everything else stays the same.</span>
                        <div className="mypack-move-days">
                          {days.filter((d) => d.key !== p.drop_date).map((d) => (
                            <button key={d.key} type="button" className="k-chip" disabled={busy === p.id} onClick={() => moveDay(p, d.key)}>{d.label}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        );
          })}
        </div>
      ))}
    </div>
  );
}
