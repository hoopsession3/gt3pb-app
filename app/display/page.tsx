"use client";

import { useEffect, useMemo, useState } from "react";
import { lineSubKey, sectionsOf } from "@/lib/drinks";
import { useSiteCopy } from "@/lib/copy";
import { CUP_MARKETS } from "@/lib/markets";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useOrderingOpen } from "@/components/useOrderingOpen";
import { useApp } from "@/components/AppProvider";
import { useAvailability } from "@/lib/availability";
import { pickForDisplay, type CleanReview } from "@/lib/reviews";
import { CONNECT_APP, SCAN_TO_ORDER } from "@/lib/connect";
import { supabase } from "@/lib/supabase";
import Gt3Mark from "@/components/Gt3Mark";
import Icon from "@/components/Icon";
import { money } from "@/lib/money";

// TRUCK DISPLAY — a full-screen, auto-rotating loop for a tablet or TV at the bar. Five scenes: the
// live menu, the craft/chemistry teaser, a cleaned + anonymized guest review, the brand line, and a
// QR/social connect card. Public (no login). Reviews are staff-approved and scrubbed by lib/reviews
// before they ever reach this screen. Route: /display.
// "craft" (2026-07-27, placement #4 of the craft-education strategic audit — the real "ad when you
// come in": a captive line-waiting audience already staring at this board, stronger than any paid
// ad hook) sits right after "menu" — you just saw what's pouring, here's why it's built this way.
type Scene = "menu" | "craft" | "brand" | "review" | "connect";
const ORDER: Scene[] = ["menu", "craft", "review", "brand", "connect"];
const DWELL = 9000;

export default function DisplayPage() {
  const [reviews, setReviews] = useState<CleanReview[]>([]);
  const [step, setStep] = useState(0);
  const [qr, setQr] = useState("");
  const [craftQr, setCraftQr] = useState("");
  // THE BOARD IS THE MENU (2026-10-13, R2 — the Catalog is the menu): the same drinks, names, sections and prices as the
  // menu in the app (AppProvider → /api/menu → lib/drinks), read again every five minutes because this screen never
  // reloads. A drink taken off in the Catalog leaves the board; one 86'd says so in place of its price (realtime).
  // The board hangs in the truck: a stop with its own menu (stop_menu, 0393) shows what it pours, as the app does — the
  // rest leave the board. Its words are the menu's: the 86 and each section's subtitle are the same page copy.
  const { menu, refreshMenu, priceCents } = useApp();
  const t = useSiteCopy();
  const { market } = useViewerMarket(CUP_MARKETS);
  // The board's own city (0408: an 86 at one truck is that city's): the same market its stop menu is read for.
  const { soldOut } = useAvailability(market);
  const { stopMenu } = useOrderingOpen(true, market);
  const sections = sectionsOf(stopMenu ? menu.filter((d) => stopMenu.has(d.slug)) : menu);

  // The QR maker comes down with the board's first moment, not before it (R13 — the 10/10 audit, F11): the codes draw a
  // beat after the menu.
  useEffect(() => {
    let live = true;
    void import("qrcode").then(({ default: QRCode }) => {
      const at = (url: string, set: (s: string) => void) => QRCode.toDataURL(url, { margin: 1, width: 640, color: { dark: "#15120D", light: "#ffffff" } })
        .then((u) => { if (live) set(u); }, () => { if (live) set(""); });
      void at(SCAN_TO_ORDER, setQr);
      void at(`${CONNECT_APP}/craft`, setCraftQr);
    }, () => { /* no codes: the board's words still say where */ });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    refreshMenu();
    // This screen never reloads: the board follows the Catalog within a minute, as the menu does (R7) — a drink taken off
    // stayed on the truck's board for up to five.
    const t = setInterval(refreshMenu, 60_000);
    return () => clearInterval(t);
  }, [refreshMenu]);

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    Promise.resolve(supabase.from("reviews").select("name, body, rating, created_at").eq("approved", true).order("created_at", { ascending: false }).limit(60))
      .then(({ data }) => { if (live && data) setReviews(pickForDisplay(data)); })
      .catch(() => {});
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
            {sections.map((sec) => (
              <div key={sec.line} className="tvl-cat">
                <div className="tvl-cat-h">{sec.line}<span>{t(lineSubKey(sec.line))}</span></div>
                {sec.drinks.map((d) => (
                  <div key={d.slug} className="tvl-row"><span className="tvl-row-n">{d.name}</span><em className="tvl-row-p">{soldOut.has(d.slug) ? t("menu.sold_out") : money(priceCents(d.slug))}</em></div>
                ))}
              </div>
            ))}
          </div>
          <div className="tvl-foot">Drawn cold · made to order · poured into glass</div>
        </div>
      )}

      {scene === "craft" && (
        <div className="tvl-scene tvl-connect">
          <div className="tvl-connect-l">
            <div className="tvl-hero-mark"><Gt3Mark tone="cream" /></div>
            <div className="tvl-connect-h">Art. And chemistry.</div>
            <div className="tvl-sub">Every ingredient, chosen for what it does — not just how it tastes.</div>
          </div>
          {craftQr && <div className="tvl-connect-qr"><img src={craftQr} alt="Scan to read the full ingredient science at app.gt3pb.com/craft" /><span>Scan for the full breakdown</span></div>}
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
              <div className="tvl-connect-row"><span>Order ahead</span><em>{CONNECT_APP.replace(/^https?:\/\//, "")}</em></div>
              <div className="tvl-connect-row"><span>Instagram · TikTok</span><em>@gt3pb</em></div>
              <div className="tvl-connect-row"><span>Web</span><em>gt3pb.com</em></div>
            </div>
          </div>
          {qr && <div className="tvl-connect-qr"><img src={qr} alt={`Scan to order at ${SCAN_TO_ORDER.replace(/^https?:\/\//, "")}`} /><span>Scan to order</span></div>}
        </div>
      )}
    </div>
  );
}
