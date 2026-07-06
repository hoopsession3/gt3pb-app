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
