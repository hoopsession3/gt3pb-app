"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";

// SPLASH EDITOR (Studio) — the owner controls the marketing card the app opens to (promos, 0144).
// Edit the copy + CTA, flip it live/off. The guest app shows the most recent active one, once a
// day, closeable. Dynamically changeable, no deploy.

type Promo = { id: string; active: boolean; headline: string; body: string | null; cta_label: string | null; cta_href: string | null };

export default function PromoEditor() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [row, setRow] = useState<Promo | null>(null);
  const [d, setD] = useState<Promo>({ id: "", active: false, headline: "", body: "", cta_label: "Build your pack →", cta_href: "/delivery" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("promos").select("id, active, headline, body, cta_label, cta_href").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data) { setRow(data as Promo); setD(data as Promo); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!supabase || busy) return;
    if (!d.headline.trim()) { toast("The splash needs a headline", "error"); return; }
    setBusy(true);
    const patch = { active: d.active, headline: d.headline.trim(), body: d.body?.trim() || null, cta_label: d.cta_label?.trim() || null, cta_href: d.cta_href?.trim() || null, updated_by: user?.id ?? null, updated_at: new Date().toISOString() };
    const { error } = row?.id
      ? await supabase.from("promos").update(patch).eq("id", row.id)
      : await supabase.from("promos").insert(patch);
    setBusy(false);
    if (error) { toast(String(error.message).includes("promos") ? "Run migration 0144 first (promos table)." : `Couldn't save — ${error.message}`, "error"); return; }
    toast(d.active ? "Live — guests will see it" : "Saved (off)");
    load();
  };

  return (
    <div className="adm-sec" id="promo-editor">
      <div className="sec">App splash {d.active && <span className="adm-pill">live</span>}</div>
      <p className="h-sub" style={{ marginBottom: 12 }}>The marketing card the app opens to for guests — closeable, shown once a day. Edit it anytime; it changes live.</p>
      <div className="goal-new">
        <input className="auth-input" value={d.headline} onChange={(e) => setD({ ...d, headline: e.target.value })} placeholder="Headline — e.g. Save more with a pack." maxLength={80} />
        <textarea className="auth-input" rows={3} value={d.body ?? ""} onChange={(e) => setD({ ...d, body: e.target.value })} placeholder="The benefit, in a sentence or two." maxLength={400} />
        <div className="goal-new-row">
          <input className="auth-input" value={d.cta_label ?? ""} onChange={(e) => setD({ ...d, cta_label: e.target.value })} placeholder="Button label" maxLength={40} />
          <input className="auth-input" value={d.cta_href ?? ""} onChange={(e) => setD({ ...d, cta_href: e.target.value })} placeholder="Button link — /delivery" maxLength={80} />
        </div>
        <label className="prod-toggle"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Show it to guests (live)</label>
        <div className="st-log-btns">
          <button type="button" className="dops-mini" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save splash"}</button>
        </div>
      </div>
    </div>
  );
}
