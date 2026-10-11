// WHERE A LINK TAPPED IN THE IPHONE APP OPENS (2026-10-11, the review). components/NativeBridge asks this of every
// link and every window.open in the app: null keeps it in the app (or hands it to the phone — Maps, Phone, Mail);
// an address opens in the in-app browser sheet.
//
// The app's own pages come first. On an iPhone they live at capacitor://localhost: no http, and no origin either (a
// URL with a scheme of its own has "null" for one) — so a link to a page only the web serves (/built/…) stopped at the
// old first line, "not http: one of the phone's own apps", and Next took it to a page the app doesn't hold, which is
// the home screen. Scheme and host are what make a link the app's own. It is pure, with the page's address passed in,
// so the smoke asks it from the phone's address — the browser tests are served from http://localhost, where the old
// code worked, and that is how it passed them all.

const MAPS = /^https:\/\/(maps\.apple\.com|maps\.google\.|www\.google\.[^/]+\/maps|goo\.gl\/maps)/;

/** Where `url` should open instead of inside the app — the web's page, or another site's — or null. `here` is the
 *  page's own address (window.location); `webOnly`, the paths only the web serves; `webOrigin`, the web's address. */
export function opensOutside(url: string, here: { protocol: string; host: string }, webOnly: readonly string[], webOrigin: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol === here.protocol && u.host === here.host) {
    return webOnly.some((p) => u.pathname.startsWith(p)) ? `${webOrigin}${u.pathname}${u.search}${u.hash}` : null;
  }
  if (!/^https?:$/i.test(u.protocol)) return null;   // tel:, mailto:, sms: — the phone's own apps
  if (MAPS.test(u.href)) return null;                // Maps opens the Maps app
  return u.href;                                     // another site
}
