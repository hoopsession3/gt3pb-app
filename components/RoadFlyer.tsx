"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";

// ROAD FLYER — the locked GT3 house graphics, drawn on a canvas so they're pixel-identical every
// time. A five-slide set that reads as ONE luxury carousel (Announce · Menu · Sub-menu · Details ·
// Photo): refined motorsport — gold hairline framing, a checkered-flag crest, Archivo/Fraunces
// editorial pairing. Pick a stop → it fills the data → tweak → Download PNG or Save to the feed.

const W = 1080, H = 1350, M = 76;
const INK = "#1A1310", RED = "#B82420", CREAM = "#F5F1E8", GOLD = "#A97C3F", MUT = "rgba(26,19,16,.52)";
type Tile = "announce" | "menu" | "submenu" | "details" | "photo";
// carousel position → drives the "01 ⁄ 04" page tag that signals "swipe for more"
const PAGE: Record<Tile, number> = { announce: 1, menu: 2, submenu: 3, details: 4, photo: 0 };
const PAGES = 4;

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function dateLine(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return "";
  return `${DOW[d.getDay()]} · ${MON[d.getMonth()]} ${d.getDate()}`;
}
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const DEFAULT_MENU = "COLD BREW\nRise · Flow · Dusk\n\nESPRESSO\nCortado · Latte · Americano";
const DEFAULT_SUB = "THE RESERVE\nKing Me Nitro Cold Brew\nSalted Maple Latte\n\nSEASONAL\nNature's Aid Hydration\nGoat Milk Chai";
const DEFAULT_DETAILS = "Rise | Bright and citrus-forward. Your morning gear.\nFlow | Smooth, balanced — the all-day cruise.\nDusk | Dark, low and slow. An evening pour.\nKing Me | Nitro cold brew under a cascading crema.\nNature's Aid | Honey + electrolytes. Clean hydration.";

export default function RoadFlyer() {
  const { toast } = useApp();
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [opts, setOpts] = useState<{ key: string; label: string; date: string; time: string; place: string; address: string }[]>([]);
  const [tile, setTile] = useState<Tile>("announce");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ headline1: "FIND US", headline2: "ON THE ROAD", date: "", time: "", place: "", address: "", photo: "", menu: DEFAULT_MENU, submenu: DEFAULT_SUB, details: DEFAULT_DETAILS });
  const wmRef = useRef<HTMLImageElement | null>(null);
  const [logoReady, setLogoReady] = useState(0);

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

  // Load the REAL GT3 wordmark so the footer uses the actual logo (not canvas text).
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    (async () => {
      let wm = "";
      const { data: bk } = await supabase.from("brand_kit").select("wordmark_url, logo_url").limit(1).maybeSingle();
      if (bk) wm = (bk as any).wordmark_url || (bk as any).logo_url || "";
      if (!wm) {
        const { data: ba } = await supabase.from("brand_assets").select("kind, url, sort").in("kind", ["wordmark", "logo"]).order("sort");
        const list = (ba as any[]) ?? [];
        wm = (list.find((a) => a.kind === "wordmark") || list.find((a) => a.kind === "logo") || {}).url || "";
      }
      if (!wm) return;
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { if (alive) { wmRef.current = img; setLogoReady((n) => n + 1); } };
      img.src = wm;
    })();
    return () => { alive = false; };
  }, []);

  const uploadPhoto = async (file: File) => {
    if (!supabase) return; setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `flyer/${new Date().getTime()}.${ext}`;
    const up = await supabase.storage.from("content").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (up.error) { toast(`Upload failed — ${up.error.message}`, "error"); setBusy(false); return; }
    setF((p) => ({ ...p, photo: supabase!.storage.from("content").getPublicUrl(path).data.publicUrl })); setBusy(false);
  };

  // ── canvas primitives ──
  const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const cover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => { const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); };
  const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
    const words = text.split(" "); const lines: string[] = []; let cur = "";
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  };

  // letterspaced small-caps label (the editorial "eyebrow")
  const eyebrow = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign = "left") => {
    ctx.save(); (ctx as any).letterSpacing = "4px"; ctx.font = "500 21px 'DM Mono', monospace"; ctx.fillStyle = color; ctx.textAlign = align;
    ctx.fillText(text.toUpperCase(), x, y); ctx.restore(); (ctx as any).letterSpacing = "0px"; ctx.textAlign = "left";
  };
  // a short red tick + long gold hairline — the house divider
  const goldRule = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number) => {
    ctx.fillStyle = RED; ctx.fillRect(x, y, 64, 4);
    ctx.fillStyle = GOLD; ctx.fillRect(x + 78, y + 1, w - 78, 2);
  };
  // a rotated 3×3 checkered diamond in a gold ring — the crest
  const checkerDiamond = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, onPhoto: boolean) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
    const n = 3, cs = (size * 2) / n, off = -size;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { ctx.fillStyle = (r + c) % 2 === 0 ? (onPhoto ? "#FFFFFF" : INK) : RED; ctx.fillRect(off + c * cs, off + r * cs, cs, cs); }
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5; ctx.strokeRect(-size, -size, size * 2, size * 2);
    ctx.restore();
  };
  // top crest band: gold hairlines flanking the checker diamond + a small caption beneath
  const topMotif = (ctx: CanvasRenderingContext2D, caption: string, onPhoto = false) => {
    const cy = 148, cx = W / 2, gold = onPhoto ? "rgba(245,241,232,.85)" : GOLD;
    ctx.strokeStyle = gold; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(M + 6, cy); ctx.lineTo(cx - 72, cy); ctx.moveTo(cx + 72, cy); ctx.lineTo(W - M - 6, cy); ctx.stroke();
    checkerDiamond(ctx, cx, cy, 26, onPhoto);
    eyebrow(ctx, caption, cx, cy + 58, gold, "center");
  };
  // the framed border — double gold hairline, the "premium print" cue
  const frame = (ctx: CanvasRenderingContext2D, onPhoto = false) => {
    ctx.strokeStyle = onPhoto ? "rgba(245,241,232,.5)" : GOLD; ctx.lineWidth = 2; ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.strokeStyle = onPhoto ? "rgba(245,241,232,.26)" : "rgba(169,124,63,.45)"; ctx.lineWidth = 1; ctx.strokeRect(50, 50, W - 100, H - 100);
  };
  // "01 ⁄ 04" — signals a swipeable set
  const pageTag = (ctx: CanvasRenderingContext2D, n: number, onPhoto = false) => {
    if (!n) return;
    ctx.save(); (ctx as any).letterSpacing = "2px"; ctx.font = "500 23px 'DM Mono', monospace"; ctx.fillStyle = onPhoto ? "rgba(245,241,232,.9)" : GOLD; ctx.textAlign = "right";
    ctx.fillText(`0${n} ⁄ 0${PAGES}`, W - M, 100); ctx.restore(); (ctx as any).letterSpacing = "0px"; ctx.textAlign = "left";
  };
  // editorial title: Fraunces italic word + Archivo Black word on one baseline
  const editorialTitle = (ctx: CanvasRenderingContext2D, serif: string, bold: string, y: number, onPhoto = false) => {
    ctx.font = "italic 600 84px Fraunces, Georgia, serif"; ctx.fillStyle = RED; ctx.fillText(serif, M, y);
    const tw = ctx.measureText(serif).width;
    ctx.font = "900 92px 'Archivo Black', system-ui"; ctx.fillStyle = onPhoto ? "#fff" : INK; ctx.fillText(bold.toUpperCase(), M + tw + 24, y);
  };

  const footer = (ctx: CanvasRenderingContext2D, onPhoto = false) => {
    ctx.fillStyle = onPhoto ? "rgba(245,241,232,.32)" : "rgba(169,124,63,.55)"; ctx.fillRect(M, H - 150, W - 2 * M, 1.5);
    ctx.textAlign = "left";
    const img = wmRef.current;
    if (img && img.width > 0) {
      const h = 52, w = img.width * (h / img.height), y = H - 116;
      if (onPhoto) { ctx.fillStyle = CREAM; rr(ctx, M - 16, y - 12, Math.min(w + 32, W - 2 * M), h + 24, 14); ctx.fill(); }
      ctx.drawImage(img, M, y, w, h);
    } else {
      ctx.font = "900 38px 'Archivo Black', system-ui"; ctx.fillStyle = RED; ctx.fillText("GT3", M, H - 74);
      ctx.font = "500 21px 'DM Mono', monospace"; ctx.fillStyle = onPhoto ? "#fff" : INK; ctx.fillText("PERFORMANCE BAR", M + 92, H - 78);
    }
    ctx.textAlign = "right";
    ctx.font = "900 28px 'Archivo Black', system-ui"; ctx.fillStyle = onPhoto ? "#fff" : INK; ctx.fillText("PURE SIGNAL.", W - M, H - 98);
    ctx.fillStyle = RED; ctx.fillText("NO NOISE.", W - M, H - 64); ctx.textAlign = "left";
  };

  // measured height of a menu block, so short lists can be vertically centered (no top-heavy dead space)
  const listHeight = (text: string) => {
    let h = 0;
    for (const raw of text.split("\n")) { const line = raw.trim(); if (!line) h += 30; else if (line === line.toUpperCase() && line.length < 24) h += 58; else h += 64; }
    return h;
  };
  // shared list renderer for Menu / Sub-menu
  const menuList = (ctx: CanvasRenderingContext2D, text: string, startY: number) => {
    let y = startY;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) { y += 30; continue; }
      const isHead = line === line.toUpperCase() && line.length < 24;
      if (isHead) { eyebrow(ctx, line, M, y, GOLD); y += 58; }
      else { ctx.font = "700 46px Inter, system-ui"; ctx.fillStyle = INK; ctx.fillText(line, M, y); y += 64; }
    }
    return y;
  };

  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return; const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await Promise.all([document.fonts.load("900 100px 'Archivo Black'"), document.fonts.load("700 46px Inter"), document.fonts.load("500 24px 'DM Mono'"), document.fonts.load("italic 600 84px Fraunces")]); } catch { /* */ }
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; (ctx as any).letterSpacing = "0px";

    if (tile === "photo") {
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      const img = f.photo ? await loadImg(f.photo) : null;
      if (img) cover(ctx, img, 0, 0, W, H); else { ctx.fillStyle = "#2a241c"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = MUT; ctx.font = "500 28px 'DM Mono'"; ctx.textAlign = "center"; ctx.fillText("ADD A PHOTO", W / 2, H / 2); ctx.textAlign = "left"; }
      const g = ctx.createLinearGradient(0, H - 620, 0, H); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.84)"); ctx.fillStyle = g; ctx.fillRect(0, H - 620, W, 620);
      frame(ctx, true); topMotif(ctx, "GT3 Mobile Bar", true);
      ctx.font = "900 100px 'Archivo Black', system-ui"; ctx.fillStyle = "#fff"; ctx.fillText((f.headline1 || "").toUpperCase(), M, H - 300);
      ctx.fillStyle = RED; ctx.fillText((f.headline2 || "").toUpperCase(), M, H - 300 + 104);
      footer(ctx, true); return;
    }

    ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H);
    frame(ctx); pageTag(ctx, PAGE[tile]);

    if (tile === "menu" || tile === "submenu") {
      const isSub = tile === "submenu";
      topMotif(ctx, isSub ? "Limited · Seasonal" : "Small Batch · Made To Order");
      editorialTitle(ctx, "The", isSub ? "Reserve" : "Menu", M + 288);
      goldRule(ctx, M, M + 330, W - 2 * M);
      // vertically center the list in the open area between the rule and the tagline
      const text = isSub ? f.submenu : f.menu;
      const topY = M + 408, botY = H - 240, avail = botY - topY;
      const startY = topY + Math.max(0, (avail - listHeight(text)) / 2) + 46;
      menuList(ctx, text, startY);
      ctx.font = "italic 600 33px Fraunces, Georgia, serif"; ctx.fillStyle = GOLD;
      ctx.fillText("Every bottle poured to order.", M, H - 205);
      footer(ctx); return;
    }

    if (tile === "details") {
      topMotif(ctx, "Swipe · Tasting Notes ›");
      editorialTitle(ctx, "The", "Pour", M + 288);
      goldRule(ctx, M, M + 330, W - 2 * M);
      let y = M + 452;
      const rows = f.details.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5);
      for (const row of rows) {
        const [name, ...rest] = row.split("|");
        ctx.font = "700 44px Inter, system-ui"; ctx.fillStyle = INK; ctx.fillText((name || "").trim(), M, y);
        const desc = rest.join("|").trim();
        if (desc) {
          y += 44; ctx.font = "400 30px Inter, system-ui"; ctx.fillStyle = MUT;
          for (const ln of wrap(ctx, desc, W - 2 * M)) { ctx.fillText(ln, M, y); y += 38; }
        }
        y += 22; ctx.fillStyle = "rgba(169,124,63,.35)"; ctx.fillRect(M, y, W - 2 * M, 1); y += 46;
      }
      footer(ctx); return;
    }

    // announce
    topMotif(ctx, "On The Road");
    ctx.font = "900 112px 'Archivo Black', system-ui"; ctx.fillStyle = INK; ctx.fillText((f.headline1 || "").toUpperCase(), M, M + 300);
    ctx.fillStyle = RED; ctx.fillText((f.headline2 || "").toUpperCase(), M, M + 300 + 114);
    goldRule(ctx, M, M + 452, W - 2 * M);
    let y = M + 552;
    const label = (t: string) => { eyebrow(ctx, t, M, y, GOLD); y += 46; };
    const big = (t: string, color = INK, size = 56) => { ctx.font = `700 ${size}px Inter, system-ui`; ctx.fillStyle = color; ctx.fillText(t, M, y); y += size + 12; };
    const serif = (t: string, size = 58) => { ctx.font = `italic 600 ${size}px Fraunces, Georgia, serif`; ctx.fillStyle = INK; ctx.fillText(t, M, y); y += size + 8; };
    const small = (t: string) => { ctx.font = "400 30px Inter, system-ui"; ctx.fillStyle = MUT; ctx.fillText(t, M, y); y += 44; };
    if (f.date || f.time) { label("WHEN"); if (f.date) big(f.date); if (f.time) big(f.time, RED, 46); y += 14; }
    const showAddr = f.address && norm(f.address) !== norm(f.place) && !norm(f.address).startsWith(norm(f.place) + " ");
    if (f.place || showAddr) { label("WHERE"); if (f.place) serif(f.place); if (showAddr) small(f.address); }
    const px = M, pw = W - 2 * M, ph = 300, py = H - ph - 172;
    const img = f.photo ? await loadImg(f.photo) : null;
    if (img) { ctx.save(); rr(ctx, px, py, pw, ph, 22); ctx.clip(); cover(ctx, img, px, py, pw, ph); ctx.restore(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; rr(ctx, px, py, pw, ph, 22); ctx.stroke(); }
    else { rr(ctx, px, py, pw, ph, 22); ctx.fillStyle = "#ece4d3"; ctx.fill(); ctx.strokeStyle = "rgba(169,124,63,.4)"; ctx.lineWidth = 1.5; ctx.stroke(); eyebrow(ctx, "Add a photo", W / 2, py + ph / 2 + 6, MUT, "center"); }
    footer(ctx);
  }, [f, tile, logoReady]);

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
    const caption = tile === "menu" || tile === "submenu" ? "The pour list — every bottle made to order."
      : tile === "details" ? "Tasting notes — what's in the glass, and why."
      : f.place ? `Find us on the road — ${f.place}${f.date ? ` · ${f.date}` : ""}${f.time ? ` · ${f.time}` : ""}.` : "Find us on the road.";
    const { error } = await supabase.from("content_items").insert({ title: `${f.place || "Road"} — ${tile}`, kind: "post", caption, media: [{ url: mediaUrl, type: "image" }], media_url: mediaUrl, media_type: "image", created_by: user?.id ?? null, updated_by: user?.id ?? null });
    setBusy(false);
    toast(error ? `Save failed — ${error.message}` : "Saved to the feed — schedule it in Board/Grid");
  };

  const field = (k: keyof typeof f, label: string, ph: string) => (
    <label className="rf-f"><span>{label}</span><input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={ph} /></label>
  );
  const usesPhoto = tile === "announce" || tile === "photo";

  return (
    <div className="rf">
      <div className="rf-tiles">
        {([["announce", "Announce"], ["menu", "Menu"], ["submenu", "Sub-menu"], ["details", "Details"], ["photo", "Photo"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={`rf-tile${tile === k ? " on" : ""}`} onClick={() => setTile(k)}>{l}</button>
        ))}
      </div>
      <div className="rf-note">Five slides that read as one luxury carousel — swipe order: Announce → Menu → Sub-menu → Details. Pick a stop to fill it in, tweak, then download or save to the feed. Same framed design every time.</div>
      {opts.length > 0 && tile === "announce" && (
        <select className="rf-pick" defaultValue="" onChange={(e) => e.target.value && pick(e.target.value)}>
          <option value="">⚡ Prefill from an event / stop…</option>
          {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      )}
      {tile === "announce" && <><div className="rf-grid2">{field("date", "When (day)", "WED · JUL 1")}{field("time", "Time", "6–10 AM")}</div>{field("place", "Place", "Wine Xpress · Five Forks")}{field("address", "Address", "202 Scuffletown Rd, Simpsonville SC")}</>}
      {tile === "photo" && <div className="rf-grid2">{field("headline1", "Headline 1", "WORLD'S FIRST")}{field("headline2", "Headline 2 (red)", "NET+ MOBILE BAR")}</div>}
      {tile === "menu" && <label className="rf-f"><span>Menu (one per line; ALL-CAPS = a header)</span><textarea rows={7} value={f.menu} onChange={(e) => setF((p) => ({ ...p, menu: e.target.value }))} /></label>}
      {tile === "submenu" && <label className="rf-f"><span>Sub-menu — reserve / specialty / seasonal (ALL-CAPS = a header)</span><textarea rows={7} value={f.submenu} onChange={(e) => setF((p) => ({ ...p, submenu: e.target.value }))} /></label>}
      {tile === "details" && <label className="rf-f"><span>Tasting notes — one drink per line as <b>Name | description</b> (up to 5)</span><textarea rows={7} value={f.details} onChange={(e) => setF((p) => ({ ...p, details: e.target.value }))} /></label>}
      {usesPhoto && (
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
