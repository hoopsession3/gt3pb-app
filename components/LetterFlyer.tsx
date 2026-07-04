"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";

// LETTER FLYER — 10 generic, fully-editable announcement templates, drawn on canvas so they're
// pixel-identical every time. Unlike the poster Road Flyer, these carry NO preset GT3 saying — you
// write the announcement. The only fixed brand line is the tagline "Pure Signal. No Noise." Same
// locked grid (1080×1350, margins 64) and palette; each style is a distinct letter layout.
const W = 1080, H = 1350, M = 64;
const INK = "#15120D", RED = "#B82420", CREAM = "#F5F1E8", GOLD = "#A97C3F", GOLD_LT = "#C8A661";
const cm = (a: number) => `rgba(245,241,232,${a})`;
const mc = (a: number) => `rgba(21,18,13,${a})`;
// Crop box (fractions of gt3pb-handle.png) isolating the red "GT3" — we draw THESE pixels, never a redraw.
const LOGO = { fx: 0.035, fy: 0.05, fw: 0.93, fh: 0.5 };

type Style = { id: string; name: string; note: string };
const STYLES: Style[] = [
  { id: "letterhead", name: "Letterhead", note: "classic · centered" },
  { id: "memo", name: "Memo", note: "typewriter · TO / FROM" },
  { id: "editorial", name: "Editorial", note: "magazine · italic" },
  { id: "notice", name: "Notice", note: "framed · formal" },
  { id: "telegram", name: "Telegram", note: "vintage · STOP" },
  { id: "card", name: "Card", note: "charcoal · gilded" },
  { id: "manifesto", name: "Manifesto", note: "bold · statement" },
  { id: "gilded", name: "Gilded", note: "opulent · warm" },
  { id: "minimal", name: "Minimal", note: "quiet · airy" },
  { id: "bulletin", name: "Bulletin", note: "red banner · urgent" },
];

type Fields = { kicker: string; headline: string; body: string; signoff: string; date: string };
const DEFAULTS: Fields = {
  kicker: "Announcement",
  headline: "A Note From GT3",
  body: "We have something to share. Add your message here — what's changing, when it takes effect, and anything worth knowing.\nKeep it plain, and let it breathe.",
  signoff: "— Ryan & Kayla, GT3 Performance Bar",
  date: "",
};

type Ctx = CanvasRenderingContext2D;
type Img = HTMLImageElement | null;
/* eslint-disable @typescript-eslint/no-explicit-any */
const ls = (c: Ctx, v: string) => { (c as any).letterSpacing = v; };

// ── shared canvas primitives ──
const rr = (c: Ctx, x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
const wrapText = (c: Ctx, text: string, maxW: number) => {
  const words = (text || "").split(" "); const lines: string[] = []; let cur = "";
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
};
const eyebrow = (c: Ctx, t: string, x: number, y: number, color: string, align: CanvasTextAlign = "left", sp = 4, size = 21) => {
  c.save(); ls(c, `${sp}px`); c.font = `500 ${size}px 'DM Mono', monospace`; c.fillStyle = color; c.textAlign = align;
  c.fillText((t || "").toUpperCase(), x, y); c.restore(); ls(c, "0px"); c.textAlign = "left";
};
const fitDisp = (c: Ctx, t: string, maxSize: number, maxW: number, tracking = -1) => {
  c.save(); ls(c, `${tracking}px`); c.font = `900 ${maxSize}px 'Archivo Black', system-ui`; const w = c.measureText(t || "").width; c.restore(); ls(c, "0px");
  return w > maxW ? Math.max(46, Math.floor(maxSize * (maxW / w))) : maxSize;
};
const goldHead = (c: Ctx, y: number, size: number) => { const g = c.createLinearGradient(0, y - size, 0, y + 8); g.addColorStop(0, GOLD_LT); g.addColorStop(.5, GOLD); g.addColorStop(1, "#8a6531"); return g; };
// the REAL GT3 logo, cropped from the asset — never redrawn. chip = cream backing for the red field.
const gtLogo = (c: Ctx, logo: Img, cx: number, cy: number, h: number, chip: boolean) => {
  if (!logo || !logo.width) return null;
  const sx = LOGO.fx * logo.width, sy = LOGO.fy * logo.height, sw = LOGO.fw * logo.width, sh = LOGO.fh * logo.height;
  let dh = h, dw = sw * (dh / sh); const maxW = W - 2 * M - 100; if (dw > maxW) { const k = maxW / dw; dw *= k; dh *= k; }
  if (chip) { c.fillStyle = CREAM; rr(c, cx - dw / 2 - 18, cy - dh / 2 - 12, dw + 36, dh + 24, 12); c.fill(); }
  c.drawImage(logo, sx, sy, sw, sh, cx - dw / 2, cy - dh / 2, dw, dh);
  return dw / 2;
};
const emblem = (c: Ctx, logo: Img, cx: number, cy: number, h: number, dark: boolean, chip = false) => {
  const hw = gtLogo(c, logo, cx, cy, h, chip); if (hw != null) return hw;
  c.save(); ls(c, "-2px"); c.font = `900 ${h * .8}px 'Archivo Black', system-ui`; c.textAlign = "center"; c.textBaseline = "middle";
  const w = c.measureText("GT3").width; c.fillStyle = dark ? CREAM : RED; c.fillText("GT3", cx, cy);
  c.restore(); ls(c, "0px"); c.textAlign = "left"; c.textBaseline = "alphabetic"; return w / 2;
};
const crestRow = (c: Ctx, logo: Img, cx: number, cy: number, h: number, lineColor: string, dark: boolean, chip = false) => {
  const hw = emblem(c, logo, cx, cy, h, dark, chip);
  c.strokeStyle = lineColor; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(M + 6, cy); c.lineTo(cx - hw - 20, cy); c.moveTo(cx + hw + 20, cy); c.lineTo(W - M - 6, cy); c.stroke();
  return hw;
};
const para = (c: Ctx, text: string, x: number, y: number, maxW: number, font: string, color: string, lh: number, align: CanvasTextAlign = "left") => {
  c.font = font; c.fillStyle = color; c.textAlign = align;
  const ax = align === "center" ? x + maxW / 2 : align === "right" ? x + maxW : x;
  let yy = y;
  for (const p of (text || "").split("\n")) { if (!p.trim()) { yy += lh * .55; continue; } for (const l of wrapText(c, p.trim(), maxW)) { c.fillText(l, ax, yy); yy += lh; } yy += lh * .34; }
  c.textAlign = "left"; return yy;
};
// the one fixed brand line — same lockup as the poster flyer footer
const footerMark = (c: Ctx, logo: Img, dark: boolean) => {
  c.fillStyle = dark ? cm(.28) : "rgba(200,166,97,.5)"; c.fillRect(M, H - 150, W - 2 * M, 1.5); c.textAlign = "left";
  if (logo && logo.width) {
    const sx = LOGO.fx * logo.width, sy = LOGO.fy * logo.height, sw = LOGO.fw * logo.width, sh = LOGO.fh * logo.height;
    const dh = 40, dw = sw * (dh / sh), y = Math.round(H - 96 - dh / 2); c.drawImage(logo, sx, sy, sw, sh, M, y, dw, dh);
  } else { c.font = "900 38px 'Archivo Black', system-ui"; c.fillStyle = dark ? CREAM : RED; c.fillText("GT3", M, H - 74); }
  c.textAlign = "right"; c.font = "900 28px 'Archivo Black', system-ui"; c.fillStyle = dark ? CREAM : INK; c.fillText("PURE SIGNAL.", W - M, H - 98);
  c.fillStyle = RED; c.fillText("NO NOISE.", W - M, H - 64); c.textAlign = "left";
};
// break an ALL-CAPS display headline into fitted lines
const capLines = (c: Ctx, text: string, size: number, maxW: number, tracking: number) => {
  c.save(); ls(c, `${tracking}px`); c.font = `900 ${size}px 'Archivo Black', system-ui`;
  const words = (text || "").toUpperCase().split(" "); const lines: string[] = []; let cur = "";
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); c.restore(); ls(c, "0px"); return lines;
};

// ── the 10 letter layouts ──
function drawStyle(c: Ctx, logo: Img, id: string, F: Fields) {
  c.textBaseline = "alphabetic"; c.textAlign = "left"; ls(c, "0px");
  const dark = id === "card";
  const paper = dark ? INK : id === "gilded" ? "#efe7d6" : id === "telegram" ? "#f1ead9" : CREAM;
  const ink = dark ? CREAM : INK;
  c.fillStyle = paper; c.fillRect(0, 0, W, H);

  if (id === "letterhead") {
    const cy = 158; crestRow(c, logo, W / 2, cy, 64, GOLD, dark);
    eyebrow(c, F.kicker, W / 2, cy + 70, GOLD, "center", 6);
    c.strokeStyle = GOLD; c.lineWidth = 1.5; c.strokeRect(44, 44, W - 88, H - 88);
    if (F.date) eyebrow(c, F.date, W - M - 6, cy + 70, mc(.5), "right", 3, 18);
    c.font = "italic 600 76px Fraunces, Georgia, serif"; c.fillStyle = ink; c.textAlign = "center"; c.fillText(F.headline, W / 2, cy + 240); c.textAlign = "left";
    c.fillStyle = RED; c.fillRect(W / 2 - 40, cy + 286, 80, 4);
    para(c, F.body, M + 30, cy + 380, W - 2 * M - 60, "400 31px Inter, system-ui", ink, 44);
    c.font = "italic 600 34px Fraunces, Georgia, serif"; c.fillStyle = ink; c.textAlign = "right"; c.fillText(F.signoff, W - M - 30, H - 210); c.textAlign = "left";
    footerMark(c, logo, dark); return;
  }
  if (id === "memo") {
    c.font = "900 52px 'Archivo Black', system-ui"; c.fillStyle = INK; c.fillText("MEMORANDUM", M, 140);
    emblem(c, logo, W - M - 70, 120, 54, false);
    c.fillStyle = INK; c.fillRect(M, 168, W - 2 * M, 4);
    const rows: [string, string][] = [["TO", "Everyone"], ["FROM", F.signoff.replace(/^—\s*/, "")], ["DATE", F.date || "—"], ["RE", F.kicker]];
    let y = 232;
    for (const [k, v] of rows) { c.save(); ls(c, "2px"); c.font = "500 26px 'DM Mono', monospace"; c.fillStyle = mc(.5); c.fillText(k.padEnd(6), M, y); c.restore(); c.fillStyle = INK; c.font = "500 27px 'DM Mono', monospace"; c.fillText(v, M + 150, y); y += 48; }
    c.strokeStyle = mc(.5); c.lineWidth = 1.5; c.beginPath(); c.moveTo(M, y + 6); c.lineTo(W - M, y + 6); c.stroke(); c.beginPath(); c.moveTo(M, y + 12); c.lineTo(W - M, y + 12); c.stroke();
    c.font = "700 46px Inter, system-ui"; c.fillStyle = INK; c.fillText(F.headline, M, y + 90);
    para(c, F.body, M, y + 150, W - 2 * M, "400 30px Inter, system-ui", mc(.75), 44);
    footerMark(c, logo, false); return;
  }
  if (id === "editorial") {
    eyebrow(c, F.kicker, M, 120, RED, "left", 5);
    emblem(c, logo, W - M - 58, 108, 50, false);
    c.fillStyle = mc(.85); c.fillRect(M, 146, W - 2 * M, 3);
    c.font = "italic 600 90px Fraunces, Georgia, serif"; c.fillStyle = INK; c.textAlign = "left";
    const hl = wrapText(c, F.headline, W - 2 * M); let y = 300; for (const l of hl) { c.fillText(l, M, y); y += 92; }
    c.fillStyle = RED; c.fillRect(M, y - 40, 90, 5);
    const body = F.body.replace(/\n/g, " ");
    c.font = "700 118px Georgia, serif"; c.fillStyle = RED; c.fillText(body[0] || "", M, y + 118); const dcw = c.measureText(body[0] || "").width + 16;
    c.font = "400 32px Inter, system-ui"; c.fillStyle = mc(.8);
    const first = wrapText(c, body.slice(1), W - 2 * M - dcw); let yy = y + 70; let i = 0;
    for (; i < first.length && i < 2; i++) { c.fillText(first[i], M + dcw, yy); yy += 46; }
    para(c, first.slice(i).join(" "), M, yy + 2, W - 2 * M, "400 32px Inter, system-ui", mc(.8), 46);
    c.font = "italic 600 32px Fraunces, Georgia, serif"; c.fillStyle = INK; c.fillText(F.signoff, M, H - 205);
    footerMark(c, logo, false); return;
  }
  if (id === "notice") {
    c.strokeStyle = GOLD; c.lineWidth = 3; c.strokeRect(40, 40, W - 80, H - 80); c.strokeStyle = GOLD_LT; c.lineWidth = 1; c.strokeRect(52, 52, W - 104, H - 104);
    ([[40, 40], [W - 40, 40], [40, H - 40], [W - 40, H - 40]] as const).forEach(([x, y]) => { c.fillStyle = GOLD; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); });
    emblem(c, logo, W / 2, 150, 58, false);
    eyebrow(c, `· ${F.kicker} ·`, W / 2, 236, RED, "center", 6, 24);
    c.font = "italic 600 64px Fraunces, Georgia, serif"; c.fillStyle = INK; c.textAlign = "center";
    const hl = wrapText(c, F.headline, W - 2 * M - 80); let y = 340; for (const l of hl) { c.fillText(l, W / 2, y); y += 68; } c.textAlign = "left";
    c.strokeStyle = GOLD; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W / 2 - 70, y + 6); c.lineTo(W / 2 + 70, y + 6); c.stroke(); c.fillStyle = GOLD; c.beginPath(); c.arc(W / 2, y + 6, 5, 0, 7); c.fill();
    para(c, F.body, W / 2 - (W - 2 * M - 160) / 2, y + 70, W - 2 * M - 160, "400 31px Inter, system-ui", mc(.72), 46, "center");
    if (F.date) eyebrow(c, F.date, W / 2, H - 205, mc(.5), "center", 3, 20);
    footerMark(c, logo, false); return;
  }
  if (id === "telegram") {
    c.strokeStyle = INK; c.lineWidth = 3; c.beginPath(); c.moveTo(M, 96); c.lineTo(W - M, 96); c.stroke(); c.lineWidth = 1.5; c.beginPath(); c.moveTo(M, 104); c.lineTo(W - M, 104); c.stroke();
    emblem(c, logo, W / 2, 168, 50, false);
    eyebrow(c, "GT3 TELEGRAM", W / 2, 244, INK, "center", 8, 28);
    eyebrow(c, `${F.date || "—"}  —  PRIORITY`, W / 2, 286, mc(.55), "center", 3, 19);
    c.strokeStyle = mc(.4); c.lineWidth = 1; c.beginPath(); c.moveTo(M, 314); c.lineTo(W - M, 314); c.stroke();
    const tel = `${F.headline}. ${F.body.replace(/\n/g, " ")}`.toUpperCase().replace(/\.\s*/g, " STOP ").trim();
    c.save(); ls(c, "1px"); let y = 384; c.font = "500 30px 'DM Mono', monospace"; c.fillStyle = INK;
    for (const l of wrapText(c, tel, W - 2 * M)) { c.fillText(l, M, y); y += 46; } c.restore(); ls(c, "0px");
    c.font = "500 26px 'DM Mono', monospace"; c.fillStyle = mc(.6); c.fillText(F.signoff.toUpperCase(), M, y + 30);
    footerMark(c, logo, false); return;
  }
  if (id === "card") {
    c.strokeStyle = "rgba(200,166,97,.6)"; c.lineWidth = 1.5; c.strokeRect(46, 46, W - 92, H - 92);
    const cy = 168; crestRow(c, logo, W / 2, cy, 60, "rgba(200,166,97,.55)", true);
    eyebrow(c, F.kicker, W / 2, cy + 68, GOLD_LT, "center", 6);
    c.font = "italic 600 62px Fraunces, Georgia, serif"; c.fillStyle = CREAM; c.textAlign = "center";
    const hl = wrapText(c, F.headline, W - 2 * M - 40); let y = cy + 210; for (const l of hl) { c.fillText(l, W / 2, y); y += 66; } c.textAlign = "left";
    c.strokeStyle = GOLD; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W / 2 - 60, y + 2); c.lineTo(W / 2 + 60, y + 2); c.stroke();
    para(c, F.body, W / 2 - (W - 2 * M - 140) / 2, y + 66, W - 2 * M - 140, "400 31px Inter, system-ui", cm(.72), 46, "center");
    c.font = "italic 600 32px Fraunces, Georgia, serif"; c.fillStyle = GOLD_LT; c.textAlign = "center"; c.fillText(F.signoff, W / 2, H - 205); c.textAlign = "left";
    footerMark(c, logo, true); return;
  }
  if (id === "manifesto") {
    emblem(c, logo, M + 52, 116, 52, false); eyebrow(c, F.kicker, M + 96, 124, RED, "left", 5);
    const hs = fitDisp(c, F.headline, 120, W - 2 * M, -2);
    c.save(); ls(c, "-2px"); c.font = `900 ${hs}px 'Archivo Black', system-ui`; c.fillStyle = INK;
    const lines = capLines(c, F.headline, hs, W - 2 * M, -2); let y = 300; const lh = Math.round(hs * 1.02);
    for (const l of lines) { c.fillText(l, M, y); y += lh; } c.restore(); ls(c, "0px");
    c.fillStyle = RED; c.fillRect(M, y - lh + 40, 180, 10);
    para(c, F.body, M, y + 30, W - 2 * M, "400 34px Inter, system-ui", mc(.8), 48);
    c.font = "700 30px Inter, system-ui"; c.fillStyle = INK; c.fillText(F.signoff, M, H - 205);
    footerMark(c, logo, false); return;
  }
  if (id === "gilded") {
    c.strokeStyle = GOLD; c.lineWidth = 3; c.strokeRect(38, 38, W - 76, H - 76); c.strokeStyle = GOLD_LT; c.lineWidth = 1; c.strokeRect(48, 48, W - 96, H - 96);
    ([[38, 38], [W - 38, 38], [38, H - 38], [W - 38, H - 38]] as const).forEach(([x, y]) => { c.fillStyle = GOLD; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); });
    emblem(c, logo, W / 2, 158, 58, false);
    eyebrow(c, F.kicker, W / 2, 240, GOLD, "center", 6);
    c.font = "italic 600 66px Fraunces, Georgia, serif"; c.fillStyle = goldHead(c, 340, 66); c.textAlign = "center";
    const hl = wrapText(c, F.headline, W - 2 * M - 80); let y = 336; for (const l of hl) { c.fillText(l, W / 2, y); y += 68; } c.textAlign = "left";
    c.strokeStyle = GOLD; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W / 2 - 90, y + 4); c.lineTo(W / 2 - 14, y + 4); c.moveTo(W / 2 + 14, y + 4); c.lineTo(W / 2 + 90, y + 4); c.stroke(); c.fillStyle = GOLD; c.beginPath(); c.arc(W / 2, y + 4, 5, 0, 7); c.fill();
    para(c, F.body, W / 2 - (W - 2 * M - 160) / 2, y + 70, W - 2 * M - 160, "400 31px Inter, system-ui", mc(.7), 46, "center");
    c.font = "italic 600 32px Fraunces, Georgia, serif"; c.fillStyle = GOLD; c.textAlign = "center"; c.fillText(F.signoff, W / 2, H - 205); c.textAlign = "left";
    footerMark(c, logo, false); return;
  }
  if (id === "minimal") {
    const M2 = 110;
    emblem(c, logo, M2 + 40, 120, 44, false);
    if (F.date) eyebrow(c, F.date, W - M2, 124, mc(.45), "right", 3, 18);
    c.strokeStyle = mc(.25); c.lineWidth = 1; c.beginPath(); c.moveTo(M2, 168); c.lineTo(W - M2, 168); c.stroke();
    const hs = fitDisp(c, F.headline, 72, W - 2 * M2, -1);
    c.save(); ls(c, "-1px"); c.font = `900 ${hs}px 'Archivo Black', system-ui`; c.fillStyle = INK;
    const lines = capLines(c, F.headline, hs, W - 2 * M2, -1); let y = 430; for (const l of lines) { c.fillText(l, M2, y); y += Math.round(hs * 1.08); } c.restore(); ls(c, "0px");
    para(c, F.body, M2, y + 30, W - 2 * M2 - 120, "400 32px Inter, system-ui", mc(.6), 48);
    eyebrow(c, F.signoff, M2, H - 210, mc(.55), "left", 2, 20);
    c.fillStyle = mc(.2); c.fillRect(M2, H - 150, W - 2 * M2, 1); c.textAlign = "left";
    if (logo && logo.width) { const sx = LOGO.fx * logo.width, sy = LOGO.fy * logo.height, sw = LOGO.fw * logo.width, sh = LOGO.fh * logo.height; const dh = 34, dw = sw * (dh / sh); c.drawImage(logo, sx, sy, sw, sh, M2, H - 92 - dh / 2, dw, dh); }
    eyebrow(c, "Pure Signal. No Noise.", W - M2, H - 84, mc(.5), "right", 2, 20); return;
  }
  if (id === "bulletin") {
    c.fillStyle = RED; c.fillRect(0, 0, W, 210);
    eyebrow(c, F.kicker, M, 118, cm(.75), "left", 6, 26);
    emblem(c, logo, W - M - 72, 105, 58, false, true);
    c.font = "900 44px 'Archivo Black', system-ui"; c.fillStyle = CREAM; c.fillText("GT3 · PERFORMANCE BAR", M, 168);
    const hs = fitDisp(c, F.headline, 88, W - 2 * M, -1);
    c.save(); ls(c, "-1px"); c.font = `900 ${hs}px 'Archivo Black', system-ui`; c.fillStyle = INK;
    const lines = capLines(c, F.headline, hs, W - 2 * M, -1); let y = 320; for (const l of lines) { c.fillText(l, M, y); y += Math.round(hs * 1.04); } c.restore(); ls(c, "0px");
    c.fillStyle = RED; c.fillRect(M, y - hs + 34, 140, 6);
    para(c, F.body, M, y + 34, W - 2 * M, "400 33px Inter, system-ui", mc(.78), 48);
    c.font = "700 30px Inter, system-ui"; c.fillStyle = INK; c.fillText(F.signoff, M, H - 208);
    footerMark(c, logo, false); return;
  }
}

export default function LetterFlyer() {
  const { toast } = useApp();
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tpl, setTpl] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Fields>(DEFAULTS);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const [logoReady, setLogoReady] = useState(0);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? Number(localStorage.getItem("gt3-letter-tpl")) : 0;
    if (saved >= 0 && saved < STYLES.length) setTpl(saved);
  }, []);
  const pickTpl = (i: number) => { setTpl(i); if (typeof window !== "undefined") localStorage.setItem("gt3-letter-tpl", String(i)); };

  useEffect(() => {
    let alive = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { if (alive) { logoRef.current = img; setLogoReady((n) => n + 1); } };
    img.src = "/brand/gt3pb-handle.png";
    return () => { alive = false; };
  }, []);

  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return; const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await Promise.all([document.fonts.load("900 100px 'Archivo Black'"), document.fonts.load("700 46px Inter"), document.fonts.load("500 24px 'DM Mono'"), document.fonts.load("italic 600 84px Fraunces")]); } catch { /* */ }
    drawStyle(ctx, logoRef.current, STYLES[tpl]?.id ?? "letterhead", f);
  }, [f, tpl, logoReady]);

  useEffect(() => { draw(); }, [draw]);

  const toBlob = () => new Promise<Blob | null>((res) => canvasRef.current?.toBlob(res, "image/png"));
  const download = async () => {
    await draw(); const blob = await toBlob();
    if (!blob) { toast("Export failed — try again.", "error"); return; }
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `gt3-letter-${STYLES[tpl].id}-${(f.headline || "note").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40)}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const saveToFeed = async () => {
    if (!supabase) return; setBusy(true);
    await draw(); const blob = await toBlob();
    if (!blob) { toast("Couldn't render — try again.", "error"); setBusy(false); return; }
    const path = `flyer/letter-${new Date().getTime()}.png`;
    const up = await supabase.storage.from("content").upload(path, blob, { upsert: true, contentType: "image/png" });
    if (up.error) { toast(`Save failed — ${up.error.message}`, "error"); setBusy(false); return; }
    const mediaUrl = supabase.storage.from("content").getPublicUrl(path).data.publicUrl;
    const caption = `${f.headline}${f.body ? ` — ${f.body.split("\n")[0]}` : ""}`.slice(0, 300);
    const { error } = await supabase.from("content_items").insert({ title: f.headline || "Announcement", kind: "post", caption, media: [{ url: mediaUrl, type: "image" }], media_url: mediaUrl, media_type: "image", created_by: user?.id ?? null, updated_by: user?.id ?? null });
    setBusy(false);
    toast(error ? `Save failed — ${error.message}` : "Saved to the feed — schedule it in Board/Grid");
  };

  const field = (k: keyof Fields, label: string, ph: string) => (
    <label className="rf-f"><span>{label}</span><input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={ph} /></label>
  );

  return (
    <div className="rf">
      <div className="rf-tpl-head"><span>Letter · {STYLES[tpl].name}</span></div>
      <div className="rf-tpls" role="tablist" aria-label="Letter style">
        {STYLES.map((t, i) => (
          <button key={t.id} type="button" className={`rf-tpl${tpl === i ? " on" : ""}`} onClick={() => pickTpl(i)} title={t.note}>{t.name}</button>
        ))}
      </div>
      <div className="rf-note">10 editable letter styles for announcements. Pick a style, write your note — the only fixed line is <b>Pure Signal. No Noise.</b> Then download or save to the feed.</div>
      {field("kicker", "Kicker (small label)", "Announcement")}
      {field("headline", "Headline", "A Note From GT3")}
      <label className="rf-f"><span>Message (one blank line = new paragraph)</span><textarea rows={5} value={f.body} onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))} /></label>
      {field("signoff", "Sign-off", "— Ryan & Kayla, GT3 Performance Bar")}
      {field("date", "Date (optional)", "July 4, 2026")}
      <canvas ref={canvasRef} width={W} height={H} className="rf-canvas" />
      <div className="rf-actions">
        <button type="button" className="rf-dl ghost" onClick={download}>⬇ Download</button>
        <button type="button" className="rf-dl" onClick={saveToFeed} disabled={busy}>{busy ? "Saving…" : "✦ Save to feed"}</button>
      </div>
    </div>
  );
}
