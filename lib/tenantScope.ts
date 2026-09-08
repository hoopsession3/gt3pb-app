// TENANT SCOPE FOR PATHS WITH NO SESSION.
//
// Most of R-002 was closed by reading the tenant off the caller: tenantFromRequest() resolves it
// from the bearer, and eighteen agent routes plus the staff-gated commerce routes now filter every
// read by it. That works because those callers ARE somebody.
//
// Four paths have nobody to ask, structurally and permanently:
//
//   /api/apliiq/search        Apliiq asks whether we carry a product. HMAC-signed by Apliiq.
//   /api/apliiq/fulfillment   Apliiq tells us an order shipped. HMAC-signed by Apliiq.
//   /api/checkout             a GUEST buying a cup. No account, no bearer.
//   /api/shop/checkout        a GUEST buying merch. Same.
//
// tenantFromRequest() returns null for all four by design, and it always will. Requiring a session
// there would break guest checkout and reject a legitimate webhook — the fix would be worse than
// the finding, which is the trap this whole audit has been avoiding.
//
// ── WHAT IS ACTUALLY TRUE ──────────────────────────────────────────────────────────────────────
// A webhook is authenticated by a shared secret, and a shared secret belongs to ONE integration:
// there is one Apliiq account and one Square account, and both belong to one tenant. A guest
// checkout belongs to the storefront it was opened from, and there is one storefront.
//
// So the tenant for these paths is not unknowable — it is a deployment fact. It has been implicit
// all along: 0134's stamp_tenant() already writes exactly this uuid when current_tenant() is null,
// which is every guest order this business has ever taken. This file only makes the READ side say
// out loud what the WRITE side has always done.
//
// ── WHY A CONSTANT AND NOT A FILTER-SHAPED GUESS ───────────────────────────────────────────────
// Earlier in this sweep I refused to add tenant filters that would assert nothing — an id the route
// itself created cannot belong to anyone else, so filtering it is theatre. This is the opposite
// case. A bare `select` on shop_products genuinely returns another market's products the day one
// exists; naming the tenant changes the result then. It is a real filter, not a decoration.
//
// And it moves the second-market work from "find and fix eight route handlers again" to "set one
// environment variable", which is the difference between a decision someone can make and one they
// keep postponing.

/**
 * The founding GT3PB tenant. The same literal 0134's stamp_tenant() falls back to, so a row written
 * by a guest and a row read for a guest agree by construction rather than by luck.
 */
export const FOUNDING_TENANT = "00000000-0000-0000-0000-000000000001";

/**
 * The tenant that owns this deployment's provider integrations and public storefront.
 *
 * Override with GT3_INTEGRATION_TENANT_ID when a second market gets its own Square and Apliiq
 * credentials. Until then it is the founding tenant, stated rather than assumed.
 *
 * NOT for anything with a caller — if there is a bearer, tenantFromRequest() is the answer and this
 * would silently widen the scope back out.
 */
export const integrationTenant = (): string =>
  process.env.GT3_INTEGRATION_TENANT_ID?.trim() || FOUNDING_TENANT;

/** True when a value looks like the uuid a tenant id is, so a mistyped env var fails loudly. */
export const isTenantId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
