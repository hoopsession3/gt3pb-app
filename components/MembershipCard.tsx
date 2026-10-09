"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useAuth } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import Gt3Mark from "@/components/Gt3Mark";
import MemberCard from "@/components/MemberCard";
import Icon from "@/components/Icon";
import { APP_BUILD, publicOrigin } from "@/lib/native";
import { authedFetch } from "@/lib/authedFetch";
import { addToWallet } from "@/lib/deviceActions";

// GT3 MEMBERSHIP CARD — a premium, scannable member card. The QR encodes a link to the operator
// scan page keyed to this member (referral_code, or user id as fallback), so at the truck a crew
// member scans it to pull up the account and add a stamp. "Add to Apple Wallet" is wired to
// /api/wallet/pass and appears once the Apple Pass certs are configured (NEXT_PUBLIC_WALLET_READY).
const GOAL = 10;

export default function MembershipCard() {
  const { profile, user } = useAuth();
  const { toast } = useApp();
  const [qr, setQr] = useState<string>("");
  const [busy, setBusy] = useState<"" | "apple" | "google">("");
  const [flexOpen, setFlexOpen] = useState(false);
  const code = profile?.referral_code || user?.id || "";
  const appleReady = process.env.NEXT_PUBLIC_APPLE_WALLET === "1";
  // Not in the iPhone app: Google Wallet does not exist on an iPhone, and Apple refuses an app that
  // points to another phone platform's (App Review Guideline 2.3.10).
  const googleReady = process.env.NEXT_PUBLIC_GOOGLE_WALLET === "1" && !APP_BUILD;

  useEffect(() => {
    if (!code || typeof window === "undefined") return;
    const url = `${publicOrigin()}/scan?m=${encodeURIComponent(code)}`;
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#15120D", light: "#ffffff" } })
      .then(setQr).catch(() => setQr(""));
  }, [code]);

  if (!profile || !user) return null;
  const name = (profile.display_name || user.email?.split("@")[0] || "Member").split(" ")[0];
  const pts = Math.max(0, profile.points || 0);
  const inCard = pts % GOAL;

  // Safari opens the downloaded pass in Wallet; the iPhone app hands it to Wallet's own Add sheet
  // (lib/deviceActions addToWallet), where a download would go nowhere.
  const addApple = async () => {
    setBusy("apple");
    try {
      const res = await authedFetch("/api/wallet/pass");
      if (!res.ok) throw new Error();
      if ((await addToWallet(await res.blob())) === "failed") throw new Error();
    } catch { toast("Couldn't add your card to Apple Wallet — try again", "error"); }
    setBusy("");
  };
  const addGoogle = async () => {
    setBusy("google");
    try {
      const res = await authedFetch("/api/wallet/google");
      const data = res.ok ? await res.json() : null;
      if (data?.saveUrl) window.location.href = data.saveUrl;
      else toast("Couldn't open Google Wallet — try again", "error");
    } catch { /* surfaced by the button */ }
    setBusy("");
  };

  return (
    <section className="memberpass" aria-label="GT3 membership card">
      <div className="mp-top">
        <div className="mp-mark"><Gt3Mark tone="cream" /></div>
        <span className="k-tag gold">{profile.founding_member ? "Founding Member" : "Member"}</span>
      </div>
      <div className="mp-name">{name}</div>
      <div className="mp-row">
        <div className="mp-meta">
          <div className="mp-meta-k">Stamps</div>
          <div className="mp-meta-v">{inCard}<span>/{GOAL}</span></div>
          <div className="mp-code">#{String(code).slice(0, 8).toUpperCase()}</div>
        </div>
        <div className="mp-qr">{qr ? <img src={qr} alt="Scan at the truck" width={110} height={110} /> : <div className="mp-qr-ph" />}</div>
      </div>
      <div className="mp-foot">Scan at the truck to earn your stamp · 10th is on us</div>
      <button type="button" className="mp-flex" onClick={() => setFlexOpen(true)}><Icon name="star" /> Show off your status <Icon name="externalLink" /></button>
      <MemberCard open={flexOpen} onClose={() => setFlexOpen(false)} />
      {(appleReady || googleReady) && (
        <div className="mp-wallets">
          {appleReady && <button type="button" className="mp-wallet" onClick={addApple} disabled={!!busy}>{busy === "apple" ? "Preparing…" : "Add to Apple Wallet"}</button>}
          {googleReady && <button type="button" className="mp-wallet mp-wallet-g" onClick={addGoogle} disabled={!!busy}>{busy === "google" ? "Preparing…" : "Save to Google Wallet"}</button>}
        </div>
      )}
    </section>
  );
}
