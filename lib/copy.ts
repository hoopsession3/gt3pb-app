"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// SITE COPY — owner/admin-editable front-end text. Every editable string has a stable key and a
// DEFAULT (the canonical copy). Overrides live in the `site_copy` table (0122); the front-end reads
// default-or-override, so the site never shows a blank and always works even before anything is
// edited. Add a new editable string = add one entry here and render it with useSiteCopy()'s t(key).
export type CopyMeta = { key: string; group: string; label: string; multiline?: boolean; default: string };

export const COPY_META: CopyMeta[] = [
  // ── Home · signed-out (Arrival) ──
  { key: "home.statement", group: "Home · signed-out", label: "Hero statement", multiline: true,
    default: "We draw the coffee cold, blend the hydration from whole coconut, and simmer the broth slow — the long way, on purpose — then make every cup the moment you order it." },
  { key: "home.principles", group: "Home · signed-out", label: "Principles line",
    default: "Drawn cold, made to order, poured into glass" },
  { key: "home.cta", group: "Home · signed-out", label: "Primary button",
    default: "Start your order" },
  { key: "home.cta_sub", group: "Home · signed-out", label: "Button subtext", multiline: true,
    default: "Choose what you'd like and we'll have it waiting at the window." },
  { key: "home.signoff", group: "Home · signed-out", label: "Sign-off",
    default: "Pure Signal, No Noise." },
  // ── Home · signed-in (Today) ──
  { key: "home.questions", group: "Home · signed-in", label: "Stack-builder intro", multiline: true,
    default: "Five questions and I'll build your stack for the day." },
  // ── Home · the three pillars (signed-out "What We Make") ──
  { key: "home.pillar1_t", group: "Home · pillars", label: "Pillar 1 — title", default: "Activation" },
  { key: "home.pillar1_d", group: "Home · pillars", label: "Pillar 1 — line", default: "Cold-extracted coffee to start the day clear." },
  { key: "home.pillar2_t", group: "Home · pillars", label: "Pillar 2 — title", default: "Hydration" },
  { key: "home.pillar2_d", group: "Home · pillars", label: "Pillar 2 — line", default: "Whole-coconut water to carry you through it." },
  { key: "home.pillar3_t", group: "Home · pillars", label: "Pillar 3 — title", default: "Fuel" },
  { key: "home.pillar3_d", group: "Home · pillars", label: "Pillar 3 — line", default: "Slow-simmered broth to rebuild after." },
  // ── Reserve card on the home screen ──
  { key: "pitch.kicker", group: "Reserve card", label: "Kicker", default: "Order Ahead" },
  { key: "pitch.headline", group: "Reserve card", label: "Headline", default: "The bottles you love, brewed to order." },
  { key: "pitch.body", group: "Reserve card", label: "Body", multiline: true,
    default: "Reserve a Saturday drop — 3, 6, or 12 bottles, brewed to order and ready when you reach the window. No plan, no commitment." },
  { key: "pitch.cta", group: "Reserve card", label: "Button", default: "Reserve this week's drop" },
  { key: "pitch.fine", group: "Reserve card", label: "Fine print", multiline: true,
    default: "Order by Wed 6 PM · pickup Saturday · bring bottles back for the best price." },
  // ── Reserve flow (order-ahead). {cutoff}/{pickup}/{size} are filled in live. ──
  { key: "reserve.kicker", group: "Reserve flow", label: "Kicker", default: "Order Ahead" },
  { key: "reserve.headline", group: "Reserve flow", label: "Headline", multiline: true, default: "Tell us you're coming, we'll brew it to order." },
  { key: "reserve.cutoff", group: "Reserve flow", label: "Cutoff line (uses {cutoff} and {pickup})", default: "Order by {cutoff} · pickup {pickup}" },
  { key: "reserve.fresh", group: "Reserve flow", label: "Fresh line", multiline: true, default: "Brewed to order, no preservatives — fresh 7 days from pickup." },
  { key: "reserve.window", group: "Reserve flow", label: "Footer / walk-up prices", multiline: true, default: "No commitment, no plan — just this drop.\nAt the window: $10 new · $8 bring-back · single bottle $10" },
  { key: "reserve.confirm_return", group: "Reserve flow", label: "Confirmation — bringing bottles back (uses {size})", multiline: true, default: "Don't forget your empties. Rinse them out and bring all {size} — that's what your pack price is built on. Fresh 7 days from pickup." },
  { key: "reserve.confirm_new", group: "Reserve flow", label: "Confirmation — new glass", multiline: true, default: "Your bottles are yours to keep — or bring them back next drop and unlock pack pricing. Fresh 7 days from pickup." },
  // ── Menu header ──
  { key: "menu.statement", group: "Menu", label: "Menu statement", multiline: true,
    default: "We draw the coffee cold, blend the hydration from whole coconut, and simmer the broth slow — the long way, on purpose — then make every cup the moment you order it." },
  { key: "menu.order_line", group: "Menu", label: "Order prompt",
    default: "Order here, and it'll be waiting when you reach the window." },
];

export const COPY_DEFAULTS: Record<string, string> = Object.fromEntries(COPY_META.map((m) => [m.key, m.default]));
export const copyDefault = (key: string): string => COPY_DEFAULTS[key] ?? "";

// Client hook: load overrides once, resolve default-or-override. Returns a stable t(key) function.
// Falls back to defaults if Supabase isn't configured or the row doesn't exist.
export function useSiteCopy(): (key: string) => string {
  const [over, setOver] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.from("site_copy").select("key, value").then(({ data }) => {
      if (live && data) setOver(Object.fromEntries((data as { key: string; value: string }[]).map((r) => [r.key, r.value])));
    });
    return () => { live = false; };
  }, []);
  return (key: string) => over[key] ?? COPY_DEFAULTS[key] ?? "";
}
