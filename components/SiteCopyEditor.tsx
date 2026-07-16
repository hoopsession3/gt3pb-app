"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { COPY_META } from "@/lib/copy";
import { SectionHeader } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// SITE COPY EDITOR — owners/crews edit the storefront's front-end text from inside the app. Each
// editable string shows its current value (override or default); Save writes an override, Reset
// removes it (back to the default). Public storefronts read the change live (realtime). Gated to
// admins/owners (RLS enforces it server-side regardless).
export default function SiteCopyEditor() {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const isAdmin = Boolean(profile?.is_admin);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>("");

  const loader = useCallback(async (): Promise<Record<string, string>> => {
    if (!supabase) return {};
    const { data, error } = await supabase.from("site_copy").select("key, value");
    if (error) throw new Error(error.message);
    return Object.fromEntries(((data as { key: string; value: string }[]) ?? []).map((r) => [r.key, r.value]));
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  const over = board.data ?? {};

  // current shown value = unsaved draft ?? saved override ?? default
  const groups = useMemo(() => {
    const g: Record<string, typeof COPY_META> = {};
    for (const m of COPY_META) { (g[m.group] ??= []).push(m); }
    return g;
  }, []);

  if (!isAdmin) return null;

  const valueOf = (key: string, def: string) => (draft[key] ?? over[key] ?? def);
  const dirty = (key: string, def: string) => (draft[key] !== undefined && draft[key] !== (over[key] ?? def));

  const save = async (key: string, def: string) => {
    if (!supabase) return;
    const value = (draft[key] ?? over[key] ?? def).trim();
    if (!value) { toast("Copy can't be empty — use Reset to go back to the default", "error"); return; }
    setBusy(key);
    const { error } = await supabase.from("site_copy").upsert({ key, value, updated_by: user?.id ?? null, updated_at: new Date().toISOString() });
    setBusy("");
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setDraft((p) => { const n = { ...p }; delete n[key]; return n; });
    toast("Copy saved — live on the site");
    reload();
  };
  const reset = async (key: string) => {
    if (!supabase) return;
    setBusy(key);
    const { error } = await supabase.from("site_copy").delete().eq("key", key);
    setBusy("");
    if (error) { toast(`Couldn't reset — ${error.message}`, "error"); return; }
    setDraft((p) => { const n = { ...p }; delete n[key]; return n; });
    toast("Reset to the default");
    reload();
  };

  return (
    <AsyncSection state={board} isEmpty={() => false} emptyTitle="No copy overrides yet" errorTitle="Couldn't load the copy overrides">
      {() => (
        <div className="adm-sec sitecopy">
          <SectionHeader label="Front-end copy" />
          <div className="h-sub" style={{ margin: "0 2px 12px" }}>Edit the words on the storefront. Saves go live immediately; Reset returns a line to its default.</div>
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="sc-group">
              <div className="sc-group-h">{group}</div>
              {items.map((m) => {
                const overridden = over[m.key] !== undefined;
                return (
                  <div key={m.key} className="sc-row">
                    <div className="sc-row-h"><span className="sc-label">{m.label}</span>{overridden && <span className="sc-pill">edited</span>}</div>
                    {m.multiline
                      ? <textarea className="sc-in" rows={3} value={valueOf(m.key, m.default)} onChange={(e) => setDraft((p) => ({ ...p, [m.key]: e.target.value }))} />
                      : <input className="sc-in" value={valueOf(m.key, m.default)} onChange={(e) => setDraft((p) => ({ ...p, [m.key]: e.target.value }))} />}
                    <div className="sc-actions">
                      <button type="button" className="sc-save" disabled={busy === m.key || !dirty(m.key, m.default)} onClick={() => save(m.key, m.default)}>{busy === m.key ? "Saving…" : "Save"}</button>
                      <button type="button" className="sc-reset" disabled={busy === m.key || !overridden} onClick={() => reset(m.key)}>Reset to default</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </AsyncSection>
  );
}
