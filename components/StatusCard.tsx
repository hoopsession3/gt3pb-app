"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Sheet from "./Sheet";
import { supabase } from "@/lib/supabase";
import { uploadToBucket } from "@/lib/uploads";
import { haptic, HAPTIC } from "@/lib/haptics";

// SHOW OFF YOUR STATUS — the member's card, made into an object they own. It's DUAL-SIDED: the front
// is their portrait held in the frame, the back is their GT3 member card (tier, name, code). Tap it
// and it turns to machined steel, rocks, and spins a turn-and-a-half — LV-style — to its other half.
// Drag to tilt it in your hand. They choose a finish and their own motto, so it's THEIRS. The viral
// export is untouched: Share still hands them the 1080×1350 PNG (Web Share API, save fallback), with
// their referral code on it. Brand-locked art only (the "3" mark + the caffeine molecule from /brand).

const W = 1080, H = 1350;

type Finish = "gold" | "steel" | "carbon" | "redline";
const FINISHES: { key: Finish; label: string }[] = [
  { key: "gold", label: "Gold" },
  { key: "steel", label: "Steel" },
  { key: "carbon", label: "Carbon" },
  { key: "redline", label: "Redline" },
];
const MOTTO_DEFAULT = "Pure Signal, No Noise";

// The shared PNG mirrors the member-card side in the member's chosen finish (matches the .fc-scene
// tokens). ink/accent/edge + a texture for the metallic finishes.
type Paint = { grd: [string, string, string]; ink: string; inkDim: string; accent: string; accentDeep: string; edge: string; edge2: string; tex: "none" | "brush" | "carbon" };
const FINISH_PAINT: Record<Finish, Paint> = {
  gold:    { grd: ["#171208", "#0c0906", "#120d08"], ink: "#F5F1E8", inkDim: "rgba(245,241,232,.62)", accent: "#C8A661", accentDeep: "#B8902F", edge: "rgba(200,166,97,.6)",  edge2: "rgba(200,166,97,.22)", tex: "none" },
  steel:   { grd: ["#3b414a", "#2a2f36", "#20242a"], ink: "#EEF1F4", inkDim: "rgba(238,241,244,.62)", accent: "#C3CCD6", accentDeep: "#8E99A4", edge: "rgba(224,230,236,.62)", edge2: "rgba(224,230,236,.24)", tex: "brush" },
  carbon:  { grd: ["#191919", "#141414", "#101010"], ink: "#F5F1E8", inkDim: "rgba(245,241,232,.6)",  accent: "#C8A661", accentDeep: "#B8902F", edge: "rgba(200,166,97,.5)",  edge2: "rgba(200,166,97,.18)", tex: "carbon" },
  redline: { grd: ["#171010", "#0a0707", "#140c0c"], ink: "#F5F1E8", inkDim: "rgba(245,241,232,.6)",  accent: "#E0453F", accentDeep: "#B8241F", edge: "rgba(184,36,32,.6)",  edge2: "rgba(184,36,32,.24)", tex: "none" },
};

export default function StatusCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user } = useAuth();
  const { toast } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  // The photo persists to the canonical avatar_url (same one ProfileSheet + the account circle use),
  // so it follows the member everywhere and survives a reload — not a throwaway local preview.
  const [hasPhoto, setHasPhoto] = useState(Boolean(profile?.avatar_url));
  const [photoUrl, setPhotoUrl] = useState<string | null>(profile?.avatar_url ?? null);

  // the interactive card
  const [turns, setTurns] = useState(0);        // each tap +3 → a 540° whirl that lands on the other face
  const [spinning, setSpinning] = useState(false);
  const [pointer, setPointer] = useState(false);
  const [finish, setFinish] = useState<Finish>("gold");
  const [motto, setMotto] = useState(MOTTO_DEFAULT);
  const [editMotto, setEditMotto] = useState(false);

  const founding = Boolean(profile?.founding_member);
  const tierLine = founding ? "FOUNDING MEMBER" : "MEMBER";
  const name = (profile?.display_name || user?.email?.split("@")[0] || "You").split(" ")[0].toUpperCase();
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

  // ── the shareable PNG = the MEMBER-CARD side, in their chosen finish (matches the card they hold) ──
  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* fonts optional */ }
    const p = FINISH_PAINT[finish];

    // ground
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, p.grd[0]); bg.addColorStop(0.55, p.grd[1]); bg.addColorStop(1, p.grd[2]);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // finish grain — brushed steel / carbon weave
    if (p.tex === "brush") {
      ctx.save(); ctx.lineWidth = 1;
      for (let x = -H; x < W; x += 5) {
        ctx.strokeStyle = Math.round(x) % 15 === 0 ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.05)";
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H * 0.5, H); ctx.stroke();
      }
      ctx.restore();
    } else if (p.tex === "carbon") {
      ctx.save(); ctx.lineWidth = 1.2;
      for (let x = -H; x < W; x += 8) { ctx.strokeStyle = "rgba(255,255,255,.035)"; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke(); }
      for (let x = 0; x < W + H; x += 8) { ctx.strokeStyle = "rgba(0,0,0,.06)"; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - H, H); ctx.stroke(); }
      ctx.restore();
    }

    // faint caffeine-molecule watermark (ties it to the craft brand)
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { ctx.save(); ctx.globalAlpha = 0.08; const s = 640; ctx.drawImage(img, W / 2 - s / 2, 470, s, s * 250 / 300); ctx.restore(); resolve(); };
      img.onerror = () => resolve();
      img.src = "/brand/caffeine-gt3.svg";
    });

    // machined edge
    ctx.strokeStyle = p.edge; ctx.lineWidth = 3; ctx.strokeRect(46, 46, W - 92, H - 92);
    ctx.strokeStyle = p.edge2; ctx.lineWidth = 1; ctx.strokeRect(60, 60, W - 120, H - 120);

    const lsp = (v: string) => { try { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = v; } catch { /* older canvas */ } };
    const sparkle = (x: number, y: number, r: number, c: string) => {
      ctx.save(); ctx.fillStyle = c; ctx.translate(x, y); ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a + Math.PI / 4) * r * 0.3, Math.sin(a + Math.PI / 4) * r * 0.3); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    };
    ctx.textAlign = "center";

    // brand lockup — "Grow your 3mpire", then a sparkling PB
    ctx.fillStyle = p.inkDim; ctx.font = "italic 500 34px 'Fraunces', serif";
    ctx.fillText("Grow your 3mpire", W / 2, 190);
    const pg = ctx.createLinearGradient(W / 2 - 72, 0, W / 2 + 72, 0);
    pg.addColorStop(0, p.accentDeep); pg.addColorStop(0.5, "#fff6d8"); pg.addColorStop(1, p.accentDeep);
    ctx.fillStyle = pg; ctx.font = "800 66px 'Archivo Black', 'Inter', sans-serif";
    ctx.fillText("PB", W / 2, 292);
    sparkle(W / 2 + 74, 244, 12, "#fff6d8"); sparkle(W / 2 - 78, 288, 8, p.accent);

    // "I PERFORM" — the hero, first person; the card is about them, so they'll share it
    const ig = ctx.createLinearGradient(0, 418, 0, 520);
    ig.addColorStop(0, p.accent); ig.addColorStop(1, p.accentDeep);
    lsp("8px"); ctx.fillStyle = ig; ctx.font = "800 92px 'Inter', sans-serif";
    ctx.fillText("I PERFORM", W / 2, 508); lsp("0px");

    ctx.strokeStyle = p.edge; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2 - 90, 572); ctx.lineTo(W / 2 + 90, 572); ctx.stroke();

    ctx.fillStyle = p.ink; ctx.font = "650 64px 'Inter', sans-serif"; ctx.fillText(name, W / 2, 672);

    // their member status — in gold
    lsp("5px"); ctx.fillStyle = p.accent; ctx.font = "600 32px 'Inter', sans-serif";
    ctx.fillText(tierLine, W / 2, 742); lsp("0px");

    ctx.fillStyle = p.inkDim; ctx.font = "500 24px 'DM Mono', ui-monospace, monospace";
    ctx.fillText(`MEMBER SINCE ${sinceYear}`, W / 2, 794);

    ctx.fillStyle = p.accent; ctx.font = "italic 600 44px 'Fraunces', serif"; ctx.fillText(motto, W / 2, 906);

    ctx.fillStyle = p.accent; ctx.font = "600 30px 'DM Mono', ui-monospace, monospace";
    ctx.fillText(code ? `JOIN WITH ${code}   ·   app.gt3pb.com` : "app.gt3pb.com", W / 2, 1254);

    setReady(true);
  }, [founding, name, code, sinceYear, tierLine, motto, finish]);

  useEffect(() => { if (open) { setReady(false); draw(); } }, [open, draw]);
  useEffect(() => () => { if (spinTimer.current) clearTimeout(spinTimer.current); }, []);
  // Adopt the saved photo when the profile loads (async) — unless the member just picked a new one.
  const dirtyPhoto = useRef(false);
  useEffect(() => { if (!dirtyPhoto.current && profile?.avatar_url) { setPhotoUrl(profile.avatar_url); setHasPhoto(true); } }, [profile?.avatar_url]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    dirtyPhoto.current = true;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { photoRef.current = img; setHasPhoto(true); setPhotoUrl(url); haptic(HAPTIC.tap); draw(); if (showingBack) flip(); };
    img.onerror = () => toast("Couldn't read that photo — try another", "error");
    img.src = url;
    // Persist to the canonical avatar_url so it survives reload and shows everywhere (profile, card).
    (async () => {
      if (!supabase || !user) { toast("Sign in to save your photo", "error"); return; }
      setSaving(true);
      const up = await uploadToBucket({ bucket: "avatars", file: f, path: `${user.id}/avatar.${(f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"}`, upsert: true });
      if ("url" in up) {
        const bust = `${up.url}?v=${Date.now()}`;  // cache-bust so the new photo shows immediately
        await supabase.from("profiles").update({ avatar_url: bust }).eq("id", user.id);
        setPhotoUrl(bust); toast("Photo saved");
      } else toast(`Couldn't save the photo — ${up.error}`, "error");
      setSaving(false);
      e.target.value = "";
    })();
  };
  const clearPhoto = async () => {
    dirtyPhoto.current = true;
    photoRef.current = null; setHasPhoto(false);
    if (photoUrl?.startsWith("blob:")) { try { URL.revokeObjectURL(photoUrl); } catch { /* ignore */ } }
    setPhotoUrl(null); draw();
    if (supabase && user) await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
  };

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
              <span className="fc-grow">Grow your 3mpire</span>
              <span className="fc-pbwrap"><span className="fc-pb">PB</span><i className="fc-spark s1" aria-hidden>✦</i><i className="fc-spark s2" aria-hidden>✦</i></span>
              <span className="fc-perform">I Perform</span>
              <span className="fc-rule" />
              <span className="fc-bname">{name}</span>
              <span className="fc-status">{tierLine}</span>
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
        <button type="button" className="status-photo-btn" onClick={() => fileRef.current?.click()} disabled={saving}>{saving ? "Saving…" : hasPhoto ? "↺ Change photo" : "＋ Add your photo — the front frames it"}</button>
        {hasPhoto && !saving && <button type="button" className="status-photo-clear" onClick={clearPhoto} aria-label="Remove photo">✕</button>}
      </div>
      <p className="status-hint">Make it yours — a finish, your motto, your photo. Share it to your story and tag <b>@gt3pb</b>; your code&rsquo;s on the card, so every friend who joins with it earns you both a credit.</p>

      {/* off-screen canvas — the rasterized share image */}
      <canvas ref={canvasRef} width={W} height={H} className="status-canvas-export" aria-hidden />
    </Sheet>
  );
}
