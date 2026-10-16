// WHAT THE PHONE'S DISPLAY SETTINGS ASK THAT A WEB VIEW DOES NOT PASS ON (R12 — the 10/10 audit, F19). Increase Contrast
// reaches the page as prefers-contrast; Bold Text and Reduce Transparency do not reach a WKWebView at all, and the app's
// Inter does not answer Bold Text on its own. The iPhone app asks its own plugin (native/ios/GT3Device.swift
// displayPrefs, from components/NativeBridge — at launch and whenever the app comes back, since both are changed in
// Settings, outside it) and marks the page; app/globals.css answers the marks. A build without the method answers
// nothing, and nothing is marked.

export type DisplayPrefs = { boldText?: boolean; reduceTransparency?: boolean };

/** The marks app/globals.css reads: html[data-phone-bold], html[data-less-glass]. */
export function applyDisplayPrefs(p: DisplayPrefs | null | undefined): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.toggleAttribute("data-phone-bold", !!p?.boldText);
  html.toggleAttribute("data-less-glass", !!p?.reduceTransparency);
}
