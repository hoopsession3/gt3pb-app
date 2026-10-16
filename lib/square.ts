// Square config (client-safe bits use NEXT_PUBLIC_*; the access token stays server-only).
export const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID || "";
export const SQUARE_LOCATION_ID = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID || "";
// The ONE environment truth (2026-07-30, Ryan's live checkout: "Card nonce not found in this
// application environment"): DERIVED from the app ID's own prefix, not a second env var that can
// disagree with it. A sandbox- app ID tokenizes sandbox nonces no matter what
// NEXT_PUBLIC_SQUARE_ENV claims, so the charge side must follow the app ID — the mismatch class
// dies here. NEXT_PUBLIC_SQUARE_ENV is retired (ignored); lib/squareServer derives the REST base
// from the same prefix.
export const SQUARE_ENV: "sandbox" | "production" = SQUARE_APP_ID.startsWith("sandbox-") ? "sandbox" : "production";

// Whether the client can render the card form (real charges still require the server token + Square activation).
export const squareClientReady = Boolean(SQUARE_APP_ID && SQUARE_LOCATION_ID);

export const squareWebSdkUrl =
  SQUARE_ENV === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { Square?: any } }

// One cached script-load promise instead of three copy-pasted loaders (Checkout, OrderFunnel via
// next/script, SubscriptionCard each grew their own). Concurrent callers (e.g. two payment surfaces
// mounting close together) share the same in-flight load instead of racing to inject the tag twice.
//
// A FAILED LOAD IS FORGOTTEN (R11, 2026-10-16 — the 10/10 audit). The promise was cached whatever became of it, so one
// failed fetch of Square's script — a dead spot on truck LTE — handed every later ask the same failure: no card payment
// anywhere until the page was reloaded (in the iPhone app, killed and relaunched). And the failed <script> stayed in the
// head, where a second try would have waited on events that had already fired. Now a load that fails, or never answers
// within SDK_TIMEOUT_MS, takes its tag with it and leaves nothing cached, so the next ask (components/PaymentCard's Try
// again) starts clean.
export const SDK_TIMEOUT_MS = 20_000;
let squareLoad: Promise<any> | null = null;
export function loadSquareSdk(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Square) return Promise.resolve(window.Square);
  if (squareLoad) return squareLoad;
  const load = new Promise<any>((resolve, reject) => {
    // A tag from an earlier try is dropped, not waited on: its load or error may have fired already.
    document.querySelectorAll<HTMLScriptElement>("script[data-square]").forEach((t) => t.remove());
    const s = document.createElement("script");
    const settle = (loaded: boolean) => {
      clearTimeout(timer);
      s.onload = s.onerror = null;
      if (loaded && window.Square) { resolve(window.Square); return; }
      s.remove();
      reject(new Error(loaded ? "Square's script loaded without its SDK" : "Square's script didn't load"));
    };
    const timer = setTimeout(() => settle(false), SDK_TIMEOUT_MS);
    s.src = squareWebSdkUrl;
    s.async = true;
    s.dataset.square = "1";
    s.onload = () => settle(true);
    s.onerror = () => settle(false);
    document.head.appendChild(s);
  });
  squareLoad = load;
  load.catch(() => { if (squareLoad === load) squareLoad = null; });
  return load;
}

// Subscriptions: a coffee pack (6 / 12 / 18) on a cadence. The owner flips
// NEXT_PUBLIC_SUBSCRIPTIONS_ON=1 once the Square plans + webhook are configured.
// Real price/cadence live in the Square plan variations; labels here are display-only.
export const SUBSCRIPTIONS_ON = process.env.NEXT_PUBLIC_SUBSCRIPTIONS_ON === "1";
export const SUB_NAME = process.env.NEXT_PUBLIC_SUB_NAME || "Coffee, on repeat";
export const SUB_CADENCE = process.env.NEXT_PUBLIC_SUB_CADENCE || "every 2 weeks";

// Three pack tiers. Prices are display labels (owner overrides via env); the
// actual charge + cadence come from each pack's Square plan variation.
export type SubPack = { size: number; key: "6" | "12" | "18"; price: string; each: string };
export const SUB_PACKS: SubPack[] = [
  { size: 6, key: "6", price: process.env.NEXT_PUBLIC_SUB_PRICE_6 || "$36", each: "$6.00 / bottle" },
  { size: 12, key: "12", price: process.env.NEXT_PUBLIC_SUB_PRICE_12 || "$66", each: "$5.50 / bottle" },
  { size: 18, key: "18", price: process.env.NEXT_PUBLIC_SUB_PRICE_18 || "$96", each: "$5.33 / bottle" },
];
