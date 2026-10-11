// WHAT ONLY AN IPHONE NEEDS (2026-10-06). Safari-only workarounds live here, so no component re-derives
// them: knowing the phone is an iPhone, and keeping a tapped field from zooming the whole page.

/** An iPhone or iPad. iPadOS reports itself as a Mac, so a Mac with a touch screen counts too. */
export function isIPhoneLike(): boolean {
  return typeof navigator !== "undefined"
    && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform ?? "")));
}

// THE APP RUNS ON AN IPAD (2026-10-11). Words that name the device in someone's hand — "Calendar on this iPhone",
// "this iPhone's Settings" — said iPhone on an iPad. They say what it is: an iPad's web view says iPad (the app keeps it
// in mobile mode, capacitor.config.ts), and in iPadOS's desktop mode an iPad says Mac and has a touch screen.

/** "iPad" or "iPhone", from what the web view says of itself. Pure, for tests. */
export function appleDeviceFrom(userAgent: string, maxTouchPoints: number, platform: string): "iPhone" | "iPad" {
  return /iPad/.test(userAgent) || (maxTouchPoints > 1 && /Mac/.test(platform)) ? "iPad" : "iPhone";
}

/** This device's name, for words drawn on the client (a menu once opened, a toast, an answer the phone gave). */
export function appleDevice(): "iPhone" | "iPad" {
  if (typeof navigator === "undefined") return "iPhone";
  return appleDeviceFrom(navigator.userAgent, navigator.maxTouchPoints ?? 0, navigator.platform ?? "");
}

// NO ZOOM ON A TAPPED FIELD (2026-10-06). Safari on an iPhone zooms into any field whose text is under
// 16px the moment it is focused, and never zooms back: the page stays at 107–114% and whatever comes
// next is cut off on the right — the offer letter's preview, opened after typing in the offer, looked
// broken because of it. Most of the app's fields are 15px (the `.app` field rule in app/globals.css),
// so it happened on nearly every form. On an iPhone only, the viewport gains maximum-scale=1: iOS then
// skips the focus zoom and still lets a person pinch to zoom (iOS 10 and later ignore the limit for a
// pinch), so the pinch app/layout.tsx protects is kept. Android keeps the layout's maximum-scale=5 —
// there the same words would block the pinch.
export const NO_FOCUS_ZOOM = "maximum-scale=1";

/** The viewport content with the iPhone's limit in place of any other maximum-scale. Pure, for tests. */
export function withoutFocusZoom(content: string): string {
  const kept = content.split(",").map((p) => p.trim()).filter((p) => p && !/^maximum-scale\s*=/i.test(p));
  return [...kept, NO_FOCUS_ZOOM].join(", ");
}

/** Run on every screen (components/AppShell): a no-op anywhere but an iPhone. */
export function holdFocusZoom(): void {
  if (typeof document === "undefined" || !isIPhoneLike()) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const next = withoutFocusZoom(meta.content);
  if (meta.content !== next) meta.content = next;
}
