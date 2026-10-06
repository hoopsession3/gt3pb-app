"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import type { MyFlag } from "@/lib/useMyAlerts";
import Icon from "@/components/Icon";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ALERT ACTION — handle an alert's goal IN PLACE, from the card. The 0174 `kind` names the handler
// and `subject_id` names the row; each kind resolves its objective with one tap and then acks the
// alert, so My Day is a cockpit — you never leave the card to do a 10-second job. Kinds with no
// safe one-tap resolution (external systems, judgement calls) fall back to the parent's Open →.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Which kinds can be finished right here, and what the button says.
const INLINE: Record<string, { verb: ReactNode; done: string }> = {
  task_assigned:   { verb: <><Icon name="check" /> Mark done</>,       done: "Done — nice." },
  task_due:        { verb: <><Icon name="check" /> Mark done</>,       done: "Done — nice." },
  brew_start_window: { verb: "▶ Start the brew", done: "Brewing — logged." },
  brew_start_now:  { verb: "▶ Start now",        done: "Brewing — logged." },
  brew_at_risk:    { verb: "▶ Start now",        done: "Brewing — logged." },
  refund_needed:   { verb: <><Icon name="check" /> Marked refunded</>, done: "Logged as refunded." },
  delivery_held:   { verb: <><Icon name="check" /> Picked up</>,       done: "Marked picked up." },
  pack_moved:      { verb: <><Icon name="check" /> Got it</>,          done: "Acknowledged." },
  reservation_new: { verb: <><Icon name="check" /> Got it</>,          done: "Acknowledged." },
  content_approved:{ verb: <><Icon name="check" /> Got it</>,          done: "Acknowledged." },
  ops_incident:    { verb: <><Icon name="check" /> Handled</>,         done: "Marked handled." },
};

export function alertHasInlineAction(kind: string | null): boolean {
  return !!kind && kind in INLINE;
}

export default function AlertAction({ flag, meId, onResolved }: {
  flag: MyFlag;
  meId: string | null;
  onResolved: () => void; // parent acks the alert + refreshes
}) {
  const kind = flag.kind ?? "";
  const cfg = INLINE[kind];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ReactNode | null>(null); // a live one-line preview of the subject

  // Pull a light preview of the subject so the card confirms WHAT you're about to finish.
  useEffect(() => {
    let alive = true;
    if (!supabase || !flag.subject_id) return;
    (async () => {
      if (kind === "task_assigned" || kind === "task_due") {
        const { data } = await supabase!.from("event_tasks").select("label, done").eq("id", flag.subject_id!).maybeSingle();
        if (alive && data) setCtx(data.done ? <>Already done <Icon name="check" /></> : (data.label as string));
      } else if (kind.startsWith("brew_")) {
        const { data } = await supabase!.from("brew_batches").select("recipe_name, batch_gal, status").eq("id", flag.subject_id!).maybeSingle();
        if (alive && data) setCtx(data.status === "brewing" ? <>Already brewing <Icon name="check" /></> : `${data.recipe_name ?? "Brew"} · ${data.batch_gal ?? "?"} gal`);
      }
    })();
    return () => { alive = false; };
  }, [kind, flag.subject_id]);

  const run = useCallback(async () => {
    if (!supabase || !flag.subject_id || busy) return;
    setBusy(true);
    try {
      // supabase-js does NOT throw on an RLS/constraint/offline failure — it resolves with { error }.
      // Capture it and throw so a FAILED write never reports "done" and never acks the alert (the brew
      // reminder would otherwise vanish without the brew ever starting).
      if (kind === "task_assigned" || kind === "task_due") {
        const { error } = await supabase.from("event_tasks").update({ done: true, done_by: meId, done_at: new Date().toISOString() }).eq("id", flag.subject_id);
        if (error) throw error;
        haptic("success");
      } else if (kind === "brew_start_window" || kind === "brew_start_now" || kind === "brew_at_risk") {
        const startIso = new Date().toISOString();
        // Mirror BrewPlanner.startBrew's status + alert-flag reset so the ladder re-arms cleanly.
        const { error } = await supabase.from("brew_batches").update({
          status: "brewing", brew_started_at: startIso,
          alerted_soon: false, alerted_ready: false, alerted_started: false,
          alerted_overextract: false, alerted_hold_soon: false, alerted_hold_expired: false,
        }).eq("id", flag.subject_id);
        if (error) throw error;
        haptic("start");
      } else if (kind === "delivery_held") {
        // Collected at GT3PB is the order fulfilled: "delivered". This wrote "picked_up" until
        // 2026-10-04 — a word delivery_orders.status has never had (0139's check: received · brewed
        // · out_for_delivery · delivered · held_for_pickup · issue), so every tap failed and the held
        // bottles stayed held on paper. scripts/vocab.audit.mjs found it. driver_outcome keeps
        // "held_no_empties", so the record still says it was held. Only a held order moves — one
        // re-routed since is left alone, and one already collected is simply done.
        const { data, error } = await supabase.from("delivery_orders").update({ status: "delivered" })
          .eq("id", flag.subject_id).eq("status", "held_for_pickup").select("id");
        if (error) throw error;
        if (!data?.length) {
          const now = await supabase.from("delivery_orders").select("status").eq("id", flag.subject_id).maybeSingle();
          if (now.error) throw now.error;
          if ((now.data as { status: string } | null)?.status !== "delivered") throw new Error("It isn't held for pickup any more.");
        }
        haptic("success");
      }
      // refund_needed / pack_moved / reservation_new / content_approved / ops_incident are
      // acknowledge-only from here (the money/other-system move happens outside the app); the ack
      // IS the resolution — the crew has seen it and owns it.
      setMsg(cfg?.done ?? "Done.");
      setTimeout(onResolved, 650);
    } catch {
      setMsg("Couldn't do that — open it to handle manually.");
    } finally {
      setBusy(false);
    }
  }, [kind, flag.subject_id, meId, busy, cfg, onResolved]);

  if (!cfg) return null;
  return (
    <div className="alert-act">
      {ctx && <span className="alert-act-ctx">{ctx}</span>}
      <button type="button" className="alert-act-do" onClick={run} disabled={busy || !!msg}>
        {msg ?? (busy ? "…" : cfg.verb)}
      </button>
    </div>
  );
}
