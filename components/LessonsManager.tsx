"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { isBlank } from "@/lib/formGuard";
import { supabase } from "@/lib/supabase";
import { SectionHeader, InfoRow } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// RETURN TO PRIMAL · lessons manager (0273) — author the customer nutrition academy the same way the
// menu is managed: create a draft (born hidden, 0270 publish gate), fill it in, link the menu products
// that make its stack, then publish. Writes go straight through the browser client; RLS `is_staff()`
// is the gate (same as MenuManager). Publish = stamp published_at; unpublish = clear it.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Pillar = { id: string; slug: string; title: string; sort: number; published_at: string | null };
type Module = { id: string; pillar_id: string; slug: string; title: string; sort: number; published_at: string | null };
type Lesson = { id: string; module_id: string; slug: string; title: string; subtitle: string | null; tier: "rookie" | "pro"; est_minutes: number | null; summary: string | null; key_points: string[]; body: string | null; sort: number; published_at: string | null };
type ProductOpt = { slug: string; name: string; active: boolean };
type Board = { pillars: Pillar[]; modules: Module[]; lessons: Lesson[]; products: ProductOpt[] };

const rid = () => Math.random().toString(36).slice(2, 7);

export default function LessonsManager() {
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [newMod, setNewMod] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [showStructure, setShowStructure] = useState(false);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { pillars: [], modules: [], lessons: [], products: [] };
    const [pil, mod, les, prod] = await Promise.all([
      supabase.from("primal_pillars").select("id, slug, title, sort, published_at").order("sort"),
      supabase.from("primal_modules").select("id, pillar_id, slug, title, sort, published_at").order("sort"),
      supabase.from("primal_lessons").select("id, module_id, slug, title, subtitle, tier, est_minutes, summary, key_points, body, sort, published_at").order("sort"),
      supabase.from("products").select("slug, name, active").order("sort"),
    ]);
    if (pil.error) throw new Error(pil.error.message);
    const lessons = ((les.data as Lesson[]) ?? []).map((l) => ({ ...l, key_points: Array.isArray(l.key_points) ? l.key_points : [] }));
    return { pillars: (pil.data as Pillar[]) ?? [], modules: (mod.data as Module[]) ?? [], lessons, products: (prod.data as ProductOpt[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  const b = board.data ?? { pillars: [], modules: [], lessons: [], products: [] };

  const createLesson = async () => {
    if (!supabase) return;
    if (!newMod) { toast("Pick a module first", "error"); return; }
    if (isBlank(newTitle)) { toast("Give the lesson a title", "error"); return; }
    const modLessons = b.lessons.filter((l) => l.module_id === newMod);
    const { data, error } = await supabase.from("primal_lessons").insert({
      module_id: newMod, slug: `${newTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lesson"}-${rid()}`,
      title: newTitle.trim(), tier: "rookie", sort: (modLessons.at(-1)?.sort ?? 0) + 1,
    }).select("id").single();
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setNewTitle(""); await reload(); if (data?.id) setOpenId(data.id);
  };

  return (
    <AsyncSection state={board} isEmpty={(d) => d.pillars.length === 0} emptyTitle="No academy yet" emptySub="Apply migration 0272 (Return to Primal) first." errorTitle="Couldn't load the academy">
      {() => (
        <div className="adm-sec">
          <div className="studio-top">
            <SectionHeader label="Return to Primal · lessons" />
            <button type="button" className="btn-sec" onClick={() => setShowStructure((s) => !s)}>{showStructure ? "Hide structure" : "Pillars & modules"}</button>
          </div>
          <div className="h-sub">Write the customer nutrition academy. New lessons are born hidden — fill them in, link the menu stack, then publish. Rookie is free; Pro unlocks through a membership.</div>

          {showStructure && <StructureEditor pillars={b.pillars} modules={b.modules} onSaved={reload} toast={toast} />}

          {/* create a lesson */}
          <div className="prod-addc" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <select value={newMod} onChange={(e) => setNewMod(e.target.value)}>
              <option value="">+ new lesson in…</option>
              {b.pillars.map((p) => (
                <optgroup key={p.id} label={p.title}>
                  {b.modules.filter((m) => m.pillar_id === p.id).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </optgroup>
              ))}
            </select>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Lesson title" style={{ flex: 1, minWidth: 140 }} />
            <button type="button" className="insp-yes" onClick={createLesson} disabled={!newMod || isBlank(newTitle)}>Create</button>
          </div>

          {/* lessons grouped by pillar → module */}
          {b.pillars.map((p) => {
            const mods = b.modules.filter((m) => m.pillar_id === p.id);
            const pillarLessons = b.lessons.filter((l) => mods.some((m) => m.id === l.module_id));
            if (pillarLessons.length === 0) return null;
            return (
              <div key={p.id} style={{ marginTop: 16 }}>
                <div className="crew-group">{p.title}</div>
                {mods.map((m) => {
                  const lessons = b.lessons.filter((l) => l.module_id === m.id);
                  if (lessons.length === 0) return null;
                  return (
                    <div key={m.id} style={{ marginBottom: 8 }}>
                      <div className="insp-lbl">{m.title}</div>
                      {lessons.map((l) => (
                        <LessonRow key={l.id} l={l} products={b.products} open={openId === l.id} onToggle={() => setOpenId(openId === l.id ? null : l.id)} onSaved={reload} toast={toast} />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </AsyncSection>
  );
}

function LessonRow({ l, products, open, onToggle, onSaved, toast }: { l: Lesson; products: ProductOpt[]; open: boolean; onToggle: () => void; onSaved: () => void; toast: (m: string, t?: any) => void }) {
  const [d, setD] = useState(l);
  const [keysText, setKeysText] = useState((l.key_points || []).join("\n"));
  const [links, setLinks] = useState<{ id: string; product_slug: string; rationale: string | null; sort: number }[]>([]);
  const [addSlug, setAddSlug] = useState(""); const [addWhy, setAddWhy] = useState("");
  useEffect(() => { setD(l); setKeysText((l.key_points || []).join("\n")); }, [l]);
  useEffect(() => {
    if (!open || !supabase) return;
    supabase.from("primal_lesson_products").select("id, product_slug, rationale, sort").eq("lesson_id", l.id).order("sort").then(({ data }) => setLinks((data as any[]) ?? []));
  }, [open, l.id]);

  const published = !!d.published_at;
  const save = async () => {
    if (!supabase) return;
    if (isBlank(d.title)) { toast("Give it a title first", "error"); return; }
    const key_points = keysText.split("\n").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.from("primal_lessons").update({
      title: d.title.trim(), subtitle: d.subtitle, tier: d.tier, est_minutes: d.est_minutes ? Math.round(Number(d.est_minutes)) : null,
      summary: d.summary, key_points, body: d.body, sort: d.sort, published_at: d.published_at,
    }).eq("id", l.id);
    if (error) toast(`Error: ${error.message}`, "error"); else { toast("Saved"); onSaved(); }
  };
  const togglePublish = () => setD({ ...d, published_at: d.published_at ? null : new Date().toISOString() });
  const del = async () => {
    if (!supabase || !window.confirm(`Delete "${d.title}"? This removes the lesson and its menu links.`)) return;
    await supabase.from("primal_lessons").delete().eq("id", l.id); toast("Deleted"); onSaved();
  };
  const addLink = async () => {
    if (!supabase || !addSlug) return;
    const { error } = await supabase.from("primal_lesson_products").insert({ lesson_id: l.id, product_slug: addSlug, rationale: addWhy || null, sort: (links.at(-1)?.sort ?? 0) + 1 });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setAddSlug(""); setAddWhy("");
    supabase.from("primal_lesson_products").select("id, product_slug, rationale, sort").eq("lesson_id", l.id).order("sort").then(({ data }) => setLinks((data as any[]) ?? []));
  };
  const rmLink = async (id: string) => {
    if (!supabase) return;
    await supabase.from("primal_lesson_products").delete().eq("id", id);
    setLinks((c) => c.filter((x) => x.id !== id));
  };
  const prodName = (slug: string) => products.find((p) => p.slug === slug)?.name ?? slug;

  return (
    <div className={`prod${open ? " open" : ""}`}>
      <div className="k-rows">
        <InfoRow
          bodyClick={onToggle} expanded={open} ariaLabel={`${l.title} — edit lesson`}
          name={<>
            <span className="prod-dot" style={{ background: d.tier === "pro" ? "#B8902F" : "#3f7d6e" }} />
            {l.title}
          </>}
          nameExtra={<>{!published && <span className="prod-off">hidden</span>}{d.tier === "pro" && <span className="prod-86tag">PRO</span>}</>}
          trailing={<span className="prod-line">{l.est_minutes ? `${l.est_minutes}m` : ""}</span>}
        />
      </div>
      {open && (
        <div className="prod-body">
          <div className="prod-grid">
            <label className="prod-f"><span>Title</span><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
            <label className="prod-f"><span>Read time (min)</span><input type="number" value={d.est_minutes ?? ""} onChange={(e) => setD({ ...d, est_minutes: e.target.value ? Number(e.target.value) : null })} /></label>
            <label className="prod-f"><span>Tier</span>
              <select value={d.tier} onChange={(e) => setD({ ...d, tier: e.target.value as "rookie" | "pro" })}>
                <option value="rookie">Rookie (free)</option>
                <option value="pro">Pro (members)</option>
              </select>
            </label>
            <label className="prod-f"><span>Sort</span><input type="number" value={d.sort} onChange={(e) => setD({ ...d, sort: Number(e.target.value) || 0 })} /></label>
          </div>
          <label className="prod-f"><span>Subtitle</span><input value={d.subtitle ?? ""} onChange={(e) => setD({ ...d, subtitle: e.target.value })} /></label>
          <label className="prod-f"><span>Summary (card + search)</span><input value={d.summary ?? ""} onChange={(e) => setD({ ...d, summary: e.target.value })} /></label>
          <label className="prod-f"><span>Key points (one per line — the quick version)</span><textarea rows={3} value={keysText} onChange={(e) => setKeysText(e.target.value)} /></label>
          <label className="prod-f"><span>Body</span><textarea rows={6} value={d.body ?? ""} onChange={(e) => setD({ ...d, body: e.target.value })} placeholder="The lesson. Keep it factual — composition and general nutrition, never disease/cure/medical claims." /></label>

          <div className="prod-recipe">
            <div className="insp-lbl">Menu stack — the drinks this lesson recommends (ordered before/during/after by the menu)</div>
            {links.map((lk) => (
              <div key={lk.id} className="prod-comp">
                <span><b>{prodName(lk.product_slug)}</b>{lk.rationale ? ` · ${lk.rationale}` : ""}</span>
                <button type="button" className="insp-no" onClick={() => rmLink(lk.id)}>Remove</button>
              </div>
            ))}
            <div className="prod-addc" style={{ flexWrap: "wrap" }}>
              <select value={addSlug} onChange={(e) => setAddSlug(e.target.value)}>
                <option value="">+ menu product…</option>
                {products.filter((p) => !links.some((lk) => lk.product_slug === p.slug)).map((p) => <option key={p.slug} value={p.slug}>{p.name}{p.active ? "" : " (off-board)"}</option>)}
              </select>
              <input value={addWhy} onChange={(e) => setAddWhy(e.target.value)} placeholder="why it fits" style={{ flex: 1, minWidth: 120 }} />
              <button type="button" className="insp-yes" onClick={addLink} disabled={!addSlug}>Link</button>
            </div>
          </div>

          <label className="prod-toggle"><input type="checkbox" checked={published} onChange={togglePublish} /> Published — visible to guests{published && d.published_at ? ` (since ${new Date(d.published_at).toLocaleDateString()})` : ""}</label>
          <div className="prod-actions" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn-ter" onClick={del}>Delete</button>
            <button type="button" className="btn-pri" onClick={save} disabled={isBlank(d.title)}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact pillar/module structure editor — create + publish-toggle + rename. Born hidden; publish when ready.
function StructureEditor({ pillars, modules, onSaved, toast }: { pillars: Pillar[]; modules: Module[]; onSaved: () => void; toast: (m: string, t?: any) => void }) {
  const [pTitle, setPTitle] = useState("");
  const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  const addPillar = async () => {
    if (!supabase || isBlank(pTitle)) return;
    const { error } = await supabase.from("primal_pillars").insert({ slug: `${slugify(pTitle) || "pillar"}-${rid()}`, title: pTitle.trim(), sort: (pillars.at(-1)?.sort ?? 0) + 10 });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setPTitle(""); onSaved();
  };
  const addModule = async (pillarId: string, title: string) => {
    if (!supabase || isBlank(title)) return;
    const kids = modules.filter((m) => m.pillar_id === pillarId);
    const { error } = await supabase.from("primal_modules").insert({ pillar_id: pillarId, slug: `${slugify(title) || "module"}-${rid()}`, title: title.trim(), sort: (kids.at(-1)?.sort ?? 0) + 10 });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    onSaved();
  };
  const togglePub = async (table: "primal_pillars" | "primal_modules", id: string, cur: string | null) => {
    if (!supabase) return;
    await supabase.from(table).update({ published_at: cur ? null : new Date().toISOString() }).eq("id", id);
    onSaved();
  };
  return (
    <div className="prod-recipe" style={{ marginTop: 10 }}>
      <div className="insp-lbl">Pillars &amp; modules — the shape of the academy</div>
      {pillars.map((p) => (
        <div key={p.id} style={{ marginBottom: 8 }}>
          <div className="prod-comp">
            <span><b>{p.title}</b>{!p.published_at && <em style={{ opacity: 0.6 }}> · hidden</em>}</span>
            <button type="button" className={p.published_at ? "insp-no" : "insp-yes"} onClick={() => togglePub("primal_pillars", p.id, p.published_at)}>{p.published_at ? "Unpublish" : "Publish"}</button>
          </div>
          <div style={{ paddingLeft: 12 }}>
            {modules.filter((m) => m.pillar_id === p.id).map((m) => (
              <div key={m.id} className="prod-comp">
                <span>{m.title}{!m.published_at && <em style={{ opacity: 0.6 }}> · hidden</em>}</span>
                <button type="button" className={m.published_at ? "insp-no" : "insp-yes"} onClick={() => togglePub("primal_modules", m.id, m.published_at)}>{m.published_at ? "Unpublish" : "Publish"}</button>
              </div>
            ))}
            <ModuleAdder onAdd={(title) => addModule(p.id, title)} />
          </div>
        </div>
      ))}
      <div className="prod-addc" style={{ marginTop: 8 }}>
        <input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="+ new pillar" style={{ flex: 1 }} />
        <button type="button" className="insp-yes" onClick={addPillar} disabled={isBlank(pTitle)}>Add pillar</button>
      </div>
    </div>
  );
}

function ModuleAdder({ onAdd }: { onAdd: (title: string) => void }) {
  const [t, setT] = useState("");
  return (
    <div className="prod-addc" style={{ marginTop: 4 }}>
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="+ module" style={{ flex: 1 }} />
      <button type="button" className="insp-yes" onClick={() => { onAdd(t); setT(""); }} disabled={!t.trim()}>Add</button>
    </div>
  );
}
