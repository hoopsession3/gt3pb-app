import type { CalEvent } from "./ics";

// WHAT THE DEVICE DOES FOR A PAGE — SAVE A FILE, SHARE, PRINT, ADD TO THE CALENDAR OR TO WALLET
// (2026-10-06, the iPhone round, part 3). The one home of all of them: no other file downloads, shares,
// prints, or hands over an .ics or a .pkpass (scripts/smoke.cjs holds every file to that).
//
// On the web each is a browser trick: a file is "downloaded" by clicking an <a download> pointed at a
// blob, a link or an image is shared with navigator.share, a page printed with window.print(), an event
// handed to a calendar as an .ics file and a pass to Wallet as a .pkpass. A WKWebView performs none of
// the tricks: it has no downloads, no print panel and nothing to open an .ics or a .pkpass with
// (Capacitor hands a blob: address to the system, which has no app for it). So in the iPhone app nine
// buttons did nothing — the five CSV exports (customers, orders, expenses, the change log, the error
// log), the two flyer makers, the offer letter's Print, Add to calendar on an event or a stop — Add to
// Apple Wallet would not have either once it is switched on, and the two shares (your status card, your
// invite link) leaned on the web view's own share where it has one and on a download where it has not.
//
// The web keeps exactly what it did. In the app, components/NativeBridge — the one file that speaks to
// Capacitor — fills in `native` below, and each action uses the phone's own sheet instead:
//   · a file   → GT3Device.keepFile puts it in the app's temporary folder, and the share sheet
//                (@capacitor/share) offers Save to Files, Save Image, AirDrop, Mail, Messages, Instagram…
//                — a link that saves a file (<a download>, a post's photo) goes the same way, fetched by
//                the phone itself (saveFromUrl, called by NativeBridge);
//   · a link   → the share sheet;
//   · a print  → GT3Device.printPage: the system print panel, of the page as it is;
//   · an event → GT3Device.addEvent: the system's own New Event sheet, filled in, one tap to save;
//   · a pass   → GT3Device.addPass: Wallet's own Add sheet.
// GT3Device is the app's own plugin, native/ios/GT3Device.swift. GT3DevicePlugin below is its contract;
// scripts/smoke.cjs holds the two to the same methods, and scripts/smoke.native.mjs presses each button
// on a stand-in iPhone that knows only the methods the Swift declares.
//
// WHAT COMES BACK. Every action answers how it went, so a caller can say the right thing — or nothing:
//   done · cancelled (the person closed the sheet — an answer; nothing more happens) · denied (the
//   phone's permission is off) · unsupported (nothing of the kind here: the caller has its fallback) ·
//   failed.

export type Outcome = "done" | "cancelled" | "denied" | "unsupported" | "failed";

/** An event as the phone's New Event sheet takes it: times in milliseconds since 1970. */
export type NativeEvent = { title: string; start: number; end: number; allDay: boolean; location?: string; notes?: string; url?: string };

/** The app's own plugin, native/ios/GT3Device.swift, as the page calls it. */
export type GT3DevicePlugin = {
  keepFile(o: { name: string; data?: string; url?: string }): Promise<{ uri: string }>;
  printPage(o: { name?: string }): Promise<{ printed: boolean }>;
  addEvent(o: NativeEvent): Promise<{ added: boolean }>;
  addPass(o: { data: string }): Promise<void>;
};

/** What the iPhone app does instead: GT3Device, and the share sheet (@capacitor/share Share.share). */
export type NativeDevice = GT3DevicePlugin & {
  share(o: { title?: string; text?: string; url?: string; files?: string[]; dialogTitle?: string }): Promise<unknown>;
};

let native: NativeDevice | null = null;

/** The app's own sheets (components/NativeBridge, once the plugins are in). Null: the web's ways. */
export function setNativeDevice(device: NativeDevice | null): void {
  native = device;
}

// Every app half below asks this first, in lib/native APP_BUILD's own words and in this file: decided
// when the bundle is built, so the web build drops every app half — and all it alone uses — and a web
// page carries only the web's ways (components/AppShell says how that was measured).
const APP = process.env.NEXT_PUBLIC_GT3_TARGET === "app";

// How a refusal reads: the phone's permission off; the person closing the sheet (Capacitor's share says
// "Share canceled", the browser's an AbortError); anything else is a failure.
function outcomeOf(e: unknown): Outcome {
  const err = (e ?? {}) as { code?: string; name?: string; message?: string };
  if (err.code === "DENIED") return "denied";
  if (err.name === "AbortError" || /cancel/i.test(String(err.message ?? e))) return "cancelled";
  return "failed";
}

/** A file's name as the phone keeps it: letters, digits, dots, dashes, underscores and spaces (the same
 *  rule GT3Device.safeName applies). */
export function fileName(name: string): string {
  const kept = name.replace(/[^\w.\- ]+/g, "-").replace(/^[.\- ]+|[.\- ]+$/g, "");
  return kept.slice(0, 120) || "gt3-file";
}

/** The last part of an address, as a file's name: …/post/IMG_0042.jpg → IMG_0042.jpg. */
export function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "gt3-file";
  } catch {
    return "gt3-file";
  }
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(blob);
  });
}

// In the app: the file kept where the share sheet can reach it, then the sheet.
async function shareFile(device: NativeDevice, name: string, blob: Blob, text?: string): Promise<Outcome> {
  try {
    const { uri } = await device.keepFile({ name: fileName(name), data: await base64(blob) });
    await device.share({ text, files: [uri] });
    return "done";
  } catch (e) {
    return outcomeOf(e);
  }
}

/** Save a file the person asked for: a download on the web, the share sheet in the app. */
export async function saveFile(name: string, blob: Blob): Promise<Outcome> {
  if (typeof window === "undefined") return "unsupported";
  if (APP && native) return shareFile(native, name, blob);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "done";
}

/** A file at an https address — a post's photo — into the share sheet. The app's alone: on the web the
 *  link itself does it (components/NativeBridge calls this for an <a download> the app would drop). */
export async function saveFromUrl(url: string, name?: string): Promise<Outcome> {
  if (!APP || !native) return "unsupported";
  try {
    const { uri } = await native.keepFile({ name: fileName(name || nameFromUrl(url)), url });
    await native.share({ files: [uri] });
    return "done";
  } catch (e) {
    return outcomeOf(e);
  }
}

/** Share a link: the share sheet in the app, the browser's own where it has one. "unsupported" where it
 *  has none — the caller copies the link instead, and says so. */
export async function shareLink(link: { title?: string; text?: string; url: string }): Promise<Outcome> {
  if (typeof window === "undefined") return "unsupported";
  if (APP && native) {
    try {
      await native.share({ title: link.title, text: link.text, url: link.url, dialogTitle: link.title });
      return "done";
    } catch (e) {
      return outcomeOf(e);
    }
  }
  if (!navigator.share) return "unsupported";
  try {
    await navigator.share(link);
    return "done";
  } catch (e) {
    return outcomeOf(e);
  }
}

/** Share an image with words beside it: the share sheet in the app; on the web the browser's own share
 *  of a file where it can, "unsupported" where it cannot (the caller saves and copies it instead). */
export async function shareImage(name: string, blob: Blob, text?: string): Promise<Outcome> {
  if (typeof window === "undefined") return "unsupported";
  if (APP && native) return shareFile(native, name, blob, text);
  const file = new File([blob], name, { type: blob.type || "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (!nav.share || !nav.canShare?.({ files: [file] })) return "unsupported";
  try {
    await nav.share({ files: [file], text });
    return "done";
  } catch (e) {
    return outcomeOf(e);
  }
}

/** Print the page as it is (its print styles apply): the browser's print on the web, the phone's print
 *  panel in the app — which also saves it as a PDF. `name` is the print job's. */
export async function printPage(name?: string): Promise<Outcome> {
  if (typeof window === "undefined") return "unsupported";
  if (APP && native) {
    try {
      const r = await native.printPage({ name });
      return r?.printed === false ? "cancelled" : "done";
    } catch (e) {
      return outcomeOf(e);
    }
  }
  window.print();
  return "done";
}

/** The event as the phone's New Event sheet takes it. An all-day entry is that one day; a timed one ends
 *  when it says, or two hours on — as the .ics says (lib/ics buildIcs). */
export function nativeEvent(ev: CalEvent): NativeEvent {
  const allDay = !!ev.allDay;
  const end = ev.end ?? (allDay ? ev.start : new Date(ev.start.getTime() + 2 * 3600000));
  return {
    title: ev.title || "GT3 event", start: ev.start.getTime(), end: end.getTime(), allDay,
    location: ev.location || undefined, notes: ev.description || undefined, url: ev.url || undefined,
  };
}

/** Add an event to the person's own calendar: the .ics file on the web (Apple Calendar, Outlook and any
 *  calendar app open it), the phone's own New Event sheet in the app. The caller writes the .ics
 *  (lib/ics buildIcs), so the calendar's code rides only with the screens that offer it. */
export async function addToCalendar(ev: CalEvent, ics: { name: string; text: string }): Promise<Outcome> {
  if (typeof window === "undefined") return "unsupported";
  if (APP && native) {
    try {
      const r = await native.addEvent(nativeEvent(ev));
      return r?.added ? "done" : "cancelled";
    } catch (e) {
      return outcomeOf(e);
    }
  }
  return saveFile(ics.name, new Blob([ics.text], { type: "text/calendar;charset=utf-8" }));
}

/** Add a membership pass to Apple Wallet: a .pkpass download on the web (Safari opens it in Wallet),
 *  Wallet's own Add sheet in the app. */
export async function addToWallet(pass: Blob): Promise<Outcome> {
  if (typeof window === "undefined") return "unsupported";
  if (APP && native) {
    try {
      await native.addPass({ data: await base64(pass) });
      return "done";
    } catch (e) {
      return outcomeOf(e);
    }
  }
  return saveFile("gt3-membership.pkpass", pass);
}
