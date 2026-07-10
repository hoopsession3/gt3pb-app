"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Sheet from "./Sheet";
import { haptic, HAPTIC } from "@/lib/haptics";

// SHOW OFF YOUR STATUS — the viral activation, and the member's card doubles as a photo FRAME.
// A member taps "Show off your status," optionally drops in their own photo, and gets a portrait
// card (1080×1350, IG-ready): their photo framed by the gold membership card, their tier in gold,
// their name, and a join hook carrying their referral code. Share (Web Share API, image file) or
// save the PNG. Brand-locked art only (the "3" mark from /public/brand).

const W = 1080, H = 1350;
const GOLD = "#C8A661", GOLD_DEEP = "#B8902F", CREAM = "#F5F1E8", CREAM_M = "rgba(245,241,232,.66)";

export default function StatusCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user } = useAuth();
  const { toast } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);

  const founding = Boolean(profile?.founding_member);
  const tierLine = founding ? "FOUNDING MEMBER" : "MEMBER";
  const name = (profile?.display_name || user?.email?.split("@")[0] || "Member").split(" ")[0].toUpperCase();
  const code = profile?.referral_code || "";
  const sinceYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();

  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* fonts optional */ }
    const photo = photoRef.current;

    // Ground.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#12100b"); bg.addColorStop(0.55, "#0b0906"); bg.addColorStop(1, "#100d09");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    if (photo) {
      // The card frames the member's photo (cover-fit inside the inset), then a bottom scrim so the
      // gold text stays legible — a luxury ID/trading-card look.
      const inset = 46, iw = W - inset * 2, ih = H - inset * 2;
      const r = Math.max(iw / photo.width, ih / photo.height);
      const pw = photo.width * r, ph = photo.height * r;
      ctx.save();
      ctx.beginPath(); ctx.rect(inset, inset, iw, ih); ctx.clip();
      ctx.drawImage(photo, inset + (iw - pw) / 2, inset + (ih - ph) / 2, pw, ph);
      // top + bottom scrim for legibility
      const top = ctx.createLinearGradient(0, inset, 0, inset + 300);
      top.addColorStop(0, "rgba(11,9,6,.82)"); top.addColorStop(1, "rgba(11,9,6,0)");
      ctx.fillStyle = top; ctx.fillRect(inset, inset, iw, 300);
      const bot = ctx.createLinearGradient(0, H - inset - 560, 0, H - inset);
      bot.addColorStop(0, "rgba(8,6,4,0)"); bot.addColorStop(0.5, "rgba(8,6,4,.72)"); bot.addColorStop(1, "rgba(8,6,4,.96)");
      ctx.fillStyle = bot; ctx.fillRect(inset, H - inset - 560, iw, 560);
      ctx.restore();
    } else {
      // No photo: a soft gold aura behind the mark.
      const aura = ctx.createRadialGradient(W / 2, 470, 40, W / 2, 470, 560);
      aura.addColorStop(0, "rgba(200,166,97,.18)"); aura.addColorStop(1, "rgba(200,166,97,0)");
      ctx.fillStyle = aura; ctx.fillRect(0, 0, W, H);
    }

    // The frame — the machined gold edge (this is "the card as a frame").
    ctx.strokeStyle = "rgba(200,166,97,.62)"; ctx.lineWidth = 3; ctx.strokeRect(46, 46, W - 92, H - 92);
    ctx.strokeStyle = "rgba(200,166,97,.22)"; ctx.lineWidth = 1; ctx.strokeRect(60, 60, W - 120, H - 120);

    // Eyebrow.
    ctx.textAlign = "center"; ctx.fillStyle = CREAM_M;
    ctx.font = "500 30px 'DM Mono', ui-monospace, monospace";
    ctx.fillText("G T 3   P E R F O R M A N C E   B A R", W / 2, 152);

    // The mark — big & centered without a photo; a small crest up top with one.
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { const s = photo ? 96 : 300; ctx.drawImage(img, W / 2 - s / 2, photo ? 186 : 300, s, s); resolve(); };
      img.onerror = () => { if (!photo) { ctx.fillStyle = CREAM; ctx.font = "700 300px 'Inter', sans-serif"; ctx.fillText("3", W / 2, 590); } resolve(); };
      img.src = "/brand/3-outline.svg";
    });

    // Tier — the status, in gold.
    const grad = ctx.createLinearGradient(0, 890, 0, 970);
    grad.addColorStop(0, GOLD); grad.addColorStop(1, GOLD_DEEP);
    ctx.fillStyle = grad; ctx.font = `800 ${founding ? 74 : 78}px 'Inter', sans-serif`;
    ctx.fillText(tierLine, W / 2, 970);

    ctx.strokeStyle = "rgba(200,166,97,.55)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2 - 90, 1018); ctx.lineTo(W / 2 + 90, 1018); ctx.stroke();

    // Name + since.
    ctx.fillStyle = CREAM; ctx.font = "650 56px 'Inter', sans-serif"; ctx.fillText(name, W / 2, 1096);
    ctx.fillStyle = CREAM_M; ctx.font = "500 25px 'DM Mono', ui-monospace, monospace";
    ctx.fillText(`MEMBER SINCE ${sinceYear}  ·  PURE SIGNAL, NO NOISE`, W / 2, 1142);

    // Join hook — the viral edge.
    ctx.fillStyle = GOLD; ctx.font = "600 29px 'DM Mono', ui-monospace, monospace";
    ctx.fillText(code ? `app.gt3pb.com  ·  JOIN WITH ${code}` : "app.gt3pb.com  ·  join the drop", W / 2, 1236);

    setReady(true);
  }, [founding, name, code, sinceYear, tierLine]);

  useEffect(() => { if (open) { setReady(false); draw(); } }, [open, draw]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { photoRef.current = img; setHasPhoto(true); haptic(HAPTIC.tap); draw(); };
    img.onerror = () => toast("Couldn't read that photo — try another", "error");
    img.src = url;
  };
  const clearPhoto = () => { photoRef.current = null; setHasPhoto(false); draw(); };

  const share = async () => {
    const cv = canvasRef.current; if (!cv) return;
    haptic(HAPTIC.success);
    const blob: Blob | null = await new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
    if (!blob) { toast("Couldn't make the image — try again", "error"); return; }
    const file = new File([blob], "gt3-status.png", { type: "image/png" });
    const shareText = `I'm a GT3 ${founding ? "Founding Member" : "Member"}. Pure Signal, No Noise.${code ? ` Join with ${code} → app.gt3pb.com` : " app.gt3pb.com"}`;
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], text: shareText }); return; } catch { /* cancelled → save */ }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gt3-status.png"; a.click();
    toast("Saved — post it and tag @gt3pb");
  };

  if (!open) return null;
  return (
    <Sheet open onClose={onClose} className="status-lux"
      header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Show off your status</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">✕</button></div>}
      footer={<button type="button" className="status-share" onClick={share} disabled={!ready}>Share your status ↗</button>}>
      <div className="status-canvas-wrap">
        <canvas ref={canvasRef} width={W} height={H} className="status-canvas" aria-label={`GT3 ${tierLine} card`} />
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPick} />
      <div className="status-photo-row">
        <button type="button" className="status-photo-btn" onClick={() => fileRef.current?.click()}>{hasPhoto ? "↺ Change photo" : "＋ Add your photo — the card frames it"}</button>
        {hasPhoto && <button type="button" className="status-photo-clear" onClick={clearPhoto} aria-label="Remove photo">✕</button>}
      </div>
      <p className="status-hint">Drop in your photo and the card becomes the frame. Post it to your story and tag <b>@gt3pb</b> — your code&rsquo;s on the card, so every friend who joins with it earns you both a credit.</p>
    </Sheet>
  );
}
