"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToBucket } from "@/lib/uploads";

// BRAND KIT — GT3's logos, palette, fonts & voice, in the Studio. Seeded with the real brand;
// leadership can edit voice/tagline, the wordmark, and the palette. The reference both of you
// design against (and what the caption engine's voice already enforces in copy).
/* eslint-disable @typescript-eslint/no-explicit-any */

type Kit = { id?: string; voice: string; tagline: string; logo_url: string; wordmark_url: string; colors: { name: string; hex: string }[]; fonts: { role: string; name: string }[]; notes: string };
const EMPTY: Kit = { voice: "", tagline: "", logo_url: "", wordmark_url: "", colors: [], fonts: [], notes: "" };

type Asset = { id: string; label: string; kind: string; url: string; notes: string | null };

export default function BrandKit({ canEdit }: { canEdit: boolean }) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [draft, setDraft] = useState<Kit>(EMPTY);
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newC, setNewC] = useState({ name: "", hex: "#" });
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState("");

  const loadAssets = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("brand_assets").select("id, label, kind, url, notes").order("sort");
    setAssets((data as Asset[]) ?? []);
  }, []);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("brand_kit").select("*").limit(1).maybeSingle().then(({ data }) => {
      const k = data ? { ...EMPTY, ...data, colors: data.colors ?? [], fonts: data.fonts ?? [] } : EMPTY;
      setKit(k); setDraft(k);
    });
    loadAssets();
  }, [loadAssets]);

  const uploadLogo = async (file: File) => {
    if (!supabase) return;
    setUploading(true); setUpErr("");
    try {
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]+/g, "-")}`;
      const res = await uploadToBucket({ bucket: "brand", file, path });
      if ("error" in res) throw new Error(res.error);
      const kind = /\.(jpg|jpeg)$/i.test(file.name) ? "photo" : "logo";
      const label = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 60) || "Logo";
      const ins = await supabase.from("brand_assets").insert({ label, kind, url: res.url, sort: 900 });
      if (ins.error) throw ins.error;
      await loadAssets();
    } catch (e: any) { setUpErr(String(e?.message ?? "Upload failed").includes("Bucket not found") ? "Run migration 0064 (storage bucket) first." : `Upload: ${e?.message ?? e}`); }
    setUploading(false);
  };
  const delAsset = async (id: string) => {
    if (!supabase || !window.confirm("Remove this asset?")) return;
    await supabase.from("brand_assets").delete().eq("id", id);
    setAssets((a) => a.filter((x) => x.id !== id));
  };

  const save = async () => {
    if (!supabase || !kit?.id) return;
    setSaving(true);
    await supabase.from("brand_kit").update({ voice: draft.voice, tagline: draft.tagline, wordmark_url: draft.wordmark_url, logo_url: draft.logo_url, colors: draft.colors, fonts: draft.fonts, notes: draft.notes }).eq("id", kit.id);
    setKit(draft); setEdit(false); setSaving(false);
  };

  if (!kit) return <div className="oa-empty" style={{ padding: "28px 8px" }}>Loading brand…</div>;
  const k = edit ? draft : kit;

  return (
    <div className="brand">
      <div className="brand-head">
        {k.wordmark_url ? <img src={k.wordmark_url} alt="GT3 wordmark" className="brand-word" /> : <span className="brand-name">GT3</span>}
        {canEdit && <button type="button" className="studio-act" onClick={() => { if (edit) save(); else { setDraft(kit); setEdit(true); } }} disabled={saving}>{edit ? (saving ? "Saving…" : "Save") : "Edit"}</button>}
      </div>

      <div className="brand-voice">
        {edit ? <input className="studio-hook" value={k.voice} onChange={(e) => setDraft({ ...draft, voice: e.target.value })} placeholder="Voice" /> : <div className="brand-voice-l">{k.voice}</div>}
        {edit ? <input className="studio-hook" value={k.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} placeholder="Tagline" /> : <div className="brand-tag">{k.tagline}</div>}
      </div>

      <div className="insp-lbl">Palette</div>
      <div className="brand-palette">
        {k.colors.map((c, i) => (
          <div key={i} className="brand-sw">
            <span className="brand-chip" style={{ background: c.hex }} />
            <span className="brand-sw-n">{c.name}</span><span className="brand-sw-h">{c.hex}</span>
            {edit && <button type="button" className="brand-x" onClick={() => setDraft({ ...draft, colors: draft.colors.filter((_, j) => j !== i) })}>✕</button>}
          </div>
        ))}
      </div>
      {edit && (
        <div className="brand-addc">
          <input className="insp-in insp-st" type="color" value={newC.hex.length === 7 ? newC.hex : "#a97c3f"} onChange={(e) => setNewC({ ...newC, hex: e.target.value })} />
          <input className="insp-in" value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} placeholder="Color name" />
          <button type="button" className="studio-act" onClick={() => { if (newC.name) { setDraft({ ...draft, colors: [...draft.colors, { name: newC.name, hex: newC.hex }] }); setNewC({ name: "", hex: "#" }); } }}>Add</button>
        </div>
      )}

      <div className="insp-lbl">Type</div>
      <div className="brand-fonts">
        {k.fonts.map((f, i) => (
          <div key={i} className="brand-font">
            {edit ? (
              <>
                <input className="brand-font-edit" value={f.role} onChange={(e) => setDraft({ ...draft, fonts: draft.fonts.map((g, j) => j === i ? { ...g, role: e.target.value } : g) })} placeholder="Role" />
                <input className="brand-font-edit n" value={f.name} onChange={(e) => setDraft({ ...draft, fonts: draft.fonts.map((g, j) => j === i ? { ...g, name: e.target.value } : g) })} placeholder="Font name" />
                <button type="button" className="brand-x" onClick={() => setDraft({ ...draft, fonts: draft.fonts.filter((_, j) => j !== i) })}>✕</button>
              </>
            ) : (
              <>
                <span className="brand-font-r">{f.role}</span>
                <span className="brand-font-n" style={{ fontFamily: f.name.replace(" Italic", ""), fontStyle: f.name.includes("Italic") ? "italic" : "normal" }}>{f.name}</span>
              </>
            )}
          </div>
        ))}
        {edit && <button type="button" className="studio-act" style={{ marginTop: 8 }} onClick={() => setDraft({ ...draft, fonts: [...draft.fonts, { role: "Role", name: "Font" }] })}>+ Add font</button>}
      </div>

      {edit && (
        <div className="brand-urls">
          <input className="studio-hook" value={k.wordmark_url} onChange={(e) => setDraft({ ...draft, wordmark_url: e.target.value })} placeholder="Wordmark image URL" />
          <input className="studio-hook" value={k.logo_url} onChange={(e) => setDraft({ ...draft, logo_url: e.target.value })} placeholder="Logo/icon URL" />
        </div>
      )}
      {(assets.length > 0 || canEdit) && (
        <>
          <div className="insp-lbl">Logos &amp; assets</div>
          <div className="brand-assets">
            {assets.map((a) => (
              <div key={a.id} className="brand-asset-wrap">
                <a className="brand-asset" href={a.url} target="_blank" rel="noreferrer" title={a.notes || a.label}>
                  <span className={`brand-asset-img${a.kind === "photo" ? " photo" : ""}`}><img src={a.url} alt={a.label} /></span>
                  <span className="brand-asset-l">{a.label}</span>
                </a>
                {canEdit && <button type="button" className="brand-asset-x" onClick={() => delAsset(a.id)} aria-label={`Delete ${a.label}`}>✕</button>}
              </div>
            ))}
            {canEdit && (
              <label className="brand-asset brand-upload">
                <span className="brand-asset-img"><span className="brand-up-plus">{uploading ? "…" : "＋"}</span></span>
                <span className="brand-asset-l">Upload logo</span>
                <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.currentTarget.value = ""; }} />
              </label>
            )}
          </div>
          {upErr && <p className="insp-foot">{upErr}</p>}
        </>
      )}

      {k.notes && !edit && <p className="insp-foot">{k.notes}</p>}
    </div>
  );
}
