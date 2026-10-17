// EVERY SETTING THE APP READS, IN ONE PLACE (R14, 2026-10-16 — the 10/10 audit's operations pass, F14).
//
// Seventy-odd environment names were read where they were needed and nowhere declared: a secret missing in production
// turned its feature off without a word (no service-role key — error reporting AND alerting off; no Resend key — every
// email a quiet no-op), and a name read in one file and set under another spelling was found by a customer. This is the
// list. scripts/env.audit.mjs holds it true both ways — every environment name the app reads is here, and every name here
// is read — and instrumentation.ts says at each server start which "core" and "feature" names are not set (names only,
// never a value).
//
//   core     — the app does not work without it (it cannot reach its database, or cannot take a payment it offers)
//   feature  — one thing is off without it, and that thing says so on its own screen
//   display  — words or switches with a working default
//   platform — set by Vercel or Next.js, never by hand
//
// `side`: "public" names are written into every page's script by Next.js (NEXT_PUBLIC_*); "server" names never leave the
// server. Pure data: no import, nothing read here.

export type EnvNeed = "core" | "feature" | "display" | "platform";
export type EnvEntry = { name: string; side: "server" | "public"; need: EnvNeed; what: string };

export const ENV: readonly EnvEntry[] = [
  // ── the database ──
  { name: "NEXT_PUBLIC_SUPABASE_URL", side: "public", need: "core", what: "the database — without it nothing loads" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", side: "public", need: "core", what: "the database's public key — without it nothing loads" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", side: "server", need: "core", what: "every server route's database access — without it no order saves, no alert is raised and no error is filed" },
  { name: "GT3_INTEGRATION_TENANT_ID", side: "server", need: "display", what: "the tenant Square's and Apliiq's events are written for (defaults to the founding tenant)" },
  // ── payments ──
  { name: "SQUARE_ACCESS_TOKEN", side: "server", need: "core", what: "card payments, refunds and the reserve and pack charges — without it every card checkout says it isn't switched on" },
  { name: "NEXT_PUBLIC_SQUARE_APP_ID", side: "public", need: "core", what: "the card form (its prefix picks sandbox or production for the form and the charges)" },
  { name: "NEXT_PUBLIC_SQUARE_LOCATION_ID", side: "public", need: "core", what: "where card payments are taken" },
  { name: "SQUARE_WEBHOOK_SIGNATURE_KEY", side: "server", need: "feature", what: "Square's webhook — refunds, disputes and subscription changes recorded as they happen" },
  { name: "SQUARE_WEBHOOK_URL", side: "server", need: "feature", what: "the address Square signs its webhook for (with the signature key above)" },
  { name: "SQUARE_SUB_PLAN_6", side: "server", need: "feature", what: "the 6-pack subscription's Square plan" },
  { name: "SQUARE_SUB_PLAN_12", side: "server", need: "feature", what: "the 12-pack subscription's Square plan" },
  { name: "SQUARE_SUB_PLAN_18", side: "server", need: "feature", what: "the 18-pack subscription's Square plan" },
  { name: "NEXT_PUBLIC_SUBSCRIPTIONS_ON", side: "public", need: "display", what: "the coffee subscription is offered (\"1\"); otherwise it says opening soon" },
  { name: "NEXT_PUBLIC_SUB_NAME", side: "public", need: "display", what: "the subscription's name on the pack tiles" },
  { name: "NEXT_PUBLIC_SUB_CADENCE", side: "public", need: "display", what: "the subscription's cadence words" },
  { name: "NEXT_PUBLIC_SUB_PRICE_6", side: "public", need: "display", what: "the 6-pack tile's price label" },
  { name: "NEXT_PUBLIC_SUB_PRICE_12", side: "public", need: "display", what: "the 12-pack tile's price label" },
  { name: "NEXT_PUBLIC_SUB_PRICE_18", side: "public", need: "display", what: "the 18-pack tile's price label" },
  { name: "STRIPE_SECRET_KEY", side: "server", need: "feature", what: "the operators' Pro billing (Stripe checkout and portal)" },
  { name: "STRIPE_PRICE_PRO", side: "server", need: "feature", what: "the Pro plan's Stripe price" },
  { name: "STRIPE_WEBHOOK_SECRET", side: "server", need: "feature", what: "Stripe's webhook — Pro billing changes recorded" },
  // ── messages ──
  { name: "RESEND_API_KEY", side: "server", need: "feature", what: "every email — receipts, sign-in follow-ups, the crew's critical alerts by email" },
  { name: "NOTIFY_FROM_EMAIL", side: "server", need: "feature", what: "the address emails come from (with the Resend key)" },
  { name: "RESEND_WEBHOOK_SECRET", side: "server", need: "feature", what: "Resend's webhook — bounces and complaints recorded" },
  { name: "ALERT_FALLBACK_EMAIL", side: "server", need: "feature", what: "where a critical alert goes when the database will not take it" },
  { name: "TWILIO_ACCOUNT_SID", side: "server", need: "feature", what: "texts to customers who said yes (with the two below)" },
  { name: "TWILIO_AUTH_TOKEN", side: "server", need: "feature", what: "texts, and checking Twilio's signature on a reply" },
  { name: "TWILIO_FROM_NUMBER", side: "server", need: "feature", what: "the number texts come from" },
  { name: "TWILIO_WEBHOOK_URL", side: "server", need: "feature", what: "the address Twilio signs a reply for (STOP, START)" },
  { name: "NEXT_PUBLIC_TEXTS_ON", side: "public", need: "display", what: "the yes-to-texts box is offered (\"1\")" },
  { name: "NOTES_INBOUND_SECRET", side: "server", need: "feature", what: "meeting notes emailed in" },
  { name: "NOTES_INBOUND_FROM", side: "server", need: "feature", what: "who may email meeting notes in" },
  // ── push ──
  { name: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", side: "public", need: "feature", what: "web push on phones and browsers" },
  { name: "NEXT_PUBLIC_NATIVE_PUSH", side: "public", need: "display", what: "the iPhone app's own alerts are live (\"1\", once APNs is set up)" },
  // ── Apple and Google ──
  { name: "APPLE_TEAM_ID", side: "server", need: "feature", what: "Sign in with Apple and Apple Wallet passes" },
  { name: "APPLE_SIWA_KEY_ID", side: "server", need: "feature", what: "Sign in with Apple — letting go of a deleted account's token" },
  { name: "APPLE_SIWA_PRIVATE_KEY", side: "server", need: "feature", what: "Sign in with Apple — the key that signs the request" },
  { name: "APPLE_MAPS_TEAM_ID", side: "server", need: "feature", what: "Apple Maps — the address lookup (and Sign in with Apple's team when APPLE_TEAM_ID is not set)" },
  { name: "APPLE_MAPS_KEY_ID", side: "server", need: "feature", what: "Apple Maps — its key's id" },
  { name: "APPLE_MAPS_PRIVATE_KEY", side: "server", need: "feature", what: "Apple Maps — its key" },
  { name: "APPLE_PASS_TYPE_ID", side: "server", need: "feature", what: "the member card as an Apple Wallet pass" },
  { name: "APPLE_PASS_CERT", side: "server", need: "feature", what: "the pass's signing certificate" },
  { name: "APPLE_PASS_KEY", side: "server", need: "feature", what: "the pass's signing key" },
  { name: "APPLE_WWDR", side: "server", need: "feature", what: "Apple's intermediate certificate for passes" },
  { name: "NEXT_PUBLIC_APPLE_WALLET", side: "public", need: "display", what: "Add to Apple Wallet is offered (\"1\")" },
  { name: "GOOGLE_WALLET_ISSUER_ID", side: "server", need: "feature", what: "the member card in Google Wallet" },
  { name: "GOOGLE_WALLET_CLASS_SUFFIX", side: "server", need: "feature", what: "the Google Wallet pass class" },
  { name: "GOOGLE_WALLET_SA_EMAIL", side: "server", need: "feature", what: "the Google Wallet service account" },
  { name: "GOOGLE_WALLET_SA_KEY", side: "server", need: "feature", what: "the Google Wallet service account's key" },
  { name: "NEXT_PUBLIC_GOOGLE_WALLET", side: "public", need: "display", what: "Add to Google Wallet is offered (\"1\", the web only)" },
  // ── partners ──
  { name: "ANTHROPIC_API_KEY", side: "server", need: "feature", what: "the AI helpers (Ask GT3, the brew and event planners, captions)" },
  { name: "APLIIQ_APP_KEY", side: "server", need: "feature", what: "the merch printer (Apliiq) — orders and the catalog" },
  { name: "APLIIQ_SHARED_SECRET", side: "server", need: "feature", what: "Apliiq's signature on its webhooks" },
  { name: "CANVA_ACCESS_TOKEN", side: "server", need: "feature", what: "Studio's designs made in Canva" },
  { name: "CANVA_BRAND_TEMPLATE_ID", side: "server", need: "feature", what: "the Canva brand template Studio fills" },
  { name: "WEBFLOW_API_TOKEN", side: "server", need: "feature", what: "Studio's posts published to gt3pb.com" },
  { name: "WEBFLOW_SITE_ID", side: "server", need: "feature", what: "the Webflow site Studio publishes to" },
  { name: "WEBFLOW_COLLECTION_ID", side: "server", need: "feature", what: "the Webflow collection posts go into" },
  { name: "WEBFLOW_BODY_FIELD", side: "server", need: "display", what: "the Webflow field a post's body goes into (defaults to post-body)" },
  { name: "WEBFLOW_PUBLIC_BASE", side: "server", need: "display", what: "the public address a published post is linked at (no link without it)" },
  { name: "MS_CLIENT_ID", side: "server", need: "feature", what: "Outlook calendar sync" },
  { name: "MS_CLIENT_SECRET", side: "server", need: "feature", what: "Outlook calendar sync's secret" },
  { name: "MS_TENANT_ID", side: "server", need: "feature", what: "the Microsoft tenant Outlook signs in through" },
  { name: "MS_REDIRECT_URI", side: "server", need: "feature", what: "where Microsoft sends the sign-in back" },
  // ── the app itself ──
  { name: "NEXT_PUBLIC_APP_URL", side: "public", need: "display", what: "the app's own address in links sent out — Stripe's way back and Twilio's reply address (defaults to the request's own)" },
  { name: "NEXT_PUBLIC_GT3_TARGET", side: "public", need: "platform", what: "\"app\" in the iPhone build (scripts/build.app.mjs)" },
  { name: "NEXT_PUBLIC_GT3_WEB_ONLY", side: "public", need: "platform", what: "the web-only pages the iPhone build opens in a browser sheet (scripts/build.app.mjs)" },
  { name: "NEXT_PUBLIC_GT3_APP_CSP", side: "public", need: "platform", what: "the iPhone build's content security policy (scripts/build.app.mjs)" },
  { name: "NEXT_PUBLIC_BUILD_COMMIT", side: "public", need: "platform", what: "which build a tab is (next.config.ts, from Vercel's commit)" },
  { name: "VERCEL", side: "server", need: "platform", what: "set by Vercel" },
  { name: "VERCEL_ENV", side: "server", need: "platform", what: "set by Vercel: production, preview or development" },
  { name: "VERCEL_GIT_COMMIT_SHA", side: "server", need: "platform", what: "set by Vercel: the commit being served" },
  { name: "VERCEL_GIT_COMMIT_REF", side: "server", need: "platform", what: "set by Vercel: the branch being served" },
  { name: "VERCEL_DEPLOYMENT_ID", side: "server", need: "platform", what: "set by Vercel: the deployment" },
  { name: "NODE_ENV", side: "server", need: "platform", what: "set by Next.js" },
  { name: "NEXT_RUNTIME", side: "server", need: "platform", what: "set by Next.js: nodejs or edge" },
];

/** The names a server start should say are not set: the core ones, and the features — never the platform's. Pure. */
export function notSet(env: Readonly<Record<string, string | undefined>>, list: readonly EnvEntry[] = ENV): EnvEntry[] {
  return list.filter((e) => (e.need === "core" || e.need === "feature") && !(env[e.name] ?? "").trim());
}
