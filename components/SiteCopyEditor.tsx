"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { COPY_META, copyGroupAnchor, copyGroupRoute, saveCopy, resetCopy } from "@/lib/copy";
import { SectionHeader } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";

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

  // Shared write path (lib/copy.ts) — the same save()/reset() an inline EditableCopy edit on the
  // live page itself now goes through, so this form and on-page editing can never save a key two
  // slightly different ways.
  const save = async (key: string, def: string) => {
    setBusy(key);
    const { error } = await saveCopy(key, draft[key] ?? over[key] ?? def, user?.id);
    setBusy("");
    if (error) { toast(`Couldn't save — ${error}`, "error"); return; }
    setDraft((p) => { const n = { ...p }; delete n[key]; return n; });
    toast("Copy saved — live on the site");
    reload();
  };
  const reset = async (key: string) => {
    setBusy(key);
    const { error } = await resetCopy(key);
    setBusy("");
    if (error) { toast(`Couldn't reset — ${error}`, "error"); return; }
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
            <div key={group} id={copyGroupAnchor(group)} className="sc-group">
              <div className="sc-group-h">
                <span>{group}</span>
                {/* Ryan's ask, 7/16: "click the section I'm editing, see what it looks like" — jumps
                    to the live page that actually renders this group's copy. New tab so an unsaved
                    draft in this editor isn't lost by navigating away from it. */}
                <a className="sc-view-live" href={copyGroupRoute(group)} target="_blank" rel="noopener noreferrer">
                  View live <Icon name="externalLink" size={13} />
                </a>
              </div>
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
