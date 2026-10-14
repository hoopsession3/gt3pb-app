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
