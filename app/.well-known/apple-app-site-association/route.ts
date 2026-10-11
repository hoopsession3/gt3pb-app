import { NextResponse } from "next/server";
import { route } from "@/lib/apiRoute";

// public: Apple's file for universal links and password AutoFill — it names the iPhone app and which of this site's addresses open it, nothing else
// UNIVERSAL LINKS (2026-10-11). With the app installed, a link to app.gt3pb.com tapped in Messages, Mail or a
// note — or a member's card scanned with the Camera — opens the GT3 app on that screen instead of Safari
// (components/NativeBridge appUrlOpen: the same screen; a lesson's web address as the app's; a page only the web
// serves in the app's browser sheet). iOS reads this file when the app is installed, through Apple's CDN; the app's
// entitlement names the domain (scripts/ios.configure.mjs: applinks and webcredentials, app.gt3pb.com).
//
// Left to Safari: the server's own addresses, the pages the app's build leaves out (scripts/build.app.mjs LEAVE_OUT:
// /built, /c), this folder, the truck's TV loop, and a password reset's link (the review, 2026-10-11 — the app handles
// one too, components/NativeBridge, but a reset belongs where it was asked for). webcredentials lets iOS offer a
// password saved for app.gt3pb.com in the app's sign-in.
const APP_ID = "7SC4HB6V2J.com.gt3pb.app";
const SITE = {
  applinks: {
    details: [{
      appIDs: [APP_ID],
      components: [
        { "/": "/api/*", exclude: true, comment: "the server's" },
        { "/": "/built/*", exclude: true, comment: "web-only: a partner's one-pager" },
        { "/": "/c/*", exclude: true, comment: "web-only: a printed code's landing page" },
        { "/": "/.well-known/*", exclude: true },
        { "/": "/display", exclude: true, comment: "the truck's TV" },
        { "/": "*", "#": "*type=recovery*", exclude: true, comment: "a password reset: the browser it was asked from sets the new one" },
        { "/": "*" },
      ],
    }],
  },
  webcredentials: { apps: [APP_ID] },
};

async function get() {
  return NextResponse.json(SITE, { headers: { "cache-control": "public, max-age=3600" } });
}

export const GET = route("well-known/apple-app-site-association", get);
