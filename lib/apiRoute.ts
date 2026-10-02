import { NextResponse } from "next/server";
import { fileError } from "./errorIntake";

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

type Handler<A extends unknown[]> = (...args: A) => Promise<Response> | Response;

export function route<A extends unknown[]>(name: string, handler: Handler<A>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      // Best-effort, awaited so a serverless instance does not freeze the write mid-flight; the
      // intake itself never rejects.
      await fileError({ message: err.message.slice(0, 400), stack: (err.stack ?? "").slice(0, 1_500), url: `/api/${name}`, ua: "server" });
      return NextResponse.json({ ok: false, error: ROUTE_THREW }, { status: 500 });
    }
  };
}
