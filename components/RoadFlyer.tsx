"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";

// ROAD FLYER — the locked GT3 house graphics, drawn on a canvas so they're pixel-identical every
// time. A five-slide set (Announce · Menu · Sub-menu · Details · Photo) that reads as ONE luxury
// carousel, rendered in one of 10 brand-cohesive "templates" (director's cuts): same crest, wordmark,
// tagline and type system; each plays the palette + framing differently. Pick a stop → tweak → export.

// Grid + palette locked to the GT3 brand standard (Academy "The GT3 Grid" + seeded brand_kit):
// feed 1080×1350, margins ALWAYS 64, Charcoal/Signal Red/Cream/Gold, red on emphasis only.
const W = 1080, H = 1350, M = 64;
const INK = "#15120D", RED = "#B82420", CREAM = "#F5F1E8", GOLD = "#A97C3F", GOLD_LT = "#C8A661";
const cm = (a: number) => `rgba(245,241,232,${a})`;
const mc = (a: number) => `rgba(21,18,13,${a})`;
type Tile = "announce" | "menu" | "submenu" | "details" | "photo";
const PAGE: Record<Tile, number> = { announce: 1, menu: 2, submenu: 3, details: 4, photo: 0 };
const PAGES = 4;

type Theme = {
  id: string; name: string; note: string;
  paper: string; ink: string; headInk?: string; sub: string; accent: string; serif: string;
  frame: "gold" | "cream" | "goldheavy" | "thin" | "brackets" | "press" | "ticket" | "none";
  motif: "crest" | "masthead" | "band" | "neon" | "monogram";
  dark?: boolean; gold?: boolean; glow?: boolean; grain?: boolean; split?: boolean; weave?: boolean; warm?: boolean;
  crestSq?: string; crestAcc?: string;
};
// The 10 templates — one family, ten director's cuts.
const THEMES: Theme[] = [
  { id: "marquee", name: "The Marquee", note: "cream · gold frame", paper: CREAM, ink: INK, sub: mc(.52), accent: RED, serif: GOLD, frame: "gold", motif: "crest" },
  { id: "blackout", name: "Blackout", note: "charcoal night", paper: INK, ink: CREAM, sub: cm(.55), accent: RED, serif: GOLD_LT, frame: "gold", motif: "crest", dark: true, crestSq: CREAM },
  { id: "redline", name: "Redline", note: "signal-red field", paper: RED, ink: CREAM, sub: cm(.78), accent: INK, serif: CREAM, frame: "cream", motif: "crest", dark: true, crestSq: CREAM, crestAcc: INK },
  { id: "press", name: "The Press", note: "editorial masthead", paper: CREAM, ink: INK, sub: mc(.55), accent: RED, serif: INK, frame: "press", motif: "masthead" },
  { id: "goldleaf", name: "Gold Leaf", note: "gilded · opulent", paper: "#efe7d6", ink: INK, sub: mc(.5), accent: GOLD, serif: GOLD, frame: "goldheavy", motif: "crest", gold: true },
  { id: "checker", name: "Checkered Flag", note: "motorsport", paper: CREAM, ink: INK, sub: mc(.52), accent: RED, serif: INK, frame: "thin", motif: "band" },
  { id: "split", name: "The Split", note: "charcoal ∕ cream", paper: CREAM, ink: INK, headInk: CREAM, sub: mc(.55), accent: RED, serif: GOLD, frame: "none", motif: "crest", split: true, crestSq: CREAM },
  { id: "neon", name: "Neon Signal", note: "red-glow headline", paper: "#100d09", ink: CREAM, sub: cm(.55), accent: RED, serif: GOLD_LT, frame: "brackets", motif: "neon", dark: true, glow: true, crestSq: CREAM },
  { id: "monogram", name: "The Monogram", note: "oversized crest", paper: CREAM, ink: INK, sub: mc(.5), accent: RED, serif: GOLD, frame: "thin", motif: "monogram" },
  { id: "reserve", name: "Grain & Frame", note: "cinematic grain", paper: "#161009", ink: CREAM, sub: cm(.6), accent: RED, serif: GOLD_LT, frame: "gold", motif: "crest", dark: true, grain: true, crestSq: CREAM },
  { id: "carbon", name: "Carbon Fiber", note: "woven motorsport", paper: "#17130d", ink: CREAM, sub: cm(.55), accent: RED, serif: GOLD_LT, frame: "gold", motif: "crest", dark: true, weave: true, crestSq: CREAM },
  { id: "ticket", name: "The Ticket", note: "event ticket · perforated", paper: CREAM, ink: INK, sub: mc(.5), accent: RED, serif: GOLD, frame: "ticket", motif: "crest" },
  { id: "amber", name: "Amber Glow", note: "warm sunrise gradient", paper: CREAM, ink: INK, sub: mc(.5), accent: RED, serif: GOLD, frame: "gold", motif: "crest", warm: true },
];

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function dateLine(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return "";
  return `${DOW[d.getDay()]} · ${MON[d.getMonth()]} ${d.getDate()}`;
}
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Defaults are true to the Academy source of truth — real products, real specs, honey disclosed.
const DEFAULT_MENU = "COLD BREW\nRise · Flow · Dusk\n\nON NITRO\nNitro Cold Brew";
const DEFAULT_SUB = "SPECIALTY\nSalted Maple\n\nHYDRATION\nNature Aide · Tide";
const DEFAULT_DETAILS = "Rise | Cold-extracted ~18 hrs, coconut-finished. No burnt bite.\nFlow | The same base, cacao-infused. Richer, no added sugar.\nDusk | Cinnamon and cardamom. Warm, spiced — same lift.\nNitro | Charged with nitrogen. Creamy, no milk, no ice.\nNature Aide | Coconut + mineral water, organic maple, sea salt.";

export default function RoadFlyer() {
  const { toast } = useApp();
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [opts, setOpts] = useState<{ key: string; label: string; date: string; time: string; place: string; address: string }[]>([]);
  const [tile, setTile] = useState<Tile>("announce");
  const [tpl, setTpl] = useState(0);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [f, setF] = useState({ headline1: "FIND US", headline2: "ON THE ROAD", date: "", time: "", place: "", address: "", photo: "", menu: DEFAULT_MENU, submenu: DEFAULT_SUB, details: DEFAULT_DETAILS });
  const wmRef = useRef<HTMLImageElement | null>(null);
  const [logoReady, setLogoReady] = useState(0);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? Number(localStorage.getItem("gt3-flyer-tpl")) : 0;
    if (saved >= 0 && saved < THEMES.length) setTpl(saved);
  }, []);
  const pickTpl = (i: number) => { setTpl(i); if (typeof window !== "undefined") localStorage.setItem("gt3-flyer-tpl", String(i)); };
  const applyTemplate = (id: string) => { const i = THEMES.findIndex((x) => x.id === id); if (i >= 0) pickTpl(i); return i >= 0 ? THEMES[i].name : ""; };

  // Deterministic fallback pick when the AI isn't switched on — reads the slide + copy for a mood.
  const heuristicPick = (): { id: string; reason: string } => {
    const t = `${f.headline1} ${f.headline2} ${f.place} ${f.time} ${f.menu} ${f.submenu} ${f.details} ${tile}`.toLowerCase();
    if (tile === "photo") return { id: "reserve", reason: "Photo-forward — the cinematic grain frames a real image best." };
    if (tile === "menu" || tile === "submenu") return { id: "press", reason: "A menu reads with authority in the editorial masthead." };
    if (/\b(invite|rsvp|ticket|party|celebrat)/.test(t)) return { id: "ticket", reason: "It's an invite — the perforated ticket makes it feel like a happening." };
    if (/\b(night|evening|dusk|late|after ?dark|pm)\b/.test(t)) return { id: "neon", reason: "Evening energy — the red-glow cut owns after-dark." };
    if (/\b(morning|sunrise|am|market|coffee|rise)\b/.test(t)) return { id: "amber", reason: "A morning market — warm sunrise tones fit the hour." };
    if (/\b(race|track|grand|speed|launch|gt3|pit)\b/.test(t)) return { id: "checker", reason: "Motorsport moment — the checker cut leans into it." };
    if (/\b(reserve|vip|member|special|limited)\b/.test(t)) return { id: "goldleaf", reason: "Something special — Gold Leaf gives it the reserve treatment." };
    return { id: "marquee", reason: "Clean and premium — the Marquee is the refined default." };
  };

  const suggest = async () => {
    setSuggesting(true);
    const fallback = () => { const h = heuristicPick(); const name = applyTemplate(h.id); toast(`✨ ${name}: ${h.reason}`); };
    try {
      const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
      const r = await fetch("/api/agents/flyer-template", {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tile, headline1: f.headline1, headline2: f.headline2, place: f.place, date: f.date, time: f.time, text: tile === "menu" ? f.menu : tile === "submenu" ? f.submenu : tile === "details" ? f.details : "" }),
      });
      const j = await r.json();
      if (j.ok && j.template) { const name = applyTemplate(j.template); toast(`✨ ${name}: ${j.reason}`); }
      else fallback();
    } catch { fallback(); }
    setSuggesting(false);
  };

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

  // ── theme-independent primitives ──
  const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const cover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => { const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); };
  const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
    const words = text.split(" "); const lines: string[] = []; let cur = "";
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  };
  const listHeight = (text: string) => {
    let h = 0;
    for (const raw of text.split("\n")) { const line = raw.trim(); if (!line) h += 30; else if (line === line.toUpperCase() && line.length < 24) h += 58; else h += 64; }
    return h;
  };

  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return; const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await Promise.all([document.fonts.load("900 100px 'Archivo Black'"), document.fonts.load("700 46px Inter"), document.fonts.load("500 24px 'DM Mono'"), document.fonts.load("italic 600 84px Fraunces")]); } catch { /* */ }
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; (ctx as any).letterSpacing = "0px";
    const th = THEMES[tpl] ?? THEMES[0];
    const goldHair = th.dark ? "rgba(200,166,97,.7)" : GOLD;
    const goldFaint = th.dark ? cm(.28) : "rgba(200,166,97,.5)";

    // ── theme-aware helpers (closure over th) ──
    const eyebrow = (t: string, x: number, y: number, color: string, align: CanvasTextAlign = "left", ls = 4) => {
      ctx.save(); (ctx as any).letterSpacing = `${ls}px`; ctx.font = "500 21px 'DM Mono', monospace"; ctx.fillStyle = color; ctx.textAlign = align;
      ctx.fillText(t.toUpperCase(), x, y); ctx.restore(); (ctx as any).letterSpacing = "0px"; ctx.textAlign = "left";
    };
    const disp = (t: string, x: number, y: number, color: string | CanvasGradient, size: number, glow?: string) => {
      ctx.save(); (ctx as any).letterSpacing = "-1px"; ctx.font = `900 ${size}px 'Archivo Black', system-ui`;
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 32; } ctx.fillStyle = color; ctx.fillText(t, x, y);
      ctx.restore(); (ctx as any).letterSpacing = "0px";
    };
    const goldHead = (y: number, size: number) => { const g = ctx.createLinearGradient(0, y - size, 0, y + 8); g.addColorStop(0, GOLD_LT); g.addColorStop(.5, GOLD); g.addColorStop(1, "#8a6531"); return g; };
    const checkerDiamond = (cx: number, cy: number, s: number) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
      const n = 3, cs = (s * 2) / n, o = -s, sq = th.crestSq || INK, acc = th.crestAcc || RED;
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) { ctx.fillStyle = (r + k) % 2 === 0 ? sq : acc; ctx.fillRect(o + k * cs, o + r * cs, cs, cs); }
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5; ctx.strokeRect(-s, -s, s * 2, s * 2); ctx.restore();
    };
    // background paint; returns the split-band bottom (0 if none)
    const paintBg = (hero: boolean) => {
      if (th.split) {
        ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H);
        const past = hero ? 612 : 232;
        ctx.fillStyle = INK; ctx.fillRect(0, 0, W, past);
        ctx.fillStyle = RED; ctx.fillRect(0, past - 5, W, 6);
        return past;
      }
      ctx.fillStyle = th.paper; ctx.fillRect(0, 0, W, H);
      if (th.warm) {
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#f8f2e5"); g.addColorStop(1, "#e9d4a9"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const rg = ctx.createRadialGradient(W / 2, 160, 40, W / 2, 160, 560); rg.addColorStop(0, "rgba(201,166,97,.3)"); rg.addColorStop(1, "rgba(201,166,97,0)"); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
      if (th.weave) {
        const s = 18; for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) { ctx.fillStyle = ((x / s + y / s) % 2 === 0) ? "rgba(245,241,232,.03)" : "rgba(0,0,0,.22)"; ctx.fillRect(x, y, s, s); }
      }
      if (th.motif === "monogram") {
        ctx.save(); ctx.globalAlpha = .05; ctx.translate(W / 2, H / 2 + 140); ctx.rotate(Math.PI / 4);
        const s = 340, n = 6, cs = (s * 2) / n;
        for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if ((r + k) % 2 === 0) { ctx.fillStyle = INK; ctx.fillRect(-s + k * cs, -s + r * cs, cs, cs); }
        ctx.restore(); ctx.globalAlpha = 1;
      }
      if (th.grain) {
        for (let i = 0; i < 7000; i++) { const x = Math.random() * W, y = Math.random() * H; ctx.fillStyle = `rgba(${Math.random() < .5 ? "245,241,232" : "0,0,0"},${Math.random() * .06})`; ctx.fillRect(x, y, 2, 2); }
        const v = ctx.createRadialGradient(W / 2, H / 2, 220, W / 2, H / 2, 900); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.5)"); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
      }
      return 0;
    };
    const frame = () => {
      if (th.frame === "gold" || th.frame === "cream") { const c1 = th.frame === "cream" ? cm(.75) : goldHair, c2 = th.frame === "cream" ? cm(.4) : goldFaint; ctx.strokeStyle = c1; ctx.lineWidth = 2; ctx.strokeRect(38, 38, W - 76, H - 76); ctx.strokeStyle = c2; ctx.lineWidth = 1; ctx.strokeRect(48, 48, W - 96, H - 96); }
      else if (th.frame === "goldheavy") { ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.strokeRect(36, 36, W - 72, H - 72); ctx.strokeStyle = GOLD_LT; ctx.lineWidth = 1; ctx.strokeRect(46, 46, W - 92, H - 92); [[36, 36], [W - 36, 36], [36, H - 36], [W - 36, H - 36]].forEach(([x, y]) => { ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); }); }
      else if (th.frame === "thin") { ctx.strokeStyle = goldHair; ctx.lineWidth = 1.5; ctx.strokeRect(44, 44, W - 88, H - 88); }
      else if (th.frame === "brackets") { ctx.strokeStyle = goldHair; ctx.lineWidth = 3; const L = 70, o = 44; ([[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]] as const).forEach(([x, y, dx, dy]) => { ctx.beginPath(); ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke(); }); }
      else if (th.frame === "press") { ctx.fillStyle = th.ink; ctx.fillRect(M, 150, W - 2 * M, 7); ctx.fillStyle = mc(.85); ctx.fillRect(M, H - 160, W - 2 * M, 3); }
      else if (th.frame === "ticket") {
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5; rr(ctx, 44, 44, W - 88, H - 88, 20); ctx.stroke();
        const py = H - 232;
        ctx.save(); ctx.strokeStyle = mc(.5); ctx.lineWidth = 2; ctx.setLineDash([2, 12]); ctx.beginPath(); ctx.moveTo(72, py); ctx.lineTo(W - 72, py); ctx.stroke(); ctx.restore();
        ctx.fillStyle = CREAM; ctx.beginPath(); ctx.arc(44, py, 22, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(W - 44, py, 22, 0, 7); ctx.fill();
        eyebrow("Admit One · GT3", W / 2, py + 42, mc(.55), "center", 5);
      }
    };
    const topMotif = (caption: string) => {
      if (th.motif === "masthead") { eyebrow("GT3 · Performance Bar", W / 2, 120, th.ink, "center", 6); return; }
      const cy = 148, cx = W / 2;
      if (th.motif === "neon") { eyebrow(`· ${caption} ·`, cx, cy, th.serif, "center", 6); return; }
      if (th.motif === "monogram") { eyebrow("GT3 Mobile Bar", cx, cy, GOLD, "center", 5); return; }
      ctx.strokeStyle = goldHair; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(M + 6, cy); ctx.lineTo(cx - 72, cy); ctx.moveTo(cx + 72, cy); ctx.lineTo(W - M - 6, cy); ctx.stroke();
      checkerDiamond(cx, cy, 26); eyebrow(caption, cx, cy + 58, goldHair, "center");
    };
    const pageTag = (n: number) => {
      if (!n || th.motif === "masthead") return;
      ctx.save(); (ctx as any).letterSpacing = "2px"; ctx.font = "500 23px 'DM Mono', monospace"; ctx.fillStyle = goldHair; ctx.textAlign = "right";
      ctx.fillText(`0${n} ⁄ 0${PAGES}`, W - M, 100); ctx.restore(); (ctx as any).letterSpacing = "0px"; ctx.textAlign = "left";
    };
    // the divider under the headline/title — checker band, neon glow bar, or the house tick+hairline
    const rule = (x: number, y: number, w: number) => {
      if (th.motif === "band") { const cs = 30; for (let r = 0; r < 2; r++) for (let k = 0; k <= Math.ceil(w / cs); k++) if ((r + k) % 2 === 0) { ctx.fillStyle = r === 0 ? INK : RED; ctx.fillRect(x + k * cs, y + r * cs, cs, cs); } return; }
      if (th.glow) { ctx.save(); ctx.shadowColor = RED; ctx.shadowBlur = 22; ctx.fillStyle = RED; ctx.fillRect(x, y, 220, 5); ctx.restore(); return; }
      ctx.fillStyle = th.accent; ctx.fillRect(x, y, 64, 4); ctx.fillStyle = goldHair; ctx.fillRect(x + 78, y + 1, w - 78, 2);
    };
    const editorialTitle = (serifWord: string, boldWord: string, y: number) => {
      ctx.font = "italic 600 84px Fraunces, Georgia, serif"; ctx.fillStyle = th.serif; ctx.fillText(serifWord, M, y);
      const tw = ctx.measureText(serifWord).width;
      disp(boldWord.toUpperCase(), M + tw + 24, y, th.gold ? goldHead(y, 92) : th.ink, 92, th.glow ? RED : undefined);
    };
    const menuList = (text: string, startY: number) => {
      let y = startY;
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line) { y += 30; continue; }
        const isHead = line === line.toUpperCase() && line.length < 24;
        if (isHead) { eyebrow(line, M, y, goldHair); y += 58; }
        else { ctx.font = "700 46px Inter, system-ui"; ctx.fillStyle = th.ink; ctx.fillText(line, M, y); y += 64; }
      }
      return y;
    };
    const footer = (onPhoto = false) => {
      ctx.fillStyle = onPhoto ? cm(.32) : goldFaint; ctx.fillRect(M, H - 150, W - 2 * M, 1.5);
      ctx.textAlign = "left";
      const img = wmRef.current;
      if (img && img.width > 0) {
        const h = 60, w = img.width * (h / img.height), y = H - 122;
        if (onPhoto || th.dark) { ctx.fillStyle = CREAM; rr(ctx, M - 16, y - 12, Math.min(w + 32, W - 2 * M), h + 24, 14); ctx.fill(); }
        ctx.drawImage(img, M, y, w, h);
      } else {
        ctx.font = "900 38px 'Archivo Black', system-ui"; ctx.fillStyle = th.gold ? GOLD : th.accent; ctx.fillText("GT3", M, H - 74);
        ctx.font = "500 21px 'DM Mono', monospace"; ctx.fillStyle = onPhoto ? "#fff" : th.ink; ctx.fillText("PERFORMANCE BAR", M + 92, H - 78);
      }
      ctx.textAlign = "right";
      ctx.font = "900 28px 'Archivo Black', system-ui"; ctx.fillStyle = onPhoto ? "#fff" : th.ink; ctx.fillText("PURE SIGNAL.", W - M, H - 98);
      ctx.fillStyle = onPhoto ? RED : th.accent; ctx.fillText("NO NOISE.", W - M, H - 64); ctx.textAlign = "left";
    };

    // ── PHOTO tile: the photo is its own dark hero; kept constant across templates ──
    if (tile === "photo") {
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      const img = f.photo ? await loadImg(f.photo) : null;
      if (img) cover(ctx, img, 0, 0, W, H); else { ctx.fillStyle = "#2a241c"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = cm(.5); ctx.font = "500 28px 'DM Mono'"; ctx.textAlign = "center"; ctx.fillText("ADD A PHOTO", W / 2, H / 2); ctx.textAlign = "left"; }
      const g = ctx.createLinearGradient(0, H - 620, 0, H); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.84)"); ctx.fillStyle = g; ctx.fillRect(0, H - 620, W, 620);
      ctx.strokeStyle = cm(.5); ctx.lineWidth = 2; ctx.strokeRect(38, 38, W - 76, H - 76);
      { const cy = 148, cx = W / 2; ctx.strokeStyle = cm(.85); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(M + 6, cy); ctx.lineTo(cx - 72, cy); ctx.moveTo(cx + 72, cy); ctx.lineTo(W - M - 6, cy); ctx.stroke(); checkerDiamond(cx, cy, 26); eyebrow("GT3 Mobile Bar", cx, cy + 58, cm(.85), "center"); }
      disp((f.headline1 || "").toUpperCase(), M, H - 300, "#fff", 100, th.glow ? RED : undefined);
      disp((f.headline2 || "").toUpperCase(), M, H - 300 + 104, RED, 100, th.glow ? RED : undefined);
      footer(true); return;
    }

    const bandBottom = paintBg(tile === "announce");
    frame(); pageTag(PAGE[tile]);

    // ── MENU / SUB-MENU ──
    if (tile === "menu" || tile === "submenu") {
      const isSub = tile === "submenu";
      topMotif(isSub ? "Limited · Seasonal" : "Small Batch · Made To Order");
      editorialTitle("The", isSub ? "Reserve" : "Menu", M + 288);
      rule(M, M + 330, W - 2 * M);
      const text = isSub ? f.submenu : f.menu;
      const topY = M + 408, botY = H - 240, avail = botY - topY;
      const startY = topY + Math.max(0, (avail - listHeight(text)) / 2) + 46;
      menuList(text, startY);
      ctx.font = "italic 600 33px Fraunces, Georgia, serif"; ctx.fillStyle = th.dark ? GOLD_LT : GOLD;
      ctx.fillText("Every cup, made to order.", M, H - 205);
      footer(); return;
    }

    // ── DETAILS (tasting notes) ──
    if (tile === "details") {
      topMotif("Swipe · Tasting Notes ›");
      editorialTitle("The", "Pour", M + 288);
      rule(M, M + 330, W - 2 * M);
      const rows = f.details.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5);
      const many = rows.length >= 5;
      const nameSz = many ? 40 : 44, descSz = many ? 27 : 30, descLh = descSz + 7, pad = many ? 32 : 42;
      let y = M + (many ? 428 : 452);
      for (const row of rows) {
        const [name, ...rest] = row.split("|");
        ctx.font = `700 ${nameSz}px Inter, system-ui`; ctx.fillStyle = th.ink; ctx.fillText((name || "").trim(), M, y);
        const desc = rest.join("|").trim();
        if (desc) { y += nameSz - 2; ctx.font = `400 ${descSz}px Inter, system-ui`; ctx.fillStyle = th.sub; for (const ln of wrap(ctx, desc, W - 2 * M)) { ctx.fillText(ln, M, y); y += descLh; } }
        y += pad * 0.42; ctx.fillStyle = th.dark ? cm(.25) : "rgba(200,166,97,.4)"; ctx.fillRect(M, y, W - 2 * M, 1); y += pad;
      }
      footer(); return;
    }

    // ── ANNOUNCE ──
    topMotif("On The Road");
    const onBand = th.split; // headlines sit on the charcoal band
    disp((f.headline1 || "").toUpperCase(), M, M + 312, onBand ? (th.headInk || CREAM) : th.ink, 112, th.glow ? RED : undefined);
    disp((f.headline2 || "").toUpperCase(), M, M + 312 + 114, th.gold ? goldHead(M + 426, 112) : th.accent, 112, th.glow ? RED : undefined);
    rule(M, M + 464, W - 2 * M);
    let y = M + (th.motif === "band" ? 604 : 566);
    const label = (t: string) => { eyebrow(t, M, y, goldHair); y += 46; };
    const big = (t: string, color = th.ink, size = 56) => { ctx.font = `700 ${size}px Inter, system-ui`; ctx.fillStyle = color; ctx.fillText(t, M, y); y += size + 12; };
    const serifLine = (t: string, size = 58) => { ctx.font = `italic 600 ${size}px Fraunces, Georgia, serif`; ctx.fillStyle = th.ink; ctx.fillText(t, M, y); y += size + 8; };
    const small = (t: string) => { ctx.font = "400 30px Inter, system-ui"; ctx.fillStyle = th.sub; ctx.fillText(t, M, y); y += 44; };
    if (f.date || f.time) { label("WHEN"); if (f.date) big(f.date); if (f.time) big(f.time, th.accent, 46); y += 14; }
    const showAddr = f.address && norm(f.address) !== norm(f.place) && !norm(f.address).startsWith(norm(f.place) + " ");
    if (f.place || showAddr) { label("WHERE"); if (f.place) serifLine(f.place); if (showAddr) small(f.address); }
    const px = M, pw = W - 2 * M, ph = 300, py = H - ph - 172;
    const img = f.photo ? await loadImg(f.photo) : null;
    if (img) { ctx.save(); rr(ctx, px, py, pw, ph, 22); ctx.clip(); cover(ctx, img, px, py, pw, ph); ctx.restore(); ctx.strokeStyle = goldHair; ctx.lineWidth = 2; rr(ctx, px, py, pw, ph, 22); ctx.stroke(); }
    else { rr(ctx, px, py, pw, ph, 22); ctx.fillStyle = th.dark ? cm(.06) : "#ece4d3"; ctx.fill(); ctx.strokeStyle = goldFaint; ctx.lineWidth = 1.5; ctx.stroke(); eyebrow("Add a photo", W / 2, py + ph / 2 + 6, th.sub, "center"); }
    void bandBottom; footer();
  }, [f, tile, tpl, logoReady]);

  useEffect(() => { draw(); }, [draw]);

  const toBlob = () => new Promise<Blob | null>((res) => canvasRef.current?.toBlob(res, "image/png"));
  const download = async () => {
    await draw(); const blob = await toBlob();
    if (!blob) { toast("Export failed — try a different photo.", "error"); return; }
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `gt3-${THEMES[tpl].id}-${tile}-${(f.place || "stop").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
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
      <div className="rf-tpl-head">
        <span>Template · {THEMES[tpl].name}</span>
        <button type="button" className="rf-ai" onClick={suggest} disabled={suggesting}>{suggesting ? "Thinking…" : "✨ Suggest for me"}</button>
      </div>
      <div className="rf-tpls" role="tablist" aria-label="Template">
        {THEMES.map((t, i) => (
          <button key={t.id} type="button" className={`rf-tpl${tpl === i ? " on" : ""}`} onClick={() => pickTpl(i)} title={t.note}>{t.name}</button>
        ))}
      </div>
      <div className="rf-tiles">
        {([["announce", "Announce"], ["menu", "Menu"], ["submenu", "Sub-menu"], ["details", "Details"], ["photo", "Photo"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={`rf-tile${tile === k ? " on" : ""}`} onClick={() => setTile(k)}>{l}</button>
        ))}
      </div>
      <div className="rf-note">Pick a template up top — 10 cuts of the GT3 look. Then a slide (Announce → Menu → Sub-menu → Details), fill it in, and download or save to the feed.</div>
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
