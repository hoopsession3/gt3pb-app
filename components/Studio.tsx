"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import BrandCalendar from "./BrandCalendar";
import BrandKit from "./BrandKit";

// STUDIO — the collaborative marketing studio. Her money-maker, his taste → built around
// collaboration: real-time co-editing (Supabase Realtime presence + broadcast), real version
// history, scheduling, titles, status/approval, and a suave on-brand caption engine.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Item = {
  id: string; kind: string; channel: string; title: string; hook: string | null; caption: string | null;
  hashtags: string[]; status: string; review_note: string | null; scheduled_for: string | null;
  updated_at: string; updated_by: string | null; event_id?: string | null; created_by?: string | null;
  canva_design_id?: string | null; canva_edit_url?: string | null; export_url?: string | null; published_url?: string | null;
  media_url?: string | null; media_type?: string | null; media?: { url: string; type: string }[] | null;
};
type Version = { id: string; title: string | null; hook: string | null; caption: string | null; hashtags: string[] | null; status: string | null; label: string | null; edited_by: string | null; created_at: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "st-draft" }, review: { label: "In review", cls: "st-review" },
  changes: { label: "Changes", cls: "st-changes" }, approved: { label: "Approved", cls: "st-approved" },
  scheduled: { label: "Scheduled", cls: "st-scheduled" }, published: { label: "Published", cls: "st-published" },
};
const KINDS = ["post", "carousel", "reel", "story", "caption", "email", "menu_card", "promo", "blog"];
// Format → the real frame aspect ratio + label, so the mockup matches what posts on the platform.
const FORMATS: Record<string, { ratio: string; label: string }> = {
  post: { ratio: "4 / 5", label: "Post · 4:5" }, carousel: { ratio: "4 / 5", label: "Carousel · 4:5" },
  reel: { ratio: "9 / 16", label: "Reel · 9:16" }, story: { ratio: "9 / 16", label: "Story · 9:16" },
  menu_card: { ratio: "1 / 1", label: "1:1" }, promo: { ratio: "1 / 1", label: "1:1" },
};
const fmtFor = (kind: string) => FORMATS[kind] ?? { ratio: "1 / 1", label: "1:1" };
const CHANNELS = ["instagram", "tiktok", "site", "email", "print", "other"];
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function Studio() {
  const { user, profile } = useAuth();
  const me = useMemo(() => ({ id: user?.id ?? "anon", name: profile?.display_name || user?.email?.split("@")[0] || "Crew" }), [user?.id, profile?.display_name, user?.email]);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "board" | "grid" | "brand">(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem("gt3-studio-view") : null;
    return v === "board" || v === "brand" || v === "grid" ? v : "calendar";
  });

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

  const create = async (scheduledISO?: string, eventId?: string | null) => {
    if (!supabase) return;
    const { data } = await supabase.from("content_items").insert({ title: "Untitled", created_by: me.id, updated_by: me.id, scheduled_for: scheduledISO ?? null, event_id: eventId ?? null }).select("id").single();
    if (data?.id) { await load(); setOpenId(data.id); }
  };
  const pickView = (v: "calendar" | "board" | "grid" | "brand") => { setView(v); if (typeof window !== "undefined") localStorage.setItem("gt3-studio-view", v); };

  if (openId) return <StudioEditor id={openId} me={me} onClose={() => { setOpenId(null); load(); }} />;

  const shown = filter === "all" ? items : items.filter((i) => i.status === filter);
  return (
    <div className="adm-sec">
      <div className="studio-top">
        <div className="studio-views" role="tablist" aria-label="View">
          <button type="button" className={`studio-view${view === "calendar" ? " on" : ""}`} onClick={() => pickView("calendar")}>Calendar</button>
          <button type="button" className={`studio-view${view === "board" ? " on" : ""}`} onClick={() => pickView("board")}>Board</button>
          <button type="button" className={`studio-view${view === "grid" ? " on" : ""}`} onClick={() => pickView("grid")}>Grid</button>
          <button type="button" className={`studio-view${view === "brand" ? " on" : ""}`} onClick={() => pickView("brand")}>Brand</button>
        </div>
        {view !== "brand" && <button type="button" className="rdy-run" onClick={() => create()}>✦ New piece</button>}
      </div>

      {view === "brand" ? (
        <BrandKit canEdit />
      ) : view === "calendar" ? (
        <BrandCalendar onOpen={setOpenId} onCreate={(iso, evId) => create(iso, evId)} />
      ) : view === "grid" ? (
        <>
          <div className="subnav" role="tablist" aria-label="Filter">
            {["all", ...Object.keys(STATUS)].map((k) => (
              <button key={k} type="button" className={`subnav-tab${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>{k === "all" ? "All" : STATUS[k].label}</button>
            ))}
          </div>
          <div className="ig-note">📱 Instagram feed preview — newest top-left. Tap a tile to open it.</div>
          {shown.length === 0 ? (
            <div className="oa-empty" style={{ padding: "28px 8px" }}>No pieces yet — add a design (export the PNG from Canva) and it shows in the grid.</div>
          ) : (
            <div className="ig-grid">
              {[...shown].sort((a, b) => (b.scheduled_for || b.updated_at).localeCompare(a.scheduled_for || a.updated_at)).map((it) => {
                const img = (it.media_type !== "video" && it.media_url) || it.export_url || null;
                const vid = it.media_type === "video" ? it.media_url : null;
                return (
                  <button key={it.id} type="button" className="ig-cell" onClick={() => setOpenId(it.id)}
                    style={img ? { backgroundImage: `url(${img})` } : undefined} aria-label={it.title || "Untitled"}>
                    {vid && <video className="ig-vid" src={vid} muted playsInline preload="metadata" />}
                    {!img && !vid && <span className="ig-ph"><b>{it.title || "Untitled"}</b><span>{STATUS[it.status]?.label ?? it.status}</span></span>}
                    {vid && <span className="ig-reel">▶</span>}
                    {(it.media?.length ?? 0) > 1 && <span className="ig-multi">▦</span>}
                    {(img || vid) && it.status !== "published" && <span className="ig-tag">{STATUS[it.status]?.label ?? it.status}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

function StudioEditor({ id, me, onClose }: { id: string; me: { id: string; name: string }; onClose: () => void }) {
  const [item, setItem] = useState<Item | null>(null);
  const [title, setTitle] = useState(""); const [hook, setHook] = useState(""); const [caption, setCaption] = useState("");
  const [tags, setTags] = useState(""); const [status, setStatus] = useState("draft");
  const [sched, setSched] = useState(""); const [note, setNote] = useState("");
  const [eventId, setEventId] = useState<string>(""); const [evs, setEvs] = useState<{ id: string; title: string | null; day: string | null; day_label: string | null }[]>([]);
  const [peers, setPeers] = useState<{ id: string; name: string }[]>([]);
  const [savedAt, setSavedAt] = useState<string>("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVers, setShowVers] = useState(false);
  // caption engine
  const [brief, setBrief] = useState(""); const [drafting, setDrafting] = useState(false);
  const [options, setOptions] = useState<any[]>([]);
  // Canva + Webflow muscle
  const [pub, setPub] = useState<{ edit: string | null; png: string | null; live: string | null }>({ edit: null, png: null, live: null });
  const [pubBusy, setPubBusy] = useState(""); const [pubErr, setPubErr] = useState("");
  const [campBusy, setCampBusy] = useState(false);
  const [mediaList, setMediaList] = useState<{ url: string; type: string }[]>([]);
  const [active, setActive] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chRef = useRef<any>(null);
  const saveTimer = useRef<any>(null);
  // Live identity for the realtime channel — read inside the subscribe effect so identity churn
  // (auth/profile refresh, co-editor join, dev HMR) never re-keys the studio-${id} socket.
  const meRef = useRef(me); useEffect(() => { meRef.current = me; }, [me]);

  const loadVersions = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("content_versions").select("*").eq("content_id", id).order("created_at", { ascending: false }).limit(40);
    setVersions((data as Version[]) ?? []);
  }, [id]);

  // Load the piece + its versions when the editor opens (or the piece changes).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from("content_items").select("*").eq("id", id).single().then(({ data }) => {
      if (cancelled || !data) return;
      const it = data as Item;
      setItem(it); setTitle(it.title || ""); setHook(it.hook || ""); setCaption(it.caption || "");
      setTags((it.hashtags || []).join(", ")); setStatus(it.status); setNote(it.review_note || "");
      setSched(it.scheduled_for ? new Date(it.scheduled_for).toISOString().slice(0, 16) : "");
      setPub({ edit: it.canva_edit_url ?? null, png: it.export_url ?? null, live: it.published_url ?? null });
      const ml = Array.isArray((it as any).media) && (it as any).media.length
        ? ((it as any).media as { url: string; type: string }[])
        : (it.media_url ? [{ url: it.media_url, type: it.media_type || "image" }] : []);
      setMediaList(ml); setActive(0);
      setEventId(it.event_id ?? "");
    });
    loadVersions();
    return () => { cancelled = true; };
  }, [id, loadVersions]);

  // Real-time co-editing: presence (who's here) + broadcast (live field patches). Subscribes EXACTLY
  // once per piece (deps [id]); identity is read from meRef.current so churn never re-keys the socket.
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel(`studio-${id}`, { config: { presence: { key: meRef.current.id } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState() as any;
      const list = Object.values(state).flat().map((p: any) => ({ id: p.id, name: p.name }));
      setPeers(list.filter((p: any) => p.id !== meRef.current.id));
    });
    ch.on("broadcast", { event: "patch" }, ({ payload }: any) => {
      if (payload.by === meRef.current.id) return;
      if (payload.field === "title") setTitle(payload.value);
      else if (payload.field === "hook") setHook(payload.value);
      else if (payload.field === "caption") setCaption(payload.value);
      else if (payload.field === "tags") setTags(payload.value);
    });
    ch.subscribe(async (st: string) => { if (st === "SUBSCRIBED") await ch.track({ id: meRef.current.id, name: meRef.current.name }); });
    chRef.current = ch;
    return () => { supabase?.removeChannel(ch); };
  }, [id]);

  // Events for the relational link (upcoming + a little past).
  useEffect(() => {
    if (!supabase) return;
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    supabase.from("events").select("id, title, day, day_label").is("archived_at", null).gte("day", since).order("day").limit(60).then(({ data }) => setEvs(data ?? []));
  }, []);

  const persist = useCallback(async (patch: Record<string, any>) => {
    if (!supabase) return;
    await supabase.from("content_items").update({ ...patch, updated_by: me.id }).eq("id", id);
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }, [id, me.id]);

  // Save the media array + keep the single cover columns (media_url/type) in sync for the grid.
  const saveMedia = async (list: { url: string; type: string }[]) => {
    setMediaList(list);
    await persist({ media: list, media_url: list[0]?.url ?? null, media_type: list[0]?.type ?? null });
  };
  // Attach post media — one or many photos/videos (carousel). Uploads to the public 'content' bucket.
  const uploadMedia = async (files: FileList) => {
    if (!supabase || !files.length) return;
    setUploading(true);
    const added: { url: string; type: string }[] = [];
    for (const file of Array.from(files)) {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${id}/${new Date().getTime()}-${added.length}.${ext}`;
      const up = await supabase.storage.from("content").upload(path, file, { upsert: true, cacheControl: "3600" });
      if (up.error) { setPubErr(`Upload: ${up.error.message}`); continue; }
      added.push({ url: supabase.storage.from("content").getPublicUrl(path).data.publicUrl, type: file.type.startsWith("video") ? "video" : "image" });
    }
    if (added.length) await saveMedia([...mediaList, ...added]);
    setUploading(false);
  };
  const removeMedia = async (i: number) => {
    const list = mediaList.filter((_, j) => j !== i);
    setActive((a) => Math.max(0, Math.min(a, list.length - 1)));
    await saveMedia(list);
  };
  const makeCover = async (i: number) => { const list = [...mediaList]; const [m] = list.splice(i, 1); await saveMedia([m, ...list]); setActive(0); };

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
    // approval notifications (→ alerts spine → in-app inbox + web push)
    if (!supabase) return;
    const t = (title || "Untitled").slice(0, 80);
    if (next === "review") {
      await supabase.from("alerts").insert({ severity: "important", category: "note", title: `🎨 Content ready for review — ${t}`.slice(0, 180), body: `${me.name} submitted "${t}" for approval.`.slice(0, 300), link: "/admin" });
    } else if (next === "approved" && item?.created_by && item.created_by !== me.id) {
      await supabase.from("alerts").insert({ severity: "fyi", category: "note", title: `✅ Approved — ${t}`.slice(0, 180), body: `${me.name} approved "${t}". Ready to schedule/publish.`.slice(0, 300), link: "/admin", target_user_id: item.created_by });
    } else if (next === "changes" && item?.created_by && item.created_by !== me.id) {
      await supabase.from("alerts").insert({ severity: "important", category: "note", title: `✏️ Changes requested — ${t}`.slice(0, 180), body: (extra.review_note ? String(extra.review_note) : `${me.name} requested changes on "${t}".`).slice(0, 300), link: "/admin", target_user_id: item.created_by });
    }
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

  const callStudio = async (path: string, body: any) => {
    const token = (await supabase!.auth.getSession()).data.session?.access_token;
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return r.json();
  };
  const makeCanva = async () => {
    if (!supabase || pubBusy) return;
    setPubBusy("design"); setPubErr("");
    const j = await callStudio("/api/studio/canva", { content_id: id, action: "design" });
    if (j.ok) { setPub((p) => ({ ...p, edit: j.canva_edit_url })); if (j.canva_edit_url) window.open(j.canva_edit_url, "_blank"); }
    else setPubErr(String(j.error ?? "").includes("not configured") ? "Canva isn't connected yet (token + brand template needed)." : `Canva: ${j.error}`);
    setPubBusy("");
  };
  const exportCanva = async () => {
    if (!supabase || pubBusy) return;
    setPubBusy("export"); setPubErr("");
    const j = await callStudio("/api/studio/canva", { content_id: id, action: "export" });
    if (j.ok) setPub((p) => ({ ...p, png: j.export_url })); else setPubErr(`Export: ${j.error}`);
    setPubBusy("");
  };
  const publish = async () => {
    if (!supabase || pubBusy) return;
    if (!window.confirm("Publish this to the live GT3 site?")) return;
    setPubBusy("publish"); setPubErr("");
    const j = await callStudio("/api/studio/publish", { content_id: id });
    if (j.ok) { setPub((p) => ({ ...p, live: j.published_url })); setStatus("published"); loadVersions(); }
    else setPubErr(String(j.error ?? "").includes("not configured") ? "Webflow isn't connected yet (token + site/collection needed)." : `Publish: ${j.error}`);
    setPubBusy("");
  };

  const useOption = (o: any) => {
    const t = o.title || title, h = o.hook || "", cap = o.caption || "", tags = (o.hashtags || []).join(", ");
    setTitle(t); setHook(h); setCaption(cap); setTags(tags);
    chRef.current?.send({ type: "broadcast", event: "patch", payload: { by: me.id, field: "caption", value: cap } });
    persist({ title: t, hook: h, caption: cap, hashtags: (o.hashtags || []) });
    setOptions([]); setBrief("");
  };

  const setMeta = async (field: "kind" | "channel", value: string) => {
    setItem((it) => it ? { ...it, [field]: value } : it);
    await persist({ [field]: value });
  };

  // ── Relational helpers: when a piece is tied to an event, plan the campaign around it ──
  const linkedEv = useMemo(() => evs.find((e) => e.id === eventId), [evs, eventId]);
  const scheduleRel = async (offsetDays: number) => {
    if (!linkedEv?.day) return;
    const [y, m, d] = linkedEv.day.split("-").map(Number);
    const dt = new Date(y, m - 1, d + offsetDays, 9, 0);
    setSched(dt.toISOString().slice(0, 16));
    await persist({ scheduled_for: dt.toISOString() });
  };
  const briefFromEvent = () => {
    if (!linkedEv) return;
    setBrief(`Promote ${linkedEv.title || "our event"}${linkedEv.day_label ? ` (${linkedEv.day_label})` : ""}. Education-first — lead with the why, sell by talking less.`);
  };
  const genCampaign = async () => {
    if (!supabase || !eventId || campBusy) return;
    if (!window.confirm("Generate a teaser + day-of + recap for this event? Three drafts will be added to the calendar.")) return;
    setCampBusy(true); setPubErr("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/campaign", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ event_id: eventId, channel: item?.channel }) });
      const j = await r.json();
      if (j.ok) onClose(); // back to the calendar to see the arc laid out
      else setPubErr(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key." : `Campaign: ${j.error}`);
    } catch { setPubErr("Couldn't reach the campaign agent."); }
    setCampBusy(false);
  };

  if (!item) return <div className="adm-sec"><div className="oa-empty">Loading…</div></div>;
  const cur = mediaList[active] || mediaList[0] || null;

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
        <select className="insp-in" value={eventId} onChange={(e) => { setEventId(e.target.value); persist({ event_id: e.target.value || null }); }} title="Link this piece to an event (optional)">
          <option value="">🔗 No event</option>
          {evs.map((ev) => <option key={ev.id} value={ev.id}>🔗 {ev.day_label || ev.day || ""} · {ev.title || "Event"}</option>)}
        </select>
      </div>

      {linkedEv && (
        <div className="studio-rel">
          <span className="studio-rel-l">🔗 Tied to <b>{linkedEv.title || "Event"}</b>{linkedEv.day_label ? ` · ${linkedEv.day_label}` : ""}</span>
          <div className="studio-rel-chips">
            <span className="studio-rel-cap">Schedule:</span>
            <button type="button" onClick={() => scheduleRel(-7)}>−1 wk</button>
            <button type="button" onClick={() => scheduleRel(-3)}>Teaser −3d</button>
            <button type="button" onClick={() => scheduleRel(-1)}>Day before</button>
            <button type="button" onClick={() => scheduleRel(0)}>Day of</button>
            <button type="button" onClick={() => scheduleRel(1)}>Recap +1d</button>
            <button type="button" className="rel-draft" onClick={briefFromEvent}>✨ Draft from event</button>
            <button type="button" className="rel-camp" onClick={genCampaign} disabled={campBusy}>{campBusy ? "Building…" : "⚡ Generate campaign"}</button>
          </div>
        </div>
      )}

      {/* Post media + a real, format-accurate mockup (post 4:5 · reel/story 9:16 · carousel slides) */}
      <div className="studio-media">
        <div className="studio-media-fmt">{fmtFor(item.kind).label}{mediaList.length > 1 ? ` · ${mediaList.length} slides` : ""}</div>
        {mediaList.length === 0 ? (
          <button type="button" className="studio-media-add" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : "＋ Add photos / video / reel"}</button>
        ) : (
          <div className="studio-mockup" style={{ aspectRatio: fmtFor(item.kind).ratio }}>
            {cur?.type === "video"
              ? <video className="studio-mockup-m" src={cur.url} controls playsInline />
              : cur && <div className="studio-mockup-m" style={{ backgroundImage: `url(${cur.url})` }} role="img" aria-label="Preview" />}
            {mediaList.length > 1 && <div className="studio-dots">{mediaList.map((_, i) => <span key={i} className={i === active ? "on" : ""} />)}</div>}
            {mediaList.length > 1 && active > 0 && <button type="button" className="studio-nav prev" onClick={() => setActive((a) => a - 1)} aria-label="Previous">‹</button>}
            {mediaList.length > 1 && active < mediaList.length - 1 && <button type="button" className="studio-nav next" onClick={() => setActive((a) => a + 1)} aria-label="Next">›</button>}
          </div>
        )}
        {mediaList.length > 0 && (
          <div className="studio-thumbs">
            {mediaList.map((m, i) => (
              <button type="button" key={i} className={`studio-thumb${i === active ? " on" : ""}`} onClick={() => setActive(i)} style={m.type !== "video" ? { backgroundImage: `url(${m.url})` } : undefined} aria-label={`Slide ${i + 1}`}>
                {m.type === "video" && <video src={m.url} muted playsInline preload="metadata" />}
                {i === 0 && <span className="studio-thumb-cover">Cover</span>}
                <span className="studio-thumb-x" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); removeMedia(i); }} aria-label="Remove">✕</span>
                {i !== 0 && <span className="studio-thumb-cv" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); makeCover(i); }} aria-label="Make cover">★</span>}
              </button>
            ))}
            <button type="button" className="studio-thumb add" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Add more">{uploading ? "…" : "＋"}</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files?.length) uploadMedia(e.target.files); e.target.value = ""; }} />
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
        <button type="button" className="studio-act ghost" onClick={async () => { if (supabase && window.confirm("Delete this piece? This can't be undone.")) { await supabase.from("content_items").delete().eq("id", id); onClose(); } }}>Delete</button>
      </div>
      {status === "changes" && item.review_note && <p className="insp-foot">Requested: {item.review_note}</p>}

      {(status === "approved" || status === "scheduled" || status === "published") && (
        <div className="studio-pub">
          <div className="insp-lbl">Design &amp; publish</div>
          <div className="studio-pub-row">
            <button type="button" className="studio-act" onClick={makeCanva} disabled={!!pubBusy}>{pubBusy === "design" ? "Opening…" : "🎨 Make in Canva"}</button>
            {pub.edit && <a className="studio-act ghost" href={pub.edit} target="_blank" rel="noreferrer">Open design ↗</a>}
            {pub.edit && <button type="button" className="studio-act" onClick={exportCanva} disabled={!!pubBusy}>{pubBusy === "export" ? "Exporting…" : "Export PNG"}</button>}
            {pub.png && <a className="studio-act ghost" href={pub.png} target="_blank" rel="noreferrer">View graphic ↗</a>}
          </div>
          <div className="studio-pub-row">
            <button type="button" className="studio-act primary" onClick={publish} disabled={!!pubBusy}>{pubBusy === "publish" ? "Publishing…" : "🌐 Publish to site"}</button>
            {pub.live && <a className="studio-act ghost" href={pub.live.startsWith("http") ? pub.live : undefined} target="_blank" rel="noreferrer">Live ↗ {pub.live.startsWith("http") ? "" : `(${pub.live})`}</a>}
          </div>
          {pubErr && <p className="insp-foot">{pubErr}</p>}
        </div>
      )}

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
