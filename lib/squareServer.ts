// Server-only Square REST helpers (the access token never leaves the server).
export const SQUARE_BASE =
  process.env.NEXT_PUBLIC_SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

export const SQUARE_VERSION = "2025-01-23";

export function squareHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": SQUARE_VERSION,
  };
}

// Square Subscription Plan Variation that defines cadence + price. The owner
// creates the plan in Square (e.g. "RISE + FLOW — every 2 weeks") and sets this.
export const SQUARE_PLAN_VARIATION_ID = process.env.SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID || "";
export const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "";
export const SQUARE_WEBHOOK_URL = process.env.SQUARE_WEBHOOK_URL || "";

export function subsConfigured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID && SQUARE_PLAN_VARIATION_ID);
}

// Map Square subscription status -> our mirror enum.
export function mapSubStatus(s?: string): "pending" | "active" | "paused" | "canceled" {
  switch ((s || "").toUpperCase()) {
    case "ACTIVE": return "active";
    case "PAUSED": return "paused";
    case "CANCELED":
    case "DEACTIVATED": return "canceled";
    default: return "pending";
  }
}
