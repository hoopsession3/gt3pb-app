"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";

// ROAD FLYER — the locked "Find Us On The Road" graphic, drawn to the GT3 Grid spec on a canvas so
// it's pixel-identical every time. Pick an event/stop → it fills date · time · place · address →
// add one photo → export a clean 1080×1350 PNG to post. No Canva, no blank canvas, no typos.

const W = 1080, H = 1350, M = 76;
const INK = "#1A1310", RED = "#B82420", CREAM = "#F5F1E8", MUT = "rgba(26,19,16,.55)";

type Picker = { key: string; label: string; date: string; time: string; place: string; address: string };

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function dateLine(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return "";
  return `${DOW[d.getDay()]} · ${MON[d.getMonth()]} ${d.getDate()}`;
}

export default function RoadFlyer() {
  const { toast } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opts, setOpts] = useState<Picker[]>([]);
  const [f, setF] = useState({ headline1: "FIND US", headline2: "ON THE ROAD", date: "", time: "", place: "", address: "", photo: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // upcoming events + stops to prefill from
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
    if (!supabase) return;
    setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `flyer/${new Date().getTime()}.${ext}`;
    const up = await supabase.storage.from("content").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (up.error) { toast(`Upload failed — ${up.error.message}`, "error"); setBusy(false); return; }
    setF((p) => ({ ...p, photo: supabase!.storage.from("content").getPublicUrl(path).data.publicUrl }));
    setBusy(false);
  };

  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await Promise.all([document.fonts.load("900 120px 'Archivo Black'"), document.fonts.load("700 56px Inter"), document.fonts.load("500 24px 'DM Mono'")]); } catch { /* */ }

    ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H);
    // checker accent — top-left, used once
    const cs = 26;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { if ((r + c) % 2 === 0) { ctx.fillStyle = INK; ctx.fillRect(M + c * cs, M + r * cs, cs, cs); } }

    // headline
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.font = "900 116px 'Archivo Black', system-ui";
    ctx.fillStyle = INK; ctx.fillText(f.headline1.toUpperCase(), M, M + 230);
    ctx.fillStyle = RED; ctx.fillText(f.headline2.toUpperCase(), M, M + 230 + 118);
    // red rule
    ctx.fillStyle = RED; ctx.fillRect(M, M + 400, W - 2 * M, 6);

    // info block
    let y = M + 500;
    const label = (t: string) => { ctx.font = "500 26px 'DM Mono', monospace"; ctx.fillStyle = MUT; ctx.fillText(t, M, y); y += 44; };
    const big = (t: string, color = INK, size = 60) => { ctx.font = `700 ${size}px Inter, system-ui`; ctx.fillStyle = color; ctx.fillText(t, M, y); y += size + 14; };
    const small = (t: string) => { ctx.font = "400 32px Inter, system-ui"; ctx.fillStyle = MUT; ctx.fillText(t, M, y); y += 46; };
    if (f.date || f.time) { label("WHEN"); if (f.date) big(f.date); if (f.time) big(f.time, RED, 50); y += 12; }
    if (f.place || f.address) { label("WHERE"); if (f.place) big(f.place, INK, 50); if (f.address) small(f.address); }

    // photo panel (bottom band)
    const px = M, pw = W - 2 * M, ph = 380, py = H - ph - 150;
    const rr = (x: number, yy: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.moveTo(x + r, yy); ctx.arcTo(x + w, yy, x + w, yy + h, r); ctx.arcTo(x + w, yy + h, x, yy + h, r); ctx.arcTo(x, yy + h, x, yy, r); ctx.arcTo(x, yy, x + w, yy, r); ctx.closePath(); };
    rr(px, py, pw, ph, 28);
    if (f.photo) {
      await new Promise<void>((res) => {
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => { ctx.save(); rr(px, py, pw, ph, 28); ctx.clip(); const s = Math.max(pw / img.width, ph / img.height); const dw = img.width * s, dh = img.height * s; ctx.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh); ctx.restore(); res(); };
        img.onerror = () => { ctx.fillStyle = "#ece4d3"; ctx.fill(); res(); };
        img.src = f.photo;
      });
    } else { ctx.fillStyle = "#ece4d3"; ctx.fill(); ctx.font = "500 26px 'DM Mono'"; ctx.fillStyle = MUT; ctx.textAlign = "center"; ctx.fillText("ADD A PHOTO", W / 2, py + ph / 2 + 8); ctx.textAlign = "left"; }

    // footer lockup
    ctx.font = "900 40px 'Archivo Black', system-ui"; ctx.fillStyle = RED; ctx.fillText("GT3", M, H - 70);
    ctx.font = "500 22px 'DM Mono', monospace"; ctx.fillStyle = INK; ctx.fillText("PERFORMANCE BAR", M + 96, H - 76);
    ctx.font = "900 30px 'Archivo Black', system-ui"; ctx.textAlign = "right"; ctx.fillStyle = INK; ctx.fillText("PURE SIGNAL.", W - M, H - 96); ctx.fillStyle = RED; ctx.fillText("NO NOISE.", W - M, H - 60); ctx.textAlign = "left";
  }, [f]);

  useEffect(() => { draw(); }, [draw]);

  const download = async () => {
    const cv = canvasRef.current; if (!cv) return;
    await draw();
    cv.toBlob((blob) => {
      if (!blob) { toast("Export failed — try a different photo (must allow sharing).", "error"); return; }
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `gt3-road-flyer-${f.place.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "stop"}.png`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, "image/png");
  };

  const field = (k: keyof typeof f, label: string, ph: string) => (
    <label className="rf-f"><span>{label}</span><input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={ph} /></label>
  );

  return (
    <div className="rf">
      <div className="rf-note">Pick a stop to fill it in, tweak if needed, add a photo, download. Same locked design every time.</div>
      {opts.length > 0 && (
        <select className="rf-pick" defaultValue="" onChange={(e) => e.target.value && pick(e.target.value)}>
          <option value="">⚡ Prefill from an event / stop…</option>
          {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      )}
      <div className="rf-grid2">{field("date", "When (day)", "WED · JUL 1")}{field("time", "Time", "6–10 AM")}</div>
      {field("place", "Place", "Wine Xpress · Five Forks")}
      {field("address", "Address", "202 Scuffletown Rd, Simpsonville SC")}
      <div className="rf-photo">
        <button type="button" className="rf-btn" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Uploading…" : f.photo ? "Replace photo" : "＋ Add photo"}</button>
        {f.photo && <button type="button" className="rf-btn ghost" onClick={() => setF((p) => ({ ...p, photo: "" }))}>Remove</button>}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadPhoto(file); e.target.value = ""; }} />
      </div>
      <canvas ref={canvasRef} width={W} height={H} className="rf-canvas" />
      <button type="button" className="rf-dl" onClick={download}>⬇ Download flyer (PNG)</button>
    </div>
  );
}
