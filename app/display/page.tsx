"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { DRINKS, MENU } from "@/lib/menu";
import { pickForDisplay, type CleanReview } from "@/lib/reviews";
import { CONNECT_PRIMARY } from "@/lib/connect";
import { supabase } from "@/lib/supabase";
import Gt3Mark from "@/components/Gt3Mark";
import Icon from "@/components/Icon";

// TRUCK DISPLAY — a full-screen, auto-rotating loop for a tablet or TV at the bar. Three scenes:
// the live menu, the brand line, and a cleaned + anonymized guest review. Public (no login). Reviews
// are staff-approved and scrubbed by lib/reviews before they ever reach this screen. Route: /display.
type Scene = "menu" | "brand" | "review" | "connect";
const ORDER: Scene[] = ["menu", "review", "brand", "connect"];
const DWELL = 9000;

export default function DisplayPage() {
  const [reviews, setReviews] = useState<CleanReview[]>([]);
  const [step, setStep] = useState(0);
  const [qr, setQr] = useState("");
  // Live prices (products.price_cents, the one authority — same /api/menu the ordering screens use)
  // so a reprice via Money > Menu shows up on this public board, not just the frozen lib/menu.ts copy.
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Cents-aware: a flat .toFixed(0) rounded every live price to a whole dollar for display while
  // checkout charges the exact cents — this board is the public in-truck price, so it must match
  // what customers are actually charged. Matches the dollars()/money() convention used elsewhere.
  const priceLabel = (id: keyof typeof DRINKS) => (prices[id] != null ? `$${(prices[id] / 100).toFixed(prices[id] % 100 === 0 ? 0 : 2)}` : DRINKS[id].px);

  useEffect(() => {
    QRCode.toDataURL(CONNECT_PRIMARY, { margin: 1, width: 640, color: { dark: "#15120D", light: "#ffffff" } }).then(setQr).catch(() => setQr(""));
  }, []);

  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/menu").then((r) => r.json()).then((d) => { if (live) setPrices(d.prices || {}); }).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000); // this screen never reloads — keep the board fresh across a shift
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.from("reviews").select("name, body, rating, created_at").eq("approved", true).order("created_at", { ascending: false }).limit(60)
      .then(({ data }) => { if (live && data) setReviews(pickForDisplay(data)); });
    return () => { live = false; };
  }, []);

  // Skip the review scene entirely when there's nothing approved to show.
  const scenes = useMemo(() => (reviews.length ? ORDER : ORDER.filter((s) => s !== "review")), [reviews.length]);
  useEffect(() => { const t = setInterval(() => setStep((v) => v + 1), DWELL); return () => clearInterval(t); }, []);

  const scene = scenes[step % scenes.length];
  // Advance the review once per full loop, not by the raw step: the review scene only appears at
  // one slot in the cycle, so indexing by step means step jumps by scenes.length between showings —
  // and when reviews.length shares a factor with scenes.length (e.g. any multiple of 3, incl. the
  // default cap of 12) only reviews.length/gcd of them are ever reachable and the rest go unseen.
  const review = reviews.length ? reviews[Math.floor(step / scenes.length) % reviews.length] : null;

  return (
    <div className="tvl" role="presentation">
      {scene === "menu" && (
        <div className="tvl-scene tvl-menu">
          <div className="tvl-mast"><Gt3Mark tone="cream" /><span className="tvl-mast-pb">Performance Bar</span></div>
          <div className="tvl-cats">
            {MENU.map((cat) => (
              <div key={cat.name} className="tvl-cat">
                <div className="tvl-cat-h">{cat.name}<span>{cat.wn}</span></div>
                {cat.rows.map((id) => (
                  <div key={id} className="tvl-row"><span className="tvl-row-n">{DRINKS[id].n}</span><em className="tvl-row-p">{priceLabel(id)}</em></div>
                ))}
              </div>
            ))}
          </div>
          <div className="tvl-foot">Drawn cold · made to order · poured into glass</div>
        </div>
      )}

      {scene === "brand" && (
        <div className="tvl-scene tvl-hero">
          <div className="tvl-hero-mark"><Gt3Mark tone="cream" /></div>
          <div className="tvl-stmt">Pure Signal.<br />No Noise.</div>
          <div className="tvl-sub">Whole-food inputs. Made the moment you order it.</div>
        </div>
      )}

      {scene === "review" && review && (
        <div className="tvl-scene tvl-rev">
          <div className="tvl-rev-stars" aria-hidden>{Array.from({ length: review.rating }).map((_, i) => <Icon key={i} name="star" />)}</div>
          <blockquote className="tvl-rev-q">“{review.text}”</blockquote>
          <div className="tvl-rev-who">— {review.who}</div>
          <div className="tvl-rev-tag">What the line is saying</div>
        </div>
      )}

      {scene === "connect" && (
        <div className="tvl-scene tvl-connect">
          <div className="tvl-connect-l">
            <div className="tvl-hero-mark"><Gt3Mark tone="cream" /></div>
            <div className="tvl-connect-h">Find us. Follow the signal.</div>
            <div className="tvl-connect-rows">
              <div className="tvl-connect-row"><span>Order ahead</span><em>app.gt3pb.com</em></div>
              <div className="tvl-connect-row"><span>Instagram · TikTok</span><em>@gt3pb</em></div>
              <div className="tvl-connect-row"><span>Web</span><em>gt3pb.com</em></div>
            </div>
          </div>
          {qr && <div className="tvl-connect-qr"><img src={qr} alt="Scan for gt3pb.com" /><span>Scan to order + follow</span></div>}
        </div>
      )}
    </div>
  );
}
