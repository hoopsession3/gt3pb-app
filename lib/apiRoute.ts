import { NextResponse } from "next/server";
import { fileError } from "./errorIntake";
import { isSignInUnchecked, SIGN_IN_UNCHECKED_ANY } from "./signInUnchecked";

// THE ROUTE WRAPPER — every handler under app/api is exported through this.
//
//   async function POST(req: Request) { … }
//   export const POST = route("office/paylink", POST);   // ← the file's last line, by convention
//
// What it does, and all it does: if the handler throws — a fetch that never connected, a .json()
// on an HTML body, a column that is not there yet — the caller gets JSON it can read
// (`{ ok: false, error }`, 500) instead of Next's HTML 500 page, and the error is filed through
// lib/errorIntake with the route's name as its path: one row per unique error, one alert in the
// crew inbox the first time, a counter after that. Exactly what a browser white-screen gets.
//
// What it does NOT do: it does not change a handler's own answers. A route that catches and
// returns its own 400/502 still does; this only catches what escapes. It does not retry, time out,
// rate-limit or log request bodies. It never throws itself, and it never hides a Response the
// handler returned.
//
// 2026-10-02: 11 of 76 routes had no try at all and 65 each carried their own copy of
// "catch → JSON". scripts/api.audit.mjs now fails a handler exported any other way, so the next
// route starts here instead of inventing a twelfth shape.

export const ROUTE_THREW = "Something went wrong on our side — it has been logged.";

/** A request's JSON is an object to read from — not a literal null, a number, a string or a list (R18 — the 10/10 audit,
 *  API F14). `await req.json()` answers `null` for the body "null" without throwing, and the next line's `body.id` threw a
 *  TypeError: a 500 and a "route threw" alert for what is a caller's mistake, a 400. Pure. */
export function isJsonObject(b: unknown): b is Record<string, unknown> {
  return b !== null && typeof b === "object" && !Array.isArray(b);
}

type Handler<A extends unknown[]> = (...args: A) => Promise<Response> | Response;

export function route<A extends unknown[]>(name: string, handler: Handler<A>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e: unknown) {
      // A SIGN-IN THE AUTH SERVICE COULDN'T CHECK (R16, lib/signInUnchecked): not this route's fault and not a crash — the
      // caller is told it wasn't checked and nothing was changed (503), the platform's log gets one line, and nothing is
      // filed (an auth blip would file one per door).
      if (isSignInUnchecked(e)) {
        console.error(`[sign-in-unchecked] ${JSON.stringify({ route: name, message: e.message.slice(0, 200) })}`);
        return NextResponse.json({ ok: false, error: SIGN_IN_UNCHECKED_ANY, signInUnchecked: true }, { status: 503 });
      }
      const err = e instanceof Error ? e : new Error(String(e));
      // ONE LINE IN THE PLATFORM'S LOG, FIRST (R10b, 2026-10-16 — the 10/10 audit). The intake writes to the database —
      // so when the database was what failed, the error went nowhere a person could find it. The route, the message and
      // the top of the stack go to stderr before anything else is tried; no request body, no headers.
      console.error(`[route-threw] ${JSON.stringify({ route: name, message: err.message.slice(0, 300), at: (err.stack ?? "").split("\n").slice(1, 3).join(" ").trim().slice(0, 300) })}`);
      // Best-effort, awaited so a serverless instance does not freeze the write mid-flight; the
      // intake itself never rejects.
      await fileError({ message: err.message.slice(0, 400), stack: (err.stack ?? "").slice(0, 1_500), url: `/api/${name}`, ua: "server" });
      return NextResponse.json({ ok: false, error: ROUTE_THREW }, { status: 500 });
    }
  };
}
