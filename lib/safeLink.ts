// A LINK AN OWNER TYPES GOES SOMEWHERE A LINK MAY GO (R10b, 2026-10-16 — the 10/10 audit).
//
// The splash's and the banners' button links are typed in the console (promos.cta_href, broadcasts.cta_href) and opened
// for every guest. The splash handed anything that did not start with "/" to window.open — `javascript:…` there runs on
// the app's own origin, where everyone's session lives, and React's guard on href does not cover window.open. A link is
// one of two things now, and nothing else is opened, rendered or saved:
//   path  — a page on this site: "/" then not a second slash or a backslash (//other.example is another site), no space
//   web   — an http(s):// address that parses as one, with a host and no name:password@ in front of it
// The database holds the same rule (0421's checks on both columns).
export type SafeLink = { kind: "path"; href: string } | { kind: "web"; href: string };

export function safeLink(raw: unknown): SafeLink | null {
  if (typeof raw !== "string") return null;
  const h = raw.trim();
  if (!h || h.length > 500) return null;
  if (/^\/(?![/\\])[^\s\\]*$/.test(h)) return { kind: "path", href: h };
  if (!/^https?:\/\//i.test(h) || /[\s\\]/.test(h)) return null;
  try {
    const u = new URL(h);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname && !u.username && !u.password ? { kind: "web", href: u.href } : null;
  } catch {
    return null;
  }
}

/** The words an editor shows when a typed link is neither. */
export const LINK_WORDS = "A button link is a page here (/delivery) or a web address (https://…)";
