"use client";

import { useEffect, useMemo, useState } from "react";
import { DRINKS, MENU } from "@/lib/menu";
import { pickForDisplay, type CleanReview } from "@/lib/reviews";
import { supabase } from "@/lib/supabase";
import Gt3Mark from "@/components/Gt3Mark";

// TRUCK DISPLAY — a full-screen, auto-rotating loop for a tablet or TV at the bar. Three scenes:
// the live menu, the brand line, and a cleaned + anonymized guest review. Public (no login). Reviews
// are staff-approved and scrubbed by lib/reviews before they ever reach this screen. Route: /display.
type Scene = "menu" | "brand" | "review";
const ORDER: Scene[] = ["menu", "review", "brand"];
const DWELL = 9000;

export default function DisplayPage() {
  const [reviews, setReviews] = useState<CleanReview[]>([]);
  const [step, setStep] = useState(0);

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
  const review = reviews.length ? reviews[step % reviews.length] : null;

  return (
    <div className="disp" role="presentation">
      {scene === "menu" && (
        <div className="disp-scene disp-menu">
          <div className="disp-mast"><Gt3Mark tone="cream" /><span className="disp-mast-pb">Performance Bar</span></div>
          <div className="disp-cats">
            {MENU.map((cat) => (
              <div key={cat.name} className="disp-cat">
                <div className="disp-cat-h">{cat.name}<span>{cat.wn}</span></div>
                {cat.rows.map((id) => (
                  <div key={id} className="disp-row"><span className="disp-row-n">{DRINKS[id].n}</span><em className="disp-row-p">{DRINKS[id].px}</em></div>
                ))}
              </div>
            ))}
          </div>
          <div className="disp-foot">Drawn cold · made to order · poured into glass</div>
        </div>
      )}

      {scene === "brand" && (
        <div className="disp-scene disp-hero">
          <div className="disp-hero-mark"><Gt3Mark tone="cream" /></div>
          <div className="disp-stmt">Pure Signal.<br />No Noise.</div>
          <div className="disp-sub">Whole-food inputs. Made the moment you order it.</div>
        </div>
      )}

      {scene === "review" && review && (
        <div className="disp-scene disp-rev">
          <div className="disp-rev-stars" aria-hidden>{"★".repeat(review.rating)}</div>
          <blockquote className="disp-rev-q">“{review.text}”</blockquote>
          <div className="disp-rev-who">— {review.who}</div>
          <div className="disp-rev-tag">What the line is saying</div>
        </div>
      )}
    </div>
  );
}
