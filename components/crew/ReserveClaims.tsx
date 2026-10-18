"use client";

import { useEffect, useState } from "react";
import { useAppStable } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import { InfoRow, SectionHeader } from "@/components/kit";
import Icon from "@/components/Icon";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { authedFetch } from "@/lib/authedFetch";
import { refusalText } from "@/lib/refusal";
import { IN_FLIGHT_MS } from "@/lib/chargeOnce";
import { canOf } from "@/lib/roles";
import { addDays, clockTime } from "@/lib/dates";
import { etDayStart } from "@/lib/etDay";
import { money } from "@/lib/money";

// THE CREW'S LIST OF WHO IS OWED A LIMITED RESERVE (0400, 2026-10-14 — R5 of the customer audit). A reserve is paid for
// to be held and handed over at its pickup; nothing on the crew's side said who was owed one. Two faces:
//
//   day        the drop's working face (components/DropOps): the reserves handed over at that day's stops — who, how
//              many, paid, one still being confirmed — and Handed over.
//   reserveId  Money → Reserve drops (app/crew ReservesAdmin): every claim on one reserve, as it stands — paid (Handed
//              over, Refund), being confirmed (its payment never answered: Paid — the server finds it in Square by its
//              checkout's key, and asks for the payment's id only when it cannot — or Not charged), handed over, canceled.
//
// Handing over is the crew's own call (0400 collect_reserve_claim, is_staff). Money is an owner's or an admin's: a refund
// (app/api/reserves/cancel, crew: true — the card first, then the bottles back on the shelf) and a payment settled by
// hand (app/api/reserves/settle), each refused by the server to anyone else; here they are simply not offered. A claim
// whose checkout may still be going — under two minutes old (lib/chargeOnce IN_FLIGHT_MS) — is not offered for settling
// either: it says it is being confirmed until its request has had its chance to answer.

type Claim = {
  id: string; reserve_id: string; qty: number; state: "held" | "pending" | "paid" | "collected" | "expired" | "cancelled";
  paid_cents?: number | null; refunded_cents?: number | null; created_at: string; collected_at?: string | null;
  reserve?: { name: string; price_cents?: number | null } | null; customer?: { name: string | null } | null;
};
type Board = { rows: Claim[]; at: number };

const COLS = "id, reserve_id, qty, state, paid_cents, refunded_cents, created_at, collected_at, reserve:reserves(name, price_cents), customer:customers(name)";

export default function ReserveClaims({ day, reserveId }: { day?: string; reserveId?: string }) {
  const { toast } = useAppStable();
  const { profile } = useAuth();
  const admin = canOf(profile).admin;
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [payIds, setPayIds] = useState<Record<string, string>>({});
  // The claims Square's search could not settle: the payment's id is asked for, pasted from Square.
  const [askId, setAskId] = useState<Record<string, boolean>>({});

  const state = useAsyncData<Board>(async () => {
    const at = Date.now();
    if (!supabase) return { rows: [], at };
    if (day) {
      // The day's stops, then the reserves handed over at them, then their claims owed, being confirmed or handed over.
      const from = etDayStart(day).toISOString(), to = etDayStart(addDays(day, 1)).toISOString();
      const stops = await supabase.from("stops").select("id").gte("starts_at", from).lt("starts_at", to);
      if (stops.error) throw new Error(stops.error.message);
      const stopIds = (stops.data ?? []).map((s) => (s as { id: string }).id);
      if (stopIds.length === 0) return { rows: [], at };
      const res = await supabase.from("reserves").select("id").in("stop_id", stopIds);
      if (res.error) throw new Error(res.error.message);
      const ids = (res.data ?? []).map((r) => (r as { id: string }).id);
      if (ids.length === 0) return { rows: [], at };
      const c = await supabase.from("reserve_claims").select(COLS).in("reserve_id", ids).in("state", ["pending", "paid", "collected"]).order("created_at");
      if (c.error) throw new Error(c.error.message);
      return { rows: (c.data ?? []) as unknown as Claim[], at };
    }
    const c = await supabase.from("reserve_claims").select(COLS).eq("reserve_id", reserveId ?? "").order("created_at", { ascending: false });
    if (c.error) throw new Error(c.error.message);
    return { rows: (c.data ?? []) as unknown as Claim[], at };
  }, [day, reserveId]);
  const load = state.reload;
  useRealtimeTable("reserve_claims", load);

  // A claim still being confirmed is read again the moment it has had its two minutes — nothing else would move it.
  const board = state.status === "ready" ? state.data : null;
  const nextOld = board ? Math.min(...board.rows.filter((c) => c.state === "pending").map((c) => Date.parse(c.created_at) + IN_FLIGHT_MS).filter((t) => t > board.at)) : Infinity;
  useEffect(() => {
    if (!Number.isFinite(nextOld)) return;
    const t = setTimeout(load, Math.max(1000, nextOld - Date.now() + 1000));
    return () => clearTimeout(t);
  }, [nextOld, load]);

  const handOver = async (c: Claim) => {
    if (!supabase || busy) return;
    setBusy(c.id);
    const { error } = await supabase.rpc("collect_reserve_claim", { p_claim: c.id });
    setBusy(null);
    toast(error ? refusalText(error) ?? "Couldn't mark it handed over — try again." : `Handed over — ${who(c)}`, error ? "error" : undefined);
    load();
  };

  const refund = async (c: Claim) => {
    if (busy) return;
    const paid = (c.paid_cents ?? 0) - (c.refunded_cents ?? 0);
    const ok = await confirm({
      title: `Refund ${who(c)}?`,
      body: `${paid > 0 ? `${money(paid)} goes back to their card and ` : ""}${c.qty > 1 ? `the ${c.qty} bottles go` : "the bottle goes"} back on the shelf.`,
      confirmLabel: paid > 0 ? `Refund ${money(paid)}` : "Cancel it", cancelLabel: "Keep it", danger: true,
    });
    if (!ok) return;
    setBusy(c.id);
    const d = await authedFetch("/api/reserves/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, crew: true }) })
      .then((x) => x.json()).catch(() => null) as { ok?: boolean; error?: string; warn?: string; refundedCents?: number } | null;
    setBusy(null);
    toast(d?.ok ? d.warn || (d.refundedCents ? `Refunded ${money(d.refundedCents)} — canceled` : "Canceled") : d?.error || "Couldn't refund it — try again.", d?.ok ? undefined : "error");
    load();
  };

  const settle = async (c: Claim, outcome: "paid" | "not_charged") => {
    if (busy) return;
    setBusy(c.id);
    const d = await authedFetch("/api/reserves/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, outcome, paymentId: payIds[c.id]?.trim() || undefined }) })
      .then((x) => x.json()).catch(() => null) as { ok?: boolean; error?: string; paidCents?: number; needsId?: boolean } | null;
    setBusy(null);
    if (d?.needsId) setAskId((m) => ({ ...m, [c.id]: true }));
    toast(d?.ok ? (outcome === "paid" ? (d.paidCents ? `Marked paid — ${money(d.paidCents)}` : "Confirmed — it's theirs") : "Let go — the bottles are back") : d?.error || "Couldn't settle it — try again.", d?.ok ? undefined : "error");
    load();
  };

  if (state.status === "loading") return null;
  if (state.status === "error") return <p className="rsv-err" role="alert">Couldn&rsquo;t load the reserve claims — try again shortly.</p>;
  const rows = board?.rows ?? [];
  const at = board?.at ?? 0;
  if (day && rows.length === 0) return null;
  const owed = rows.filter((c) => c.state === "paid").reduce((a, c) => a + c.qty, 0);
  const confirming = (c: Claim) => c.state === "pending" && Date.parse(c.created_at) + IN_FLIGHT_MS > at;

  return (
    <div className="mt-3">
      {day
        ? <SectionHeader label="Limited Reserve" annotation={owed > 0 ? `${owed} to hand over` : "all handed over"} />
        : <div className="mt-2 text-caption text-cream-muted">{rows.length === 0 ? "No claims yet." : `Claims · ${owed} to hand over`}</div>}
      <div className="k-rows">
        {rows.map((c) => {
          const free = (c.reserve?.price_cents ?? 0) === 0;
          // Settled here: by an owner or an admin, on a reserve's own list, once its checkout has had its chance.
          const settleHere = !day && admin && c.state === "pending" && !confirming(c);
          return (
            <div key={c.id}>
              <InfoRow
                lead={`×${c.qty}`}
                name={who(c)}
                sub={day ? c.reserve?.name : undefined}
                meta={line(c, { confirming: confirming(c), day: !!day, admin })}
                trailing={c.state === "paid" || c.state === "held"
                  ? <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => handOver(c)} disabled={busy === c.id}>Handed over</button>
                  : c.state === "collected" ? <span className="k-chip sm ok on"><Icon name="check" /> Handed over</span> : undefined}
              />
              {!day && admin && c.state === "paid" && (
                <div className="mb-2 flex justify-end">
                  <button type="button" className="btn-del shrink-0" onClick={() => refund(c)} disabled={busy === c.id}>Refund</button>
                </div>
              )}
              {settleHere && (
                <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
                  {!free && askId[c.id] && (
                    <input
                      className="w-[170px] rounded-[var(--r-lg)] border border-line2 bg-transparent px-2.5 py-[7px] font-sans text-callout text-cream"
                      placeholder="Square payment ID" aria-label="Square payment ID" autoComplete="off" spellCheck={false}
                      value={payIds[c.id] ?? ""} onChange={(e) => setPayIds((m) => ({ ...m, [c.id]: e.target.value }))}
                    />
                  )}
                  <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => settle(c, "paid")} disabled={busy === c.id}>{free ? "It's theirs" : "Paid"}</button>
                  <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => settle(c, "not_charged")} disabled={busy === c.id}>{free ? "Put it back" : "Not charged"}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const who = (c: Claim) => c.customer?.name?.trim() || "A member";

function line(c: Claim, o: { confirming: boolean; day: boolean; admin: boolean }): string {
  const paid = c.paid_cents ?? 0, back = c.refunded_cents ?? 0;
  switch (c.state) {
    case "paid": return `${money(paid)} paid${back > 0 ? ` · ${money(back)} refunded` : ""}`;
    case "pending":
      if (o.confirming) return "Confirming the payment…";
      if (o.day) return "Payment not confirmed — settle it under Money → Reserve drops";
      if (!o.admin) return "Payment not confirmed — an owner or admin settles it";
      return (c.reserve?.price_cents ?? 0) === 0 ? "Not confirmed — nothing to charge: it's theirs, or back on the shelf" : "Payment not confirmed — Paid looks for it in Square";
    case "collected": return `Handed over${c.collected_at ? ` ${clockTime(c.collected_at)}` : ""}${paid > 0 ? ` · ${money(paid)} paid` : ""}${back > 0 ? ` · ${money(back)} refunded` : ""}`;
    case "held": return "Held — pay at the truck";
    case "cancelled": return back > 0 ? `Canceled · ${money(back)} refunded` : "Canceled";
    default: return "Expired";
  }
}
