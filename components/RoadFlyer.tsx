"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";

// ROAD FLYER — the locked GT3 Grid graphics, drawn on a canvas so they're pixel-identical every
// time. Three templates that read as a set (Announce · Menu · Photo) cover the whole drop. Pick an
// event → it fills the data → add a photo → Download PNG or Save straight to the feed (ready to
// schedule). No Canva, no blank canvas, no drift.

const W = 1080, H = 1350, M = 76;
const INK = "#1A1310", RED = "#B82420", CREAM = "#F5F1E8", MUT = "rgba(26,19,16,.55)";
type Tile = "announce" | "menu" | "photo";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function dateLine(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return "";
  return `${DOW[d.getDay()]} · ${MON[d.getMonth()]} ${d.getDate()}`;
}
const DEFAULT_MENU = "3 COLD BREWS\nRise · Flow · Dusk\n\nSPECIALTY\nKing Me Nitro Cold Brew\nSalted Maple Latte\nNature's Aid Hydration";

export default function RoadFlyer() {
  const { toast } = useApp();
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [opts, setOpts] = useState<{ key: string; label: string; date: string; time: string; place: string; address: string }[]>([]);
  const [tile, setTile] = useState<Tile>("announce");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ headline1: "FIND US", headline2: "ON THE ROAD", date: "", time: "", place: "", address: "", photo: "", menu: DEFAULT_MENU });

  useEffect(() => {
    if (!supabase) return;
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      supabase.from("events").select("id,title,day,start_time,end_time,location_text").is("archived_at", null).gte("day", today).order("day").limit(20),
      supabase.from("stops").select("id,name,starts_at,when_label,time_label,location_text,address").is("archived_at", null).neq("status", "done").order("starts_at").limit(20),
    ]).then(([e, s]) => {
      const ev = ((e.data as any[]) ?? []).map((x) => ({ key: `e:${x.id}`, label: `🎪 ${x.title}`, date: dateLine(x.day), time: [x.start_time, x.end_time].filter(Boolean).join("–"), place: x.title || "", address: x.location_text || "" }));
      const st = ((s.data as any[]) ?? []).map((x) => ({ key: `s:${x.id}`, label: `🚚 ${x.name}`, date: x.starts_at ? dateLine(x.starts_at) : (x.when_label || ""), time: x.time_label || "", place: x.name || "", address: x.address || x.location_text || "" }));
      setOpts([...ev, ...st]);
    });
  }, []);
  const pick = (key: string) => { const o = opts.find((x) => x.key === key); if (o) setF((p) => ({ ...p, date: o.date, time: o.time, place: o.place, address: o.address })); };

  const uploadPhoto = async (file: File) => {
    if (!supabase) return; setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `flyer/${new Date().getTime()}.${ext}`;
    const up = await supabase.storage.from("content").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (up.error) { toast(`Upload failed — ${up.error.message}`, "error"); setBusy(false); return; }
    setF((p) => ({ ...p, photo: supabase!.storage.from("content").getPublicUrl(path).data.publicUrl })); setBusy(false);
  };

  const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const cover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => { const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); };

  const footer = (ctx: CanvasRenderingContext2D, onPhoto = false) => {
    ctx.textAlign = "left";
    ctx.font = "900 40px 'Archivo Black', system-ui"; ctx.fillStyle = RED; ctx.fillText("GT3", M, H - 70);
    ctx.font = "500 22px 'DM Mono', monospace"; ctx.fillStyle = onPhoto ? "#fff" : INK; ctx.fillText("PERFORMANCE BAR", M + 96, H - 76);
    ctx.textAlign = "right";
    ctx.font = "900 30px 'Archivo Black', system-ui"; ctx.fillStyle = onPhoto ? "#fff" : INK; ctx.fillText("PURE SIGNAL.", W - M, H - 96);
    ctx.fillStyle = RED; ctx.fillText("NO NOISE.", W - M, H - 60); ctx.textAlign = "left";
  };
  const checker = (ctx: CanvasRenderingContext2D) => { const cs = 26; for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) { ctx.fillStyle = INK; ctx.fillRect(M + c * cs, M + r * cs, cs, cs); } };

  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return; const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await Promise.all([document.fonts.load("900 120px 'Archivo Black'"), document.fonts.load("700 56px Inter"), document.fonts.load("500 24px 'DM Mono'")]); } catch { /* */ }
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

    if (tile === "photo") {
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      const img = f.photo ? await loadImg(f.photo) : null;
      if (img) cover(ctx, img, 0, 0, W, H); else { ctx.fillStyle = "#2a241c"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = MUT; ctx.font = "500 28px 'DM Mono'"; ctx.textAlign = "center"; ctx.fillText("ADD A PHOTO", W / 2, H / 2); ctx.textAlign = "left"; }
      const g = ctx.createLinearGradient(0, H - 560, 0, H); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.82)"); ctx.fillStyle = g; ctx.fillRect(0, H - 560, W, 560);
      ctx.font = "900 104px 'Archivo Black', system-ui"; ctx.fillStyle = "#fff"; ctx.fillText((f.headline1 || "").toUpperCase(), M, H - 290);
      ctx.fillStyle = RED; ctx.fillText((f.headline2 || "").toUpperCase(), M, H - 290 + 106);
      footer(ctx, true); return;
    }

    ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H); checker(ctx);

    if (tile === "menu") {
      ctx.font = "900 116px 'Archivo Black', system-ui"; ctx.fillStyle = INK; ctx.fillText("THE", M, M + 230); ctx.fillStyle = RED; ctx.fillText("MENU", M, M + 230 + 118);
      ctx.fillStyle = RED; ctx.fillRect(M, M + 400, W - 2 * M, 6);
      let y = M + 500;
      for (const raw of f.menu.split("\n")) {
        const line = raw.trim();
        if (!line) { y += 26; continue; }
        const isHead = line === line.toUpperCase() && line.length < 22;
        if (isHead) { ctx.font = "500 28px 'DM Mono', monospace"; ctx.fillStyle = RED; ctx.fillText(line, M, y); y += 52; }
        else { ctx.font = "700 46px Inter, system-ui"; ctx.fillStyle = INK; ctx.fillText(line, M, y); y += 64; }
      }
      ctx.font = "italic 700 34px Inter, system-ui"; ctx.fillStyle = "#9a7b3a"; ctx.fillText("Served in a glass bottle", M, H - 200);
      footer(ctx); return;
    }

    // announce
    ctx.font = "900 116px 'Archivo Black', system-ui"; ctx.fillStyle = INK; ctx.fillText((f.headline1 || "").toUpperCase(), M, M + 230);
    ctx.fillStyle = RED; ctx.fillText((f.headline2 || "").toUpperCase(), M, M + 230 + 118);
    ctx.fillStyle = RED; ctx.fillRect(M, M + 400, W - 2 * M, 6);
    let y = M + 500;
    const label = (t: string) => { ctx.font = "500 26px 'DM Mono', monospace"; ctx.fillStyle = MUT; ctx.fillText(t, M, y); y += 44; };
    const big = (t: string, color = INK, size = 60) => { ctx.font = `700 ${size}px Inter, system-ui`; ctx.fillStyle = color; ctx.fillText(t, M, y); y += size + 14; };
    const small = (t: string) => { ctx.font = "400 32px Inter, system-ui"; ctx.fillStyle = MUT; ctx.fillText(t, M, y); y += 46; };
    if (f.date || f.time) { label("WHEN"); if (f.date) big(f.date); if (f.time) big(f.time, RED, 50); y += 12; }
    if (f.place || f.address) { label("WHERE"); if (f.place) big(f.place, INK, 50); if (f.address) small(f.address); }
    const px = M, pw = W - 2 * M, ph = 380, py = H - ph - 150;
    rr(ctx, px, py, pw, ph, 28);
    const img = f.photo ? await loadImg(f.photo) : null;
    if (img) { ctx.save(); rr(ctx, px, py, pw, ph, 28); ctx.clip(); cover(ctx, img, px, py, pw, ph); ctx.restore(); }
    else { ctx.fillStyle = "#ece4d3"; ctx.fill(); ctx.font = "500 26px 'DM Mono'"; ctx.fillStyle = MUT; ctx.textAlign = "center"; ctx.fillText("ADD A PHOTO", W / 2, py + ph / 2 + 8); ctx.textAlign = "left"; }
    footer(ctx);
  }, [f, tile]);

  useEffect(() => { draw(); }, [draw]);

  const toBlob = () => new Promise<Blob | null>((res) => canvasRef.current?.toBlob(res, "image/png"));
  const download = async () => {
    await draw(); const blob = await toBlob();
    if (!blob) { toast("Export failed — try a different photo.", "error"); return; }
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `gt3-${tile}-${(f.place || "stop").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const saveToFeed = async () => {
    if (!supabase) return; setBusy(true);
    await draw(); const blob = await toBlob();
    if (!blob) { toast("Couldn't render — try a different photo.", "error"); setBusy(false); return; }
    const path = `flyer/feed-${new Date().getTime()}.png`;
    const up = await supabase.storage.from("content").upload(path, blob, { upsert: true, contentType: "image/png" });
    if (up.error) { toast(`Save failed — ${up.error.message}`, "error"); setBusy(false); return; }
    const mediaUrl = supabase.storage.from("content").getPublicUrl(path).data.publicUrl;
    const caption = tile === "menu" ? "The menu — every bottle made to order." : f.place ? `Find us on the road — ${f.place}${f.date ? ` · ${f.date}` : ""}${f.time ? ` · ${f.time}` : ""}.` : "Find us on the road.";
    const { error } = await supabase.from("content_items").insert({ title: `${f.place || "Road"} — ${tile}`, kind: "post", caption, media: [{ url: mediaUrl, type: "image" }], media_url: mediaUrl, media_type: "image", created_by: user?.id ?? null, updated_by: user?.id ?? null });
    setBusy(false);
    toast(error ? `Save failed — ${error.message}` : "Saved to the feed — schedule it in Board/Grid");
  };

  const field = (k: keyof typeof f, label: string, ph: string) => (
    <label className="rf-f"><span>{label}</span><input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={ph} /></label>
  );

  return (
    <div className="rf">
      <div className="rf-tiles">
        {([["announce", "Announce"], ["menu", "Menu"], ["photo", "Photo"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={`rf-tile${tile === k ? " on" : ""}`} onClick={() => setTile(k)}>{l}</button>
        ))}
      </div>
      <div className="rf-note">Pick a stop to fill it in, tweak, add a photo. Same locked design every time — download or save to the feed.</div>
      {opts.length > 0 && tile !== "menu" && (
        <select className="rf-pick" defaultValue="" onChange={(e) => e.target.value && pick(e.target.value)}>
          <option value="">⚡ Prefill from an event / stop…</option>
          {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      )}
      {tile === "announce" && <><div className="rf-grid2">{field("date", "When (day)", "WED · JUL 1")}{field("time", "Time", "6–10 AM")}</div>{field("place", "Place", "Wine Xpress · Five Forks")}{field("address", "Address", "202 Scuffletown Rd, Simpsonville SC")}</>}
      {tile === "photo" && <div className="rf-grid2">{field("headline1", "Headline 1", "WORLD'S FIRST")}{field("headline2", "Headline 2 (red)", "NET+ MOBILE BAR")}</div>}
      {tile === "menu" && <label className="rf-f"><span>Menu (one per line; ALL-CAPS = a header)</span><textarea rows={7} value={f.menu} onChange={(e) => setF((p) => ({ ...p, menu: e.target.value }))} /></label>}
      {tile !== "menu" && (
        <div className="rf-photo">
          <button type="button" className="rf-btn" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Working…" : f.photo ? "Replace photo" : "＋ Add photo"}</button>
          {f.photo && <button type="button" className="rf-btn ghost" onClick={() => setF((p) => ({ ...p, photo: "" }))}>Remove</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadPhoto(file); e.target.value = ""; }} />
        </div>
      )}
      <canvas ref={canvasRef} width={W} height={H} className="rf-canvas" />
      <div className="rf-actions">
        <button type="button" className="rf-dl ghost" onClick={download}>⬇ Download</button>
        <button type="button" className="rf-dl" onClick={saveToFeed} disabled={busy}>{busy ? "Saving…" : "✦ Save to feed"}</button>
      </div>
    </div>
  );
}
