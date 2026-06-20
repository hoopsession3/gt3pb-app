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
