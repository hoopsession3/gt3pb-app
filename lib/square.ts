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

// Subscriptions: the owner flips NEXT_PUBLIC_SUBSCRIPTIONS_ON=1 once the Square
// plan + webhook are configured. Labels are display-only (real price/cadence live
// in the Square plan variation).
export const SUBSCRIPTIONS_ON = process.env.NEXT_PUBLIC_SUBSCRIPTIONS_ON === "1";
export const SUB_NAME = process.env.NEXT_PUBLIC_SUB_NAME || "RISE + FLOW";
export const SUB_PRICE_LABEL = process.env.NEXT_PUBLIC_SUB_PRICE_LABEL || "$48 · every 2 weeks";
