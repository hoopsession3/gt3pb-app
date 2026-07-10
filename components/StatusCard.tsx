"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Sheet from "./Sheet";
import { haptic, HAPTIC } from "@/lib/haptics";

// SHOW OFF YOUR STATUS — the viral activation. A member taps "Show off your status" and gets a
// portrait card (1080×1350, IG-ready) rendered on a canvas: the locked "3" mark, their tier in
// gold, their name, and a join hook carrying their referral code. Share (Web Share API, image file)
// or save the PNG. LV restraint: black → charcoal, cream mark, one gold line. Brand-locked art only.

const W = 1080, H = 1350;
const GOLD = "#C8A661", GOLD_DEEP = "#B8902F", CREAM = "#F5F1E8", CREAM_M = "rgba(245,241,232,.62)";

export default function StatusCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user } = useAuth();
  const { toast } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  const founding = Boolean(profile?.founding_member);
  const tierLine = founding ? "FOUNDING MEMBER" : "MEMBER";
  const name = (profile?.display_name || user?.email?.split("@")[0] || "Member").split(" ")[0].toUpperCase();
  const code = profile?.referral_code || "";
  const sinceYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();

  const draw = useCallback(async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    try { await (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* fonts optional */ }

    // Ground: a deep charcoal wash with a soft gold aura behind the mark.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#12100b"); bg.addColorStop(0.55, "#0b0906"); bg.addColorStop(1, "#100d09");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const aura = ctx.createRadialGradient(W / 2, 430, 40, W / 2, 430, 520);
    aura.addColorStop(0, "rgba(200,166,97,.16)"); aura.addColorStop(1, "rgba(200,166,97,0)");
    ctx.fillStyle = aura; ctx.fillRect(0, 0, W, H);

    // A hairline gold frame — the machined edge.
    ctx.strokeStyle = "rgba(200,166,97,.5)"; ctx.lineWidth = 2;
    ctx.strokeRect(46, 46, W - 92, H - 92);

    // Eyebrow.
    ctx.textAlign = "center"; ctx.fillStyle = CREAM_M;
    ctx.font = "500 30px 'DM Mono', ui-monospace, monospace";
    ctx.fillText("G T 3   P E R F O R M A N C E   B A R", W / 2, 168);

    // The locked "3" mark — cream on charcoal, drawn from the brand SVG (never redrawn).
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { const s = 300; ctx.drawImage(img, W / 2 - s / 2, 270, s, s); resolve(); };
      img.onerror = () => {
        // Fallback: a typographic 3 if the asset can't load (share must never blank out).
        ctx.fillStyle = CREAM; ctx.font = "700 300px 'Inter', sans-serif"; ctx.fillText("3", W / 2, 560); resolve();
      };
      img.src = "/brand/3-outline.svg";
    });

    // Tier — the status, in gold. Founding gets a fuller weight.
    const grad = ctx.createLinearGradient(0, 720, 0, 800);
    grad.addColorStop(0, GOLD); grad.addColorStop(1, GOLD_DEEP);
    ctx.fillStyle = grad;
    ctx.font = `800 ${founding ? 74 : 78}px 'Inter', sans-serif`;
    ctx.fillText(tierLine, W / 2, 800);

    // Gold rule.
    ctx.strokeStyle = "rgba(200,166,97,.55)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2 - 90, 850); ctx.lineTo(W / 2 + 90, 850); ctx.stroke();

    // Name.
    ctx.fillStyle = CREAM; ctx.font = "650 58px 'Inter', sans-serif";
    ctx.fillText(name, W / 2, 940);
    ctx.fillStyle = CREAM_M; ctx.font = "500 26px 'DM Mono', ui-monospace, monospace";
    ctx.fillText(`MEMBER SINCE ${sinceYear}`, W / 2, 992);

    // The signature line.
    ctx.fillStyle = "rgba(245,241,232,.9)"; ctx.font = "italic 600 40px 'Inter', sans-serif";
    ctx.fillText("Pure Signal. No Noise.", W / 2, 1140);

    // Join hook — the viral edge. Their code turns a flex into a funnel.
    ctx.fillStyle = GOLD; ctx.font = "600 30px 'DM Mono', ui-monospace, monospace";
    ctx.fillText(code ? `app.gt3pb.com  ·  JOIN WITH ${code}` : "app.gt3pb.com  ·  join the drop", W / 2, 1230);

    setReady(true);
  }, [founding, name, code, sinceYear, tierLine]);

  useEffect(() => { if (open) { setReady(false); draw(); } }, [open, draw]);

  const share = async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    haptic(HAPTIC.success);
    const blob: Blob | null = await new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
    if (!blob) { toast("Couldn't make the image — try again", "error"); return; }
    const file = new File([blob], "gt3-status.png", { type: "image/png" });
    const shareText = `I'm a GT3 ${founding ? "Founding Member" : "Member"}. Pure Signal, No Noise.${code ? ` Join with ${code} → app.gt3pb.com` : " app.gt3pb.com"}`;
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], text: shareText }); return; } catch { /* user cancelled — fall through to save */ }
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
      <p className="status-hint">Post it to your story and tag <b>@gt3pb</b>. Your code&rsquo;s on the card — every friend who joins with it earns you both a credit.</p>
    </Sheet>
  );
}
