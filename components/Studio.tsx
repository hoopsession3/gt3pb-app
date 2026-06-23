"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";

// STUDIO — the collaborative marketing studio. Her money-maker, his taste → built around
// collaboration: real-time co-editing (Supabase Realtime presence + broadcast), real version
// history, scheduling, titles, status/approval, and a suave on-brand caption engine.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Item = {
  id: string; kind: string; channel: string; title: string; hook: string | null; caption: string | null;
  hashtags: string[]; status: string; review_note: string | null; scheduled_for: string | null;
  updated_at: string; updated_by: string | null;
};
type Version = { id: string; title: string | null; hook: string | null; caption: string | null; hashtags: string[] | null; status: string | null; label: string | null; edited_by: string | null; created_at: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "st-draft" }, review: { label: "In review", cls: "st-review" },
  changes: { label: "Changes", cls: "st-changes" }, approved: { label: "Approved", cls: "st-approved" },
  scheduled: { label: "Scheduled", cls: "st-scheduled" }, published: { label: "Published", cls: "st-published" },
};
const KINDS = ["post", "carousel", "reel", "caption", "email", "menu_card", "promo", "blog"];
const CHANNELS = ["instagram", "tiktok", "site", "email", "print", "other"];
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function Studio() {
  const { user, profile } = useAuth();
  const me = { id: user?.id ?? "anon", name: profile?.display_name || user?.email?.split("@")[0] || "Crew" };
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("content_items").select("*").order("updated_at", { ascending: false }).limit(100);
    setItems((data as Item[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Live board across users.
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel("studio-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "content_items" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const create = async () => {
    if (!supabase) return;
    const { data } = await supabase.from("content_items").insert({ title: "Untitled", created_by: me.id, updated_by: me.id }).select("id").single();
    if (data?.id) { await load(); setOpenId(data.id); }
  };

  if (openId) return <StudioEditor id={openId} me={me} onClose={() => { setOpenId(null); load(); }} />;

  const shown = filter === "all" ? items : items.filter((i) => i.status === filter);
  return (
    <div className="adm-sec">
      <div className="studio-top">
        <div className="sec" style={{ margin: 0 }}>Studio</div>
        <button type="button" className="rdy-run" onClick={create}>✦ New piece</button>
      </div>
      <div className="subnav" role="tablist" aria-label="Filter">
        {["all", ...Object.keys(STATUS)].map((k) => (
          <button key={k} type="button" className={`subnav-tab${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>
            {k === "all" ? "All" : STATUS[k].label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="oa-empty" style={{ padding: "28px 8px" }}>No pieces yet. Start one — draft a caption with the engine, collaborate in real time, schedule it.</div>
      ) : (
        <div className="studio-grid">
          {shown.map((it) => (
            <button key={it.id} type="button" className="studio-card" onClick={() => setOpenId(it.id)}>
              <div className="studio-card-h">
                <span className={`st-pill ${STATUS[it.status]?.cls ?? ""}`}>{STATUS[it.status]?.label ?? it.status}</span>
                <span className="studio-card-ch">{it.channel}</span>
              </div>
              <div className="studio-card-t">{it.title || "Untitled"}</div>
              {it.caption && <div className="studio-card-c">{it.caption}</div>}
              <div className="studio-card-f">{it.scheduled_for ? `📅 ${fmtDate(it.scheduled_for)}` : `Edited ${fmtDate(it.updated_at)}`}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StudioEditor({ id, me, onClose }: { id: string; me: { id: string; name: string }; onClose: () => void }) {
  const [item, setItem] = useState<Item | null>(null);
  const [title, setTitle] = useState(""); const [hook, setHook] = useState(""); const [caption, setCaption] = useState("");
  const [tags, setTags] = useState(""); const [status, setStatus] = useState("draft");
  const [sched, setSched] = useState(""); const [note, setNote] = useState("");
  const [peers, setPeers] = useState<{ id: string; name: string }[]>([]);
  const [savedAt, setSavedAt] = useState<string>("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVers, setShowVers] = useState(false);
  // caption engine
  const [brief, setBrief] = useState(""); const [drafting, setDrafting] = useState(false);
  const [options, setOptions] = useState<any[]>([]);
  const chRef = useRef<any>(null);
  const saveTimer = useRef<any>(null);

  const loadVersions = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("content_versions").select("*").eq("content_id", id).order("created_at", { ascending: false }).limit(40);
    setVersions((data as Version[]) ?? []);
  }, [id]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from("content_items").select("*").eq("id", id).single().then(({ data }) => {
      if (cancelled || !data) return;
      const it = data as Item;
      setItem(it); setTitle(it.title || ""); setHook(it.hook || ""); setCaption(it.caption || "");
      setTags((it.hashtags || []).join(", ")); setStatus(it.status); setNote(it.review_note || "");
      setSched(it.scheduled_for ? new Date(it.scheduled_for).toISOString().slice(0, 16) : "");
    });
    loadVersions();

    // Real-time co-editing: presence (who's here) + broadcast (live field patches).
    const ch = supabase.channel(`studio-${id}`, { config: { presence: { key: me.id } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState() as any;
      const list = Object.values(state).flat().map((p: any) => ({ id: p.id, name: p.name }));
      setPeers(list.filter((p: any) => p.id !== me.id));
    });
    ch.on("broadcast", { event: "patch" }, ({ payload }: any) => {
      if (payload.by === me.id) return;
      if (payload.field === "title") setTitle(payload.value);
      else if (payload.field === "hook") setHook(payload.value);
      else if (payload.field === "caption") setCaption(payload.value);
      else if (payload.field === "tags") setTags(payload.value);
    });
    ch.subscribe(async (st: string) => { if (st === "SUBSCRIBED") await ch.track({ id: me.id, name: me.name }); });
    chRef.current = ch;
    return () => { cancelled = true; supabase?.removeChannel(ch); };
  }, [id, me.id, me.name, loadVersions]);

  const persist = useCallback(async (patch: Record<string, any>) => {
    if (!supabase) return;
    await supabase.from("content_items").update({ ...patch, updated_by: me.id }).eq("id", id);
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }, [id, me.id]);

  // local edit → broadcast immediately + debounced autosave
  const edit = (field: "title" | "hook" | "caption" | "tags", value: string) => {
    if (field === "title") setTitle(value); else if (field === "hook") setHook(value);
    else if (field === "caption") setCaption(value); else setTags(value);
    chRef.current?.send({ type: "broadcast", event: "patch", payload: { by: me.id, field, value } });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const patch: any = {};
      if (field === "tags") patch.hashtags = value.split(",").map((s) => s.trim()).filter(Boolean);
      else patch[field] = value;
      persist(patch);
    }, 1100);
  };

  const snapshot = async (label: string) => {
    if (!supabase) return;
    await supabase.from("content_versions").insert({
      content_id: id, title, hook, caption, status, label,
      hashtags: tags.split(",").map((s) => s.trim()).filter(Boolean), edited_by: me.id,
    });
    loadVersions();
  };

  const saveVersion = async () => {
    await persist({ title, hook, caption, hashtags: tags.split(",").map((s) => s.trim()).filter(Boolean) });
    await snapshot("edited");
  };

  const setStage = async (next: string, extra: Record<string, any> = {}, label?: string) => {
    setStatus(next);
    await persist({ status: next, ...extra });
    await snapshot(label ?? next);
  };

  const schedule = async () => {
    if (!sched) return;
    await setStage("scheduled", { scheduled_for: new Date(sched).toISOString() }, "scheduled");
  };

  const requestChanges = async () => {
    await persist({ review_note: note });
    await setStage("changes", { review_note: note }, "changes");
  };

  const restore = async (v: Version) => {
    setTitle(v.title || ""); setHook(v.hook || ""); setCaption(v.caption || ""); setTags((v.hashtags || []).join(", "));
    chRef.current?.send({ type: "broadcast", event: "patch", payload: { by: me.id, field: "caption", value: v.caption || "" } });
    await persist({ title: v.title, hook: v.hook, caption: v.caption, hashtags: v.hashtags || [] });
    await snapshot("restored");
  };

  const draft = async () => {
    if (!supabase || drafting || !brief.trim()) return;
    setDrafting(true); setOptions([]);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/caption", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ brief, kind: item?.kind, channel: item?.channel }) });
      const j = await r.json();
      if (j.ok) setOptions(j.options ?? []);
    } catch { /* */ }
    setDrafting(false);
  };

  const useOption = (o: any) => {
    edit("title", o.title || title); edit("hook", o.hook || ""); edit("caption", o.caption || "");
    edit("tags", (o.hashtags || []).join(", ")); setOptions([]); setBrief("");
  };

  const setMeta = async (field: "kind" | "channel", value: string) => {
    setItem((it) => it ? { ...it, [field]: value } : it);
    await persist({ [field]: value });
  };

  if (!item) return <div className="adm-sec"><div className="oa-empty">Loading…</div></div>;

  return (
    <div className="adm-sec">
      <div className="studio-top">
        <button type="button" className="studio-back" onClick={onClose}>‹ Studio</button>
        <div className="studio-presence">
          <span className={`st-pill ${STATUS[status]?.cls ?? ""}`}>{STATUS[status]?.label ?? status}</span>
          {peers.map((p) => <span key={p.id} className="studio-peer" title={`${p.name} is here`}>{p.name.slice(0, 1).toUpperCase()}</span>)}
          {savedAt && <span className="studio-saved">Saved {savedAt}</span>}
        </div>
      </div>

      <div className="studio-meta">
        <select className="insp-in" value={item.kind} onChange={(e) => setMeta("kind", e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <select className="insp-in" value={item.channel} onChange={(e) => setMeta("channel", e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </div>

      <input className="studio-title" value={title} onChange={(e) => edit("title", e.target.value)} placeholder="Title" />
      <input className="studio-hook" value={hook} onChange={(e) => edit("hook", e.target.value)} placeholder="Hook — the scroll-stopping first line" />
      <textarea className="studio-caption" value={caption} onChange={(e) => edit("caption", e.target.value)} rows={7} placeholder="Caption…" />
      <input className="studio-tags" value={tags} onChange={(e) => edit("tags", e.target.value)} placeholder="hashtags, comma, separated" />

      {/* Caption engine */}
      <div className="studio-engine">
        <div className="insp-lbl">✨ Caption engine</div>
        <div className="oa-input">
          <input value={brief} onChange={(e) => setBrief(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") draft(); }} placeholder="Brief — e.g. 'promote Saturday market; lead with why no oxalates'" />
          <button type="button" className="oa-send" onClick={draft} disabled={drafting || !brief.trim()}>{drafting ? "Drafting…" : "Draft"}</button>
        </div>
        {options.map((o, i) => (
          <div key={i} className="studio-opt">
            <div className="studio-opt-t">{o.hook}</div>
            <div className="studio-opt-c">{o.caption}</div>
            {o.hashtags?.length ? <div className="studio-opt-h">{o.hashtags.map((h: string) => `#${h}`).join(" ")}</div> : null}
            <button type="button" className="insp-yes" onClick={() => useOption(o)}>Use this</button>
          </div>
        ))}
      </div>

      {/* Schedule + workflow */}
      <div className="studio-sched">
        <input type="datetime-local" className="insp-in" value={sched} onChange={(e) => setSched(e.target.value)} />
        <button type="button" className="studio-act" onClick={schedule} disabled={!sched}>Schedule</button>
      </div>

      <div className="studio-actions">
        <button type="button" className="studio-act" onClick={saveVersion}>✓ Save version</button>
        {status === "draft" && <button type="button" className="studio-act primary" onClick={() => setStage("review", {}, "submitted")}>Submit for review</button>}
        {(status === "review" || status === "changes") && <button type="button" className="studio-act primary" onClick={() => setStage("approved", { approved_by: me.id }, "approved")}>Approve</button>}
        {status === "review" && (
          <span className="studio-changes">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change…" />
            <button type="button" className="studio-act" onClick={requestChanges} disabled={!note.trim()}>Request changes</button>
          </span>
        )}
        {(status === "approved" || status === "scheduled") && <button type="button" className="studio-act" onClick={() => setStage("published", {}, "published")}>Mark published</button>}
        <button type="button" className="studio-act ghost" onClick={() => setShowVers((s) => !s)}>History ({versions.length})</button>
      </div>
      {status === "changes" && item.review_note && <p className="insp-foot">Requested: {item.review_note}</p>}

      {showVers && (
        <div className="studio-vers">
          {versions.length === 0 ? <div className="oa-empty">No versions yet — Save version to checkpoint.</div> : versions.map((v) => (
            <div key={v.id} className="studio-ver">
              <span className="studio-ver-t"><b>{v.label}</b> · {fmtDate(v.created_at)}{v.caption ? ` · ${v.caption.slice(0, 60)}` : ""}</span>
              <button type="button" className="insp-no" onClick={() => restore(v)}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
