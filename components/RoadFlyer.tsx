"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { uploadToBucket } from "@/lib/uploads";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { localToday } from "@/lib/dates";
import Icon from "@/components/Icon";

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
  frame: "gold" | "cream" | "goldheavy" | "thin" | "brackets" | "press" | "ticket" | "proof" | "none";
  motif: "crest" | "masthead" | "band" | "neon" | "monogram";
  dark?: boolean; gold?: boolean; glow?: boolean; grain?: boolean; split?: boolean; weave?: boolean; warm?: boolean; deco?: boolean; offset?: boolean; spotlight?: boolean; terrazzo?: boolean; halftone?: boolean;
  crestSq?: string; crestAcc?: string;
  l1: string; l2: string; // the template's default GT3 saying (headline) — a different angle per cut
};
// The 10 templates — one family, ten director's cuts.
const THEMES: Theme[] = [
  { id: "marquee", name: "The Marquee", note: "cream · gold frame", paper: CREAM, ink: INK, sub: mc(.52), accent: RED, serif: GOLD, frame: "gold", motif: "crest", l1: "FIND US", l2: "ON THE ROAD" },
  { id: "blackout", name: "Blackout", note: "charcoal night", paper: INK, ink: CREAM, sub: cm(.55), accent: RED, serif: GOLD_LT, frame: "gold", motif: "crest", dark: true, crestSq: CREAM, l1: "THE EVENING", l2: "POUR" },
  { id: "redline", name: "Redline", note: "signal-red field", paper: RED, ink: CREAM, sub: cm(.78), accent: INK, serif: CREAM, frame: "cream", motif: "crest", dark: true, crestSq: CREAM, crestAcc: INK, l1: "PURE SIGNAL", l2: "NO NOISE" },
  { id: "press", name: "The Press", note: "editorial masthead", paper: CREAM, ink: INK, sub: mc(.55), accent: RED, serif: INK, frame: "press", motif: "masthead", l1: "MADE", l2: "TO ORDER" },
  { id: "goldleaf", name: "Gold Leaf", note: "gilded · opulent", paper: "#efe7d6", ink: INK, sub: mc(.5), accent: GOLD, serif: GOLD, frame: "goldheavy", motif: "crest", gold: true, l1: "SINGLE", l2: "ORIGIN" },
  { id: "checker", name: "Checkered Flag", note: "motorsport", paper: CREAM, ink: INK, sub: mc(.52), accent: RED, serif: INK, frame: "thin", motif: "band", l1: "COLD", l2: "EXTRACTED" },
  { id: "split", name: "The Split", note: "charcoal ∕ cream", paper: CREAM, ink: INK, headInk: CREAM, sub: mc(.55), accent: RED, serif: GOLD, frame: "none", motif: "crest", split: true, crestSq: CREAM, l1: "NOTHING", l2: "TO HIDE" },
  { id: "neon", name: "Neon Signal", note: "red-glow headline", paper: "#100d09", ink: CREAM, sub: cm(.55), accent: RED, serif: GOLD_LT, frame: "brackets", motif: "neon", dark: true, glow: true, crestSq: CREAM, l1: "NITRO", l2: "ON TAP" },
  { id: "monogram", name: "The Monogram", note: "oversized crest", paper: CREAM, ink: INK, sub: mc(.5), accent: RED, serif: GOLD, frame: "thin", motif: "monogram", l1: "ONLY THE BEST", l2: "FOR YOU" },
  { id: "reserve", name: "Grain & Frame", note: "cinematic grain", paper: "#161009", ink: CREAM, sub: cm(.6), accent: RED, serif: GOLD_LT, frame: "gold", motif: "crest", dark: true, grain: true, crestSq: CREAM, l1: "OUT OF", l2: "RESPECT" },
  { id: "carbon", name: "Carbon Fiber", note: "woven motorsport", paper: "#17130d", ink: CREAM, sub: cm(.55), accent: RED, serif: GOLD_LT, frame: "gold", motif: "crest", dark: true, weave: true, crestSq: CREAM, l1: "18 HOURS", l2: "COLD" },
  { id: "ticket", name: "The Ticket", note: "event ticket · perforated", paper: CREAM, ink: INK, sub: mc(.5), accent: RED, serif: GOLD, frame: "ticket", motif: "crest", l1: "WHEN YOU", l2: "NEED IT" },
  { id: "amber", name: "Amber Glow", note: "warm sunrise gradient", paper: CREAM, ink: INK, sub: mc(.5), accent: RED, serif: GOLD, frame: "gold", motif: "crest", warm: true, l1: "START", l2: "THE MORNING" },
  { id: "proof", name: "The Proof", note: "press proof · registration", paper: CREAM, ink: INK, sub: mc(.52), accent: RED, serif: INK, frame: "proof", motif: "crest", l1: "HONEST", l2: "IN THE BOTTLE" },
  { id: "deco", name: "The Deco", note: "art-deco · gilded rays", paper: "#141007", ink: CREAM, sub: cm(.6), accent: GOLD, serif: GOLD_LT, frame: "gold", motif: "crest", dark: true, deco: true, gold: true, crestSq: CREAM, l1: "ONLY WHAT", l2: "WE'D DRINK" },
  { id: "offset", name: "Offset", note: "riso duotone · handmade", paper: CREAM, ink: INK, sub: mc(.52), accent: RED, serif: INK, frame: "thin", motif: "crest", offset: true, l1: "MADE", l2: "FRESH" },
  { id: "nocturne", name: "Nocturne", note: "spotlit charcoal", paper: "#0f0c08", ink: CREAM, sub: cm(.55), accent: RED, serif: GOLD_LT, frame: "thin", motif: "crest", dark: true, spotlight: true, crestSq: CREAM, l1: "FOR THE", l2: "DEEP WORK" },
  { id: "terrazzo", name: "Terrazzo", note: "speckled · whole-food", paper: CREAM, ink: INK, sub: mc(.52), accent: RED, serif: GOLD, frame: "thin", motif: "crest", terrazzo: true, l1: "WHOLE", l2: "COCONUT" },
  { id: "halftone", name: "Halftone", note: "pop-art dots", paper: CREAM, ink: INK, sub: mc(.52), accent: RED, serif: INK, frame: "thin", motif: "crest", halftone: true, l1: "REAL", l2: "INGREDIENTS" },
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
// Crop box (fractions of the gt3pb-handle.png) that isolates just the red "GT3" from the full lockup —
// measured from the asset's red bounding box. We draw THESE PIXELS, never a redrawn approximation.
const LOGO = { fx: 0.035, fy: 0.05, fw: 0.93, fh: 0.50 };

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
  const [f, setF] = useState({ headline1: THEMES[0].l1, headline2: THEMES[0].l2, date: "", time: "", place: "", address: "", photo: "", menu: DEFAULT_MENU, submenu: DEFAULT_SUB, details: DEFAULT_DETAILS });
  const logoRef = useRef<HTMLImageElement | null>(null); // the real GT3 logo image (gt3pb-handle.png)
  const [logoReady, setLogoReady] = useState(0);
  const headEditedRef = useRef(false); // once the user types their own headline, stop auto-seeding the saying

  useEffect(() => {
    const saved = typeof window !== "undefined" ? Number(localStorage.getItem("gt3-flyer-tpl")) : 0;
    if (saved >= 0 && saved < THEMES.length) { setTpl(saved); seedSaying(saved); }
  }, []);
  // Each template carries its own GT3 saying; picking one shows that saying (a different angle),
  // unless the user has already written their own headline.
  const seedSaying = (i: number) => { if (!headEditedRef.current) setF((p) => ({ ...p, headline1: THEMES[i].l1, headline2: THEMES[i].l2 })); };
  const pickTpl = (i: number) => { setTpl(i); if (typeof window !== "undefined") localStorage.setItem("gt3-flyer-tpl", String(i)); seedSaying(i); };
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
      const r = await authedFetch("/api/agents/flyer-template", {
        method: "POST", headers: { "Content-Type": "application/json" },
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
    const today = localToday(); // display filter — the operator's wall-clock day
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
    let alive = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { if (alive) { logoRef.current = img; setLogoReady((n) => n + 1); } };
    img.src = "/brand/gt3pb-handle.png"; // the real GT3 logo asset (committed in /public/brand)
    return () => { alive = false; };
  }, []);

  const uploadPhoto = async (file: File) => {
    if (!supabase) return; setBusy(true);
    const res = await uploadToBucket({ bucket: "content", file, prefix: "flyer" });
    if ("error" in res) { toast(`Upload failed — ${res.error}`, "error"); setBusy(false); return; }
    setF((p) => ({ ...p, photo: res.url })); setBusy(false);
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
      // Offset cut — a riso-style misregistration ghost behind the type (handmade-print look)
      if (th.offset && typeof color === "string") { ctx.fillStyle = color === INK ? "rgba(184,36,32,.5)" : "rgba(21,18,13,.42)"; ctx.fillText(t, x + 7, y + 7); }
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 32; } ctx.fillStyle = color; ctx.fillText(t, x, y);
      ctx.restore(); (ctx as any).letterSpacing = "0px";
    };
    // shrink a display line so it always fits the column (long sayings never run off the frame)
    const fitSize = (t: string, maxSize: number, maxW: number) => {
      ctx.save(); (ctx as any).letterSpacing = "-1px"; ctx.font = `900 ${maxSize}px 'Archivo Black', system-ui`; const w = ctx.measureText(t).width; ctx.restore(); (ctx as any).letterSpacing = "0px";
      return w > maxW ? Math.max(52, Math.floor(maxSize * (maxW / w))) : maxSize;
    };
    const goldHead = (y: number, size: number) => { const g = ctx.createLinearGradient(0, y - size, 0, y + 8); g.addColorStop(0, GOLD_LT); g.addColorStop(.5, GOLD); g.addColorStop(1, "#8a6531"); return g; };
    // The house emblem — the REAL GT3 logo, cropped straight from the asset (no redraw). Red-on-
    // transparent reads on cream + charcoal; on the red field it gets a cream chip to stay visible.
    const gtLogo = (cx: number, cy: number, h: number, chip: boolean) => {
      const src = logoRef.current; if (!src || !src.width) return null;
      const sx = LOGO.fx * src.width, sy = LOGO.fy * src.height, sw = LOGO.fw * src.width, sh = LOGO.fh * src.height;
      let dh = h, dw = sw * (dh / sh); const maxW = W - 2 * M - 100; if (dw > maxW) { const k = maxW / dw; dw *= k; dh *= k; }
      if (chip) { ctx.fillStyle = CREAM; rr(ctx, cx - dw / 2 - 18, cy - dh / 2 - 12, dw + 36, dh + 24, 12); ctx.fill(); }
      ctx.drawImage(src, sx, sy, sw, sh, cx - dw / 2, cy - dh / 2, dw, dh);
      return dw / 2;
    };
    const emblem = (cx: number, cy: number, _col?: string, _sqO?: string, _onDark = false) => {
      const hw = gtLogo(cx, cy, 74, th.id === "redline");
      if (hw != null) return hw + (th.id === "redline" ? 24 : 16);
      // fallback ONLY if the asset failed to load — the red GT3 wordmark drawn (never white/checker)
      ctx.save(); (ctx as any).letterSpacing = "-2px"; ctx.font = "900 60px 'Archivo Black', system-ui";
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; const w = ctx.measureText("GT3").width;
      ctx.fillStyle = th.id === "redline" ? CREAM : RED; ctx.fillText("GT3", cx, cy + 1);
      ctx.restore(); (ctx as any).letterSpacing = "0px"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      return w / 2 + 18;
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
      if (th.deco) {
        // gilded sunburst rays from above, + stepped art-deco corner ornaments
        ctx.save(); ctx.strokeStyle = "rgba(201,166,97,.14)"; ctx.lineWidth = 2;
        for (let a = -60; a <= 60; a += 12) { const rad = a * Math.PI / 180; ctx.beginPath(); ctx.moveTo(W / 2, -120); ctx.lineTo(W / 2 + Math.sin(rad) * 1300, -120 + Math.cos(rad) * 1300); ctx.stroke(); }
        ctx.restore();
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
        const step = (x: number, y: number, dx: number, dy: number) => { ctx.beginPath(); ctx.moveTo(x, y + dy * 74); ctx.lineTo(x, y + dy * 42); ctx.lineTo(x + dx * 32, y + dy * 42); ctx.lineTo(x + dx * 32, y + dy * 14); ctx.lineTo(x + dx * 74, y + dy * 14); ctx.stroke(); };
        const o = 50; step(o, o, 1, 1); step(W - o, o, -1, 1); step(o, H - o, 1, -1); step(W - o, H - o, -1, -1);
      }
      if (th.spotlight) { const r = ctx.createRadialGradient(W / 2, 120, 30, W / 2, 120, 660); r.addColorStop(0, "rgba(201,166,97,.22)"); r.addColorStop(1, "rgba(201,166,97,0)"); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H); }
      if (th.terrazzo) { const cols = [RED, GOLD, GOLD_LT, INK, "#3f7d6e"]; const chip = (n: number, y0: number, y1: number) => { for (let i = 0; i < n; i++) { const x = Math.random() * (W - 2 * M) + M, y = Math.random() * (y1 - y0) + y0, rw = 6 + Math.random() * 12, rh = 5 + Math.random() * 9; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.random() * Math.PI); ctx.globalAlpha = .7; ctx.fillStyle = cols[(Math.random() * cols.length) | 0]; ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, 7); ctx.fill(); ctx.restore(); } }; chip(24, 72, 224); chip(28, H - 256, H - 72); ctx.globalAlpha = 1; }
      if (th.halftone) { for (let y = 40; y < 340; y += 18) for (let x = W - 340; x < W - 40; x += 18) { const d = Math.hypot(x - (W - 40), y - 40), r = Math.max(0, 1 - d / 300) * 5.5; if (r > 0.5) { ctx.fillStyle = "rgba(184,36,32,.45)"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); } } }
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
      else if (th.frame === "proof") {
        ctx.strokeStyle = "rgba(21,18,13,.5)"; ctx.lineWidth = 1; ctx.strokeRect(58, 58, W - 116, H - 116);
        ctx.strokeStyle = INK; ctx.lineWidth = 1.5; const o = 30, L = 26;
        ([[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]] as const).forEach(([x, y, dx, dy]) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * L, y); ctx.moveTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke(); });
        regTarget(W / 2, 30, 11, INK); regTarget(W / 2, H - 30, 11, INK); regTarget(30, H / 2, 11, INK); regTarget(W - 30, H / 2, 11, INK);
      }
    };
    // a print registration target — circle + inner ring + crosshair overshoot
    const regTarget = (x: number, y: number, r: number, col: string) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r - 9, y); ctx.lineTo(x + r + 9, y); ctx.moveTo(x, y - r - 9); ctx.lineTo(x, y + r + 9); ctx.stroke();
    };
    const topMotif = (caption: string) => {
      // Press keeps its editorial masthead (still GT3, top-centered); every other cut shows the GT3 emblem.
      if (th.motif === "masthead") { eyebrow("GT3 · Performance Bar", W / 2, 120, th.ink, "center", 6); return; }
      const cy = 146, cx = W / 2;
      const hw = emblem(cx, cy, th.dark ? CREAM : INK, undefined, th.dark);
      ctx.strokeStyle = goldHair; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(M + 6, cy); ctx.lineTo(cx - hw - 18, cy); ctx.moveTo(cx + hw + 18, cy); ctx.lineTo(W - M - 6, cy); ctx.stroke();
      eyebrow(caption, cx, cy + 58, th.motif === "neon" ? th.serif : goldHair, "center");
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
      // Footer wordmark = the SAME real GT3 logo pixels, small, left-aligned (chip on the red field).
      const src = logoRef.current;
      if (src && src.width) {
        const sx = LOGO.fx * src.width, sy = LOGO.fy * src.height, sw = LOGO.fw * src.width, sh = LOGO.fh * src.height;
        const dh = 40, dw = sw * (dh / sh), y = Math.round(H - 96 - dh / 2);
        if (th.id === "redline") { ctx.fillStyle = CREAM; rr(ctx, M - 10, y - 8, dw + 20, dh + 16, 8); ctx.fill(); }
        ctx.drawImage(src, sx, sy, sw, sh, M, y, dw, dh);
      } else {
        ctx.font = "900 38px 'Archivo Black', system-ui"; ctx.fillStyle = onPhoto ? RED : (th.id === "redline" ? CREAM : RED); ctx.fillText("GT3", M, H - 74);
      }
      ctx.textAlign = "right";
      ctx.font = "900 28px 'Archivo Black', system-ui"; ctx.fillStyle = onPhoto ? "#fff" : th.ink; ctx.fillText("PURE SIGNAL.", W - M, H - 98);
      ctx.fillStyle = onPhoto ? RED : th.accent; ctx.fillText("NO NOISE.", W - M, H - 64); ctx.textAlign = "left";
    };

    // ── PHOTO tile — a photo hero that wears the chosen template: each cut grades + marks the image
    //    differently (color wash, grain, weave, split block, checker, ticket, masthead, monogram). ──
    if (tile === "photo") {
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      const img = f.photo ? await loadImg(f.photo) : null;
      if (img) cover(ctx, img, 0, 0, W, H); else { ctx.fillStyle = "#2a241c"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = cm(.5); ctx.font = "500 28px 'DM Mono'"; ctx.textAlign = "center"; ctx.fillText("ADD A PHOTO", W / 2, H / 2); ctx.textAlign = "left"; }
      // per-template color grade — the signature that makes each cut read distinctly, even over a photo
      ctx.save();
      if (th.id === "redline") { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgba(184,36,32,.6)"; ctx.fillRect(0, 0, W, H); }
      else if (th.id === "amber") { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgba(201,150,60,.52)"; ctx.fillRect(0, 0, W, H); }
      else if (th.id === "blackout") { ctx.fillStyle = "rgba(0,0,0,.44)"; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
      if (th.weave) { const s = 18; ctx.save(); ctx.globalAlpha = .55; for (let yy = 0; yy < H; yy += s) for (let xx = 0; xx < W; xx += s) { ctx.fillStyle = ((xx / s + yy / s) % 2 === 0) ? "rgba(245,241,232,.03)" : "rgba(0,0,0,.5)"; ctx.fillRect(xx, yy, s, s); } ctx.restore(); }
      if (th.grain) { for (let i = 0; i < 7000; i++) { ctx.fillStyle = `rgba(${Math.random() < .5 ? "245,241,232" : "0,0,0"},${Math.random() * .07})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2); } const vg = ctx.createRadialGradient(W / 2, H / 2, 220, W / 2, H / 2, 900); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); }
      // legibility gradients
      const g = ctx.createLinearGradient(0, H - 640, 0, H); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.86)"); ctx.fillStyle = g; ctx.fillRect(0, H - 640, W, 640);
      const gt = ctx.createLinearGradient(0, 0, 0, 320); gt.addColorStop(0, "rgba(0,0,0,.5)"); gt.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 320);
      // The Split — a charcoal caption block + red seam under the photo
      if (th.split) { ctx.fillStyle = INK; ctx.fillRect(0, H - 440, W, 440); ctx.fillStyle = RED; ctx.fillRect(0, H - 440, W, 6); }
      // The Monogram — faint oversized crest watermark
      if (th.motif === "monogram") { ctx.save(); ctx.globalAlpha = .08; ctx.translate(W / 2, H / 2); ctx.rotate(Math.PI / 4); const s = 300, n = 6, cs2 = (s * 2) / n; for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if ((r + k) % 2 === 0) { ctx.fillStyle = CREAM; ctx.fillRect(-s + k * cs2, -s + r * cs2, cs2, cs2); } ctx.restore(); }
      // frame per template (light, on photo)
      if (th.frame === "goldheavy") { ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.strokeRect(36, 36, W - 72, H - 72); ctx.strokeStyle = GOLD_LT; ctx.lineWidth = 1; ctx.strokeRect(46, 46, W - 92, H - 92); }
      else if (th.frame === "brackets") { ctx.strokeStyle = cm(.6); ctx.lineWidth = 3; const L = 70, o = 44; ([[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]] as const).forEach(([x, y, dx, dy]) => { ctx.beginPath(); ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke(); }); }
      else if (th.frame === "ticket") { ctx.strokeStyle = cm(.7); ctx.lineWidth = 2.5; rr(ctx, 44, 44, W - 88, H - 88, 20); ctx.stroke(); const py = H - 232; ctx.save(); ctx.strokeStyle = cm(.55); ctx.lineWidth = 2; ctx.setLineDash([2, 12]); ctx.beginPath(); ctx.moveTo(72, py); ctx.lineTo(W - 72, py); ctx.stroke(); ctx.restore(); ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(44, py, 22, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(W - 44, py, 22, 0, 7); ctx.fill(); eyebrow("Admit One · GT3", W / 2, py + 42, cm(.6), "center", 5); }
      else if (th.frame === "press") { ctx.fillStyle = cm(.42); ctx.fillRect(M, H - 160, W - 2 * M, 3); }
      else if (th.frame === "proof") { ctx.strokeStyle = cm(.28); ctx.lineWidth = 1; ctx.strokeRect(58, 58, W - 116, H - 116); ctx.strokeStyle = cm(.7); ctx.lineWidth = 1.5; const o = 30, L = 26; ([[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]] as const).forEach(([x, y, dx, dy]) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * L, y); ctx.moveTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke(); }); regTarget(W / 2, 30, 11, cm(.7)); regTarget(W / 2, H - 30, 11, cm(.7)); regTarget(30, H / 2, 11, cm(.7)); regTarget(W - 30, H / 2, 11, cm(.7)); }
      else { const c1 = th.gold || th.warm ? GOLD : cm(.5); ctx.strokeStyle = c1; ctx.lineWidth = 2; ctx.strokeRect(38, 38, W - 76, H - 76); ctx.strokeStyle = th.gold || th.warm ? GOLD_LT : cm(.24); ctx.lineWidth = 1; ctx.strokeRect(48, 48, W - 96, H - 96); }
      // top — editorial masthead or the crest
      if (th.motif === "masthead") { eyebrow("GT3 · Performance Bar", W / 2, 120, cm(.9), "center", 6); ctx.fillStyle = cm(.5); ctx.fillRect(M, 150, W - 2 * M, 5); }
      else { const cy = 146, cx = W / 2, gc = th.gold || th.warm ? GOLD_LT : cm(.85); const hw = emblem(cx, cy, CREAM, CREAM, true); ctx.strokeStyle = gc; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(M + 6, cy); ctx.lineTo(cx - hw - 18, cy); ctx.moveTo(cx + hw + 18, cy); ctx.lineTo(W - M - 6, cy); ctx.stroke(); eyebrow("GT3 Mobile Bar", cx, cy + 58, gc, "center"); }
      // Checkered Flag — a cream/red racing band across the top
      if (th.motif === "band") { const by = 252, cs2 = 30; for (let r = 0; r < 2; r++) for (let k = 0; k <= Math.ceil((W - 2 * M) / cs2); k++) if ((r + k) % 2 === 0) { ctx.fillStyle = r === 0 ? CREAM : RED; ctx.fillRect(M + k * cs2, by + r * cs2, cs2, cs2); } }
      // headline
      const pAcc = th.gold ? GOLD : (th.accent === INK ? RED : th.accent);
      const pL1 = (f.headline1 || "").toUpperCase(), pL2 = (f.headline2 || "").toUpperCase(), pMaxW = W - 2 * M;
      const pHs = Math.min(fitSize(pL1, 100, pMaxW), fitSize(pL2, 100, pMaxW)), pGap = Math.round(pHs * 1.04);
      disp(pL1, M, H - 196 - pGap, "#fff", pHs, th.glow ? RED : undefined);
      disp(pL2, M, H - 196, pAcc, pHs, th.glow ? RED : undefined);
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
    const aL1 = (f.headline1 || "").toUpperCase(), aL2 = (f.headline2 || "").toUpperCase(), aMaxW = W - 2 * M;
    const aHs = Math.min(fitSize(aL1, 112, aMaxW), fitSize(aL2, 112, aMaxW)), aGap = Math.round(aHs * 1.02);
    disp(aL1, M, M + 312, onBand ? (th.headInk || CREAM) : th.ink, aHs, th.glow ? RED : undefined);
    disp(aL2, M, M + 312 + aGap, th.gold ? goldHead(M + 312 + aGap, aHs) : th.accent, aHs, th.glow ? RED : undefined);
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
    const res = await uploadToBucket({ bucket: "content", file: blob, path: `flyer/feed-${new Date().getTime()}.png`, upsert: true });
    if ("error" in res) { toast(`Save failed — ${res.error}`, "error"); setBusy(false); return; }
    const mediaUrl = res.url;
    const caption = tile === "menu" || tile === "submenu" ? "The pour list — every bottle made to order."
      : tile === "details" ? "Tasting notes — what's in the glass, and why."
      : f.place ? `Find us on the road — ${f.place}${f.date ? ` · ${f.date}` : ""}${f.time ? ` · ${f.time}` : ""}.` : "Find us on the road.";
    const { error } = await supabase.from("content_items").insert({ title: `${f.place || "Road"} — ${tile}`, kind: "post", caption, media: [{ url: mediaUrl, type: "image" }], media_url: mediaUrl, media_type: "image", created_by: user?.id ?? null, updated_by: user?.id ?? null });
    setBusy(false);
    toast(error ? `Save failed — ${error.message}` : "Saved to the feed — schedule it in Board/Grid");
  };

  const field = (k: keyof typeof f, label: string, ph: string) => (
    <label className="rf-f"><span>{label}</span><input value={f[k]} onChange={(e) => { if (k === "headline1" || k === "headline2") headEditedRef.current = true; setF((p) => ({ ...p, [k]: e.target.value })); }} placeholder={ph} /></label>
  );
  const usesPhoto = tile === "announce" || tile === "photo";

  return (
    <div className="rf">
      <div className="rf-tpl-head">
        <span>Template · {THEMES[tpl].name}</span>
        <button type="button" className="rf-ai" onClick={suggest} disabled={suggesting}>{suggesting ? "Thinking…" : <><Icon name="sparkles" /> Suggest for me</>}</button>
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
          <button type="button" className="rf-btn" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Working…" : f.photo ? "Replace photo" : <><Icon name="plus" /> Add photo</>}</button>
          {f.photo && <button type="button" className="rf-btn ghost" onClick={() => setF((p) => ({ ...p, photo: "" }))}>Remove</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadPhoto(file); e.target.value = ""; }} />
        </div>
      )}
      <canvas ref={canvasRef} width={W} height={H} className="rf-canvas" />
      <div className="rf-actions">
        <button type="button" className="rf-dl ghost" onClick={download}>Download</button>
        <button type="button" className="rf-dl" onClick={saveToFeed} disabled={busy}>{busy ? "Saving…" : <><Icon name="star" /> Save to feed</>}</button>
      </div>
    </div>
  );
}
