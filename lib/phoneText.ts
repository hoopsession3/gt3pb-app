// THE PHONE'S TEXT SIZE, IN THE APP (2026-10-08, the type round: redesign 6, approved by Ryan).
//
// An iPhone's Text Size (Settings › Display & Brightness, and Accessibility's Larger Text) sets the size of
// its body text: 17pt at the standard size, 14 to 23 across the seven ordinary sizes, 28 to 53 in the
// accessibility ones. The app has its own four text sizes (components/DisplayToggle: the page drawn 1, 1.08,
// 1.16 or 1.26 times its size). In the iPhone app, until someone picks one of those, the app takes the one
// nearest the phone's (components/usePhoneText reads it from WebKit's own body face). Never smaller than
// standard: the ten steps start at 11px, and nothing goes under them. A size picked in the app wins.

/** The body text's size at the phone's standard Text Size, in points (px on the page). */
export const STANDARD_BODY = 17;

/** The page's scale at each of the app's text sizes: app/globals.css .app.rd-t1 … rd-t6 .body{zoom}.
 *  TO TWICE ITS SIZE (R12 — the 10/10 audit, F1): every larger size used to stop at 1.26, so an iPhone set to one of
 *  its accessibility sizes (28 to 53pt, 165% to 312% of standard) drew the app at 126% — and the app's web view takes
 *  no pinch (it scrolls inside the page, not itself). Three more steps reach 200%, the page reflowing at each. */
export const ZOOMS = [1, 1.08, 1.16, 1.26, 1.5, 1.75, 2] as const;

export type TextTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The app's text size nearest the phone's, from the phone's body size in px. Standard below it. */
export function tierForBody(px: number): TextTier {
  if (!(px > STANDARD_BODY)) return 0;
  const r = px / STANDARD_BODY;
  let best = 0;
  for (let t = 1; t < ZOOMS.length; t++) if (Math.abs(ZOOMS[t] - r) < Math.abs(ZOOMS[best] - r)) best = t;
  return best as TextTier;
}
