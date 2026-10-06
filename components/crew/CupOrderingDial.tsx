"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { haptic } from "@/lib/haptics";
import { leadLabel } from "@/lib/settingsGlance";
import AsyncSection from "@/components/AsyncSection";

// THE CUP-ORDERING DIAL (0137) — when cup pre-orders open: only while the truck is live, or 2, 4 or 8
// hours before a stop starts. Same rule everywhere — the menu sheet, checkout and the charge API
// (lib/orderingRead). Pack reserves are always open regardless.
//
// ITS OWN HOME, AND ONLY WHERE IT CAN SAVE (2026-10-06, the settings round). The dial sat inside
// Plan › Route's Live truck panel (components/crew/LiveControl), which every manager opens. But
// live_status takes writes from an owner or an admin only (0003, is_admin()), and Postgres does not
// call a refused UPDATE an error — it updates no rows and says nothing. So an event manager tapped
// "2h before", read "Cup orders open 2h before a stop", and nothing had changed. The dial lives in
// Settings › Business › Ordering & delivery now, drawn for an owner or an admin only; Route keeps a line to it.
// And a save asks for the row back: no row means the database refused it, and that is said as an
// error, with the dial put back where the database has it.

// The words for each lead have one home (lib/settingsGlance) — Settings' row says the one picked.
const LEADS = [0, 2, 4, 8].map((h) => [h, leadLabel(h)] as const);

export default function CupOrderingDial() {
  const { toast } = useApp();
  const loader = useCallback(async (): Promise<number> => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data, error } = await supabase.from("live_status").select("preorder_lead_h").eq("id", 1).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { preorder_lead_h?: number | null } | null)?.preorder_lead_h ?? 4;
  }, []);
  const state = useAsyncData(loader, []);
  useRealtimeTable("live_status", state.reload);
  // The tapped answer shows at once; the database's answer replaces it either way.
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (h: number) => {
    if (!supabase || busy) return;
    haptic("selection");
    setPicked(h); setBusy(true);
    const { data, error } = await supabase.from("live_status").update({ preorder_lead_h: h }).eq("id", 1).select("preorder_lead_h");
    const refused = !error && !(data && data.length);
    if (error || refused) {
      setPicked(null);
      toast(error ? `Couldn't save — ${error.message}` : "Couldn't save — only an owner or an admin can set when cup orders open. Nothing changed.", "error");
    } else {
      toast(h === 0 ? "Cups sell only while you're live" : `Cup orders open ${h}h before a stop`);
    }
    await state.reload();
    setPicked(null); setBusy(false);
  };

  return (
    <AsyncSection state={state} isEmpty={() => false} emptyTitle="Nothing to set" loadingLabel="Reading the dial…" errorTitle="Couldn't read when cup orders open">
      {(lead) => {
        const on = picked ?? lead;
        return (
          <div className="adm-lead">
            <span className="adm-lead-k">Cup orders open</span>
            <div className="adm-lead-opts" role="radiogroup" aria-label="When cup pre-orders open">
              {LEADS.map(([h, label]) => (
                <button key={h} type="button" role="radio" aria-checked={on === h} disabled={busy}
                  className={`adm-lead-opt${on === h ? " on" : ""}`} onClick={() => pick(h)}>{label}</button>
              ))}
            </div>
          </div>
        );
      }}
    </AsyncSection>
  );
}
