// SERVER ERROR SELF-REPORTING (2026-07-30 — the "crash/error/outage email" round, part 1).
// Next.js calls onRequestError for every UNCAUGHT error in route handlers / server components —
// the 500s nobody sees because the requester just got a broken response and moved on. Same
// contract as the client intake (/api/errors/report): fingerprint server-side, dedupe into ONE
// client_errors row per unique error via bump_client_error, and only the FIRST occurrence raises
// a critical alert — which the alerts webhook fans out as push + admin email. One bug = one
// email, not a flood.
//
// Deliberately self-contained: raw PostgREST fetches + WebCrypto (no supabase-js, no node:crypto)
// so it runs identically on the nodejs and edge runtimes and never drags app imports into Next's
// instrumentation bundle. Telemetry never throws — every path is fail-silent by contract.

type ReqInfo = { path?: string; method?: string };
type ErrCtx = { routerKind?: string; routeType?: string };

export async function onRequestError(err: unknown, request: ReqInfo, context: ErrCtx) {
  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return;

    const e = err as { message?: unknown; stack?: unknown } | null;
    const message = String(e?.message ?? err ?? "Unknown server error").slice(0, 400).trim();
    if (!message) return;
    const stack = String(e?.stack ?? "").slice(0, 1500);
    const path = String(request?.path ?? "").split("?")[0].slice(0, 300);

    // Same fingerprint recipe as the client intake, "api|"-prefixed so a server hit of a shared
    // message can never merge into a client row's counter.
    const topFrame = stack.split("\n").slice(0, 2).join(" ");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`api|${message}|${topFrame}|${path}`));
    const fingerprint = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" };

    // Seen before → bump the counter, no alert (the dedup that keeps this from flooding).
    const bumped = await fetch(`${base}/rest/v1/rpc/bump_client_error`, {
      method: "POST", headers, body: JSON.stringify({ p_fingerprint: fingerprint }),
    }).then((r) => r.json()).catch(() => null);
    if (bumped === true) return;

    // First sighting → file it…
    const ins = await fetch(`${base}/rest/v1/client_errors`, {
      method: "POST", headers,
      body: JSON.stringify({ fingerprint, message, stack: stack || null, url: path || null, ua: `server · ${request?.method ?? "?"} · ${context?.routeType ?? context?.routerKind ?? "unknown"}`, fatal: true }),
    });
    if (!ins.ok) {
      // Unique-violation race (two instances, same brand-new error): the other one alerted.
      await fetch(`${base}/rest/v1/rpc/bump_client_error`, { method: "POST", headers, body: JSON.stringify({ p_fingerprint: fingerprint }) }).catch(() => null);
      return;
    }
    // …and raise the ONE critical alert. The alerts webhook does the rest: push + admin email.
    await fetch(`${base}/rest/v1/alerts`, {
      method: "POST", headers,
      body: JSON.stringify({ severity: "critical", category: "system", kind: "server_error", title: "Server error — an API call failed", body: `${message.slice(0, 200)}${path ? ` · ${path}` : ""}`, link: "/crew" }),
    });
  } catch { /* telemetry never throws */ }
}
