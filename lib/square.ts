// Square config (client-safe bits use NEXT_PUBLIC_*; the access token stays server-only).
export const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID || "";
export const SQUARE_LOCATION_ID = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID || "";
export const SQUARE_ENV = (process.env.NEXT_PUBLIC_SQUARE_ENV || "sandbox") as "sandbox" | "production";

// Whether the client can render the card form (real charges still require the server token + Square activation).
export const squareClientReady = Boolean(SQUARE_APP_ID && SQUARE_LOCATION_ID);

export const squareWebSdkUrl =
  SQUARE_ENV === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";

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
  { size: 18, key: "18", price: process.env.NEXT_PUBLIC_SUB_PRICE_18 || "$90", each: "$5.00 / bottle" },
];
