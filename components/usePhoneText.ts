"use client";

import { useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/native";
import { STANDARD_BODY, tierForBody, type TextTier } from "@/lib/phoneText";

// The phone's Text Size as the app's text size (lib/phoneText says how). Read from WebKit's own body face,
// -apple-system-body, which follows the setting; only in the iPhone app (a browser keeps its own zoom), and
// again whenever the app comes back to the screen, since the setting is changed in Settings, outside it.
// The website's bundle carries none of it: the build's target is spelled out here, as components/AppShell
// spells it for NativeBridge, so the web build drops the reading altogether.
const APP = process.env.NEXT_PUBLIC_GT3_TARGET === "app";

let tier: TextTier = 0;
let read = false;

function measure(): TextTier {
  const el = document.createElement("span");
  el.style.cssText = "font:-apple-system-body;position:absolute;visibility:hidden;pointer-events:none";
  el.textContent = "x";
  document.body.appendChild(el);
  const px = parseFloat(getComputedStyle(el).fontSize);
  el.remove();
  return tierForBody(px > 0 ? px : STANDARD_BODY);
}

function subscribe(onChange: () => void): () => void {
  if (!isNativeApp()) return () => {};
  const again = () => {
    if (document.visibilityState !== "visible") return;
    const t = measure();
    if (t !== tier) { tier = t; onChange(); }
  };
  document.addEventListener("visibilitychange", again);
  return () => document.removeEventListener("visibilitychange", again);
}

function snapshot(): TextTier {
  if (!read && isNativeApp() && document.body) { read = true; tier = measure(); }
  return tier;
}

const server = (): TextTier => 0;
function usePhoneTextTierInApp(): TextTier {
  return useSyncExternalStore(subscribe, snapshot, server);
}
function usePhoneTextTierOnWeb(): TextTier {
  return 0;
}

/** The app's text size the phone asks for: 0 (standard) everywhere but an iPhone app set larger. */
export const usePhoneTextTier: () => TextTier = APP ? usePhoneTextTierInApp : usePhoneTextTierOnWeb;
