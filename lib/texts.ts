// TEXTS: THE YES, THE STOP AND THE NIGHT (2026-10-14, R5 of the customer audit — decided 2026-10-13: texts with a
// recorded opt-in, STOP honoured, no texts at night, and none at all until the Twilio number is registered).
//
// Pure, so the server (lib/notify before every text, the inbound-text route) and the screens (the yes at checkout and on
// the account) read the same rules. The yes itself is kept in the database (0398 text_consents) — never in a phone.

/** "+18645550100" from what a person typed: ten digits take +1, eleven starting 1 take +; a number written with its own
 *  + keeps it. Anything else is null — a guess at a number is a text to a stranger. */
export function e164(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+") && digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")) return `+${digits}`;
  if (digits.length === 10 && !/^[01]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1") && !/^1[01]/.test(digits)) return `+${digits}`;
  return null;
}

/** Area codes inside +1 that are not a US phone (R9 review): Canada, the Caribbean and Bermuda — +1 is twenty-five
 *  countries, and the Caribbean's are where SMS pumping is billed — and the codes that reach no person's phone: toll-free,
 *  premium 900, carrier and government services, personal-number blocks. US territories (Puerto Rico, the US Virgin
 *  Islands, Guam) stay. supabase/functions/push/policy.ts and the database (0418 us_textable) hold the same list. */
export const NOT_US_AREA_CODES: ReadonlySet<string> = new Set((
  "204 226 236 242 246 249 250 257 263 264 268 273 284 289 306 343 345 354 365 367 368 382 387 403 416 " +
  "418 428 431 437 438 441 450 456 460 468 473 474 500 506 514 519 521 522 523 524 525 526 527 528 529 " +
  "533 544 548 566 577 579 581 584 587 588 600 604 613 622 633 639 644 647 649 655 658 664 672 677 683 " +
  "688 700 705 709 710 721 742 753 758 767 778 780 782 784 800 807 809 819 822 825 829 833 844 849 855 " +
  "866 867 868 869 873 876 877 879 880 881 882 883 884 885 886 887 888 889 900 902 905 942"
).split(" "));

/** A number we text (R9 — the abuse audit's third): a US one — area code and exchange each starting 2–9, the area code a
 *  US one. GT3 serves US cities, and a yes typed for any +country was a text paid to any carrier. A number may still be
 *  read (e164) and its STOP kept; only a US one is ever texted or recorded as a yes (0418). */
export function usTextable(num: string | null | undefined): boolean {
  const m = /^\+1([2-9]\d{2})[2-9]\d{6}$/.exec(String(num ?? ""));
  return !!m && !/^[2-9]11$/.test(m[1]) && !NOT_US_AREA_CODES.has(m[1]);
}

/** Texts one number may be sent in a day, all told (R9): a pack's few, a confirmation — never a stream. */
export const TEXTS_PER_NUMBER_DAY = 8;

/** "(864) 555-0100" from "+18645550100" — how a US number is shown back to its owner. Others as they are. */
export function phoneShown(num: string | null | undefined): string {
  const s = String(num ?? "");
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(s);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : s;
}

export type TextKeyword = "stop" | "start" | "help";
// The words carriers and Twilio treat as these three, the whole message, any case.
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const START = new Set(["START", "YES", "UNSTOP"]);
const HELP = new Set(["HELP", "INFO"]);

/** What a text sent to us asks, when it is one of the standard words; null for anything else (a person writing). */
export function textKeyword(body: string | null | undefined): TextKeyword | null {
  const w = String(body ?? "").trim().toUpperCase().replace(/[.!?\s]+$/g, "").replace(/\s+/g, "");
  if (STOP.has(w)) return "stop";
  if (START.has(w)) return "start";
  if (HELP.has(w)) return "help";
  return null;
}

/** Night, Eastern time: from 9pm to 8am nothing is texted — the email still goes, the text does not. */
export const QUIET_FROM_HOUR = 21;
export const QUIET_UNTIL_HOUR = 8;
const ET_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });
export function quietHours(at: Date = new Date()): boolean {
  const h = Number(ET_HOUR.format(at));
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/** Texting customers is switched on — the Twilio number registered and NEXT_PUBLIC_TEXTS_ON set to 1 (Ryan's). Until then
 *  no screen asks for a yes, and lib/notify texts nobody. */
export const textsOn = (): boolean => process.env.NEXT_PUBLIC_TEXTS_ON === "1";

/** Where a yes or a stop came from — the five 0398's table accepts. */
export type TextYesSource = "pack_checkout" | "delivery_checkout" | "account" | "start_text";
export type TextStopSource = "stop_text" | "account";

// ── THE YES, CONFIRMED (2026-10-14, R6 — the carriers' rule for a recurring program, as Twilio's campaign review reads
// it: the moment a number says yes, one text naming who we are, what comes and how often, that rates may apply, and how
// to get help or stop). lib/notify sends it right away when a yes is new — at night too (Ryan, 2026-10-14: it answers
// something the person just did). START by text gets Twilio's own opt-in reply instead (the Messaging Service's
// Advanced Opt-Out), so it is never sent twice. 149 characters, every one plain: one segment (scripts/smoke.cjs).
export const TEXT_YES_CONFIRMATION =
  "GT3 Performance Bar: you're signed up for pack & delivery texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to stop.";

// ── WHERE A QUESTION ABOUT TEXTS GOES (2026-10-14, R6) ─────────────────────────────────────────────────────────────────
// The carriers want a program's help contact in its Terms and in its HELP reply (Twilio's campaign review checks both).
// Ryan's: a GT3 address, not a personal one (decided 2026-10-14). The HELP reply itself is set in Twilio, beside it.
export const TEXTS_HELP_EMAIL = "hello@gt3pb.com";

// ── PLAIN CHARACTERS (2026-10-14, R6) ─────────────────────────────────────────────────────────────────────────────────
// A text is billed by the segment: 160 characters when every one is in the GSM-7 set phones and carriers share, 70 when
// a single one is not — a ✓, a long dash, a curly apostrophe or a × makes the whole text Unicode, and "your 6-pack is
// reserved … — $42.00 paid ✓" went out as three segments instead of two. The words are the emails' (lib/notify sends
// one message both ways), so the text is made plain on its way out, here, and the email keeps its marks.
// supabase/functions/push/policy.ts smsPlain is this, line for line (Deno cannot import it; scripts/smoke.cjs holds them
// together).
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
/** The text as GSM-7 alone: marks swapped for their plain twins ("—" "-", "’" "'", "×" "x", " · " ", "), a ✓ dropped,
 *  an accent the set lacks taken off its letter ("Zoë" "Zoe"); anything else left out. */
export function smsPlain(text: string): string {
  const swapped = String(text ?? "")
    .replace(/\s*[\u2713\u2714\u2705]/g, "")
    .replace(/\s+\u00B7\s+/g, ", ")
    .replace(/[\u00B7\u2022]/g, "-")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00D7/g, "x")
    .replace(/[\u00A0\u2007\u2009\u200A\u202F]/g, " ");
  let out = "";
  for (const ch of swapped) {
    if (GSM7.includes(ch)) { out += ch; continue; }
    for (const c of ch.normalize("NFD")) if (GSM7.includes(c)) out += c;
  }
  return out.replace(/ {2,}/g, " ").trim();
}
