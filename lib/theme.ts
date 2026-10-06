"use client";

import { useSyncExternalStore } from "react";
import { devicePref, useDevicePref } from "./devicePref";

// THE THEME HAS ONE HOME (2026-10-06, the settings round). The crew console's day or dark look was
// read and written inside AppShell: a useState, an effect that read "gt3-theme" once, and a floating
// moon writing it back. The read and the write live here, and the one place to change it is Settings ›
// You › Appearance.
//
// AUTO, AND THE MOON WENT (2026-10-06). The moon was there so a crew could flip to dark when the sun
// went down. Auto does that by itself: it follows the phone, and a phone set to change its look at
// sunset (iOS Automatic, Android's dark-theme schedule) takes the console with it. With Auto in
// Settings, a floating button on every screen for a once-a-day change was a second home for a
// setting — Ryan: "anything that changes a feature should be inside of the settings tab."
//
// Day is the default: the console is used outdoors, in daylight. A stored "dark" or "auto" is itself;
// anything else stored reads as day, as it always did.

export type Theme = "day" | "dark";
/** What a person picked: a look, or "auto" — whatever this phone is showing. */
export type ThemeChoice = Theme | "auto";

export const THEME = devicePref("gt3-theme");

/** What a stored value means. */
export const choiceFrom = (raw: string | null | undefined): ThemeChoice => (raw === "dark" ? "dark" : raw === "auto" ? "auto" : "day");

/** The look a stored value draws, given whether the phone is in dark mode. */
export const themeFrom = (raw: string | null | undefined, phoneDark = false): Theme => {
  const c = choiceFrom(raw);
  return c === "auto" ? (phoneDark ? "dark" : "day") : c;
};

// The phone's own look, as a store: the media query the browser answers, and tells us when it changes.
const PHONE_DARK = "(prefers-color-scheme: dark)";
function subscribePhone(onChange: () => void): () => void {
  const m = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE_DARK) : null;
  m?.addEventListener?.("change", onChange);
  return () => m?.removeEventListener?.("change", onChange);
}
const readPhoneDark = (): boolean => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(PHONE_DARK).matches;

/** What this phone's person picked. Day on the server and while hydrating. */
export function useThemeChoice(): ThemeChoice {
  return choiceFrom(useDevicePref(THEME));
}

/** The look this render should draw — Auto resolved against the phone. Day on the server and while hydrating. */
export function useTheme(): Theme {
  const raw = useDevicePref(THEME);
  const phoneDark = useSyncExternalStore(subscribePhone, readPhoneDark, () => false);
  return themeFrom(raw, phoneDark);
}

/** Set the look on this device. Every screen that reads it redraws. */
export function setTheme(t: ThemeChoice): void {
  THEME.write(t);
}
