"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { cleanReview, isDisplayable } from "@/lib/reviews";
import { SectionHeader } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";

// STAFF REVIEW DESK — approve member feedback and add reviews pulled from Google / Instagram / the
// feedback album. "Add" inserts pre-approved. Every row shows a live preview of exactly how it'll read
// on the truck display (scrubbed + anonymized by lib/reviews) and whether it clears the display bar.
// Fetch state via useAsyncData — a failed load is a real error now, not a silent "No reviews waiting".
interface Row { id: string; name: string | null; rating: number; body: string | null; source: string; approved: boolean; created_at: string }

const SOURCES = ["manual", "google", "instagram", "app"] as const;

export default function ReviewsAdmin() {
  const { toast } = useApp();
  const [tab, setTab] = useState<"pending" | "live">("pending");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<{ name: string; rating: number; body: string; source: string }>({ name: "", rating: 5, body: "", source: "google" });
  // AI-simplified suggestion per row (id → cleaned quote), and which row is mid-request.
  const [suggest, setSuggest] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Ask the AI editor to trim + de-claim a review into a display-ready line. It never invents praise;
  // it strips health/medical claims and noise. The suggestion is shown for the operator to accept.
  const simplify = async (r: Row) => {
    if (!r.body?.trim()) return;
    setBusyId(r.id);
    try {
      const res = await fetch("/api/reviews/simplify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: r.body }),
      });
      const d = await res.json();
      if (!res.ok || !d.text) { toast(d.error || "Couldn't simplify — edit by hand", "error"); return; }
      if (d.stillGenuine === false) { toast("Nothing display-safe left once the claim was removed — skip this one", "error"); return; }
      setSuggest((s) => ({ ...s, [r.id]: d.text as string }));
      if (d.droppedClaim) toast("Simplified — a health claim was removed", "success");
    } catch { toast("Couldn't reach the editor — try again", "error"); }
    finally { setBusyId(null); }
  };

  // Accept the AI suggestion: it becomes the review body and goes live in one move.
  const acceptSuggestion = async (id: string) => {
    if (!supabase) return;
    const text = suggest[id];
    await supabase.from("reviews").update({ body: text, approved: true }).eq("id", id);
    setSuggest((s) => { const n = { ...s }; delete n[id]; return n; });
    reload();
  };
  const dismissSuggestion = (id: string) => setSuggest((s) => { const n = { ...s }; delete n[id]; return n; });

  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("reviews").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  const rows = board.data ?? [];

  const setApproved = async (id: string, approved: boolean) => { if (!supabase) return; await supabase.from("reviews").update({ approved }).eq("id", id); reload(); };
  const remove = async (id: string) => { if (!supabase) return; await supabase.from("reviews").delete().eq("id", id); reload(); };
  const add = async () => {
    if (!supabase || !f.body.trim()) return;
    setAdding(false);
    await supabase.from("reviews").insert({ name: f.name.trim() || null, rating: f.rating, body: f.body.trim(), source: f.source, approved: true });
    setF({ name: "", rating: 5, body: "", source: "google" });
    reload();
  };

  const pending = rows.filter((r) => !r.approved);
  const live = rows.filter((r) => r.approved);
  const shown = tab === "pending" ? pending : live;

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load reviews" emptyTitle="Nothing here yet">
      {() => (
        <div className="adm-sec">
          <SectionHeader label="Reviews" />
          <button className="adm-prep-view" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "+ Add"}</button>
          <div className="h-sub">Nothing shows on the truck display until you approve it. Add ones from Google, Instagram, or the feedback album.</div>

          {adding && (
            <div className="rva-add">
              <div className="rva-add-row">
                <input className="rva-in" placeholder="Name (optional — shown as first name + initial)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                <select className="rva-in rva-src" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="rva-stars">
                {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={`rva-star${n <= f.rating ? " on" : ""}`} onClick={() => setF({ ...f, rating: n })}><Icon name="star" /></button>)}
              </div>
              <textarea className="rva-in" rows={2} maxLength={280} placeholder="The review, word for word…" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
              {f.body.trim() && (() => { const c = cleanReview(f); const okd = isDisplayable(f); return (
                <div className={`rva-prev${okd ? "" : " bad"}`}>Preview: {Array.from({ length: c.rating }).map((_, i) => <Icon key={i} name="star" />)} “{c.text}” — {c.who}{okd ? "" : " · won't show (needs 4★+ and a real sentence)"}</div>
              ); })()}
              <button className="adm-btn primary" onClick={add} disabled={!f.body.trim()}>Add + approve</button>
            </div>
          )}

          <div className="grp-toggle" role="tablist">
            <button className={`grp-seg${tab === "pending" ? " on" : ""}`} onClick={() => setTab("pending")}>Pending {pending.length > 0 && <span>{pending.length}</span>}</button>
            <button className={`grp-seg${tab === "live" ? " on" : ""}`} onClick={() => setTab("live")}>Live {live.length > 0 && <span>{live.length}</span>}</button>
          </div>

          {shown.length === 0 && <div className="h-sub">{tab === "pending" ? "No reviews waiting." : "Nothing live yet — approve or add some."}</div>}
          {shown.map((r) => {
            const c = cleanReview(r); const okd = isDisplayable(r);
            const sug = suggest[r.id];
            return (
              <div key={r.id} className="rva-row">
                <div className="rva-row-body">
                  <div className="rva-row-meta">{Array.from({ length: c.rating }).map((_, i) => <Icon key={i} name="star" />)}<span className="rva-src-tag">{r.source}</span>{!okd && <span className="rva-warn">below display bar</span>}</div>
                  <div className="rva-row-q">“{c.text}”</div>
                  <div className="rva-row-who">— {c.who}</div>
                  {sug && (
                    <div className="rva-sug">
                      <span className="rva-sug-lbl"><Icon name="sparkles" /> Simplified</span>
                      <div className="rva-sug-q">“{sug}”</div>
                      <div className="rva-sug-actions">
                        <button className="rva-act ok" onClick={() => acceptSuggestion(r.id)}>Use this + approve</button>
                        <button className="rva-act" onClick={() => dismissSuggestion(r.id)}>Keep original</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="rva-row-actions">
                  {r.approved
                    ? <button className="rva-act" onClick={() => setApproved(r.id, false)}>Hide</button>
                    : <>
                        <button className="rva-act ok" onClick={() => setApproved(r.id, true)} disabled={!okd} title={okd ? "" : "Below the display bar — simplify or edit it"}>Approve</button>
                        <button className="rva-act ai" onClick={() => simplify(r)} disabled={busyId === r.id || !r.body?.trim()}>{busyId === r.id ? "…" : <><Icon name="sparkles" /> Simplify</>}</button>
                      </>}
                  <button className="rva-act del" onClick={() => remove(r.id)} aria-label="Delete"><Icon name="close" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AsyncSection>
  );
}
