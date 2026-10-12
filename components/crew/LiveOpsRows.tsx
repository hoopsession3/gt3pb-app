"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { readPulse } from "@/lib/passBoard";
import { localToday } from "@/lib/dates";
import { passSays, serviceExceptions, exceptionSays, type ReadState } from "@/lib/liveOps";
import type { MyFlag } from "@/lib/useMyAlerts";
import { AlertsOffLine, useAlertsOffHere } from "@/components/DeviceAlerts";
import { DevicesCard, useDevices } from "@/components/crew/DevicesCard";
import { StatusRow } from "@/components/crew/StatusRow";
import Sheet, { CloseButton } from "@/components/Sheet";
import Button from "@/components/Button";
import Icon from "@/components/Icon";

// LIVE OPS' ROWS (2026-10-12, the Live Ops round, approved). The Pass's row and the line that leads the screen when
// service is hurting; the truck's row is components/crew/LiveControl's. What each says is lib/liveOps'.

// ── THE PASS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// It was "▶ The Pass" over "The pass is clear · 2 86'd — tap to work", a gold hero button; under the truck a line when
// this phone could not ring, and under that the Devices card. It is one row: "Pass clear · 2 86'd · 2 phones can ring",
// or "3 on the Pass · 1 ahead", and a tap opens the Pass. The phones' trouble is words on the row ("1 reconnecting",
// "this phone can't ring"); the line to turn this phone's alerts on and the devices' own rows are one tap away, under
// Phones. Counted as the Pass counts (lib/passBoard readPulse: on the pass is New + In progress + Ready, ahead is the
// Scheduled lane), read again on a change to orders or the 86 board and every minute. A count that did not answer —
// the first or a later one — says so, and never stands as the last number it had.
type Pulse = { pass: number; ahead: number; out: number };

export function PassRow({ onOpenPass, canManage }: { onOpenPass: () => void; canManage: boolean }) {
  const loader = useCallback(async (): Promise<Pulse> => {
    if (!supabase) return { pass: 0, ahead: 0, out: 0 };
    const [o, p] = await Promise.all([
      readPulse(supabase, Date.now()),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true).eq("sold_out", true),
    ]);
    if (o.pass === null || o.ahead === null) throw new Error("The Pass's count did not answer");
    if (p.error) throw new Error(p.error.message);
    return { pass: o.pass, ahead: o.ahead, out: p.count ?? 0 };
  }, []);
  const pulse = useAsyncData(loader, []);
  const { reload } = pulse;
  useEffect(() => { const t = window.setInterval(() => { void reload(); }, 60_000); return () => window.clearInterval(t); }, [reload]);
  useRealtimeTable(["orders", "products"], reload);

  // The phones: a manager's to read (crew_devices answers no one else); this phone's alerts, everyone's.
  const devices = useDevices(canManage);
  const thisPhoneOff = useAlertsOffHere();
  const [phonesOpen, setPhonesOpen] = useState(false);

  const read: ReadState = pulse.error ? "failed" : pulse.data ? "ready" : "loading";
  const says = passSays({
    read, pass: pulse.data?.pass ?? 0, ahead: pulse.data?.ahead ?? 0, out: pulse.data?.out ?? 0,
    phones: !canManage ? null : devices.failed ? "failed" : devices.phones,
    thisPhoneOff,
  });
  const anyPhones = thisPhoneOff || (canManage && (devices.failed || (devices.data?.rows.length ?? 0) > 0));
  const action = read === "failed"
    ? <Button kind="secondary" compact className="shrink-0" onClick={() => { void reload(); }} aria-label="Count the Pass again">Try again</Button>
    : anyPhones
      ? <Button kind="secondary" compact className="shrink-0" aria-haspopup="dialog" onClick={() => setPhonesOpen(true)}
          aria-label={`Phones on the Pass${says.trouble ? " — something to fix" : ""}: which can ring, and this phone's order alerts`}>Phones</Button>
      : null;
  return (
    <>
      <StatusRow label="The Pass" says={says} tapLabel={`${says.text}. Opens the Pass.`} onTap={onOpenPass} action={action} />
      {phonesOpen && (
        <Sheet open onClose={() => setPhonesOpen(false)} label="Phones on the Pass"
          header={<div className="flex items-center"><b className="text-subhead font-semibold">Phones on the Pass</b><CloseButton onClick={() => setPhonesOpen(false)} /></div>}>
          <p className="load-failed">A phone can ring for a new order while it has the Pass open and connected; with its order alerts on, a push reaches it with the Pass out of sight.</p>
          <AlertsOffLine />
          {canManage && <DevicesCard />}
        </Sheet>
      )}
    </>
  );
}

// ── THE EXCEPTION LINE ───────────────────────────────────────────────────────────────────────────────────────────────
// One row at the top of Live Ops, only while an alert is hurting service right now — tickets past their promise, no
// phone on the Pass that can ring, a paid cup order that didn't record (lib/liveOps serviceExceptions says which, and
// why nothing else). The critical tint and words of the Pass's own strip; a tap opens the Pass, or for the paid order
// with no record, the inbox, where its words are. It reads the header bell's list — handed in, not read twice — so the
// two cannot disagree. Nothing at all otherwise: silence is the signal.
export function ExceptionLine({ flags, onOpenPass }: { flags: readonly MyFlag[]; onOpenPass: () => void }) {
  const s = exceptionSays(serviceExceptions(flags, localToday()));
  if (!s) return null;
  const go = () => { if (s.opens === "pass") onOpenPass(); else window.dispatchEvent(new Event("gt3-open-inbox")); };
  return (
    <button type="button" className="alerts-strip crit min-h-11" onClick={go} aria-label={s.label}>
      <span className="alerts-strip-i" aria-hidden><Icon name="warning" /></span>
      <span className="alerts-strip-t"><b>{s.title}</b>{s.more ? ` · ${s.more}` : ""}</span>
      <span className="alerts-strip-go" aria-hidden>{s.opens === "pass" ? "The Pass" : "Open"} <Icon name="arrowRight" /></span>
    </button>
  );
}
