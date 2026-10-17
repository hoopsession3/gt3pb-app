import { stableErrorKey } from "./deploySkew";
import { isUuid } from "./uuid";

// WHAT MAKES TWO ERRORS ONE ERROR — the recipe, the server's budgets and the alert's words, in one place (R18, 2026-10-17 —
// the 10/10 audit, operations F3).
//
// Two doors file errors. lib/errorIntake takes what route() catches and what a browser sends; instrumentation.ts takes what
// escapes every wrapper — a server-drawn page that threw, or a request outside route(). The second was a copy of the first,
// and it had drifted: it hashed the raw message and the raw top of the stack, so one bug was a new row and a new alert
// after every deploy; every first sighting rang as a critical (push, sound, Teams and email); the alert's answer was never
// read; and the alert named no row. instrumentation.ts also runs on the edge runtime, where errorIntake's node:crypto and
// supabase-js cannot go — so what both doors need lives here, and this file imports only lib/deploySkew and lib/uuid.
// Pure: nothing is read or written here.

// THE SERVER'S OWN BUDGET (R10b, 2026-10-16 — the 10/10 audit). A route that threw shared the hour's thirty with every
// browser report — and anyone can post one: thirty made-up messages from one address in ten minutes, and a real crash
// in the checkout was neither filed nor alerted for the rest of the hour. A route's own throw (ua "server", never sent
// by a browser) and anything that escaped every wrapper count against these; a browser's report never does.
export const SERVER_ROWS = { bucket: "server-errors:new", windowMs: 3_600_000, max: 30 } as const;
export const SERVER_ALERTS = { bucket: "server-errors:alert", windowMs: 600_000, max: 5 } as const;

/** Where the crew reads what was filed: Settings › Advanced › Errors (components/ErrorLog.tsx). */
export const ERRORS_LINK = "/crew?s=settings&a=set-errors";

/** What words from outside may put in an alert (R9 — the abuse audit's seventh). Anyone can post a browser's report, and
 *  a server-drawn page's error can carry what its address asked for; the alert's body goes into the admins' email and
 *  Teams, and a "message" carrying a link was a phishing note sent from our own address. Its words are kept, with any link
 *  taken out; the row under Settings › Errors keeps all of it. Pure. */
export function reportWords(message: string): string {
  return message.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]").replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|xyz|info|biz|ru|cn|top|link|click|me|us)\b\S*/gi, "[link]").slice(0, 160);
}

/** A path as an alert may show it: letters, digits and / . _ - only, eighty at most. Pure. */
export function alertPath(path: string): string {
  return path.replace(/[^\w/.-]/g, "").slice(0, 80);
}

/** Where a bug was thrown, without what moves on every build (R11, 2026-10-16 — the 10/10 audit). The fingerprint took
 *  the stack's first two lines as they came: V8's first line repeats the message (ids and all), and a frame names a
 *  content-hashed chunk, a line and column, and a minified name — all different whenever the file is rebuilt. So one bug
 *  was a new row, a new alert and a split count after every deploy that touched its file; the test that said otherwise
 *  held the stack the same on both deploys. What is kept is the top frame's file, unhashed: a server route's own path, or
 *  "a chunk" in the browser. V8 ("at name (file:1:2)"), Safari and Firefox ("name@file:1:2"). Pure. */
export function stableFrame(stack: string): string {
  const lines = String(stack ?? "").split("\n").map((l) => l.trim());
  const v8 = lines.find((l) => /^at\s/.test(l));
  let where = "";
  if (v8) where = /\(([^()]*)\)$/.exec(v8)?.[1] ?? v8.replace(/^at\s+(?:async\s+)?/, "");
  else {
    const other = lines.find((l) => /^[^@]*@\S+:\d+(?::\d+)?$/.test(l));
    where = other ? other.slice(other.indexOf("@") + 1) : "";
  }
  // A build's hash in a server chunk's name ("[root-of-the-server]__a1b2c3d4._.js") is not a word stableErrorKey can see.
  return stableErrorKey(where.replace(/:\d+(?::\d+)?$/, "").replace(/[?#].*$/, "").replace(/(?<![0-9a-z])(?=[0-9a-f]*\d)[0-9a-f]{6,}(?![0-9a-z])/gi, "<h>"));
}

/** What a fingerprint hashes: the normalised message, where it was thrown, and the path — stable across users, sessions,
 *  instances and deploys, so one bug is one row. Both doors hash this; instrumentation.ts puts "api|" in front, so an
 *  escaped error never counts into a row of the other door's. Pure. */
export function errorKey(message: string, stack: string, path: string): string {
  return `${stableErrorKey(message)}|${stableFrame(stack)}|${path}`;
}

/** The alert for an error that escaped every wrapper — the weight and the words a route's own throw gets from
 *  lib/errorIntake: important (whoever asked got an error page or a 500, but nothing of theirs was lost, and a critical
 *  rings every owner, emails and posts to Teams), kind client_error with the filed row as its subject, so the alert names
 *  the row it is about. Its words came from a request anyone can send: links out, the path plain. Pure. */
export function escapedErrorAlert(message: string, path: string, routeType: string | undefined, rowId: string | null | undefined): {
  severity: "important"; category: "system"; kind: "client_error"; subject_id: string | null; title: string; body: string; link: string;
} {
  const where = alertPath(path);
  return {
    severity: "important",
    category: "system",
    kind: "client_error",
    subject_id: isUuid(rowId) ? rowId : null,
    title: routeType === "render" ? "Server error — a page didn't load" : "Server error — a request failed",
    body: `${reportWords(message)}${where ? ` · ${where}` : ""}`,
    link: ERRORS_LINK,
  };
}
