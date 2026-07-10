"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useApp } from "./AppProvider";

// THE 86 BOARD — sell out of an item from where the rush actually happens (the Now screen, right
// under the pass), not three taps deep in Money. One chip per active product: tap to 86, tap to
// bring back. Realtime both ways; the flip stamps who/when (0130) and clears itself at 4am Eastern.
type Prod = { id: string; slug: string; name: string; sold_out: boolean; sold_out_at: string | null };

export default function EightySix() {
  const { toast } = useApp();
  const [rows, setRows] = useState<Prod[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("products").select("id, slug, name, sold_out, sold_out_at").eq("active", true).order("sort");
    if (data) setRows(data as Prod[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("products", load);

  const flip = async (p: Prod) => {
    if (!supabase) return;
    const next = !p.sold_out;
    setRows((r) => r.map((x) => (x.id === p.id ? { ...x, sold_out: next } : x))); // optimistic
    const { error } = await supabase.from("products").update({ sold_out: next }).eq("id", p.id);
    if (error) { toast(`Couldn't flip ${p.name} — ${error.message}`, "error"); load(); return; }
    toast(next ? `${p.name} 86'd — live menu updated` : `${p.name} back on`);
  };

  if (rows.length === 0) return null;
  const outCount = rows.filter((r) => r.sold_out).length;
  return (
    <div className="adm-sec">
      <div className="sec">86 board {outCount > 0 && <span className="adm-pill due">{outCount} out</span>}</div>
      <div className="es-note">Tap what you&rsquo;ve run out of — the live menu updates instantly, orders for it are refused, and everything resets at 4am.</div>
      <div className="es-row">
        {rows.map((p) => (
          <button key={p.id} type="button" className={`es-chip${p.sold_out ? " out" : ""}`} onClick={() => flip(p)} aria-pressed={p.sold_out}>
            {p.name}
            {p.sold_out && p.sold_out_at && <em>{new Date(p.sold_out_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</em>}
          </button>
        ))}
      </div>
    </div>
  );
}
