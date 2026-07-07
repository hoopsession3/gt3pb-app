// REVIEWS — pure, deterministic cleaning + anonymization for anything shown publicly (the truck
// display, the site). Reviews come from members (post-pickup) or are pasted in by staff from
// Google / Instagram; either way they pass through here before a guest ever sees them. No network,
// no state — just the rules — so it's testable and identical everywhere. "Clean the data" lives here.

export interface RawReview { name?: string | null; body?: string | null; rating?: number | null }
export interface CleanReview { who: string; text: string; rating: number }

// Light, masked (not dropped) — a stray word shouldn't nuke an otherwise good quote.
const PROFANITY = ["fuck", "shit", "bitch", "asshole", "bastard", "dick"];

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

// First name + last initial ("Marcus T."). Handles / emails / blanks → "A guest". Never expose a full
// surname on a public screen.
export function anonName(name?: string | null): string {
  const raw = (name || "").trim();
  if (!raw || raw.includes("@") || /^https?:/i.test(raw)) return "A guest";
  const parts = raw.replace(/[^A-Za-z' -]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A guest";
  const first = cap(parts[0]);
  if (parts.length === 1) return first;
  return `${first} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// Strip PII (emails, phones, URLs, @handles), collapse whitespace, mask profanity, cap length.
export function cleanBody(body?: string | null): string {
  let t = (body || "").replace(/\s+/g, " ").trim();
  t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "");          // emails
  t = t.replace(/https?:\/\/\S+/gi, "");                        // urls
  t = t.replace(/\+?\d[\d\s().-]{7,}\d/g, "");                  // phone numbers
  t = t.replace(/(^|\s)@\w+/g, "$1");                           // @handles
  for (const w of PROFANITY) t = t.replace(new RegExp(`\\b${w}\\b`, "gi"), (m) => m[0] + "•".repeat(m.length - 1));
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 240) t = t.slice(0, 237).replace(/\s+\S*$/, "") + "…";
  return t;
}

// Show it on a public screen? Only genuinely positive (4–5★), a real sentence, not shouty spam.
export function isDisplayable(r: RawReview): boolean {
  const rating = Number(r.rating);
  if (!(rating >= 4)) return false;
  const t = cleanBody(r.body);
  if (t.length < 8 || t.length > 240) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return false;
  const upper = t.replace(/[^A-Z]/g, "").length;
  if (letters.length >= 12 && upper / letters.length > 0.7) return false; // ALL-CAPS spam tell
  return true;
}

export function cleanReview(r: RawReview): CleanReview {
  return { who: anonName(r.name), text: cleanBody(r.body), rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))) };
}

// The public display list: only displayable, cleaned, de-duplicated by text. Caller pre-sorts (newest
// first); we keep insertion order and cap the count.
export function pickForDisplay(reviews: RawReview[], limit = 12): CleanReview[] {
  const seen = new Set<string>();
  const out: CleanReview[] = [];
  for (const r of reviews) {
    if (!isDisplayable(r)) continue;
    const c = cleanReview(r);
    const key = c.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
