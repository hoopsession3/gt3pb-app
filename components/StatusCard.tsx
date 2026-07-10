"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Sheet from "./Sheet";
import { haptic, HAPTIC } from "@/lib/haptics";

// SHOW OFF YOUR STATUS — the member's card, made into an object they own. It's DUAL-SIDED: the front
// is their portrait held in the frame, the back is their GT3 member card (tier, name, code). Tap it
// and it turns to machined steel, rocks, and spins a turn-and-a-half — LV-style — to its other half.
// Drag to tilt it in your hand. They choose a finish and their own motto, so it's THEIRS. The viral
// export is untouched: Share still hands them the 1080×1350 PNG (Web Share API, save fallback), with
// their referral code on it. Brand-locked art only (the "3" mark + the caffeine molecule from /brand).

const W = 1080, H = 1350;
const GOLD = "#C8A661", GOLD_DEEP = "#B8902F", CREAM = "#F5F1E8", CREAM_M = "rgba(245,241,232,.66)";

type Finish = "gold" | "steel" | "carbon" | "redline";
const FINISHES: { key: Finish; label: string }[] = [
  { key: "gold", label: "Gold" },
  { key: "steel", label: "Steel" },
  { key: "carbon", label: "Carbon" },
  { key: "redline", label: "Redline" },
];
const MOTTO_DEFAULT = "Pure Signal, No Noise";

export default function StatusCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user } = useAuth();
  const { toast } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // the interactive card
  const [turns, setTurns] = useState(0);        // each tap +3 → a 540° whirl that lands on the other face
  const [spinning, setSpinning] = useState(false);
  const [pointer, setPointer] = useState(false);
  const [finish, setFinish] = useState<Finish>("gold");
  const [motto, setMotto] = useState(MOTTO_DEFAULT);
  const [editMotto, setEditMotto] = useState(false);

  const founding = Boolean(profile?.founding_member);
  const tierLine = founding ? "FOUNDING MEMBER" : "MEMBER";
  const name = (profile?.display_name || user?.email?.split("@")[0] || "Member").split(" ")[0].toUpperCase();
  const code = profile?.referral_code || "";
  const sinceYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();
  const showingBack = turns % 2 === 1;

  // Restore their custom finish + motto (a per-device choice — no migration for a cosmetic pref).
  useEffect(() => {
    try {
      const f = localStorage.getItem("gt3-card-finish") as Finish | null;
      if (f && FINISHES.some((x) => x.key === f)) setFinish(f);
      const m = localStorage.getItem("gt3-card-motto");
      if (m && m.trim()) setMotto(m.slice(0, 30));
    } catch { /* private mode / SSR */ }
  }, []);
  const pickFinish = (f: Finish) => { setFinish(f); haptic(HAPTIC.tap); try { localStorage.setItem("gt3-card-finish", f); } catch { /* ignore */ } };
  const saveMotto = (v: string) => { const m = v.trim().slice(0, 30) || MOTTO_DEFAULT; setMotto(m); setEditMotto(false); try { localStorage.setItem("gt3-card-motto", m); } catch { /* ignore */ } };

  // ── the shareable PNG (unchanged behavior; now reflects their motto) ──
  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* fonts optional */ }
    const photo = photoRef.current;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#12100b"); bg.addColorStop(0.55, "#0b0906"); bg.addColorStop(1, "#100d09");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    if (photo) {
      const inset = 46, iw = W - inset * 2, ih = H - inset * 2;
      const r = Math.max(iw / photo.width, ih / photo.height);
      const pw = photo.width * r, ph = photo.height * r;
      ctx.save();
      ctx.beginPath(); ctx.rect(inset, inset, iw, ih); ctx.clip();
      ctx.drawImage(photo, inset + (iw - pw) / 2, inset + (ih - ph) / 2, pw, ph);
      const top = ctx.createLinearGradient(0, inset, 0, inset + 300);
      top.addColorStop(0, "rgba(11,9,6,.82)"); top.addColorStop(1, "rgba(11,9,6,0)");
      ctx.fillStyle = top; ctx.fillRect(inset, inset, iw, 300);
      const bot = ctx.createLinearGradient(0, H - inset - 560, 0, H - inset);
      bot.addColorStop(0, "rgba(8,6,4,0)"); bot.addColorStop(0.5, "rgba(8,6,4,.72)"); bot.addColorStop(1, "rgba(8,6,4,.96)");
      ctx.fillStyle = bot; ctx.fillRect(inset, H - inset - 560, iw, 560);
      ctx.restore();
    } else {
      const aura = ctx.createRadialGradient(W / 2, 470, 40, W / 2, 470, 560);
      aura.addColorStop(0, "rgba(200,166,97,.18)"); aura.addColorStop(1, "rgba(200,166,97,0)");
      ctx.fillStyle = aura; ctx.fillRect(0, 0, W, H);
    }

    ctx.strokeStyle = "rgba(200,166,97,.62)"; ctx.lineWidth = 3; ctx.strokeRect(46, 46, W - 92, H - 92);
    ctx.strokeStyle = "rgba(200,166,97,.22)"; ctx.lineWidth = 1; ctx.strokeRect(60, 60, W - 120, H - 120);

    ctx.textAlign = "center"; ctx.fillStyle = CREAM_M;
    ctx.font = "500 30px 'DM Mono', ui-monospace, monospace";
    ctx.fillText("G T 3   P E R F O R M A N C E   B A R", W / 2, 152);

    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { const s = photo ? 96 : 300; ctx.drawImage(img, W / 2 - s / 2, photo ? 186 : 300, s, s); resolve(); };
      img.onerror = () => { if (!photo) { ctx.fillStyle = CREAM; ctx.font = "700 300px 'Inter', sans-serif"; ctx.fillText("3", W / 2, 590); } resolve(); };
      img.src = "/brand/3-outline.svg";
    });

    const grad = ctx.createLinearGradient(0, 890, 0, 970);
    grad.addColorStop(0, GOLD); grad.addColorStop(1, GOLD_DEEP);
    ctx.fillStyle = grad; ctx.font = `800 ${founding ? 74 : 78}px 'Inter', sans-serif`;
    ctx.fillText(tierLine, W / 2, 970);

    ctx.strokeStyle = "rgba(200,166,97,.55)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2 - 90, 1018); ctx.lineTo(W / 2 + 90, 1018); ctx.stroke();

    ctx.fillStyle = CREAM; ctx.font = "650 56px 'Inter', sans-serif"; ctx.fillText(name, W / 2, 1096);
    ctx.fillStyle = CREAM_M; ctx.font = "500 25px 'DM Mono', ui-monospace, monospace";
    ctx.fillText(`MEMBER SINCE ${sinceYear}  ·  ${motto.toUpperCase()}`, W / 2, 1142);

    ctx.fillStyle = GOLD; ctx.font = "600 29px 'DM Mono', ui-monospace, monospace";
    ctx.fillText(code ? `app.gt3pb.com  ·  JOIN WITH ${code}` : "app.gt3pb.com  ·  join the drop", W / 2, 1236);

    setReady(true);
  }, [founding, name, code, sinceYear, tierLine, motto]);

  useEffect(() => { if (open) { setReady(false); draw(); } }, [open, draw]);
  useEffect(() => () => { if (spinTimer.current) clearTimeout(spinTimer.current); }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { photoRef.current = img; setHasPhoto(true); setPhotoUrl(url); haptic(HAPTIC.tap); draw(); if (showingBack) flip(); };
    img.onerror = () => toast("Couldn't read that photo — try another", "error");
    img.src = url;
  };
  const clearPhoto = () => { photoRef.current = null; setHasPhoto(false); if (photoUrl) { try { URL.revokeObjectURL(photoUrl); } catch { /* ignore */ } } setPhotoUrl(null); draw(); };

  // ── the flip — a turn-and-a-half spin to the other face, with a steel glint sweep ──
  const flip = () => {
    setTurns((t) => t + 3);
    setSpinning(true); haptic(HAPTIC.tap);
    if (spinTimer.current) clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpinning(false), 1200);
  };

  // ── tilt in the hand — pointer parallax; releases back to a gentle idle sway ──
  const onTilt = (e: React.PointerEvent) => {
    const el = tiltRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ty", `${x * 16}deg`);
    el.style.setProperty("--tx", `${-y * 12}deg`);
    if (!pointer) setPointer(true);
  };
  const offTilt = () => { const el = tiltRef.current; if (el) { el.style.removeProperty("--tx"); el.style.removeProperty("--ty"); } setPointer(false); };

  const share = async () => {
    const cv = canvasRef.current; if (!cv) return;
    haptic(HAPTIC.success);
    const blob: Blob | null = await new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
    if (!blob) { toast("Couldn't make the image — try again", "error"); return; }
    const file = new File([blob], "gt3-status.png", { type: "image/png" });
    const shareText = `I'm a GT3 ${founding ? "Founding Member" : "Member"}. ${motto}.${code ? ` Join with ${code} → app.gt3pb.com` : " app.gt3pb.com"}`;
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
      header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Your GT3 card</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">✕</button></div>}
      footer={<button type="button" className="status-share" onClick={share} disabled={!ready}>Share your status ↗</button>}>

      {/* the object they own — tap to spin, drag to tilt */}
      <div className={`fc-scene f-${finish}`}>
        <div ref={tiltRef} className={`fc-tilt${pointer ? "" : " idle"}`} onPointerMove={onTilt} onPointerLeave={offTilt} onPointerCancel={offTilt}>
          <button type="button" className={`fc-card${spinning ? " spinning" : ""}`} style={{ ["--turn" as string]: `${turns * 180}deg` } as React.CSSProperties}
            onClick={flip} aria-label={`GT3 ${tierLine} card — tap to flip`}>
            {/* FRONT — the portrait, held in the frame */}
            <div className="fc-face fc-front">
              {photoUrl
                ? <img className="fc-photo" src={photoUrl} alt="" />
                : <div className="fc-mark"><img src="/brand/3-outline.svg" alt="" /></div>}
              <div className="fc-front-scrim" />
              <span className="fc-crest">3</span>
              <div className="fc-front-meta">
                <span className="fc-ribbon">{tierLine}</span>
                <span className="fc-fname">{name}</span>
              </div>
              <span className="fc-flip-hint">tap ↻</span>
            </div>
            {/* BACK — the member card */}
            <div className="fc-face fc-back">
              <span className="fc-back-molecule" aria-hidden />
              <span className="fc-eyebrow">G T 3 · PERFORMANCE BAR</span>
              <span className="fc-tier">{tierLine}</span>
              <span className="fc-rule" />
              <span className="fc-bname">{name}</span>
              <span className="fc-since">MEMBER SINCE {sinceYear}</span>
              <span className="fc-motto">{motto}</span>
              <span className="fc-code">{code ? `JOIN WITH ${code}` : "app.gt3pb.com"}</span>
            </div>
          </button>
        </div>
      </div>
      <p className="fc-hint">{showingBack ? "Your member card" : "Your portrait"} · tap to flip · drag to tilt</p>

      {/* make it theirs */}
      <div className="fc-finishes" role="radiogroup" aria-label="Card finish">
        {FINISHES.map((f) => (
          <button key={f.key} type="button" role="radio" aria-checked={finish === f.key}
            className={`fc-fin fin-${f.key}${finish === f.key ? " on" : ""}`} onClick={() => pickFinish(f.key)}>
            <span className="fc-fin-sw" aria-hidden /><span>{f.label}</span>
          </button>
        ))}
      </div>
      <div className="fc-motto-edit">
        {editMotto ? (
          <input className="auth-input" defaultValue={motto} maxLength={30} autoFocus
            onBlur={(e) => saveMotto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveMotto((e.target as HTMLInputElement).value); }}
            aria-label="Your motto" placeholder={MOTTO_DEFAULT} />
        ) : (
          <button type="button" className="fc-motto-btn" onClick={() => setEditMotto(true)}>✎ Your motto — &ldquo;{motto}&rdquo;</button>
        )}
      </div>

      {/* photo (feeds the portrait side + the share PNG) */}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPick} />
      <div className="status-photo-row">
        <button type="button" className="status-photo-btn" onClick={() => fileRef.current?.click()}>{hasPhoto ? "↺ Change photo" : "＋ Add your photo — the front frames it"}</button>
        {hasPhoto && <button type="button" className="status-photo-clear" onClick={clearPhoto} aria-label="Remove photo">✕</button>}
      </div>
      <p className="status-hint">Make it yours — a finish, your motto, your photo. Share it to your story and tag <b>@gt3pb</b>; your code&rsquo;s on the card, so every friend who joins with it earns you both a credit.</p>

      {/* off-screen canvas — the rasterized share image */}
      <canvas ref={canvasRef} width={W} height={H} className="status-canvas-export" aria-hidden />
    </Sheet>
  );
}
