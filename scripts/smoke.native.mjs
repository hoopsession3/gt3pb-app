// THE IPHONE APP, OPENED THE WAY A PHONE OPENS IT (2026-10-06, the iPhone round).
//
//   npm run build:app -- --smoke && npm run smoke:native     (`npm run verify` runs both, last)
//   node scripts/smoke.native.mjs --shots <dir>              (and keeps a picture of every screen)
//
// out/ is the app's copy of the screens (scripts/build.app.mjs): what `npx cap sync ios` puts inside the
// iPhone app. This opens it on three iPhones, with the phone's side of Capacitor stood in for: every
// page as a guest, every crew section as a signed-in owner (in the crew's Day look on two phones and
// the dark look on the third), a customer's sheet, the crew's first-run guide. THE APP RUNS ON AN IPAD
// (2026-10-11): the crew's screens are opened on an iPad as well, upright and on its side (1b). It holds
// the app to what a native app owes the person holding it:
//
//   1. IT FITS EVERY PHONE. No sideways scroll at 375, 402 or 440 points wide (an iPad's 820 and 1,180 too), and nothing a person
//      reads or taps lies under the status bar, the Dynamic Island or the home indicator — measured with
//      each phone's own insets (Chromium's safe-area override: env(safe-area-inset-top) reads 62 here as
//      it does on an iPhone 17), on each screen as it opens and again scrolled part way, when what is
//      pinned must still be clear and the status bar's own ground must hide the words passing under it.
//      The status bar's text must be legible: what the app told the phone is checked against the
//      pixels under the bar.
//   2. A RELOAD STAYS PUT. This server answers the way the app's router does (ExportRouter in
//      ios/App/App/GT3ViewController.swift, mirrored line for line in routeFor below): a deep screen
//      reloads as itself, and a screen-to-screen move reads its data from the export, never a 404.
//   3. THE API IS THE WEB'S. In the app the page's own address is the phone, where no server runs, so
//      every /api call must leave for https://app.gt3pb.com (lib/native apiUrl). One that asks the
//      page's own origin fails the run.
//   4. THE NATIVE SIDE IS SPOKEN TO, AND ONLY IN WORDS IT KNOWS. The launch screen is let go, the status
//      bar follows the screen, a link out opens the in-app browser, a tab taps the haptic engine, a tap on
//      the status bar goes to the top. The stand-in knows exactly the methods the installed plugins'
//      native halves declare — read from their Swift and Objective-C, as Capacitor's own JSExport.swift
//      does — so a call the phone would refuse is refused here too.
//   5. THE KEYBOARD. When it rises the web view shrinks above it (capacitor.config.ts, resize "native"):
//      the tab bar steps aside and the field being typed in stays in sight. Offline, the banner says so
//      below the status bar.
//   6. NOTHING COMPLAINS: no console error, no uncaught exception, no Content-Security-Policy refusal
//      (the app's policy rides in a <meta> tag, and it is enforced here).
//
// Hermetic: the smoke build's backend is a stand-in this answers itself in the browser (see THE
// STAND-IN BACKEND), the API is answered here, and every other host is held back — nothing leaves the
// machine and nothing real is needed. What this cannot see — the real WKWebView, the real keyboard, the
// Swift itself — the iOS workflow's simulator run covers (.github/workflows/ios.yml), and TestFlight
// after it.
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = await import("playwright")); }
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const PORT = 3290;
// localhost, not 127.0.0.1: a secure context, as the app's capacitor://localhost is.
const BASE = `http://localhost:${PORT}`;
const API_ORIGIN = "https://app.gt3pb.com";
const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? process.argv[i + 1] : null; })();

// The phones. Points, and the insets iOS gives a portrait app. The smallest iPhone iOS 26 runs on, the
// 6.3" phone the App Store's second screenshot size is taken from, and the 6.9" phone its first is.
// Keyboard heights are the English keyboard with its suggestion bar, home-indicator strip included,
// which is how iOS reports them.
export const PHONES = [
  { name: "iPhone SE", width: 375, height: 667, top: 20, bottom: 0, keyboard: 260 },
  { name: "iPhone 17", width: 402, height: 874, top: 62, bottom: 34, keyboard: 336 },
  { name: "iPhone 17 Pro Max", width: 440, height: 956, top: 62, bottom: 34, keyboard: 346 },
];
const MAIN = PHONES[1];

// THE APP RUNS ON AN IPAD (2026-10-11, scripts/ios.configure.mjs 4). The 11-inch iPad Air, the iPad a truck most
// likely has, both ways up: 820 × 1,180 points upright and 1,180 × 820 on its side, its 24pt status bar above and its
// 20pt home indicator below either way (an iPad has no notch, so nothing at its sides). Its web view says iPad
// (capacitor.config.ts keeps it in mobile mode) and draws at 2×. Upright is one column; on its side the console is
// the desk (lib/surfaces DESK_QUERY), which is why both are opened. 1b opens every crew section on each.
export const TABLETS = [
  { name: "iPad Air 11 upright", width: 820, height: 1180, top: 24, bottom: 20, ipad: true },
  { name: "iPad Air 11 on its side", width: 1180, height: 820, top: 24, bottom: 20, ipad: true },
];
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

// Pages that answer to the inset rule differently, and why. Nothing else may.
const NOT_A_PHONE_SCREEN = {
  "/display": "the signage screen for the truck's TV — opened on a television, never in the iPhone app",
};

// ── THE APP'S ROUTER, MIRRORED ──────────────────────────────────────────────────────────────────────
// ExportRouter (ios/App/App/GT3ViewController.swift, written by scripts/ios.configure.mjs). Change one,
// change the other: scripts/smoke.cjs holds the two to the same three rules.
export function routeFor(path, exists) {
  if (extname(path)) return path;                                  // a file: itself
  let page = path;
  while (page.endsWith("/")) page = page.slice(0, -1);
  if (!page) return "/index.html";                                 // the root: the home page
  for (const candidate of [`${page}.html`, `${page}/index.html`]) if (exists(candidate)) return candidate;
  return "/index.html";                                            // anything else: the home page
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".mp4": "video/mp4",
  ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".pdf": "application/pdf",
};

// ── THE NATIVE HALVES, AS THE PHONE WOULD DECLARE THEM ─────────────────────────────────────────────
// Capacitor's bridge tells the page which plugins exist and what each can do (JSExport.swift
// createPluginHeader): five methods every plugin has, then the plugin's own CAPPluginMethod list. The
// same, read from the same sources: every @capacitor plugin in package.json with an iOS half (what
// `cap sync` registers), the bridge's own plugins (SystemBars, Console, WebView, the HTTP pair), and
// the app's own, in its target (GT3Device: ios/App/App/GT3Device.swift, which GT3ViewController
// registers).
export function nativePlugins(root = ROOT) {
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(swift|m)$/.test(e.name)) files.push(p); } };
  const deps = Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies || {});
  for (const dep of deps) {
    if (!dep.startsWith("@capacitor/") || ["@capacitor/core", "@capacitor/ios", "@capacitor/android", "@capacitor/cli"].includes(dep)) continue;
    const ios = join(root, "node_modules", dep, "ios");
    if (existsSync(ios)) walk(ios);
  }
  walk(join(root, "node_modules", "@capacitor", "ios", "Capacitor", "Capacitor", "Plugins"));
  if (existsSync(join(root, "ios", "App", "App"))) walk(join(root, "ios", "App", "App"));
  const BASE_METHODS = [
    { name: "addListener", rtype: null }, { name: "removeListener", rtype: null },
    { name: "removeAllListeners", rtype: "promise" }, { name: "checkPermissions", rtype: "promise" }, { name: "requestPermissions", rtype: "promise" },
  ];
  const rtypeOf = (t) => (t === "None" ? null : t.toLowerCase());
  const plugins = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const swift = src.match(/jsName\s*=\s*"(\w+)"/);
    const objc = src.match(/CAP_PLUGIN\(\s*\w+\s*,\s*"(\w+)"/);
    const name = swift?.[1] ?? objc?.[1];
    if (!name) continue;
    const own = swift
      ? [...src.matchAll(/CAPPluginMethod\(name:\s*"(\w+)",\s*returnType:\s*CAPPluginReturn(\w+)\)/g)].map((m) => ({ name: m[1], rtype: rtypeOf(m[2]) }))
      : [...src.matchAll(/CAP_PLUGIN_METHOD\((\w+),\s*CAPPluginReturn(\w+)\)/g)].map((m) => ({ name: m[1], rtype: rtypeOf(m[2]) }));
    if (!plugins.some((p) => p.name === name)) plugins.push({ name, own, methods: [...BASE_METHODS, ...own] });
  }
  return plugins;
}

// What the phone answers to the calls that return something. Everything else resolves empty.
const ANSWERS = {
  "App.getInfo": { name: "GT3PB", id: "com.gt3pb.app", build: "1", version: "1.0" },
  "App.getState": { isActive: true },
  "App.getLaunchUrl": {},
  "Keyboard.getResizeMode": { mode: "native" },
  "StatusBar.getInfo": { visible: true, style: "DARK", overlays: true },
  // The app's own plugin (native/ios/GT3Device.swift) and the share sheet: a file kept, a print sent, an
  // event saved, a share made.
  "GT3Device.keepFile": { uri: "file:///private/var/mobile/Containers/Data/Application/SMOKE/tmp/gt3-files/SMOKE/kept" },
  "GT3Device.printPage": { printed: true },
  "GT3Device.addEvent": { added: true },
  // Apple's sheet, answered with a made-up credential (the identity token goes to the stand-in's token exchange).
  "GT3Device.signInWithApple": { identityToken: "smoke.apple-identity-token.sig", authorizationCode: "csmoke0123456789.0.mrxv.apple-one-time-code", user: "000123.smokeapple0042.0042", givenName: "Riley" },
  "GT3Device.appleCredentialState": { state: "authorized" },
  "Share.share": { activityType: "com.apple.UIKit.activity.SaveToCameraRoll" },
  // Alerts (2026-10-11): never asked on this phone, then a yes when the app asks.
  "PushNotifications.checkPermissions": { receive: "prompt" },
  "PushNotifications.requestPermissions": { receive: "granted" },
  "GT3Device.openSettings": { opened: true },
  // The phone's Bold Text and Reduce Transparency (R12, F19): both off, as most phones have them.
  "GT3Device.displayPrefs": { boldText: false, reduceTransparency: false },
};

// The phone's side of the bridge, in the page: window.webkit.messageHandlers.bridge is where
// native-bridge.js posts every call (it is how the bridge knows it is on iOS at all). Calls are kept for
// the checks; listeners are kept so the checks can fire their events; the rest are answered on the next
// turn, as a real round trip would be.
function phoneSide({ headers, answers }) {
  const calls = [], listeners = {}, csp = [];
  Object.defineProperty(window, "__native", { value: { calls, listeners, csp } });
  document.addEventListener("securitypolicyviolation", (e) => csp.push(`${e.violatedDirective} ← ${e.blockedURI || "inline"}`));
  // The bridge asks two yes/no questions through prompt() before anything else: is CapacitorHttp on, are
  // CapacitorCookies on. Both are off in this app (capacitor.config.ts sets neither).
  window.prompt = (msg) => { try { const q = JSON.parse(msg); if (q.type === "CapacitorHttp" || q.type === "CapacitorCookies.isEnabled") return "false"; } catch { /* not the bridge */ } return null; };
  window.webkit = { messageHandlers: { bridge: { postMessage(data) {
    if (data.type && data.type !== "message") return;
    calls.push({ plugin: data.pluginId, method: data.methodName, options: data.options ?? {} });
    if (data.methodName === "addListener") { (listeners[`${data.pluginId}.${data.options?.eventName}`] ||= []).push(data.callbackId); return; }
    if (data.methodName === "removeListener") {
      const key = `${data.pluginId}.${data.options?.eventName}`;
      listeners[key] = (listeners[key] || []).filter((id) => id !== data.options?.callbackId);
      return;
    }
    if (!data.callbackId || data.callbackId === "-1") return;
    const header = headers.find((h) => h.name === data.pluginId);
    const known = !!header?.methods.some((m) => m.name === data.methodName);
    const reply = known
      ? { callbackId: data.callbackId, pluginId: data.pluginId, methodName: data.methodName, success: true, data: answers[`${data.pluginId}.${data.methodName}`] ?? {} }
      : { callbackId: data.callbackId, pluginId: data.pluginId, methodName: data.methodName, success: false, error: { message: `${data.pluginId}.${data.methodName}() is not a native method`, code: "UNIMPLEMENTED" } };
    setTimeout(() => window.Capacitor.fromNative(reply), 0);
  } } } };
  // JSExport.exportCapacitorGlobalJS, as a release build writes it.
  window.Capacitor = { DEBUG: false, isLoggingEnabled: false, Plugins: {} };
  window.WEBVIEW_SERVER_URL = window.location.origin;
}

// JSExport.exportJS, per plugin: the Plugins object and its header.
function pluginScripts(headers) {
  const w = window;
  const a = (w.Capacitor = w.Capacitor || {});
  const p = (a.Plugins = a.Plugins || {});
  for (const h of headers) {
    const t = (p[h.name] = {});
    t.addListener = (eventName, cb) => w.Capacitor.addListener(h.name, eventName, cb);
    t.removeAllListeners = () => w.Capacitor.nativePromise(h.name, "removeAllListeners");
    for (const m of h.own) {
      t[m.name] = m.rtype === "promise"
        ? (options) => w.Capacitor.nativePromise(h.name, m.name, options)
        : (options, cb) => w.Capacitor.nativeCallback(h.name, m.name, options, cb);
    }
    (a.PluginHeaders = a.PluginHeaders || []).push({ name: h.name, methods: h.methods });
  }
}

// ── WHAT A PERSON CAN SEE AND TOUCH UNDER THE SYSTEM'S BARS ────────────────────────────────────────
// Every tappable thing, and every run of text, that is actually painted (not display:none, not hidden,
// not clipped away by a scrolling ancestor, not a 1px screen-reader label) and lies above the top
// inset or below the bottom one. Backgrounds may run under the bars — that is what edge to edge means.
// At the bottom, a list that can still scroll on may pass under the home indicator, as every iOS list
// does; what is pinned there, or the end of a list, may not. With pinnedOnly — a screen scrolled part
// way — only what is pinned (fixed, or sticky) counts at either edge: the words scrolling past go under
// the status bar's own ground, which is right; a bar that sticks under the clock is not.
function underTheBars({ top, bottom, pinnedOnly = false }) {
  const H = window.innerHeight, W = window.innerWidth;
  const found = [], seen = new Set();
  // Pinned: held where it is on the screen while what scrolls scrolls — a fixed or sticky box met on the
  // way up before any box that scrolls, or no scrolling box above it at all (the tab bar).
  const scrolls = (e) => { const oy = getComputedStyle(e).overflowY; return (oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight + 1; };
  const pinned = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.classList.contains("native-bar")) return false;
      const pos = getComputedStyle(e).position;
      if (pos === "fixed" || pos === "sticky") return true;
      if (e !== el && scrolls(e)) return false;
    }
    return true;
  };
  const painted = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse" || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  // The part of a box its scrolling and clipping ancestors leave showing. Text is clipped by its own
  // element too — which is how a 1px screen-reader heading hides its words.
  const showing = (el, r, self) => {
    let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (let e = self ? el : el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === "visible" && cs.overflowY === "visible" && cs.clipPath === "none") continue;
      const c = e.getBoundingClientRect();
      if (cs.overflowX !== "visible") { x1 = Math.max(x1, c.left); x2 = Math.min(x2, c.right); }
      if (cs.overflowY !== "visible") { y1 = Math.max(y1, c.top); y2 = Math.min(y2, c.bottom); }
      if (x2 - x1 <= 1 || y2 - y1 <= 1) return null;
    }
    x1 = Math.max(x1, 0); y1 = Math.max(y1, 0); x2 = Math.min(x2, W); y2 = Math.min(y2, H);
    return x2 - x1 > 1 && y2 - y1 > 1 ? { top: y1, bottom: y2, left: x1, right: x2 } : null;
  };
  const name = (el) => {
    const t = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 36);
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${t ? ` "${t}"` : ""}`;
  };
  const scrollsOn = (el) => {
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      if (scrolls(e)) return e.scrollTop + e.clientHeight < e.scrollHeight - 1;
    }
    return false;
  };
  const check = (el, rect, what) => {
    if (rect.width <= 1 || rect.height <= 1) return;
    if (pinnedOnly && !pinned(el)) return;
    const s = showing(el, rect, what === "text");
    if (!s) return;
    const edge = s.top < top - 0.5 ? "top" : bottom > 0 && s.bottom > H - bottom + 0.5 ? "bottom" : null;
    if (!edge) return;
    if (edge === "bottom" && !pinned(el) && scrollsOn(el)) return;
    // Covered by something opaque laid over it (a takeover, a sheet's scrim) — not what a person sees.
    const hit = document.elementFromPoint((s.left + s.right) / 2, (s.top + s.bottom) / 2);
    if (hit && !el.contains(hit) && !hit.contains(el)) return;
    const key = `${edge}|${name(el)}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ edge, what, el: name(el), at: Math.round(edge === "top" ? s.top : H - s.bottom) });
  };
  for (const el of document.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="tab"],[role="link"],[role="switch"],[role="checkbox"]')) {
    if (painted(el)) check(el, el.getBoundingClientRect(), "tap");
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,template") || !painted(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) check(el, r, "text");
  }
  return found;
}

// How light the pixels of a screenshot are, 0–1, and how much they vary: the status bar's ground, read
// from the picture itself rather than from anything the page says about itself, so it can check what the
// page told the phone — and, scrolled, that no words show through it (words under the clock are spread;
// a ground is flat). Playwright's PNGs are 8-bit RGB(A) and not interlaced.
export function bandStats(png, rows = Infinity) {
  let o = 8, width = 0, height = 0, depth = 0, type = 0;
  const idat = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o), kind = png.toString("latin1", o + 4, o + 8), data = png.subarray(o + 8, o + 8 + len);
    if (kind === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12] !== 0) throw new Error("an interlaced PNG"); }
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    o += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`a PNG of ${depth}-bit colour type ${type}`);
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
  const last = Math.min(rows, height);
  const px = Buffer.alloc(stride * last);
  let sum = 0, squares = 0;
  for (let y = 0; y < last; y++) {
    const filter = raw[y * (stride + 1)], line = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      let v = raw[line + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
    for (let x = 0; x < width; x++) { const i = row + x * bpp, l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; sum += l; squares += l * l; }
  }
  const n = last * width;
  if (!n) return null;
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, squares / n - mean * mean)) };
}

// A page is measured once it has stopped moving (scripts/verify.prod.mjs SETTLE, the same reason: a
// fade caught halfway is not the page).
// ── THE CREW HEADER, ONE KIT (2026-10-07, the pill round) ─────────────────────────────────────
// Runs IN THE PAGE. Ryan's My Day header at 9:17 was five controls in five recipes; what a thumb and an
// eye make of it now: every control the kit's, the row's controls on one line of centres, 44px to the
// thumb on each (the point 21.5px above and below each centre still lands on it), the words in the
// middle of each segment, and the lane's thumb under the section you are in.
function headerReport() {
  const R = (el) => el.getBoundingClientRect();
  const row = document.querySelector(".toprow");
  const lane = document.querySelector(".lane-tabs .k-seg");
  if (!row) return { missing: true };
  const btns = [...row.querySelectorAll("button, a")];
  const foreign = btns.filter((b) => !b.matches(".k-icon-btn, .k-seg-opt")).map((b) => `${b.tagName.toLowerCase()}.${b.className}`);
  // the row's controls, grouped by line (the largest text size may wrap the row)
  const items = [...row.querySelectorAll(".k-icon-btn, .k-seg")].map((el) => ({ el, r: R(el) }));
  const lines = [];
  for (const it of items) { const c = it.r.top + it.r.height / 2; const l = lines.find((x) => Math.abs(x.c - c) < 12); if (l) l.items.push(it); else lines.push({ c, items: [it] }); }
  const offCentre = lines.flatMap((l) => { const cs = l.items.map((i) => i.r.top + i.r.height / 2); const m = cs.reduce((a, b) => a + b, 0) / cs.length; return l.items.filter((i, k) => Math.abs(cs[k] - m) > 1).map((i) => `${i.el.className} ${Math.round(cs[0] - m)}px`); });
  const heights = items.map((i) => Math.round(i.r.height));
  // 44px to the thumb: the points 21.5px above and below the centre land on the control
  const targets = [...btns, ...(lane ? lane.querySelectorAll(".k-seg-opt") : [])];
  const small = targets.filter((b) => {
    const r = R(b); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return [y - 21.5, y + 21.5].some((yy) => { const t = document.elementFromPoint(x, yy); return !(t && (t === b || b.contains(t))); });
  }).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 24));
  // the words in the middle of each segment
  const segOpts = [...document.querySelectorAll(".k-seg-opt")];
  const offText = segOpts.filter((o) => {
    const range = document.createRange(); range.selectNodeContents(o); const t = range.getBoundingClientRect(); const r = R(o);
    return t.height > 0 && Math.abs((t.top + t.height / 2) - (r.top + r.height / 2)) > 1.5;
  }).map((o) => o.textContent.trim());
  // the lane's thumb under the section you are in
  let thumb = { ok: false, why: "no lane" };
  if (lane) {
    const th = lane.querySelector(".k-seg-thumb"), on = lane.querySelector(".k-seg-opt.on");
    if (!lane.hasAttribute("data-thumb") || !th || !on) thumb = { ok: false, why: `data-thumb ${lane.hasAttribute("data-thumb")}, on ${!!on}` };
    else { const a = R(th), b = R(on); thumb = { ok: Math.abs(a.left - b.left) <= 1 && Math.abs(a.width - b.width) <= 1, why: `thumb ${Math.round(a.left)}+${Math.round(a.width)}, ${on.textContent.trim()} ${Math.round(b.left)}+${Math.round(b.width)}`, on: on.textContent.trim() }; }
  }
  const wide = [...row.querySelectorAll("*"), ...(lane ? [lane] : [])].filter((el) => { const r = R(el); return r.width > 0 && (r.left < -0.5 || r.right > innerWidth + 0.5); }).map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute("class") || ""} ${Math.round(R(el).width)}px`).slice(0, 4);
  // an icon is the size the kit gives it — 18px in a 36px button, half its button at any text size —
  // never the page's width (an icon sized by its own box, not the kit's, draws as wide as it can)
  const icons = [...row.querySelectorAll(".k-icon-btn")].map((b) => { const s = b.querySelector("svg"); return s ? R(s).width / R(b).width : 0; }).filter((x) => x > 0.55).map((x) => `${Math.round(x * 100)}%`);
  const mode = row.querySelector('[role="radiogroup"][aria-label="View mode"]');
  return {
    foreign, offCentre, heights, small, offText, thumb, wide, icons, lines: lines.length,
    mode: mode ? [...mode.querySelectorAll('[role="radio"]')].map((b) => `${b.textContent.trim()}:${b.getAttribute("aria-checked")}`).join(" ") : null,
    badge: (() => { const b = row.querySelector(".k-badge"); if (!b) return null; const r = R(b); return { h: Math.round(r.height), ring: getComputedStyle(b).boxShadow !== "none" }; })(),
  };
}

// ── THE APP ON AN IPAD: WHERE THE SHELL STANDS (2026-10-11) ───────────────────────────────────
// Runs IN THE PAGE. The app's box on the glass, its corners and whether a bezel is painted round it; the tab bar's box
// and which way its list runs; and whether the sections' columns are boxes (the desk) or not (one column).
function shellReport() {
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const app = document.querySelector(".app"), nav = document.querySelector(".app > nav.nav");
  const cs = app ? getComputedStyle(app) : null;
  return {
    view: { w: innerWidth, h: innerHeight }, app: box(app), radius: cs ? parseFloat(cs.borderTopLeftRadius) || 0 : null, bezel: cs ? cs.boxShadow !== "none" : null,
    pad: Math.round(parseFloat(getComputedStyle(document.body).paddingTop) || 0),
    nav: box(nav), orient: nav?.querySelector('[role="tablist"]')?.getAttribute("aria-orientation") ?? null,
    cols: [...document.querySelectorAll(".desk-col")].map((c) => getComputedStyle(c).display),
  };
}

// THE BRIDGE IS UP (2026-10-11, two flakes in a day). components/NativeBridge sets itself up after the page has drawn,
// and its last step lets the launch screen go: a tap before that meets no handler, so a click the test meant as the
// app's went to the browser (a saved photo became a page load) or the launch screen's own call landed in a tap's
// window. On the phone a screen has settled once that step has run; a browser with no phone has nothing to wait for.
const BRIDGE_UP = () => !window.__native || window.__native.calls.some((c) => c.plugin === "SplashScreen" && c.method === "hide");

const SETTLE = async () => {
  await document.fonts?.ready;
  const ending = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime));
  await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 3000))]);
};

// ── THE SERVER ─────────────────────────────────────────────────────────────────────────────────────
function serve() {
  const exists = (p) => { try { return statSync(join(OUT, p)).isFile(); } catch { return false; } };
  const log = [];
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, BASE).pathname);
    const file = routeFor(path, exists);
    log.push({ path, file, method: req.method });
    if (file.includes("..") || !exists(file)) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not in the export"); log.at(-1).status = 404; return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(join(OUT, file)));
    log.at(-1).status = 200;
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve({ server, log }));
  });
}

// ── THE STAND-IN BACKEND ───────────────────────────────────────────────────────────────────────────────
// What the smoke build's Supabase address (scripts/build.app.mjs --smoke) answers — in the browser:
// Playwright fulfils every request and the realtime socket, so nothing leaves the machine. Every table
// is empty; there is one made-up owner, whose made-up session the crew pass seeds; the RPCs the console
// asks first answer as they would for that owner, and as they would for a guest without it. Nothing
// here is a credential.
const OWNER_ID = "5a10e000-0000-4000-8000-000000000001";
const TENANT_ID = "5a10e000-0000-4000-8000-0000000000aa";
const OWNER = { id: OWNER_ID, aud: "authenticated", role: "authenticated", email: "owner@smoke.test", app_metadata: { provider: "email" }, user_metadata: { display_name: "Smoke Owner" }, created_at: "2026-01-01T00:00:00Z" };
// A referral code, as every real profile has one (0002's handle_new_user mints it at sign-up: up to eight letters of the
// name, a dash, four of the id's hash). Since R8 (2026-10-16) the 3MPIRE page offers its invite only with the member's own
// code — it used to stand in a made-up one ("GT3PB-3MP") for a profile without it, and a friend who joined with that was
// attached to no one.
const PROFILE = { id: OWNER_ID, display_name: "Smoke Owner", role: "owner", is_admin: true, market: "greenville", leads_market: "greenville", title: null, referred_by: null, created_at: "2026-01-01T00:00:00Z", points: 0, credit_cents: 0, tenant_id: TENANT_ID, referral_code: "SMOKE-0A1B" };
const OWNER_RPC = { is_staff: true, is_admin: true, is_owner: true, current_tenant: TENANT_ID };
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function ownerSession() {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  return {
    access_token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: OWNER_ID, role: "authenticated", aud: "authenticated", exp, email: OWNER.email })}.smoke-signature-not-a-key`,
    token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "smoke-refresh-not-a-token", user: OWNER,
  };
}
const SESSION = ownerSession();
// THE OWNER, AGAIN, WITH CLAIMS OF ITS OWN (R28): a session for the same owner whose token says more — the second step
// (aal) and how they signed in (amr) — signed in base64url as a real one is, so Supabase's client reads its claims.
const ownersOwn = new Set();
function ownerSessionWith(claims, user = OWNER) {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: OWNER_ID, role: "authenticated", aud: "authenticated", exp, email: OWNER.email, ...claims })}.${b64url({ smoke: "not a signature" })}`;
  ownersOwn.add(`Bearer ${token}`);
  return { access_token: token, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "smoke-refresh-not-a-token", user };
}

// `seed` gives a table rows of its own (block 7 needs an event, an error and an offer letter on screen);
// every other table stays empty.
function standIn(writes, seed = {}) {
  return (route) => {
    const req = route.request();
    const url = new URL(req.url());
    // The owner's session — or another of the owner's own (R28: the same owner on a sign-in with or without its code).
    const asOwner = (req.headers().authorization ?? "") === `Bearer ${SESSION.access_token}` || ownersOwn.has(req.headers().authorization ?? "");
    const answer = (status, body, extra = {}) => route.fulfill({
      status,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, PATCH, DELETE, HEAD, OPTIONS", "access-control-expose-headers": "content-range", ...extra },
      body: body === undefined ? "" : JSON.stringify(body),
    });
    if (req.method() === "OPTIONS") return answer(204);
    const path = url.pathname;
    if (path === "/auth/v1/user") return asOwner ? answer(200, OWNER) : answer(401, { message: "no session" });
    if (path === "/auth/v1/token") return answer(200, SESSION);
    if (path.startsWith("/auth/v1/")) return answer(200, {});
    let m;
    // `seed.rpc` answers a function of its own for the owner (5i's office), as `seed` gives a table rows.
    if ((m = path.match(/^\/rest\/v1\/rpc\/(\w+)$/))) return answer(200, asOwner ? (seed.rpc && m[1] in seed.rpc ? seed.rpc[m[1]] : OWNER_RPC[m[1]] ?? null) : m[1] in OWNER_RPC && m[1] !== "current_tenant" ? false : null);
    if ((m = path.match(/^\/rest\/v1\/(\w+)$/))) {
      if (req.method() !== "GET" && req.method() !== "HEAD") { writes.push(`${req.method()} ${m[1]}`); return answer(req.method() === "POST" ? 201 : 204); }
      const rows = seed[m[1]] ?? (m[1] === "profiles" && asOwner ? [PROFILE] : []);
      if (req.method() === "HEAD") return answer(200, undefined, { "content-range": `*/${rows.length}` });
      if (/vnd\.pgrst\.object/.test(req.headers().accept ?? "")) {
        return rows.length ? answer(200, rows[0]) : answer(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: "The result contains 0 rows", hint: null });
      }
      return answer(200, rows, { "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" });
    }
    if (path.startsWith("/functions/v1/")) return answer(200, {});
    return answer(404, { message: "not in the stand-in" });
  };
}

// Supabase's realtime socket speaks Phoenix: every join and heartbeat gets its "ok", and a join for table
// changes gets those changes back with ids, as the server does — otherwise realtime-js reports a mismatch.
function realtimeStandIn(ws) {
  ws.onMessage((raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const changes = (payload) => ({ postgres_changes: (payload?.config?.postgres_changes ?? []).map((c, i) => ({ ...c, id: i + 1 })) });
    if (Array.isArray(msg)) {
      const [joinRef, ref, topic, event, payload] = msg;
      ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: event === "phx_join" ? changes(payload) : {} }]));
    } else if (msg && typeof msg === "object") {
      ws.send(JSON.stringify({ topic: msg.topic, event: "phx_reply", payload: { status: "ok", response: msg.event === "phx_join" ? changes(msg.payload) : {} }, ref: msg.ref, join_ref: msg.join_ref }));
    }
  });
}

// The owner's sections, read from where the app defines them (components/OperatorNav.tsx
// ROLE_SECTIONS.owner) — the same reading scripts/smoke.authed.mjs makes, so a new section is opened
// here the day it is added there.
export function ownerSections(src) {
  const m = src.match(/\n\s*owner:\s*\[([^\]]*)\]/);
  return m ? [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]) : null;
}

// ── THE RUN ────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const MARKER = join(OUT, "gt3-smoke-build.json");
  if (!existsSync(join(OUT, "index.html")) || !existsSync(MARKER)) {
    console.log("NATIVE SMOKE: out/ is not the smoke build. Make it first:  npm run build:app -- --smoke");
    console.log("  (the smoke build points the app at a stand-in backend this answers itself — scripts/build.app.mjs)");
    process.exit(1);
  }
  const BACKEND_HOST = new URL(JSON.parse(readFileSync(MARKER, "utf8")).backend).host;
  const built = statSync(join(OUT, "index.html")).mtime;
  const pages = [];
  const walkPages = (d, rel = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== "_next") walkPages(join(d, e.name), `${rel}/${e.name}`); continue; }
      if (!e.name.endsWith(".html") || e.name === "404.html" || e.name === "_not-found.html") continue;
      const p = `${rel}/${e.name.replace(/\.html$/, "")}`;
      pages.push(p === "/index" ? "/" : p.replace(/\/index$/, ""));
    }
  };
  walkPages(OUT);
  pages.sort();
  const sections = ownerSections(readFileSync(join(ROOT, "components", "OperatorNav.tsx"), "utf8"));
  if (!sections?.length) { console.log("NATIVE SMOKE: could not read ROLE_SECTIONS.owner from components/OperatorNav.tsx — fix the reader, it is what keeps the crew pass whole."); process.exit(1); }

  const plugins = nativePlugins();
  const bridgeJs = readFileSync(join(ROOT, "node_modules", "@capacitor", "ios", "Capacitor", "Capacitor", "assets", "native-bridge.js"), "utf8");
  const headers = plugins.map(({ name, own, methods }) => ({ name, own, methods }));

  let pass = 0, fail = 0;
  const failures = [];
  const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ` → ${detail}` : ""}`); } };

  let srv;
  try { srv = await serve(); }
  catch (e) {
    console.log(`NATIVE SMOKE: could not serve out/ on ${BASE} (${e.code || e.message}). Something else holds port ${PORT}; stop it and run again.`);
    process.exit(1);
  }
  console.log(`NATIVE SMOKE — the smoke build of out/ (${built.toISOString().replace("T", " ").slice(0, 16)} UTC): ${pages.length} screens and ${sections.length} crew sections × ${PHONES.length} iPhones, the crew sections × an iPad both ways up; on the phone: ${plugins.map((p) => p.name).join(", ")}`);

  const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
  const apiCalls = [];       // what left for the web's API
  const strayApi = [];       // /api asked of the page's own origin
  const writes = [];         // writes the screens made to the stand-in on their own (reported)
  const outside = new Set(); // other hosts a page reached for (held back; reported)

  // A phone, as the app finds it: WKWebView's user agent, Capacitor's bridge and plugins injected before
  // the page's first script, the API and the backend answered, the rest of the internet held back.
  // `owner` signs the made-up owner in; `theme` sets the crew's look; `guide` leaves the first-run guide
  // unseen; `seed` puts rows in the stand-in's tables; `shell: false` opens the app's pages in a plain
  // browser — no native side at all, the test run lib/native's isNativeApp() tells apart.
  async function phoneContext(phone, { owner = false, theme = null, guide = false, seed = {}, shell = true, session = SESSION } = {}) {
    // A screen that is not a phone (5i: a laptop, an iPad in a browser) is opened as itself — no iPhone, and touch only
    // if it has it. An iPad in the app (1b) is the app's: its own web view's words, a finger, 2×.
    const ctx = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      ...(phone.desktop
        ? { deviceScaleFactor: 1, isMobile: false, hasTouch: !!phone.touch }
        : phone.ipad
          ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA }
          : { deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }),
      serviceWorkers: "block",
      acceptDownloads: !shell,
    });
    if (shell) {
      await ctx.addInitScript(phoneSide, { headers, answers: ANSWERS });
      await ctx.addInitScript({ content: bridgeJs });
      await ctx.addInitScript(pluginScripts, headers);
    }
    if (owner) {
      await ctx.addInitScript(([key, session, look, seenGuide]) => {
        try {
          localStorage.setItem(key, JSON.stringify(session));
          if (look) localStorage.setItem("gt3-theme", look);
          if (seenGuide) localStorage.setItem("gt3-guide-seen", "1");
        } catch { /* storage refused */ }
      }, [`sb-${BACKEND_HOST.split(".")[0]}-auth-token`, session, theme, !guide]);
    }
    await ctx.route((url) => url.origin === API_ORIGIN, async (route) => {
      const req = route.request();
      apiCalls.push({ url: req.url(), method: req.method(), origin: req.headers().origin });
      const cors = { "access-control-allow-origin": req.headers().origin || "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS", vary: "Origin" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: "{}" });
    });
    await ctx.route((url) => url.host === BACKEND_HOST, standIn(writes, seed));
    await ctx.routeWebSocket((url) => url.host === BACKEND_HOST, realtimeStandIn);
    await ctx.route((url) => url.origin === BASE && url.pathname.startsWith("/api/"), (route) => { strayApi.push(route.request().url()); return route.fulfill({ status: 404, body: "" }); });
    await ctx.route((url) => url.origin !== BASE && url.origin !== API_ORIGIN && url.host !== BACKEND_HOST && /^https?:$/.test(url.protocol), (route) => { outside.add(new URL(route.request().url()).host); return route.abort("blockedbyclient"); });
    return ctx;
  }

  const insetsOn = async (page, top, bottom) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, topMax: top, bottom, bottomMax: bottom, left: 0, leftMax: 0, right: 0, rightMax: 0 } });
    return cdp;
  };

  const watch = (page) => {
    const errors = [];
    // A host held back above; a 404 (the server's own log names each one, and fails the run on it
    // below, with the path); the stand-in's 406, which is how PostgREST says "no such row"; and a
    // guest's 401 from the auth server, which is how it says "nobody signed in" — none is news.
    page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_BLOCKED_BY_CLIENT|status of (401|404|406)/.test(m.text())) errors.push(`console: ${m.text().slice(0, 160)}`); });
    page.on("pageerror", (e) => errors.push(`exception: ${String(e.message || e).slice(0, 160)}`));
    return errors;
  };

  const nativeCalls = (page) => page.evaluate(() => window.__native.calls.map((c) => ({ ...c })));
  const shotPath = (phone, name) => { const dir = join(SHOTS, phone.name.replace(/\W+/g, "-")); mkdirSync(dir, { recursive: true }); return join(dir, `${name}.png`); };

  // One screen, measured as it opens and again scrolled part way.
  async function measure(page, phone, errors, file) {
    await page.waitForFunction(() => window.__native?.calls.some((c) => c.plugin === "SplashScreen" && c.method === "hide"), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(SETTLE);
    // Handed over as a function, never as source to rebuild in the page: the app's policy has no
    // 'unsafe-eval', and it is right not to.
    const under = await page.evaluate(underTheBars, { top: phone.top, bottom: phone.bottom });
    const m = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden";
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const env = [parseFloat(cs.paddingTop), parseFloat(cs.paddingBottom)];
      probe.remove();
      return {
        env,
        wide: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
        native: document.documentElement.dataset.native ?? null,
        splash: window.__native.calls.filter((c) => c.plugin === "SplashScreen" && c.method === "hide").length,
        csp: [...window.__native.csp],
        text: (document.querySelector("main")?.innerText ?? "").slice(0, 400),
      };
    });
    // The status bar's text against the pixels under it. NativeBridge looks again 400ms after a screen
    // settles; give it that, then compare what it last told the phone with the picture.
    await page.waitForTimeout(450);
    const band = { x: 0, y: 0, width: phone.width, height: phone.top };
    const ground = phone.top ? bandStats(await page.screenshot({ clip: band })) : null;
    const style = await page.evaluate(() => window.__native.calls.filter((c) => c.plugin === "SystemBars" && c.method === "setStyle").at(-1)?.options.style ?? null);
    if (SHOTS) await page.screenshot({ path: shotPath(phone, file) });
    // Scrolled part way: what stays pinned must stay clear of the bars, and the status bar's own ground
    // must hide the words passing under it.
    const by = await page.evaluate(() => {
      const b = document.getElementById("body");
      const room = b ? b.scrollHeight - b.clientHeight : 0;
      if (room < 120) return 0;
      b.scrollTop = Math.min(room, Math.round(b.clientHeight * 0.6));
      return b.scrollTop;
    });
    let scrolled = null;
    if (by > 0) {
      await page.waitForTimeout(350);
      const pinned = await page.evaluate(underTheBars, { top: phone.top, bottom: phone.bottom, pinnedOnly: true });
      scrolled = { by, pinned, ground: phone.top ? bandStats(await page.screenshot({ clip: band })) : null };
      if (SHOTS) await page.screenshot({ path: shotPath(phone, `${file}--scrolled`) });
      await page.evaluate(() => { document.getElementById("body").scrollTop = 0; });
    }
    return { ...m, under, bar: { ground, style }, scrolled, errors: [...errors] };
  }

  const findings = (list) => list.map((u) => `${u.what} ${u.el} ${u.at}px into the ${u.edge} inset`).join("; ");
  function judge(where, phone, r, { insets = true } = {}) {
    ok(`${where}: the phone's insets reached the page`, r.env[0] === phone.top && r.env[1] === phone.bottom, `env() read ${r.env.join("/")}, the phone has ${phone.top}/${phone.bottom} — the safe-area override did not take, so nothing below was measured`);
    ok(`${where}: the app knows it is native`, r.native === "ios", `html[data-native] is ${r.native} — components/NativeBridge did not run`);
    ok(`${where}: the launch screen was let go`, r.splash === 1, `SplashScreen.hide() called ${r.splash} times`);
    ok(`${where}: no sideways scroll`, r.wide <= 0, `${r.wide}px wider than the phone`);
    if (r.bar.ground) {
      // SystemBars "LIGHT" is dark text, for a light ground; "DARK" is light text, for a dark one.
      const want = r.bar.ground.mean > 0.5 ? "LIGHT" : "DARK";
      ok(`${where}: the status bar can be read`, r.bar.style === want, `the ground under it is ${Math.round(r.bar.ground.mean * 100)}% light, the app set ${r.bar.style ?? "nothing"} (wanted ${want})`);
    }
    if (insets) ok(`${where}: nothing under the system's bars`, r.under.length === 0, findings(r.under));
    if (r.scrolled) {
      if (insets) ok(`${where}: scrolled, nothing pinned under the bars`, r.scrolled.pinned.length === 0, findings(r.scrolled.pinned));
      if (r.scrolled.ground) ok(`${where}: scrolled, no words show under the clock`, r.scrolled.ground.sd < 0.035, `the status bar's band varies by ${r.scrolled.ground.sd.toFixed(3)} — words are passing under the clock (.native-bar)`);
    }
    ok(`${where}: no CSP refusal`, r.csp.length === 0, r.csp.join("; "));
    ok(`${where}: no errors`, r.errors.length === 0, r.errors.join(" | "));
  }

  // ── 1 · every screen as a guest, every crew section as the owner, on every phone ──
  await Promise.all(PHONES.map(async (phone, i) => {
    // The guest.
    {
      const ctx = await phoneContext(phone);
      const page = await ctx.newPage();
      await insetsOn(page, phone.top, phone.bottom);
      const errors = watch(page);
      for (const path of pages) {
        errors.length = 0;
        let res;
        try { res = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 30000 }); }
        catch (e) { ok(`${phone.name} ${path}: loads`, false, e.message.split("\n")[0]); continue; }
        ok(`${phone.name} ${path}: served`, res?.status() === 200, `HTTP ${res?.status()}`);
        const r = await measure(page, phone, errors, path === "/" ? "home" : path.slice(1).replace(/\//g, "_"));
        judge(`${phone.name} ${path}`, phone, r, { insets: !NOT_A_PHONE_SCREEN[path] });
      }
      // A sheet, as a customer opens one: a drink's card on the menu, its button at the bottom.
      errors.length = 0;
      await page.goto(`${BASE}/menu`, { waitUntil: "load" });
      await page.waitForTimeout(600); await page.evaluate(SETTLE);
      const entry = page.locator(".entry").first();
      ok(`${phone.name} /menu: a drink to tap`, (await entry.count()) > 0, "no .entry on /menu");
      if (await entry.count()) {
        await entry.click();
        const opened = await page.waitForSelector('.sheet2[role="dialog"]', { timeout: 5000 }).then(() => true, () => false);
        await page.waitForTimeout(400); await page.evaluate(SETTLE);
        ok(`${phone.name} a drink's sheet: it opens`, opened);
        const under = await page.evaluate(underTheBars, { top: phone.top, bottom: phone.bottom });
        ok(`${phone.name} a drink's sheet: nothing under the system's bars`, under.length === 0, findings(under));
        if (SHOTS) await page.screenshot({ path: shotPath(phone, "menu_a-drink") });
        ok(`${phone.name} a drink's sheet: no errors`, errors.length === 0, errors.join(" | "));
      }
      await ctx.close();
    }
    // The owner, in the crew's Day look on two phones and the dark look on the third.
    {
      const theme = i === 1 ? "dark" : null;
      const ctx = await phoneContext(phone, { owner: true, theme });
      const page = await ctx.newPage();
      await insetsOn(page, phone.top, phone.bottom);
      const errors = watch(page);
      for (const section of sections) {
        errors.length = 0;
        try { await page.goto(`${BASE}/crew?s=${section}`, { waitUntil: "load", timeout: 30000 }); }
        catch (e) { ok(`${phone.name} crew ${section}: loads`, false, e.message.split("\n")[0]); continue; }
        const r = await measure(page, phone, errors, `crew-${section}${theme ? `-${theme}` : ""}`);
        const walled = /Sign in|Staff only|Crew only|Owners only|isn't configured/i.test(r.text);
        ok(`${phone.name} crew ${section}: signed in, not the wall`, !walled, r.text.slice(0, 90).replace(/\s+/g, " "));
        judge(`${phone.name} crew ${section}`, phone, r);
      }
      await ctx.close();
    }
    // The first-run guide, as a new crew member meets it.
    {
      const ctx = await phoneContext(phone, { owner: true, guide: true });
      const page = await ctx.newPage();
      await insetsOn(page, phone.top, phone.bottom);
      const errors = watch(page);
      await page.goto(`${BASE}/crew?s=day`, { waitUntil: "load" });
      const opened = await page.waitForSelector('.sheet2[role="dialog"]', { timeout: 8000 }).then(() => true, () => false);
      await page.waitForTimeout(400); await page.evaluate(SETTLE);
      ok(`${phone.name} the crew's first-run guide: it opens`, opened);
      const under = await page.evaluate(underTheBars, { top: phone.top, bottom: phone.bottom });
      ok(`${phone.name} the crew's first-run guide: nothing under the system's bars`, under.length === 0, findings(under));
      if (SHOTS) await page.screenshot({ path: shotPath(phone, "crew-first-run-guide") });
      ok(`${phone.name} the crew's first-run guide: no errors`, errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
  }));

  // ── 1b · THE APP ON AN IPAD (2026-10-11) ──
  // The app installs on an iPad now (scripts/ios.configure.mjs, 4). The crew's screens are opened on one both ways up —
  // every section as the owner (the Day look upright, the dark look on its side) and the first-run guide — and judged
  // as every iPhone's are: the iPad's insets reached the page, nothing sideways, nothing under the status bar or the
  // home indicator as it opens or scrolled, the status bar legible over what is under it, no error. Then the shell, on
  // Money (laid out in columns): the iPad's glass is the frame (components/NativeBridge.css), so the app fills it edge
  // to edge with no corners and no painted bezel — upright, one column over a tab bar along its foot; on its side, the
  // desk, its tab bar a sidebar the screen's full height. After the phones, two at a time, so their timings are theirs.
  await Promise.all(TABLETS.map(async (pad) => {
    const upright = pad.height > pad.width;
    {
      const theme = upright ? null : "dark";
      const ctx = await phoneContext(pad, { owner: true, theme });
      const page = await ctx.newPage();
      await insetsOn(page, pad.top, pad.bottom);
      const errors = watch(page);
      for (const section of sections) {
        errors.length = 0;
        try { await page.goto(`${BASE}/crew?s=${section}`, { waitUntil: "load", timeout: 30000 }); }
        catch (e) { ok(`${pad.name} crew ${section}: loads`, false, e.message.split("\n")[0]); continue; }
        const r = await measure(page, pad, errors, `crew-${section}${theme ? `-${theme}` : ""}`);
        const walled = /Sign in|Staff only|Crew only|Owners only|isn't configured/i.test(r.text);
        ok(`${pad.name} crew ${section}: signed in, not the wall`, !walled, r.text.slice(0, 90).replace(/\s+/g, " "));
        judge(`${pad.name} crew ${section}`, pad, r);
      }
      errors.length = 0;
      await page.goto(`${BASE}/crew?s=money`, { waitUntil: "load" });
      await page.waitForFunction(BRIDGE_UP, null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600); await page.evaluate(SETTLE);
      const s = await page.evaluate(shellReport);
      const seen = JSON.stringify(s);
      if (SHOTS) await page.screenshot({ path: shotPath(pad, "crew-money--shell") });
      ok(`${pad.name}: the app fills the glass — edge to edge, no corners, no painted bezel, no black room round it`,
        !!s.app && s.app.x === 0 && s.app.y === 0 && s.app.w === s.view.w && s.app.h === s.view.h && s.radius === 0 && s.bezel === false && s.pad === 0, seen);
      if (upright) {
        ok(`${pad.name}: held upright the console is one column over a tab bar along the foot, the screen's full width`,
          !!s.nav && s.nav.x === 0 && s.nav.w === s.view.w && Math.abs(s.nav.y + s.nav.h - s.view.h) <= 1 && s.orient === "horizontal"
            && s.cols.length === 2 && s.cols.every((d) => d === "contents"), seen);
      } else {
        ok(`${pad.name}: on its side the console is the desk — the tab bar a sidebar at the left edge, 236 wide and the screen's full height, the sections in two columns`,
          !!s.nav && s.nav.x === 0 && s.nav.y === 0 && s.nav.w === 236 && s.nav.h === s.view.h && s.orient === "vertical"
            && s.cols.length === 2 && s.cols.every((d) => d === "block"), seen);
      }
      ok(`${pad.name}: the shell, no errors`, errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
    // The first-run guide, on the iPad: a sheet stands as a card in the middle of a screen this size.
    {
      const ctx = await phoneContext(pad, { owner: true, guide: true });
      const page = await ctx.newPage();
      await insetsOn(page, pad.top, pad.bottom);
      const errors = watch(page);
      await page.goto(`${BASE}/crew?s=day`, { waitUntil: "load" });
      const opened = await page.waitForSelector('.sheet2[role="dialog"]', { timeout: 8000 }).then(() => true, () => false);
      await page.waitForTimeout(400); await page.evaluate(SETTLE);
      ok(`${pad.name} the crew's first-run guide: it opens`, opened);
      const under = await page.evaluate(underTheBars, { top: pad.top, bottom: pad.bottom });
      ok(`${pad.name} the crew's first-run guide: nothing under the system's bars`, under.length === 0, findings(under));
      if (SHOTS) await page.screenshot({ path: shotPath(pad, "crew-first-run-guide") });
      ok(`${pad.name} the crew's first-run guide: no errors`, errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
  }));

  // ── 2–5 · the app's behaviour, on the 6.3" phone ──
  {
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const settle = async () => { await page.waitForTimeout(400); await page.evaluate(SETTLE); await page.waitForFunction(BRIDGE_UP, null, { timeout: 8000 }).catch(() => {}); };

    // 2 · a reload stays put — on the deepest screens a person reloads
    for (const path of ["/crew", "/menu", "/primal/lesson"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "load" }); await settle();
      const before = await page.evaluate(() => ({ path: location.pathname, text: document.querySelector("main")?.innerText.slice(0, 160) ?? "" }));
      await page.reload({ waitUntil: "load" }); await settle();
      const after = await page.evaluate(() => ({ path: location.pathname, text: document.querySelector("main")?.innerText.slice(0, 160) ?? "" }));
      const served = srv.log.filter((l) => l.path === path).map((l) => l.file);
      ok(`reload ${path}: the router serves the page the export made`, served.length >= 2 && served.every((f) => f !== "/index.html"), `served ${served.join(", ")}`);
      ok(`reload ${path}: the same screen comes back`, after.path === path && after.text === before.text, `${before.path} → ${after.path}`);
    }

    // 2b · moving between screens reads the export's own data files — none may be missing
    await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();
    const before = srv.log.filter((l) => l.file.endsWith(".html")).length;
    let moved = 0;
    for (const href of ["/truck", "/shop"]) {
      const link = page.locator(`nav a[href="${href}"]`).first();
      if (!(await link.count())) continue;
      await link.click(); await page.waitForURL(`**${href}`, { timeout: 8000 }).catch(() => {}); await settle();
      if (new URL(page.url()).pathname === href) moved++;
    }
    const docLoads = srv.log.filter((l) => l.file.endsWith(".html")).length - before;
    const missing = srv.log.filter((l) => l.status === 404 && !l.path.startsWith("/api/") && !/favicon/.test(l.path));
    ok("screen to screen: the tab bar moves between screens", moved === 2, `moved to ${moved} of 2`);
    ok("screen to screen: without reloading the app", docLoads === 0, `${docLoads} whole-page loads — a screen's data file was missing, so Next fell back to loading the page`);
    ok("screen to screen: every file asked for is in the export", missing.length === 0, missing.map((l) => l.path).slice(0, 6).join(", "));

    // 3 · the API is the web's
    ok("the API: nothing asks the phone's own address", strayApi.length === 0, strayApi.slice(0, 4).join(", "));

    // 4 · the native side
    await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();
    const calls = await nativeCalls(page);
    const has = (plugin, method, pred = () => true) => calls.some((c) => c.plugin === plugin && c.method === method && pred(c.options));
    ok("native: the launch screen fades out", has("SplashScreen", "hide", (o) => o.fadeOutDuration === 200));
    ok("native: the status bar is styled", has("SystemBars", "setStyle", (o) => o.style === "LIGHT" || o.style === "DARK"), JSON.stringify(calls.filter((c) => c.plugin === "SystemBars")));
    ok("native: the app listens for coming back from the background", has("App", "addListener", (o) => o.eventName === "appStateChange"));
    ok("native: the app listens for a GT3 link opening it", has("App", "addListener", (o) => o.eventName === "appUrlOpen"));
    ok("native: the keyboard's ‹ › Done bar is turned on (the keyboard plugin hides it)", has("Keyboard", "setAccessoryBarVisible", (o) => o.isVisible === true), JSON.stringify(calls.filter((c) => c.plugin === "Keyboard")));

    const opened = async (fn) => {
      const n = (await nativeCalls(page)).length;
      await fn();
      await page.waitForTimeout(300);
      return (await nativeCalls(page)).slice(n).filter((c) => c.plugin === "Browser" && c.method === "open").map((c) => c.options.url);
    };
    const here = page.url();
    const viaLink = await opened(() => page.evaluate(() => {
      const a = Object.assign(document.createElement("a"), { href: "https://example.com/from-a-link", textContent: "out" });
      document.querySelector("main").appendChild(a); a.click(); a.remove();
    }));
    ok("native: a link out opens the in-app browser", viaLink.length === 1 && viaLink[0] === "https://example.com/from-a-link" && page.url() === here, `Browser.open ${JSON.stringify(viaLink)}; page now ${page.url()}`);
    const viaOpen = await opened(() => page.evaluate(() => { window.open("https://example.com/from-window-open", "_blank"); }));
    ok("native: window.open to the web opens the in-app browser", viaOpen.length === 1 && viaOpen[0] === "https://example.com/from-window-open", JSON.stringify(viaOpen));
    const viaTel = await opened(() => page.evaluate(() => {
      const a = Object.assign(document.createElement("a"), { href: "tel:+18645550142", textContent: "call" });
      a.addEventListener("click", (e) => e.preventDefault());   // Chromium has no phone to hand it to
      document.querySelector("main").appendChild(a); a.click(); a.remove();
    }));
    ok("native: a phone number is left to the phone", viaTel.length === 0, JSON.stringify(viaTel));
    const viaInside = await opened(() => page.evaluate(() => {
      const a = Object.assign(document.createElement("a"), { href: "/truck", textContent: "in" });
      a.addEventListener("click", (e) => e.preventDefault());
      document.querySelector("main").appendChild(a); a.click(); a.remove();
    }));
    ok("native: a link inside the app stays in the app", viaInside.length === 0, JSON.stringify(viaInside));
    const viaWebOnly = await opened(() => page.evaluate(() => {
      const a = Object.assign(document.createElement("a"), { href: "/built/gt3-built-k7m9x4q2?from=app", textContent: "partner" });
      document.querySelector("main").appendChild(a); a.click(); a.remove();
    }));
    ok("native: a page only the web serves opens from the web, in the in-app browser", viaWebOnly.length === 1 && viaWebOnly[0] === `${API_ORIGIN}/built/gt3-built-k7m9x4q2?from=app` && page.url() === here, `Browser.open ${JSON.stringify(viaWebOnly)}; page now ${page.url()}`);

    // a GT3 link that opens the app (a universal link, once its domain file is live) lands where it should
    const openedBy = async (url) => {
      const n = (await nativeCalls(page)).length;
      await page.evaluate((u) => {
        for (const id of window.__native.listeners["App.appUrlOpen"] ?? []) window.Capacitor.fromNative({ callbackId: id, pluginId: "App", methodName: "addListener", success: true, save: true, data: { url: u } });
      }, url);
      await page.waitForTimeout(1500);
      const at = new URL(page.url());
      return { at: `${at.pathname}${at.search}`, browser: (await nativeCalls(page)).slice(n).filter((c) => c.plugin === "Browser" && c.method === "open").map((c) => c.options.url) };
    };
    await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();
    const toTruck = await openedBy(`${API_ORIGIN}/truck`);
    ok("a GT3 link: a screen the app has opens in the app", toTruck.at === "/truck" && toTruck.browser.length === 0, JSON.stringify(toTruck));
    const toLesson = await openedBy(`${API_ORIGIN}/primal/l/hydration-basics`);
    ok("a GT3 link: a lesson opens on the app's own lesson page", toLesson.at === "/primal/lesson?slug=hydration-basics", JSON.stringify(toLesson));
    const toPartner = await openedBy(`${API_ORIGIN}/built/gt3-built-k7m9x4q2`);
    ok("a GT3 link: a page only the web serves opens from the web, in the in-app browser", toPartner.browser.length === 1 && toPartner.browser[0] === `${API_ORIGIN}/built/gt3-built-k7m9x4q2` && toPartner.at === toLesson.at, JSON.stringify(toPartner));
    // The review (2026-10-11): the links alerts and their emails carry (/admin…) landed on the home screen; a page's own
    // ?code= was read as a sign-in and opened nothing; a password reset signed in and skipped the reset.
    const toConsole = await openedBy(`${API_ORIGIN}/admin?s=money`);
    ok("a GT3 link: the console's old address opens its new one, as a tapped alert's does", toConsole.at === "/crew?s=money", JSON.stringify(toConsole));
    await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();
    const toReserve = await openedBy(`${API_ORIGIN}/reserve?code=GT3PB-3MP`);
    ok("a GT3 link: a page's own ?code= opens the page — it is not a sign-in", toReserve.at === "/reserve?code=GT3PB-3MP" && toReserve.browser.length === 0, JSON.stringify(toReserve));
    // The page is opened again at the front door with the link's tokens in its address — the auth client reads them
    // there and raises its reset screen. (These tokens are made up, so the stand-in signs nobody in, and a signed-out
    // app's front door moves on to the menu: what is checked is the page the link opened.)
    await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();
    const navs = [];
    const onNav = (f) => { if (f === page.mainFrame()) navs.push(f.url()); };
    page.on("framenavigated", onNav);
    await openedBy(`${API_ORIGIN}/#access_token=smoke-not-a-token&refresh_token=smoke-not-either&type=recovery`).catch(() => null);
    await page.waitForLoadState("load").catch(() => {});
    page.off("framenavigated", onNav);
    const reset = navs.map((u) => new URL(u)).find((u) => u.pathname === "/" && /type=recovery/.test(u.hash));
    ok("a GT3 link: a password reset opens the app's front door with its tokens in the address — the auth client's reset screen, not a plain sign-in",
      !!reset, JSON.stringify(navs));
    await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();

    // the status bar follows a move between screens: charcoal Find Us, then the cream menu, and back
    await page.goto(`${BASE}/truck`, { waitUntil: "load" }); await settle(); await page.waitForTimeout(450);
    const lastStyle = async () => (await nativeCalls(page)).filter((c) => c.plugin === "SystemBars" && c.method === "setStyle").at(-1)?.options.style ?? null;
    const onTruck = await lastStyle();
    await page.locator('nav a[href="/menu"]').first().click(); await page.waitForURL("**/menu"); await settle(); await page.waitForTimeout(450);
    const onMenu = await lastStyle();
    await page.locator('nav a[href="/truck"]').first().click(); await page.waitForURL("**/truck"); await settle(); await page.waitForTimeout(450);
    const backOnTruck = await lastStyle();
    ok("native: the status bar follows the screen under it", onTruck === "DARK" && onMenu === "LIGHT" && backOnTruck === "DARK", `Find Us ${onTruck}, Menu ${onMenu}, Find Us again ${backOnTruck}`);

    // a tab tap is felt
    await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();
    const n0 = (await nativeCalls(page)).length;
    const otherTab = page.locator('nav a[href="/truck"]').first();
    if (await otherTab.count()) { await otherTab.click(); await page.waitForTimeout(400); }
    const buzz = (await nativeCalls(page)).slice(n0).filter((c) => c.plugin === "Haptics").map((c) => c.method);
    ok("native: a tab tap is felt", buzz.join(",") === "selectionStart,selectionChanged,selectionEnd", `Haptics calls: ${buzz.join(",") || "none"}`);

    // a tap on the status bar goes to the top
    await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();
    const scrolledTo = await page.evaluate(() => { const b = document.getElementById("body"); b.scrollTop = 600; return b.scrollTop; });
    await page.evaluate(() => window.Capacitor.triggerEvent("statusTap", "window"));
    await page.waitForTimeout(900);
    const topNow = await page.evaluate(() => document.getElementById("body").scrollTop);
    ok("native: a tap on the status bar goes to the top", scrolledTo > 0 && topNow === 0, `scrolled to ${scrolledTo}, after the tap ${topNow}`);

    // offline: the banner says so below the status bar, on its own ground under it
    await ctx.setOffline(true);
    const offline = await page.waitForSelector(".offline-bar", { timeout: 5000 }).then(() => true, () => false);
    await page.waitForTimeout(300);
    const offlineUnder = await page.evaluate(underTheBars, { top: MAIN.top, bottom: MAIN.bottom });
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "menu--offline") });
    await ctx.setOffline(false);
    ok("offline: the banner shows", offline);
    ok("offline: the banner's words are below the status bar", offlineUnder.length === 0, findings(offlineUnder));

    // 5 · the keyboard: a field low on a long form, as a person finds it
    await page.goto(`${BASE}/book`, { waitUntil: "load" }); await settle();
    const field = page.locator("main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main textarea").last();
    if (!(await field.count())) ok("keyboard: /book has a field to type in", false, "no input on /book — pick another long form for this check");
    else {
      await field.evaluate((el) => el.scrollIntoView({ block: "end" }));
      await field.focus();
      const kb = MAIN.keyboard;
      // The Keyboard plugin's order (Keyboard.m): will-show, did-show, then the web view shrinks.
      await page.evaluate((h) => window.Capacitor.triggerEvent("keyboardWillShow", "window", { keyboardHeight: h }), kb);
      await page.evaluate((h) => window.Capacitor.triggerEvent("keyboardDidShow", "window", { keyboardHeight: h }), kb);
      const cdp = await insetsOn(page, MAIN.top, 0);   // a web view that ends at the keyboard is clear of the home indicator
      await page.setViewportSize({ width: MAIN.width, height: MAIN.height - kb });
      await page.waitForTimeout(500);
      const up = await page.evaluate(() => {
        const el = document.activeElement, r = el.getBoundingClientRect();
        const nav = document.querySelector(".nav");
        return { kb: document.documentElement.dataset.kb ?? null, top: r.top, bottom: r.bottom, h: window.innerHeight, focused: el.tagName, nav: nav ? getComputedStyle(nav).display : "absent" };
      });
      if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "book--keyboard") });
      ok("keyboard: the app knows it is up", up.kb === "up", `html[data-kb] is ${up.kb}`);
      ok("keyboard: the tab bar steps aside", up.nav === "none" || up.nav === "absent", `.nav display is ${up.nav}`);
      ok("keyboard: the field being typed in stays in sight", /INPUT|TEXTAREA/.test(up.focused) && up.top >= MAIN.top && up.bottom <= up.h, `${up.focused} at ${Math.round(up.top)}–${Math.round(up.bottom)} in a ${up.h}px view`);
      await page.evaluate(() => window.Capacitor.triggerEvent("keyboardWillHide", "window"));
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: MAIN.top, topMax: MAIN.top, bottom: MAIN.bottom, bottomMax: MAIN.bottom, left: 0, leftMax: 0, right: 0, rightMax: 0 } });
      await page.setViewportSize({ width: MAIN.width, height: MAIN.height });
      await page.evaluate(() => window.Capacitor.triggerEvent("keyboardDidHide", "window"));
      await page.waitForTimeout(300);
      const down = await page.evaluate(() => ({ kb: document.documentElement.dataset.kb ?? null, nav: getComputedStyle(document.querySelector(".nav") ?? document.body).display }));
      ok("keyboard: when it goes, the tab bar comes back", down.kb === null && down.nav !== "none", JSON.stringify(down));
    }

    ok("behaviour: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── 5b · THE BARS AND WHAT FLOATS NEAR THEM (2026-10-08, the foundations round) ──
  // Four things that were wrong on every Face ID iPhone and that the pass above could not see, because none
  // of them is on a screen at rest: a broadcast banner sat under the status bar (its words and its ✕ in the
  // clock's band), a toast landed on the tab bar, the pull-to-refresh ring turned under the status bar, and a
  // stray .tl margin made the tab bar 122pt tall (UIKit's is 83 with the home indicator).
  {
    const bcast = { id: "5a10e000-0000-4000-8000-0000000000bc", title: "Truck at Main St till 2", body: "Order ahead and skip the line.", kind: "announcement", style: "info", audience: "all", cta_label: null, cta_href: null, active: true, starts_at: null, ends_at: null, created_at: "2026-10-08T00:00:00Z" };
    const ctx = await phoneContext(MAIN, { seed: { broadcasts: [bcast] } });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/menu`, { waitUntil: "load" });
    const shown = await page.waitForSelector(".bcast .bcast-x", { timeout: 8000 }).then(() => true, () => false);
    await page.waitForTimeout(400); await page.evaluate(SETTLE);
    const m = await page.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height }; };
      const screen = document.querySelector(".screen");
      return { words: r(".bcast .bcast-x"), close: r(".bcast .bcast-close"), screenPad: screen ? parseFloat(getComputedStyle(screen).paddingTop) : null, nav: r(".nav") };
    });
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "menu--broadcast") });
    ok("bars: a broadcast banner's words and its ✕ sit below the status bar", shown && m.words && m.close && m.words.top >= MAIN.top && m.close.top >= MAIN.top - 2, JSON.stringify(m));
    ok("bars: the screen under the banner does not pad for the status bar a second time", m.screenPad !== null && m.screenPad < MAIN.top, `padding-top ${m.screenPad}`);
    // UIKit's height (2026-10-08, the iPhone chrome round, approved): 49pt of tabs on the 34pt home indicator.
    // It was 122 when a stray .tl margin pushed the labels down, then 108 (the foundations round).
    ok("bars: the tab bar is an iPhone's — at most 83pt with the home indicator (49 + 34; it was 122, then 108)", !!m.nav && m.nav.height <= 84, `tab bar ${m.nav && Math.round(m.nav.height)}pt`);
    const t = await page.evaluate(() => {
      const toast = document.querySelector(".toast"); const nav = document.querySelector(".nav");
      if (!toast || !nav) return null;
      toast.classList.add("show"); toast.style.transition = "none";
      const tb = toast.getBoundingClientRect(), nb = nav.getBoundingClientRect();
      return { toastBottom: tb.bottom, navTop: nb.top };
    });
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "menu--toast") });
    ok("bars: a toast sits above the tab bar, clear of it", !!t && t.toastBottom <= t.navTop - 4, JSON.stringify(t));
    ok("bars: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  {
    const ctx = await phoneContext(MAIN, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    await page.goto(`${BASE}/crew?s=day`, { waitUntil: "load" });
    await page.waitForSelector(".nav.opnav, .opnav", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400); await page.evaluate(SETTLE);
    // The ring joins the page on the first pull (components/PullToRefresh), so its rule is read from a probe.
    const p = await page.evaluate(() => {
      const body = document.getElementById("body"); const nav = document.querySelector(".nav");
      const probe = document.createElement("div"); probe.className = "ptr"; body?.appendChild(probe);
      const top = body ? parseFloat(getComputedStyle(probe).top) : null; probe.remove();
      return { ptrTop: top, nav: nav ? nav.getBoundingClientRect().height : null };
    });
    ok("bars: the pull-to-refresh ring turns below the status bar", p.ptrTop !== null && p.ptrTop >= MAIN.top, `top ${p.ptrTop}`);
    ok("bars: the crew's tab bar is an iPhone's — at most 83pt with the home indicator (it was 122, then 108)", p.nav !== null && p.nav <= 84, `tab bar ${p.nav && Math.round(p.nav)}pt`);
    await ctx.close();
  }

  // ── 5c · THE IPHONE CHROME (2026-10-08, the iPhone chrome round — Ryan approved proposals 1, 4 and 9) ──
  // The app opens a guest on the menu with no front-door ad; nothing floats over the content of a phone's
  // screen (the rail and the quick-actions button have homes in the header and the menus); the crew's bar
  // holds an iPhone's 5 tabs; and a tab opens where it was left.
  {
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const shown = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].some((el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0; }), sel);
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.waitForURL("**/menu", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900); await page.evaluate(SETTLE);
    ok("chrome: a guest opening the app lands on the menu", new URL(page.url()).pathname === "/menu", page.url());
    ok("chrome: …with no front-door ad over it", !(await shown(".spl-skip")));
    ok("chrome: no floating rail and no floating button over a guest's screen", !(await shown(".rail")) && !(await shown(".conc-fab")) && !(await shown(".qd-fab")));
    const ask = page.locator('button[aria-label^="Ask us"]').first();
    const askBox = await ask.boundingBox().catch(() => null);
    ok("chrome: Ask us sits beside the account avatar, below the status bar", !!askBox && askBox.y >= MAIN.top && askBox.width >= 40, JSON.stringify(askBox));
    if (askBox) {
      await ask.click(); await page.waitForTimeout(500);
      ok("chrome: Ask us opens the concierge", !!(await page.$("#concierge-title")));
      await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    }
    // a tab opens where it was left: the menu scrolled, Shop, then Menu again
    const scrolled = await page.evaluate(() => { const b = document.getElementById("body"); b.scrollTop = 600; return b.scrollTop; });
    await page.waitForTimeout(250);
    await page.locator('nav a[href="/shop"]').first().click(); await page.waitForURL("**/shop", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    const onShop = await page.evaluate(() => document.getElementById("body").scrollTop);
    await page.locator('nav a[href="/menu"]').first().click(); await page.waitForURL("**/menu", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1300);
    const back = await page.evaluate(() => document.getElementById("body").scrollTop);
    ok("chrome: a new tab opens at its top", onShop === 0, `Shop opened at ${onShop}`);
    ok("chrome: a tab opens where it was left", scrolled > 300 && Math.abs(back - scrolled) <= 4, `menu left at ${scrolled}, came back at ${back}`);
    ok("chrome: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  {
    const ctx = await phoneContext(MAIN, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/crew?s=day`, { waitUntil: "load" });
    await page.waitForSelector(".opnav", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500); await page.evaluate(SETTLE);
    const tabs = await page.$$eval('.opnav .tab', (els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
    ok("chrome: the crew's bar holds an iPhone's five tabs at most — Today, three lanes and More", tabs >= 2 && tabs <= 5, `${tabs} tabs`);
    // THE ARROWS LOOK, ENTER OPENS (R12 — the 10/10 audit, F7): one stop in the Tab order, the lit lane; an arrow moves
    // focus and opens nothing; More is a button that opens a sheet, outside the tab list.
    const lanes = await page.evaluate(() => {
      const list = document.querySelector('.opnav [role="tablist"]');
      const tabsIn = [...(list?.querySelectorAll('[role="tab"]') ?? [])];
      const more = [...document.querySelectorAll(".opnav .tab")].find((b) => b.textContent.trim() === "More");
      return { stops: tabsIn.filter((t) => t.tabIndex === 0).length, lit: tabsIn.findIndex((t) => t.getAttribute("aria-selected") === "true"),
        zeroAt: tabsIn.findIndex((t) => t.tabIndex === 0), n: tabsIn.length,
        moreOk: !!more && !list?.contains(more) && more.getAttribute("aria-haspopup") === "dialog" && !more.hasAttribute("role") };
    });
    ok("a11y: the crew's lanes are one Tab stop — the lit lane — and More is a button that opens a sheet, outside the tab list",
      lanes.n >= 1 && lanes.stops === 1 && lanes.zeroAt === Math.max(0, lanes.lit) && lanes.moreOk, JSON.stringify(lanes));
    if (lanes.n > 1) {
      const before = await page.url();
      await page.focus('.opnav [role="tab"][tabindex="0"]');
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(250);
      const moved = await page.evaluate(() => ({ focusedTab: document.activeElement?.getAttribute("role") === "tab", selected: document.activeElement?.getAttribute("aria-selected") }));
      ok("a11y: an arrow in the crew's lanes moves focus and opens nothing — Enter does", moved.focusedTab && moved.selected === "false" && page.url() === before, JSON.stringify(moved));
    }
    const fab = await page.evaluate(() => [...document.querySelectorAll(".qd-fab, .rail")].some((el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0));
    ok("chrome: no floating quick-actions button or rail over the crew's screen", !fab);
    const spark = page.locator('.toprow-actions button[aria-label^="Quick actions"]').first();
    const sparkBox = await spark.boundingBox().catch(() => null);
    ok("chrome: the crew header carries quick actions (✦), below the status bar", !!sparkBox && sparkBox.y >= MAIN.top, JSON.stringify(sparkBox));
    if (sparkBox) {
      await spark.click(); await page.waitForTimeout(600);
      const sheet = await page.$('.sheet2[role="dialog"]');
      ok("chrome: ✦ in the header opens quick actions", !!sheet && /Do|Ask|Note/.test(await sheet.innerText()));
    }
    ok("chrome: no errors on the crew's screen", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── 5d · THE TITLE BAR AND BACK (2026-10-08, the navigation round — Ryan approved proposals 2 and 3) ──
  // A crew section scrolled past its heading keeps its name in a 44pt bar right under the status bar; a screen
  // reached from the menu carries "‹ Menu" at the top left; a swipe from the left edge goes back on a customer's
  // screen in the app (in a browser tab the browser's own swipe does); and in the app a sheet adds nothing to the
  // history — there is no Back button there to answer it.
  {
    const ctx = await phoneContext(MAIN, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/crew?s=money`, { waitUntil: "load" });
    await page.waitForSelector(".op-head-t", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600); await page.evaluate(SETTLE);
    const bar = () => page.evaluate(() => {
      const t = document.querySelector("[data-tbar]"); if (!t) return null;
      const title = t.querySelector('button[aria-label$="back to the top"]'); const r = title?.getBoundingClientRect();
      return { compact: t.hasAttribute("data-compact"), top: r ? Math.round(r.top) : null, h: r ? Math.round(r.height) : null, title: title?.textContent ?? null, seen: title ? getComputedStyle(title).visibility : null };
    });
    const b0 = await bar();
    ok("title bar: at the top of a crew section there is none — its own heading names it", !!b0 && !b0.compact && b0.seen === "hidden", JSON.stringify(b0));
    const room = await page.evaluate(() => { const b = document.getElementById("body"); b.scrollTop = 520; return b.scrollTop; });
    await page.waitForTimeout(700);
    const b1 = await bar();
    ok("title bar: scrolled past its heading, the section keeps its name in a 44pt bar right under the status bar",
      room > 200 && !!b1 && b1.compact && b1.title === "Money" && b1.h === 44 && b1.top === MAIN.top && b1.seen === "visible", JSON.stringify({ room, b1 }));
    const len0 = await page.evaluate(() => history.length);
    await page.locator('.toprow-actions button[aria-label^="Inbox"]').first().click().catch(() => {});
    await page.waitForTimeout(600);
    const opened = !!(await page.$(".sheet2-scrim"));
    const len1 = await page.evaluate(() => history.length);
    ok("back: in the app a sheet adds nothing to the history", opened && len1 === len0, `sheet ${opened}, history ${len0} → ${len1}`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    ok("title bar: no errors on the crew's screen", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  {
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/menu`, { waitUntil: "load" });
    await page.waitForTimeout(700); await page.evaluate(SETTLE);
    await page.locator('.k-legal a[href="/privacy"]').first().click();
    await page.waitForURL("**/privacy", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const back = await page.locator('[data-tbar] button[aria-label="Back to Menu"]').first().boundingBox().catch(() => null);
    ok("back: a screen reached from the menu carries ‹ Menu at the top left, below the status bar", !!back && back.x <= 12 && back.y >= MAIN.top && back.height >= 44, JSON.stringify(back));
    const cdp = await ctx.newCDPSession(page);
    const pt = (x, y) => [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(6, 420) });
    for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(6 + i * 22, 422) }); await page.waitForTimeout(18); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForURL("**/menu", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    ok("back: a swipe from the left edge goes back to the menu, in the app", new URL(page.url()).pathname === "/menu", page.url());
    ok("back: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── 5e · SHEETS LIKE IOS, AND A ROW'S MENU (2026-10-08, the navigation round — Ryan approved proposal 3) ──
  // A long form opens half-height and rises to full once it is used; the page behind a tall sheet steps back,
  // smaller, and comes home when it closes. A flag in the Inbox answers a long press with its actions by name:
  // a finger that drifts does not raise them, the lift does not also tap the flag, the phone ticks, Escape puts
  // the menu away with the Inbox still open, a right-click raises it too, and its Got it clears the flag.
  {
    // On the smallest iPhone (2026-10-14, R6). The crew's profile — photo, name, title, bio — was the long form here while
    // the alerts sat at its foot; they are Notifications' now, and on a 6.3" phone the profile is three-fifths of the
    // screen, opened at its own height as it should be. On the SE it is four-fifths: a long form, where a half-height
    // sheet matters most.
    const SE = PHONES[0];
    const ctx = await phoneContext(SE, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, SE.top, SE.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/book`, { waitUntil: "load" });
    await page.waitForTimeout(900); await page.evaluate(SETTLE);
    const stage = () => page.evaluate(() => {
      const p = [...document.querySelectorAll(".sheet2")].pop(), main = document.getElementById("body"), t = main ? getComputedStyle(main).transform : "none";
      return { detent: p?.dataset.detent ?? null, h: p ? p.offsetHeight : 0, vh: innerHeight, receded: !!document.querySelector(".app")?.classList.contains("receded"), scale: t === "none" ? 1 : new DOMMatrixReadOnly(t).a };
    });
    await page.locator('button.acct-av[aria-label="Your account"]').first().click().catch(() => {});
    await page.waitForTimeout(800);
    // The profile is under Settings & privacy (2026-10-12, A2 of the account audit): the menu's row, then its own.
    await page.locator(".acs-row", { hasText: "Settings & privacy" }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    await page.locator(".acs-row", { hasText: /^Profile/ }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    const h0 = await stage();
    ok("sheets: a long form (the crew's profile, on an iPhone SE) opens half-height on a phone — the page still in sight above it, not stepped back",
      h0.detent === "half" && h0.h > 0 && h0.h <= Math.ceil(h0.vh * 0.53) && !h0.receded && h0.scale === 1, JSON.stringify(h0));
    await page.evaluate(() => { [...document.querySelectorAll(".sheet2-body")].pop().scrollTop = 60; });
    await page.waitForTimeout(900);
    const h1 = await stage();
    ok("sheets: used (scrolled), it rises to full, and the page behind it steps back, smaller, as behind an iPhone's sheet",
      h1.detent === "full" && h1.h > h0.h && h1.receded && h1.scale > 0.9 && h1.scale < 0.95, JSON.stringify(h1));
    await page.keyboard.press("Escape"); await page.waitForTimeout(900);
    const h2 = await stage();
    ok("sheets: closed, the page comes home", !h2.receded && h2.scale === 1, JSON.stringify(h2));
    ok("sheets: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  {
    const flag = { id: "5a10e000-0000-4000-8000-0000000000f1", severity: "important", title: "Ice is low at the truck", body: "Two bags left before the 3 o'clock run", category: "ops", link: null, target_user_id: OWNER_ID, created_by: null, kind: null, subject_id: null, created_at: new Date(Date.now() - 600_000).toISOString(), occurrences: 1, last_seen_at: null };
    const ctx = await phoneContext(MAIN, { owner: true, seed: { alerts: [flag] } });
    const page = await ctx.newPage();
    const cdp = await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/crew?s=money`, { waitUntil: "load" });
    await page.waitForSelector(".op-head-t", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600); await page.evaluate(SETTLE);
    await page.locator('.toprow-actions button[aria-label^="Inbox"]').first().click().catch(() => {});
    await page.waitForTimeout(800);
    const row = page.locator(".sheet2 .alert-row.pressable", { hasText: "Ice is low" }).first();
    const box = await row.boundingBox().catch(() => null);
    const pt = (x, y) => [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }];
    const hold = async (ms, drift = 0) => {
      const x = box.x + 60, y = box.y + box.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x, y) });
      for (let i = 1; i <= 6; i++) { await page.waitForTimeout(ms / 6); if (drift) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x, y + (i * drift) / 6) }); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(700);
    };
    const now = () => page.evaluate(() => ({
      menu: [...document.querySelectorAll("[data-row-menu] .acs-row")].map((b) => b.textContent.trim()),
      sheets: document.querySelectorAll(".sheet2").length, at: location.pathname + location.search,
      flag: !!document.querySelector(".sheet2 .alert-row"),
    }));
    if (!box) ok("long press: the seeded flag is in the Inbox", false, "no .alert-row in the Inbox sheet");
    else {
      await hold(700, 30);
      const d = await now();
      ok("long press: a finger that drifts while it rests (a scroll beginning) raises nothing", d.menu.length === 0 && d.sheets === 1, JSON.stringify(d));
      const n0 = (await nativeCalls(page)).length;
      await hold(700);
      const m = await now();
      const felt = (await nativeCalls(page)).slice(n0).filter((c) => c.plugin === "Haptics").map((c) => `${c.method}:${c.options?.style ?? ""}`);
      ok("long press: held still on a flag, its menu rises over the Inbox — Snooze for an hour, Got it — and the lift taps nothing",
        m.menu.join("|").includes("Snooze for an hour") && m.menu.at(-1) === "Got it" && m.sheets === 2 && m.at === "/crew?s=money", JSON.stringify(m));
      ok("long press: the phone ticks as the menu rises", felt.includes("impact:MEDIUM"), felt.join(",") || "no Haptics call");
      await page.keyboard.press("Escape"); await page.waitForTimeout(700);
      const e = await now();
      ok("long press: Escape puts the menu away, and the Inbox stays", e.menu.length === 0 && e.sheets === 1 && e.flag, JSON.stringify(e));
      await row.click({ button: "right" }).catch(() => {}); await page.waitForTimeout(700);
      const r = await now();
      ok("long press: a right-click raises the same menu", r.menu.at(-1) === "Got it", JSON.stringify(r));
      const w0 = writes.length;
      await page.locator("[data-row-menu] .acs-row", { hasText: "Got it" }).first().click().catch(() => {});
      await page.waitForTimeout(900);
      const g = await now();
      ok("long press: the menu's Got it clears the flag — the menu goes, the flag goes, and the write is sent",
        g.menu.length === 0 && !g.flag && writes.slice(w0).includes("PATCH alerts"), JSON.stringify({ g, wrote: writes.slice(w0) }));
    }
    ok("long press: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  {
    // The Pass (service mode) is a full-screen layer over the console. A sheet opened from it — Collect, the void's
    // question, a ticket's menu — stands above it: before, each opened BEHIND the Pass, where nobody could see it.
    const at = (m) => new Date(Date.now() - m * 60_000).toISOString();
    const order = { id: "5a10e000-0000-4000-8000-0000000000c1", user_id: null, customer: "Jess", customer_id: null, items: ["rise", "rise", "flow"], total_cents: 1800, paid: false, payment_id: null, status: "new", created_at: at(3), status_changed_at: at(3), eta_status: null, eta_at: null, payment_status: null, collected_via: null, collected_at: null, collected_by: null, ready_from: null };
    const ctx = await phoneContext(MAIN, { owner: true, seed: { orders: [order] } });
    const page = await ctx.newPage();
    const cdp = await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/crew?s=now&a=kitchen-pass`, { waitUntil: "load" });
    await page.waitForSelector(".svc-full .adm-order", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700); await page.evaluate(SETTLE);
    const ticket = await page.evaluate(() => {
      const o = document.querySelector(".svc-full .adm-order"); if (!o) return null;
      const name = o.querySelector(".adm-order-top b"), age = o.querySelector(".adm-age")?.getBoundingClientRect(), more = o.querySelector(".adm-act-more")?.getBoundingClientRect();
      const [r, g, b] = getComputedStyle(name).color.match(/\d+/g).map(Number);
      return { day: document.querySelector(".app").classList.contains("crew-day"), light: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, apart: !!age && !!more && (age.right <= more.left || age.bottom <= more.top) };
    });
    ok("the Pass: a ticket's name is legible in the crew's Day look, and its age clears the ••• button",
      !!ticket && ticket.day && ticket.light < 0.35 && ticket.apart, JSON.stringify(ticket));
    const onTop = () => page.evaluate(() => {
      const s = [...document.querySelectorAll(".sheet2")].pop(); if (!s) return { label: null, top: false };
      const r = s.getBoundingClientRect();
      return { label: s.getAttribute("aria-label") || document.getElementById(s.getAttribute("aria-labelledby") || "")?.textContent || null, top: s.contains(document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 120))), rows: [...s.querySelectorAll("[data-row-menu] .acs-row")].map((b) => b.textContent.trim()) };
    });
    const box = await page.locator(".svc-full .adm-order").first().boundingBox().catch(() => null);
    if (box) {
      const pt = (x, y) => [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(box.x + 90, box.y + 50) });
      await page.waitForTimeout(700);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(800);
    }
    const m = await onTop();
    ok("the Pass: a long press on a ticket raises its menu above the Pass — Start, Collect, Void in red last",
      m.top && m.rows.join("|") === "Start|Collect $18|Void order", JSON.stringify(m));
    await page.keyboard.press("Escape"); await page.waitForTimeout(700);
    ok("the Pass: Escape puts the menu away, and the Pass stays", !(await page.$("[data-row-menu]")) && !!(await page.$(".svc-full .adm-order")));
    // ⋯ is the ticket's menu, the one the long press raises (2026-10-11: it went straight to Void); Void in it still asks.
    await page.locator(".svc-full .adm-order .adm-act-more").first().click().catch(() => {});
    await page.waitForTimeout(800);
    const mm = await onTop();
    ok("the Pass: ⋯ raises the same menu above the Pass — Start, Collect, Void in red last",
      mm.top && mm.rows.join("|") === "Start|Collect $18|Void order", JSON.stringify(mm));
    await page.locator("[data-row-menu] .acs-row", { hasText: "Void order" }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    const v = await onTop();
    ok("the Pass: the void's question stands above the Pass, where it can be answered", v.top && /Void Jess/.test(v.label ?? ""), JSON.stringify(v));
    await page.keyboard.press("Escape"); await page.waitForTimeout(700);
    await page.locator(".svc-full .adm-order button.btn-sec", { hasText: /^Collect \$/ }).first().click().catch(() => {});   // the kit's secondary (round 7d: it was .adm-collect)
    await page.waitForTimeout(800);
    const c = await onTop();
    ok("the Pass: Collect's sheet stands above the Pass", c.top && /Collect \$18/.test(c.label ?? ""), JSON.stringify(c));
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    ok("the Pass: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  {
    // THE PASS AT ARM'S LENGTH (2026-10-11, the KDS program, wave 2 — components/pass). On an iPad on its side the lanes stand
    // in three columns, each scrolling on its own, the rail beside them and the type set to be read from a step back; on a
    // phone the stacked list, every control on the board and its bar 44 points to the thumb, the 86 board one tap away in the
    // bar, each lane's heading saying its count; and focus that was on a ticket follows it when it moves. (The rail's own
    // controls are the pickup board's and the 86 board's, measured where they are drawn.)
    const at = (m) => new Date(Date.now() - m * 60_000).toISOString();
    const base = { user_id: null, customer_id: null, total_cents: 1000, paid: true, payment_id: "pay_TEST000001", eta_status: null, eta_at: null, payment_status: "paid", collected_via: null, collected_at: null, collected_by: null, ready_from: null, event_id: null, stop_id: null };
    const ANA = "5a10e000-0000-4000-8000-0000000000d1";
    const orders = [
      { ...base, id: ANA, customer: "Ana", items: ["flow", "flow", "rise"], status: "new", created_at: at(9), status_changed_at: at(9) },
      { ...base, id: "5a10e000-0000-4000-8000-0000000000d2", customer: "Ben", items: ["tide"], status: "preparing", created_at: at(6), status_changed_at: at(2) },
      { ...base, id: "5a10e000-0000-4000-8000-0000000000d3", customer: "Cy", items: ["maple"], status: "ready", created_at: at(5), status_changed_at: at(1) },
      { ...base, id: "5a10e000-0000-4000-8000-0000000000d4", customer: "Di", items: ["rise"], status: "new", created_at: at(120), status_changed_at: at(120), ready_from: new Date(Date.now() + 90 * 60_000).toISOString() },
    ];
    const products = [{ id: "5a10e000-0000-4000-8000-0000000000f1", slug: "flow", name: "FLOW", sold_out: false, sold_out_at: null, active: true, sort: 1 }];
    const open = async (device) => {
      const ctx = await phoneContext(device, { owner: true, seed: { orders, products } });
      const page = await ctx.newPage();
      if (!device.desktop) await insetsOn(page, device.top, device.bottom);
      const errors = watch(page);
      await page.goto(`${BASE}/crew?s=now&a=kitchen-pass`, { waitUntil: "load" });
      await page.waitForSelector(".svc-full .adm-order", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700); await page.evaluate(SETTLE);
      return { ctx, page, errors };
    };

    // ── an iPad on its side ──
    {
      const { ctx, page, errors } = await open({ name: "iPad 11 on its side", width: 1180, height: 820, desktop: true, touch: true });
      const wide = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const lanes = [...document.querySelectorAll(".svc-full .pass-lane")].map((l) => {
          const r = l.getBoundingClientRect();
          return { lane: l.getAttribute("data-lane"), x: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), scroll: getComputedStyle(l.querySelector(".pass-list")).overflowY };
        });
        const rail = q(".svc-full .pass-rail"), frame = q(".svc-full"), door = q(".svc-full .svc-bar .pass-narrow");
        const px = (sel) => (q(sel) ? parseFloat(getComputedStyle(q(sel)).fontSize) : 0);
        return {
          lanes, railX: rail ? Math.round(rail.getBoundingClientRect().left) : null, railScroll: rail ? getComputedStyle(rail).overflowY : null,
          pageScrolls: frame.scrollHeight > frame.clientHeight + 1, door: door ? getComputedStyle(door).display : null,
          no: px(".svc-full .pass-no"), name: px(".svc-full .adm-order-top b"), items: px(".svc-full .adm-items"), age: px(".svc-full .adm-age"),
          perLine: [...(q(`.svc-full [data-ticket] .adm-items`)?.querySelectorAll(".pass-item") ?? [])].map((i) => getComputedStyle(i).display),
        };
      });
      ok("the Pass on an iPad on its side (1180): New · In progress · Ready side by side, left to right on one line, each list scrolling on its own",
        wide.lanes.map((l) => l.lane).join() === "new,preparing,ready" && wide.lanes.every((l, i, a) => i === 0 || (l.x >= a[i - 1].right && Math.abs(l.top - a[0].top) <= 1))
        && wide.lanes.every((l) => l.scroll === "auto"), JSON.stringify(wide.lanes));
      ok("…the rail beside the lanes, scrolling on its own, and the board does not scroll as a page",
        wide.railX !== null && wide.railX >= Math.max(...wide.lanes.map((l) => l.right)) && wide.railScroll === "auto" && !wide.pageScrolls, JSON.stringify(wide));
      ok("…no 86 door in the bar: the rail is on screen", wide.door === "none", wide.door);
      ok("…at arm's length: the number 28, the name 20, the drinks 17 — a line each", wide.no >= 28 && wide.name >= 20 && wide.items >= 17 && wide.age >= 17
        && wide.perLine.length === 2 && wide.perLine.every((d) => d === "block"), JSON.stringify(wide));
      ok("the Pass on an iPad: no errors", errors.length === 0, errors.join(" | "));
      await ctx.close();
    }

    // ── a phone ──
    {
      const { ctx, page, errors } = await open(MAIN);
      const narrow = await page.evaluate(() => {
        const lanes = [...document.querySelectorAll(".svc-full .pass-lane")].map((l) => l.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) }));
        const door = document.querySelector(".svc-full .svc-bar .pass-narrow");
        // Each control on the board and its bar: its own box, or the reach the kit draws round it (an ::after laid over it).
        const reach = (b) => {
          const r = b.getBoundingClientRect(), a = getComputedStyle(b, "::after");
          const over = a.content !== "none" && a.position === "absolute";
          return { w: Math.max(r.width, over ? parseFloat(a.width) || 0 : 0), h: Math.max(r.height, over ? parseFloat(a.height) || 0 : 0) };
        };
        const small = [...document.querySelectorAll(".svc-full .svc-bar button, .svc-full .pass-board button")]
          .filter((b) => b.getClientRects().length > 0)
          .map((b) => ({ t: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 28), ...reach(b) }))
          .filter((b) => b.w < 44 || b.h < 44);
        const heads = [...document.querySelectorAll('.svc-full [role="heading"][aria-level="3"] > .kds-stage-h')].map((b) => b.getAttribute("aria-label"));
        const live = [...document.querySelectorAll(".svc-full [aria-live]")].filter((n) => n.querySelector(".adm-order")).length;
        const polite = !!document.querySelector('.svc-full .pass-board > .sr-only[aria-live="polite"]');
        const sched = document.querySelector('.svc-full [data-lane="scheduled"] .kds-stage-h');
        return {
          stacked: lanes.length === 3 && lanes.every((r, i, a) => i === 0 || r.top >= a[i - 1].bottom - 1), door: door ? getComputedStyle(door).display : null, small, heads, live, polite,
          scheduled: sched ? { label: sched.getAttribute("aria-label"), open: sched.getAttribute("aria-expanded") } : null,
          diDrawn: !!document.querySelector('.svc-full [data-ticket="5a10e000-0000-4000-8000-0000000000d4"]'),
          late: document.querySelector(`.svc-full [data-ticket] .adm-age.late`)?.textContent ?? null,
        };
      });
      ok("the Pass on a phone: the lanes stacked, one under another", narrow.stacked, JSON.stringify(narrow));
      ok("…every control on the board and in its bar is 44 points to the thumb", narrow.small.length === 0, JSON.stringify(narrow.small));
      ok("…each lane's heading says its count to a screen reader ('New, 1 order'), and the lanes are no live region",
        narrow.heads.includes("New, 1 order") && narrow.heads.includes("In progress, 1 order") && narrow.heads.includes("Ready, hand off, 1 order")
        && narrow.live === 0 && narrow.polite, JSON.stringify(narrow));
      ok("…an order placed ahead waits in Scheduled, folded, under New", narrow.scheduled?.label === "Scheduled, 1 order" && narrow.scheduled.open === "false" && !narrow.diDrawn, JSON.stringify(narrow.scheduled));
      ok("…a late ticket says 'late' — not by its colour alone", /^\d+m late$/.test(narrow.late ?? ""), narrow.late);
      await page.locator(".svc-full .svc-bar .pass-narrow").click().catch(() => {});
      await page.waitForTimeout(800);
      const sheet = await page.evaluate(() => {
        const s = [...document.querySelectorAll(".sheet2")].pop();
        return s ? { label: s.getAttribute("aria-label"), chips: [...s.querySelectorAll(".k-chip")].map((c) => c.textContent.trim()) } : null;
      });
      ok("…the 86 board is one tap away: the bar's door opens it in a sheet, its chips there to tap", narrow.door !== "none" && sheet?.label === "86 board" && sheet.chips.includes("FLOW"), JSON.stringify({ door: narrow.door, sheet }));
      await page.keyboard.press("Escape"); await page.waitForTimeout(600);
      // Focus that was on a ticket follows it: Start on Ana's ticket, by keyboard, and focus is on her ticket in In progress.
      await page.locator(`.svc-full [data-ticket="${ANA}"] .adm-act`).focus().catch(() => {});
      await page.keyboard.press("Enter"); await page.waitForTimeout(700);
      const f = await page.evaluate(() => {
        const a = document.activeElement;
        return { ticket: a?.closest?.("[data-ticket]")?.getAttribute("data-ticket") ?? null, lane: a?.closest?.("[data-lane]")?.getAttribute("data-lane") ?? null, inPass: !!a?.closest?.(".svc-full") };
      });
      ok("…focus stays on the board after a tap: it follows the ticket to In progress", f.inPass && f.ticket === ANA && f.lane === "preparing", JSON.stringify(f));
      ok("the Pass on a phone: no errors", errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
  }

  // ── 5f · THE PHONE'S TEXT SIZE (2026-10-08, the type round — Ryan approved proposal 6) ──
  // Until someone picks a text size in the app, the app takes the one nearest the phone's (lib/phoneText), read from
  // WebKit's body face. Chromium has no such face, so the page's own body size stands in for the phone's here: 17px is
  // the standard size and draws the app as it is; 21px (the phone's second-largest ordinary size) draws it a size up
  // twice over — the app's largest. A size picked in the app wins, and forgetting the pick goes back to the phone's.
  {
    const tierOf = (page) => page.evaluate(() => {
      const app = document.querySelector(".app"), body = document.getElementById("body");
      return { tier: [1, 2, 3, 4, 5, 6].find((t) => app?.classList.contains(`rd-t${t}`)) ?? 0, zoom: body ? getComputedStyle(body).zoom : null };
    });
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/menu`, { waitUntil: "load" });
    await page.waitForTimeout(700); await page.evaluate(SETTLE);
    const std = await tierOf(page);
    ok("text size: at the phone's standard size the app is drawn as it is", std.tier === 0 && std.zoom === "1", JSON.stringify(std));
    await ctx.close();
    const big = await phoneContext(MAIN);
    await big.addInitScript(() => {
      const put = () => { if (!document.head) return false; const st = document.createElement("style"); st.textContent = "body{font-size:21px}"; document.head.appendChild(st); return true; };
      if (!put()) new MutationObserver((_, o) => { if (put()) o.disconnect(); }).observe(document, { childList: true, subtree: true });
    });
    const p2 = await big.newPage();
    await insetsOn(p2, MAIN.top, MAIN.bottom);
    const errors2 = watch(p2);
    await p2.goto(`${BASE}/menu`, { waitUntil: "load" });
    await p2.waitForTimeout(700); await p2.evaluate(SETTLE);
    const large = await tierOf(p2);
    ok("text size: a phone set larger draws the app at the nearest of its own sizes (21pt body → the largest, 1.26)", large.tier === 3 && large.zoom === "1.26", JSON.stringify(large));
    await p2.evaluate(() => { localStorage.setItem("gt3-display", JSON.stringify({ scale: 0, bold: false, roomy: false })); window.dispatchEvent(new Event("gt3-pref:gt3-display")); });
    await p2.waitForTimeout(400);
    const picked = await tierOf(p2);
    await p2.evaluate(() => { localStorage.removeItem("gt3-display"); window.dispatchEvent(new Event("gt3-pref:gt3-display")); });
    await p2.waitForTimeout(400);
    const forgot = await tierOf(p2);
    ok("text size: a size picked in the app wins over the phone's, and forgetting the pick goes back to the phone's",
      picked.tier === 0 && forgot.tier === 3, JSON.stringify({ picked, forgot }));
    ok("text size: no errors", errors.length === 0 && errors2.length === 0, [...errors, ...errors2].join(" | "));
    await big.close();
    // TO TWICE ITS SIZE (R12 — the 10/10 audit, F1): a phone at one of its accessibility sizes (34pt body, AX2) draws the
    // app at 200%, and the page reflows — nothing on Today, the menu, Find Us or the shop runs off the right of the phone.
    const ax = await phoneContext(MAIN);
    await ax.addInitScript(() => {
      const put = () => { if (!document.head) return false; const st = document.createElement("style"); st.textContent = "body{font-size:34px}"; document.head.appendChild(st); return true; };
      if (!put()) new MutationObserver((_, o) => { if (put()) o.disconnect(); }).observe(document, { childList: true, subtree: true });
    });
    const p3 = await ax.newPage();
    await insetsOn(p3, MAIN.top, MAIN.bottom);
    const errors3 = watch(p3);
    const wide = [];
    let twice = null;
    for (const route of ["/", "/menu", "/truck", "/shop", "/3mpire", "/events", "/delivery", "/book"]) {
      await p3.goto(`${BASE}${route}`, { waitUntil: "load" });
      await p3.waitForTimeout(700); await p3.evaluate(SETTLE);
      if (route === "/menu") twice = await tierOf(p3);
      const over = await p3.evaluate(() => {
        const body = document.getElementById("body");
        return { page: document.documentElement.scrollWidth - window.innerWidth, body: body ? body.scrollWidth - body.clientWidth : 0 };
      });
      if (over.page > 1 || over.body > 1) wide.push(`${route} ${JSON.stringify(over)}`);
      // A control clipped at the edge is lost as surely as one that scrolls off (the account button was, at 200%): every
      // one on the screen sits inside the phone, unless it rides a row that scrolls sideways (the menu's chips).
      const clipped = await p3.evaluate(() => {
        const W = window.innerWidth, out = [];
        const scrolls = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1) return true; } return false; };
        for (const el of document.querySelectorAll('#body :is(a[href],button,input,select,textarea,[role="button"])')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || el.closest('[aria-hidden="true"],[inert],[hidden]') || getComputedStyle(el).visibility === "hidden") continue;
          if ((r.right > W + 1 || r.left < -1) && !scrolls(el)) out.push((el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30));
        }
        return out;
      });
      if (clipped.length) wide.push(`${route} clipped: ${clipped.join(", ")}`);
    }
    ok("text size: a phone at an accessibility size (34pt body) draws the app at twice its size", twice?.tier === 6 && twice.zoom === "2", JSON.stringify(twice));
    ok("text size: at twice its size Today, the menu, Find Us, the shop, the 3mpire, events, delivery and Book reflow — nothing runs off the right, nothing is clipped at the edge", wide.length === 0, wide.join(" | "));
    ok("text size: no errors at twice the size", errors3.length === 0, errors3.join(" | "));
    await ax.close();
  }

  // ── 5g · ONE SET OF BUTTONS (2026-10-09, the button round — Ryan approved proposal 7) ──
  // Four kinds in two sizes (app/globals.css "03 · Buttons", components/Button): primary filled — GT3 red on a
  // customer's screen, gold in the console — secondary outlined, quiet gold words, destructive red words. Regular
  // stands 50pt with 17pt words; compact 36pt with 15pt words and a 44pt reach. Measured on a specimen of each,
  // drawn into the screen itself (so the screen's own look inks it), and on a real one: the guest's Sign in.
  {
    const specimen = (page) => page.evaluate(() => {
      const host = document.getElementById("body");
      const out = {};
      for (const [k, c] of Object.entries({ pri: "btn-pri", sec: "btn-sec", ter: "btn-ter", del: "btn-del" })) for (const sm of [false, true]) {
        const b = document.createElement("button");
        b.type = "button"; b.className = sm ? `${c} btn-sm` : c; b.textContent = "Save";
        host.appendChild(b);
        const r = b.getBoundingClientRect(), cs = getComputedStyle(b), af = getComputedStyle(b, "::after");
        out[k + (sm ? "-sm" : "")] = { h: Math.round(r.height), fs: cs.fontSize, bg: cs.backgroundColor, ink: cs.color,
          reach: af.content === "none" ? null : Math.round(r.height - parseFloat(af.top) - parseFloat(af.bottom)) };
        b.remove();
      }
      const app = document.querySelector(".app");
      return { out, surface: app?.dataset.surface, gold: getComputedStyle(app).getPropertyValue("--gold").trim() };
    });
    const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/menu`, { waitUntil: "load" });
    await page.waitForTimeout(600); await page.evaluate(SETTLE);
    const guest = await specimen(page);
    const g = guest.out;
    ok("buttons: on a customer's screen regular stands 50pt with 17pt words, the primary GT3 red, the quiet and destructive kinds 44 to the thumb",
      guest.surface === "customer" && g.pri.h === 50 && g.sec.h === 50 && g.pri.fs === "17px" && g.pri.bg === "rgb(184, 36, 32)" && g.ter.h >= 44 && g.del.h >= 44, JSON.stringify(guest));
    ok("buttons: compact stands 36pt with 15pt words and still reaches 44pt", g["pri-sm"].h === 36 && g["sec-sm"].h === 36 && g["sec-sm"].fs === "15px"
      && g["pri-sm"].reach === 44 && g["sec-sm"].reach === 44, JSON.stringify({ pri: g["pri-sm"], sec: g["sec-sm"] }));
    const pill = page.locator('button.acct-av[aria-label="Your account"]').first();
    if (await pill.count()) await pill.click();
    await page.waitForTimeout(700);
    const signIn = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".sheet2 .btn-pri")].find((x) => x.textContent.trim() === "Sign in");
      if (!b) return null;
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      const box = getComputedStyle(b.parentElement), inner = b.parentElement.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
      return { h: Math.round(r.height), caps: cs.textTransform, wide: Math.abs(r.width - inner) <= 1, w: Math.round(r.width), inner: Math.round(inner) };
    });
    ok("buttons: the guest's Sign in is the kit's primary — 50pt, the sheet's width, in sentence case (it was capitals, a recipe of its own)",
      !!signIn && signIn.h === 50 && signIn.caps === "none" && signIn.wide, JSON.stringify(signIn));
    await ctx.close();
    const crew = await phoneContext(MAIN, { owner: true, theme: "dark" });
    const cp = await crew.newPage();
    await insetsOn(cp, MAIN.top, MAIN.bottom);
    const errors2 = watch(cp);
    await cp.goto(`${BASE}/crew?s=now`, { waitUntil: "load" });
    await cp.waitForTimeout(900); await cp.evaluate(SETTLE);
    const console_ = await specimen(cp);
    ok("buttons: in the crew console the primary is gold — the shell says which surface it is (data-surface)",
      console_.surface === "console" && console_.out.pri.bg === hex(console_.gold) && console_.out.pri.h === 50, JSON.stringify({ surface: console_.surface, gold: console_.gold, pri: console_.out.pri }));
    ok("buttons: no errors", errors.length === 0 && errors2.length === 0, [...errors, ...errors2].join(" | "));
    await crew.close();
  }

  // ── 5h · ONE KIT FOR CHIPS AND TAGS (2026-10-09, the chip round — redesign 7's second half) ──
  // A choice is the kit's chip — 36pt with 15pt words (28 with 13 where a row is dense), 44 to the thumb, the chosen one
  // gold; a status is its tag — 22pt, 11pt mono capitals, its tone's ink for the look it lands in. Measured on a
  // specimen of each drawn into the screen itself, and on real ones: the notes' tabs, and the guest's join (.handle was
  // the red primary in capitals; it is the kit's).
  {
    const specimen = (page) => page.evaluate(() => {
      const host = document.getElementById("body");
      const make = (tag, cls, text) => { const e = document.createElement(tag); if (tag === "button") e.type = "button"; e.className = cls; e.textContent = text; host.appendChild(e); return e; };
      const read = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e), af = getComputedStyle(e, "::after");
        return { h: Math.round(r.height), fs: cs.fontSize, ff: cs.fontFamily, caps: cs.textTransform, bg: cs.backgroundColor, ink: cs.color,
          reach: af.content === "none" || af.content === "normal" ? null : Math.round(r.height - parseFloat(af.top) - parseFloat(af.bottom)) }; };
      const els = { chip: make("button", "k-chip", "Today"), sm: make("button", "k-chip sm", "Today"), on: make("button", "k-chip on", "Today"),
        tag: make("span", "k-tag", "Draft"), crit: make("span", "k-tag crit", "Blocked") };
      const out = Object.fromEntries(Object.entries(els).map(([k, e]) => [k, read(e)]));
      Object.values(els).forEach((e) => e.remove());
      const css = getComputedStyle(document.querySelector(".app") || document.body);
      return { out, gold2: css.getPropertyValue("--gold2").trim(), crit: css.getPropertyValue("--tone-crit").trim() };
    });
    const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/menu`, { waitUntil: "load" });
    await page.waitForTimeout(600); await page.evaluate(SETTLE);
    const guest = await specimen(page);
    const c = guest.out;
    ok("chips: a chip stands 36pt with 15pt words and reaches 44; the small one 28pt, reaching 44 too; the chosen one is gold",
      c.chip.h === 36 && c.chip.fs === "15px" && c.chip.reach === 44 && c.sm.h === 28 && c.sm.reach === 44 && c.on.bg === hex(guest.gold2), JSON.stringify(guest));
    ok("tags: a tag stands 22pt in 11pt mono capitals", c.tag.h === 22 && c.tag.fs === "11px" && /DM Mono/.test(c.tag.ff) && c.tag.caps === "uppercase", JSON.stringify(c.tag));
    await page.goto(`${BASE}/3mpire`, { waitUntil: "load" });
    await page.waitForTimeout(900); await page.evaluate(SETTLE);
    const join = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button.btn-pri")].find((x) => /^Join free$/i.test(x.textContent.trim()));
      if (!b) return null;
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      return { h: Math.round(r.height), caps: cs.textTransform, bg: cs.backgroundColor, words: b.textContent.trim().slice(0, 40), old: document.querySelectorAll(".handle").length };
    });
    ok("buttons: the guest's join is the kit's primary — GT3 red, 50pt, its words as written (it was .handle, red in capitals)",
      !!join && join.h === 50 && join.caps === "none" && join.bg === "rgb(184, 36, 32)" && join.old === 0, JSON.stringify(join));
    await ctx.close();
    const crew = await phoneContext(MAIN, { owner: true, theme: "day" });
    const cp = await crew.newPage();
    await insetsOn(cp, MAIN.top, MAIN.bottom);
    const errors2 = watch(cp);
    await cp.goto(`${BASE}/crew?s=notes`, { waitUntil: "load" });
    await cp.waitForTimeout(1200); await cp.evaluate(SETTLE);
    const day = await specimen(cp);
    ok("tags: in the crew's light look a tone inks in its light-surface ink (critical is the deep red, 4.5:1 on cream)",
      day.crit === "#8f1d1a" && day.out.crit.ink === hex(day.crit) && day.out.on.bg === hex(day.gold2), JSON.stringify({ crit: day.crit, ink: day.out.crit.ink, gold2: day.gold2, on: day.out.on.bg }));
    const tabs = await cp.evaluate(() => [...document.querySelectorAll(".note-tabs .k-chip")].map((b) => ({ w: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), on: b.classList.contains("on"), pressed: b.getAttribute("aria-pressed") })));
    ok("chips: the notes' tabs are the kit's chips — 36pt, Active chosen and saying so", tabs.length === 3 && tabs.every((t) => t.h === 36) && tabs.some((t) => t.w === "Active" && t.on && t.pressed === "true"), JSON.stringify(tabs));
    ok("chips: no errors", errors.length === 0 && errors2.length === 0, [...errors, ...errors2].join(" | "));
    await crew.close();
  }

  // ── 5i · THE DESK (2026-10-09, redesign 5 — Ryan approved: "From 1024 wide up, the frame goes") ──
  // The web, not the app — in the app an iPad's glass is the frame and the shell fills it (1b) — but out/ is the same
  // pages, and this is the harness that signs in: the console and /office on a laptop's screen in a plain browser
  // (1,440 × 900 and 1,024 × 768), with the tab bar a sidebar and the sections in two columns; and the frame kept on an
  // iPad's browser held upright (the 13-inch, 1,032 × 1,376) and on a phone, where the columns are not boxes at all.
  {
    const DESK = { name: "desk", width: 1440, height: 900, desktop: true };
    const SMALL = { name: "desk 1024", width: 1024, height: 768, desktop: true };
    const UPRIGHT = { name: "iPad 13 upright", width: 1032, height: 1376, desktop: true, touch: true };
    const day = (d) => ({ id: d, date: d, scheduled_for: d, window: "mon_0500_0800", gallons: 6, price_per_gallon_cents: 4500, total_cents: 27000, status: "received", payment_status: "pending",
      driver_outcome: null, jugs_out: null, jugs_in: null, canceled: false, canceled_reason: null, cutoff_at: null, open: true, money_locked: false, note_open: true, moved_from: null, client_note: null,
      change_reason: null, changed_at: null, gallons_changed: false, location_id: "l1", program_id: "p1", market: "clt", paylink_url: null });
    // A made-up office (no real company): one location, a weekly order, two deliveries ahead, a request and an invoice.
    const office = { company: { id: "c1", name: "Northwind Studio", status: "active", billing_terms: "net30", market: "clt" }, role: "admin", can_change: true, can_request: true,
      today: "2026-10-09", min_gallons: 3, locations: [{ id: "l1", label: "Northwind HQ", street: "1 Example Way", city: "Charlotte", access: null, market: "clt" }],
      programs: [{ id: "p1", location_id: "l1", status: "active", every_n_weeks: 1, weekdays: [1], window: "mon_0500_0800", gallons: 6, price_per_gallon_cents: 4500, account: { id: "a1", standing_active: true, standing_gallons: 6, mine: true } }],
      agenda: [day("2026-10-12"), day("2026-10-19")], recent: [], jugs: 6,
      invoices: [{ id: "i1", amount_cents: 27000, status: "open", terms: "net30", issued_at: "2026-10-05T14:00:00Z", due_at: "2026-11-04T14:00:00Z", paid_at: null, order_id: null, pay_url: null }],
      requests: [{ id: "q1", kind: "extra_delivery", label: "Extra delivery", body: "Three more gallons on the 22nd?", status: "open", order_id: null, resolution: null, created_at: "2026-10-07T15:00:00Z", resolved_at: null }] };
    const look = (page) => page.evaluate(() => {
      const r = (e) => (e ? e.getBoundingClientRect() : null), shown = (e) => !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0;
      const app = document.querySelector(".app"), nav = document.querySelector(".app > nav.nav"), body = document.getElementById("body"), a = r(app), n = r(nav), sc = r(document.querySelector(".screen"));
      const tabs = nav ? [...nav.querySelectorAll(".tab")].filter(shown).map((t) => { const b = t.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), h: Math.round(b.height), on: t.classList.contains("on"), bg: getComputedStyle(t).backgroundColor }; }) : [];
      const cols = [...document.querySelectorAll(".desk-col")].map((c) => { const b = c.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), d: getComputedStyle(c).display, t: (c.textContent || "").slice(0, 4000), h: [...c.querySelectorAll("h2")].map((e) => (e.textContent || "").trim()) }; });
      const tiles = [...document.querySelectorAll(".mkpi .mkpi-tile")].map((t) => Math.round(t.getBoundingClientRect().y));
      // Money opens on the home's three numbers (2026-10-09, Business opens on Money): where they stand.
      const numbers = (() => { const e = document.getElementById("home-numbers"); return e && shown(e) ? Math.round(e.getBoundingClientRect().y) : null; })();
      return { app: a && { w: Math.round(a.width), h: Math.round(a.height), radius: parseFloat(getComputedStyle(app).borderTopLeftRadius) || 0 },
        nav: n && { x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.width), h: Math.round(n.height) }, tabs, cols, tiles, numbers,
        screen: sc && { x: Math.round(sc.x), w: Math.round(sc.width) },
        // Sideways: the page, and the scroller unless it clips (/office's watermark bleeds off the right edge by design).
        over: Math.max(document.scrollingElement.scrollWidth - innerWidth, body && getComputedStyle(body).overflowX !== "hidden" ? body.scrollWidth - body.clientWidth : 0),
        rail: shown(document.querySelector(".rail")), fab: shown(document.querySelector(".qd-fab")),
        spark: shown(document.querySelector('.toprow-actions [aria-label^="Quick actions"]')), ask: shown(document.querySelector('.acct [aria-label^="Ask us"]')),
        head: !!nav && [...nav.querySelectorAll("span")].some((s) => s.textContent === "Crew console" && shown(s.parentElement)),
        orient: nav?.querySelector('[role="tablist"]')?.getAttribute("aria-orientation") ?? null };
    });
    const open = async (vp, path, opts) => {
      const ctx = await phoneContext(vp, { owner: true, shell: false, ...opts });
      const page = await ctx.newPage();
      const errors = watch(page);
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(1300); await page.evaluate(SETTLE);
      return { ctx, page, errors, g: await look(page) };
    };
    const bare = (cols) => cols.map((c) => ({ x: c.x, y: c.y, w: c.w, d: c.d }));
    const side = (cols) => cols.length === 2 && cols.every((c) => c.d === "block" && c.w >= 300) && cols[0].x < cols[1].x && Math.abs(cols[0].y - cols[1].y) <= 1 && Math.abs(cols[0].w - cols[1].w) <= 2;
    const allErrors = [];

    const m = await open(DESK, "/crew?s=money", { theme: "day" });
    allErrors.push(...m.errors);
    const g = m.g, lit = g.tabs.filter((t) => t.on);
    ok("desk: the console fills a laptop's window — no frame, no corners", g.app.w === 1440 && g.app.h === 900 && g.app.radius === 0, JSON.stringify(g.app));
    ok("desk: the tab bar is a sidebar at the window's left edge, its full height and 236 wide — rows of 44 one under another, the lit one washed",
      g.nav.x === 0 && g.nav.y === 0 && g.nav.w === 236 && g.nav.h === 900 && g.tabs.length >= 3 && g.tabs.every((t) => t.x === g.tabs[0].x && t.h >= 44)
        && g.tabs.every((t, i) => i === 0 || t.y > g.tabs[i - 1].y) && lit.length === 1 && lit[0].bg !== "rgba(0, 0, 0, 0)", JSON.stringify({ nav: g.nav, tabs: g.tabs }));
    ok("desk: the sidebar's head says Crew console, and its list says it stands up", g.head && g.orient === "vertical", JSON.stringify({ head: g.head, orient: g.orient }));
    ok("desk: the canvas sits right of the sidebar, never wider than 1,240, and nothing scrolls sideways", g.screen.x >= 236 && g.screen.w <= 1240 && g.over <= 0, JSON.stringify({ screen: g.screen, over: g.over }));
    // MONEY ANSWERS THREE QUESTIONS (2026-10-15, release 3 of the Plan & Money audit, Ryan: "Yes, build it"): what needs a
    // person and what to do next on the left, the reports and the records on the right.
    ok("desk: Money's groups stand in two columns side by side, starting on one line — what needs attention and what to do next; the reports and the records",
      side(g.cols) && g.cols[0].h.includes("Needs attention") && g.cols[0].h.includes("Do next") && g.cols[1].h.includes("Reports") && g.cols[1].h.includes("Records"), JSON.stringify({ cols: bare(g.cols), heads: g.cols.map((c) => c.h) }));
    ok("desk: Money opens on the home's three numbers, above its two columns (2026-10-09); nothing floats over the canvas — the ✦ is in the header, and no rail or floating button is drawn",
      g.numbers !== null && g.cols.length === 2 && g.numbers < g.cols[0].y && g.tiles.length === 0 && g.spark && !g.fab && !g.rail, JSON.stringify({ numbers: g.numbers, cols: bare(g.cols), tiles: g.tiles, spark: g.spark, fab: g.fab, rail: g.rail }));
    await m.ctx.close();

    const s = await open(SMALL, "/crew?s=money", { theme: "dark" });
    allErrors.push(...s.errors);
    ok("desk: at 1,024 × 768 the two columns still stand side by side under the three numbers, nothing sideways",
      side(s.g.cols) && s.g.numbers !== null && s.g.numbers < s.g.cols[0].y && s.g.over <= 0 && s.g.nav.w === 236, JSON.stringify({ cols: bare(s.g.cols), numbers: s.g.numbers, over: s.g.over }));
    await s.ctx.close();

    const o = await open(DESK, "/office", { seed: { rpc: { office_home: office } } });
    allErrors.push(...o.errors);
    ok("desk: /office gets the same treatment — the customer's tabs a sidebar, the deliveries on the left (the next one, the calendar, the weekly order) and the account on the right",
      o.g.nav.x === 0 && o.g.nav.w === 236 && o.g.app.radius === 0 && side(o.g.cols) && /Next delivery/i.test(o.g.cols[0].t) && /Weekly order/i.test(o.g.cols[0].t)
        && /Requests/i.test(o.g.cols[1].t) && /Invoices/i.test(o.g.cols[1].t) && o.g.over <= 0,
      JSON.stringify({ nav: o.g.nav, radius: o.g.app.radius, over: o.g.over, cols: o.g.cols.map((c) => ({ ...bare([c])[0], t: c.t.slice(0, 60) })) }));
    ok("desk: on /office, Ask us sits beside the account, as on a phone, and no rail is drawn", o.g.ask && !o.g.rail, JSON.stringify({ ask: o.g.ask, rail: o.g.rail }));
    await o.ctx.close();

    const u = await open(UPRIGHT, "/crew?s=money", { theme: "day" });
    allErrors.push(...u.errors);
    ok("desk: an iPad held upright keeps today's layout — the frame, its corners, the tab bar along its foot, one column",
      u.g.app.radius > 0 && u.g.nav.y > 1000 && u.g.nav.w === u.g.app.w && u.g.cols.length === 2 && u.g.cols.every((c) => c.d === "contents") && !u.g.spark && u.g.fab,
      JSON.stringify({ app: u.g.app, nav: u.g.nav, cols: u.g.cols.map((c) => c.d), spark: u.g.spark, fab: u.g.fab }));
    await u.ctx.close();

    const ph = await phoneContext(MAIN, { owner: true, theme: "day" });
    const pp = await ph.newPage();
    await insetsOn(pp, MAIN.top, MAIN.bottom);
    allErrors.push(...watch(pp));
    await pp.goto(`${BASE}/crew?s=money`, { waitUntil: "load" });
    await pp.waitForTimeout(1200); await pp.evaluate(SETTLE);
    const p = await look(pp);
    ok("desk: on a phone the columns are not boxes at all — one column, the tab bar at the foot, the ✦ in the header",
      p.cols.length === 2 && p.cols.every((c) => c.d === "contents") && p.nav.y > 600 && p.spark && !p.fab && p.orient === "horizontal", JSON.stringify({ cols: p.cols.map((c) => c.d), nav: p.nav, spark: p.spark, orient: p.orient }));
    await ph.close();
    ok("desk: no errors", allErrors.length === 0, allErrors.join(" | "));
  }

  // ── 5j · ONE FIELD (2026-10-09, the forms round) ──
  // Every field's words at 16px — the base field's — and the fields that are not a form's field drawn as their own:
  // measured on specimens drawn into the screen itself (the console's form, the gear library's select, the emailed
  // code, the kit's switch) and on real ones: the sign-in wall's fields, a new note's, the concierge's composer.
  {
    const fieldsOn = (page) => page.evaluate(() => [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea")]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((e) => ({ c: (e.className || e.tagName).toString().slice(0, 30), fs: parseFloat(getComputedStyle(e).fontSize) })));
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/3mpire`, { waitUntil: "load" });
    await page.waitForTimeout(900); await page.evaluate(SETTLE);
    const wall = await fieldsOn(page);
    ok("fields: the sign-in wall's fields draw 16px words — an iPhone zooms into a smaller one when it is tapped", wall.length > 0 && wall.every((f) => f.fs >= 16), JSON.stringify(wall));
    await page.goto(`${BASE}/truck`, { waitUntil: "load" });
    await page.waitForTimeout(900); await page.evaluate(SETTLE);
    await page.locator('button[aria-label^="Ask us"]').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(900); await page.evaluate(SETTLE);
    const conc = await page.evaluate(() => { const e = document.querySelector(".conc-in"); if (!e) return null; const cs = getComputedStyle(e); return { fs: cs.fontSize, rad: cs.borderRadius, h: Math.round(e.getBoundingClientRect().height) }; });
    ok("fields: the concierge's composer is round beside its round send, at 16px (the base field had drawn its 9px box over it)", !!conc && conc.fs === "16px" && parseFloat(conc.rad) >= 22 && conc.h >= 44, JSON.stringify(conc));
    await ctx.close();
    const crew = await phoneContext(MAIN, { owner: true, theme: "day" });
    const cp = await crew.newPage();
    await insetsOn(cp, MAIN.top, MAIN.bottom);
    const errors2 = watch(cp);
    await cp.goto(`${BASE}/crew?s=notes`, { waitUntil: "load" });
    await cp.waitForTimeout(1200); await cp.evaluate(SETTLE);
    const spec = await cp.evaluate(() => {
      const host = document.getElementById("body");
      const box = document.createElement("div"); host.appendChild(box);
      box.innerHTML = '<div class="prod-f"><input value="Riverside Run Club"><select><option>Planning</option></select><textarea>A note</textarea></div>'
        + '<div class="gl-f"><select><option>Greenville</option></select></div><input class="auth-input auth-code" value="482916">'
        + '<button type="button" role="switch" aria-checked="false" class="k-switch"><span class="k-switch-k"></span></button>'
        + '<button type="button" role="switch" aria-checked="true" class="k-switch on"><span class="k-switch-k"></span></button>';
      const q = (sel) => box.querySelector(sel);
      const fs = (e) => getComputedStyle(e).fontSize;
      const sw = (e) => { const r = e.getBoundingClientRect(), af = getComputedStyle(e, "::after"), k = e.querySelector(".k-switch-k").getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), reach: Math.round(r.height - parseFloat(af.top) - parseFloat(af.bottom)), knob: Math.round(k.width), knobAt: Math.round(k.left - r.left), bg: getComputedStyle(e).backgroundColor }; };
      const out = { form: [fs(q(".prod-f input")), fs(q(".prod-f select")), fs(q(".prod-f textarea"))], gl: fs(q(".gl-f select")),
        code: { fs: fs(q(".auth-code")), ff: getComputedStyle(q(".auth-code")).fontFamily }, off: sw(box.querySelectorAll(".k-switch")[0]), on: sw(box.querySelectorAll(".k-switch")[1]),
        gold2: getComputedStyle(document.querySelector(".app")).getPropertyValue("--gold2").trim() };
      box.remove();
      return out;
    });
    const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
    ok("fields: the console's form draws 16px words in its fields, selects and notes (15px on 189 fields), the gear library's 16 (13)",
      spec.form.every((v) => v === "16px") && spec.gl === "16px", JSON.stringify(spec));
    ok("fields: the emailed code reads in 22px mono digits", spec.code.fs === "22px" && /DM Mono/.test(spec.code.ff), JSON.stringify(spec.code));
    ok("switch: the kit's switch is 51×31 with a 27pt knob, 44 to the thumb; on, the knob rides right on the kit's gold",
      spec.off.w === 51 && spec.off.h === 31 && spec.off.knob === 27 && spec.off.reach >= 44 && spec.off.knobAt === 2 && spec.on.knobAt === 22 && spec.on.bg === hex(spec.gold2), JSON.stringify({ off: spec.off, on: spec.on }));
    await cp.locator('button:has-text("New note")').first().click({ timeout: 5000 }).catch(() => {});
    await cp.waitForTimeout(900); await cp.evaluate(SETTLE);
    const note = await fieldsOn(cp);
    const title = note.find((f) => /note-lux-title/.test(f.c));
    ok("fields: a new note's fields draw at 16px or more — its title at 17", note.length >= 3 && note.every((f) => f.fs >= 16) && !!title && title.fs === 17, JSON.stringify(note));
    ok("fields: no errors", errors.length === 0 && errors2.length === 0, [...errors, ...errors2].join(" | "));
    await crew.close();
  }

  // R27 (2026-10-18 — the 10/10 audit, security F7): the delete's code. Supabase's own email code, stood in — what the app
  // asked to be sent, and what it checked; the check answers the owner's session again, as Supabase's does.
  const deleteCodeStandIn = async (page) => {
    const sent = { otp: null, verify: null };
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
    await page.route((u) => u.host === BACKEND_HOST && (u.pathname === "/auth/v1/otp" || u.pathname === "/auth/v1/verify"), async (route) => {
      const req = route.request(), u = new URL(req.url());
      if (req.method() === "OPTIONS") return route.fallback();
      const json = (body) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (u.pathname === "/auth/v1/otp") { sent.otp = req.postDataJSON(); return json({}); }
      sent.verify = req.postDataJSON();
      return json(SESSION);
    });
    return sent;
  };
  // The code's step, as a person meets it: the field, the words that the code went, then the code and the red words.
  // `before` is asked once the step is up, before the code is typed (what the page has done by then).
  const enterDeleteCode = async (page, before = () => {}) => {
    const asked = await page.waitForSelector("#del-code", { timeout: 8000 }).then(() => true, () => false);
    if (!asked) return false;
    await page.waitForFunction(() => /We sent an 8-digit code/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
    await before();
    await page.fill("#del-code", "12345678").catch(() => {});
    await page.locator("form", { has: page.locator("#del-code") }).getByRole("button", { name: "Delete my account" }).click().catch(() => {});
    return true;
  };

  // ── 6 · deleting your account, in the app (App Store Review Guideline 5.1.1(v)) ──
  // Signed in, from the avatar's menu: Settings & privacy, then the row — three taps (A2 of the account audit) — its
  // screen (loaded when tapped — so it must be in the export), what it asks the web's API, and after the red button a
  // phone that is signed out and home.
  // The stand-in API answers {} — nothing stands in the way — so this walks the whole way through. Since R27 the red
  // button emails a code first, and the delete goes when it is entered.
  {
    const ctx = await phoneContext(MAIN, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const code = await deleteCodeStandIn(page);
    const from = apiCalls.length;
    const asked = (method) => apiCalls.slice(from).some((c) => c.method === method && new URL(c.url).pathname === "/api/account/erase");
    await page.goto(`${BASE}/book`, { waitUntil: "load" });
    await page.waitForTimeout(400); await page.evaluate(SETTLE);
    const pill = page.locator('button.acct-av[aria-label="Your account"]').first();
    const hasPill = (await pill.count()) > 0;
    if (hasPill) await pill.click();
    const settings = page.getByRole("button", { name: /^Settings & privacy/ }).first();
    if (await settings.waitFor({ timeout: 5000 }).then(() => true, () => false)) await settings.click();
    const row = page.getByRole("button", { name: /^Delete account/ }).first();
    const hasRow = await row.waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (hasRow) await row.click();
    const said = await page.waitForSelector("text=This deletes your GT3 account for good", { timeout: 8000 }).then(() => true, () => false);
    await page.waitForTimeout(300);
    const under = await page.evaluate(underTheBars, { top: MAIN.top, bottom: MAIN.bottom });
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "account--delete") });
    ok("delete account: the avatar's menu has it under Settings & privacy, three taps in, in the app", hasPill && hasRow, `pill ${hasPill}, row ${hasRow}`);
    ok("delete account: its screen opens from the export and says what goes and what stays", said);
    ok("delete account: it asks the web's API first", asked("GET"));
    ok("delete account: nothing on its screen is under the system's bars", under.length === 0, findings(under));
    const red = page.getByRole("button", { name: "Delete my account" });
    if (said) await red.click();
    let postedEarly = null, focusedCode = null;
    const coded = said && await enterDeleteCode(page, async () => {
      postedEarly = asked("POST");
      focusedCode = await page.evaluate(() => document.activeElement?.id ?? null);
      if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "account--delete-code") }).catch(() => {});
    });
    ok("delete account: the red button emails a code first — to the account's own email, never making an account — and asks nothing of the web's API until it is entered",
      coded && code.otp?.email === OWNER.email && code.otp?.create_user === false && postedEarly === false, JSON.stringify({ otp: code.otp, postedEarly }));
    ok("delete account: the code's step has the caret in the code field (its words read with it)", focusedCode === "del-code", String(focusedCode));
    await page.waitForURL((u) => ["/", "/menu"].includes(new URL(u).pathname), { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const after = await page.evaluate((key) => ({ path: location.pathname, session: localStorage.getItem(key), told: document.body.innerText.includes("Your account is deleted.") }),
      `sb-${BACKEND_HOST.split(".")[0]}-auth-token`);
    // home sends a guest in the app on to the menu (app/page.tsx — the app opens on the menu since 2026-10-08), so either is home
    ok("delete account: the code is checked as an email code (the one typed), then the web's API is asked, then this phone is signed out and home, and told",
      code.verify?.type === "email" && code.verify?.token === "12345678" && code.verify?.email === OWNER.email
      && asked("POST") && ["/", "/menu"].includes(after.path) && after.session === null && after.told, JSON.stringify({ verify: code.verify, posted: asked("POST"), ...after, session: after.session ? "still here" : null }));
    ok("delete account: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── 6a · the account menu on the smallest iPhone (A2 of the account audit, 2026-10-12) ──
  // A member's menu — the header, two quick actions, four rows — opens with Sign out in sight on an iPhone SE (the audit's
  // acceptance line). The crew's Customer · Crew switch is there once the profile is, and it takes them to the console.
  {
    const SE = PHONES.find((p) => p.name === "iPhone SE");
    const mctx = await phoneContext(SE, { owner: true, seed: { profiles: [{ ...PROFILE, role: "member", is_admin: false }] } });
    const mp = await mctx.newPage();
    await insetsOn(mp, SE.top, SE.bottom);
    const merrors = watch(mp);
    await mp.goto(`${BASE}/book`, { waitUntil: "load" });
    await mp.waitForTimeout(900); await mp.evaluate(SETTLE);
    await mp.locator('button.acct-av[aria-label="Your account"]').first().click().catch(() => {});
    await mp.getByRole("button", { name: /^Settings & privacy/ }).first().waitFor({ timeout: 6000 }).catch(() => {});
    await mp.waitForTimeout(900);
    const mfit = await mp.evaluate(() => {
      const sheet = [...document.querySelectorAll(".sheet2")].pop();
      const out = [...(sheet?.querySelectorAll("button.btn-del") ?? [])].find((b) => b.textContent.trim() === "Sign out");
      const r = out?.getBoundingClientRect();
      return { rows: sheet ? sheet.querySelectorAll(".acs-row").length : 0, tiles: sheet ? sheet.querySelectorAll(".grid button").length : 0,
        switch: !!sheet?.querySelector('[aria-label="Which side of GT3"]'), signOutOnScreen: !!r && r.bottom <= innerHeight && r.top >= 0 };
    });
    if (SHOTS) await mp.screenshot({ path: shotPath(SE, "account--member") });
    ok("account menu: a member's — the header, two quick actions, four rows — shows Sign out on an iPhone SE without a scroll, and no crew switch",
      mfit.tiles === 2 && mfit.rows === 4 && mfit.signOutOnScreen && !mfit.switch, JSON.stringify(mfit));
    ok("account menu: no errors (a member)", merrors.length === 0, merrors.join(" | "));
    await mctx.close();
    const ctx = await phoneContext(SE, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, SE.top, SE.bottom);
    const errors = watch(page);
    await page.goto(`${BASE}/book`, { waitUntil: "load" });
    await page.waitForTimeout(900); await page.evaluate(SETTLE);
    await page.locator('button.acct-av[aria-label="Your account"]').first().click().catch(() => {});
    const crew = page.getByRole("radio", { name: "Crew" }).first();
    const hasSwitch = await crew.waitFor({ timeout: 6000 }).then(() => true, () => false);
    await page.waitForTimeout(700);
    // The owner's is the longest menu there is — the switch and the Owner group on top of a member's: on an iPhone SE it
    // scrolls, and Sign out is at the end of it.
    const fit = await page.evaluate(() => {
      const sheet = [...document.querySelectorAll(".sheet2")].pop(), body = sheet?.querySelector(".sheet2-body");
      if (body) body.scrollTop = body.scrollHeight;
      const out = [...(sheet?.querySelectorAll("button.btn-del") ?? [])].find((b) => b.textContent.trim() === "Sign out");
      const r = out?.getBoundingClientRect();
      return { rows: sheet ? sheet.querySelectorAll(".acs-row").length : 0, tiles: sheet ? sheet.querySelectorAll(".grid button").length : 0,
        signOutReached: !!r && r.bottom <= innerHeight && r.top >= 0 };
    });
    if (SHOTS) await page.screenshot({ path: shotPath(SE, "account--owner") });
    ok("account menu: the crew's Customer · Crew switch is there once the profile is", hasSwitch);
    ok("account menu: on an iPhone SE the owner's menu — two quick actions, its rows, the Owner group — reaches Sign out at its end",
      fit.tiles === 2 && fit.rows >= 5 && fit.signOutReached, JSON.stringify(fit));
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sheet2")].pop()?.querySelector(".sheet2-body"); if (b) b.scrollTop = 0; });
    if (hasSwitch) await crew.click();
    await page.waitForURL((u) => new URL(u).pathname === "/crew", { timeout: 8000 }).catch(() => {});
    ok("account menu: the switch's Crew takes the owner to the console", new URL(page.url()).pathname === "/crew", page.url());
    ok("account menu: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── 6b · Sign in with Apple, in the app (2026-10-11) ──
  // Signed out on the 3MPIRE page: the button is there (and not in a plain browser); Apple's sheet is asked with a
  // fresh nonce; the identity token goes to Supabase with that same nonce; the one-time code goes to the web's API;
  // and the phone is signed in. The stand-in answers Apple's sheet with a made-up credential (ANSWERS) and the token
  // exchange with its session.
  {
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const from = apiCalls.length;
    let exchange = null;
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.host === BACKEND_HOST && u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "id_token") { try { exchange = r.postDataJSON(); } catch { exchange = { unreadable: true }; } }
    });
    await page.goto(`${BASE}/3mpire`, { waitUntil: "load" });
    const apple = page.getByRole("button", { name: "Continue with Apple" });
    const shown = await apple.waitFor({ timeout: 8000 }).then(() => true, () => false);
    await page.waitForTimeout(700); await page.evaluate(SETTLE);
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "signin--apple") });
    if (shown) await apple.click();
    await page.waitForFunction(() => window.__native?.calls.some((c) => c.plugin === "GT3Device" && c.method === "signInWithApple"), null, { timeout: 5000 }).catch(() => {});
    const asked = (await nativeCalls(page)).find((c) => c.plugin === "GT3Device" && c.method === "signInWithApple")?.options ?? null;
    await page.waitForFunction(() => !document.querySelector("#auth-email"), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    const posted = apiCalls.slice(from).some((c) => c.method === "POST" && new URL(c.url).pathname === "/api/auth/apple");
    const signedIn = await page.evaluate((key) => !!localStorage.getItem(key), `sb-${BACKEND_HOST.split(".")[0]}-auth-token`);
    ok("apple: the app's sign-in offers Continue with Apple", shown);
    ok("apple: Apple's sheet is asked with a fresh nonce, and Supabase gets its identity token with that same nonce",
      !!asked && /^[0-9a-f]{64}$/.test(asked.nonce ?? "") && exchange?.provider === "apple" && exchange?.id_token === ANSWERS["GT3Device.signInWithApple"].identityToken && exchange?.nonce === asked.nonce,
      JSON.stringify({ asked, exchange }));
    ok("apple: the one-time code goes to the web's API, and the phone is signed in, off the sign-in screen", posted && signedIn, JSON.stringify({ posted, signedIn }));
    ok("apple: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
    const web = await phoneContext(MAIN, { shell: false });
    const wp = await web.newPage();
    await wp.goto(`${BASE}/3mpire`, { waitUntil: "load" });
    await wp.waitForSelector("#auth-email", { timeout: 8000 }).catch(() => {});
    ok("apple: a plain browser has no Apple sheet, so no Apple button", (await wp.locator("#auth-email").count()) === 1 && (await wp.getByRole("button", { name: "Continue with Apple" }).count()) === 0);
    await web.close();
  }

  // ── 6d · Sign in with Apple finds the account it belongs to (2026-10-15, A3 of the account audit) ──
  // A first Apple sign-in — the token exchange answers with an account made this moment, Apple alone on it (Hide My Email's
  // relay address) — asks "Already a GT3 member?". Linking: the email, sent a code for an account that exists (never a new
  // one); the code, which signs the phone in to that account; then the join, with the sign-in's Apple token (still fresh)
  // and its nonce, to the web's API, asked as the member's own account. "I'm new here" keeps the new account.
  {
    const APPLE_ID = "5a10e000-0000-4000-8000-0000000000a9";
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const freshUser = { id: APPLE_ID, aud: "authenticated", role: "authenticated", email: "x7k2pq9abc@privaterelay.appleid.com",
      app_metadata: { provider: "apple", providers: ["apple"] }, user_metadata: {}, created_at: new Date().toISOString(),
      identities: [{ id: "5a10e000-0000-4000-8000-0000000000aa", identity_id: "5a10e000-0000-4000-8000-0000000000ab", user_id: APPLE_ID, provider: "apple",
        identity_data: { sub: ANSWERS["GT3Device.signInWithApple"].user } }] };
    const freshSession = { access_token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: APPLE_ID, role: "authenticated", aud: "authenticated", exp, email: freshUser.email })}.smoke-signature-not-a-key`,
      token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "smoke-refresh-apple-not-a-token", user: freshUser };
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
    for (const path of ["link", "new"]) {
      const ctx = await phoneContext(MAIN);
      const page = await ctx.newPage();
      await insetsOn(page, MAIN.top, MAIN.bottom);
      const errors = watch(page);
      const sent = { otp: null, verify: null, link: null, auth: null };
      await page.route((u) => u.host === BACKEND_HOST && u.pathname.startsWith("/auth/v1/"), async (route) => {
        const req = route.request(), u = new URL(req.url());
        if (req.method() === "OPTIONS") return route.fallback();
        const json = (body) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
        if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "id_token") return json(freshSession);
        if (u.pathname === "/auth/v1/user" && (req.headers().authorization ?? "") === `Bearer ${freshSession.access_token}`) return json(freshUser);
        if (u.pathname === "/auth/v1/otp") { sent.otp = req.postDataJSON(); return json({}); }
        if (u.pathname === "/auth/v1/verify") { sent.verify = req.postDataJSON(); return json(SESSION); }
        return route.fallback();
      });
      await page.route((u) => u.origin === API_ORIGIN && u.pathname === "/api/account/link-apple", async (route) => {
        const req = route.request();
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-headers": "content-type, authorization" } });
        sent.link = req.postDataJSON(); sent.auth = req.headers().authorization ?? null;
        return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: true, joined: true }) });
      });
      await page.goto(`${BASE}/3mpire`, { waitUntil: "load" });
      const apple = page.getByRole("button", { name: "Continue with Apple" });
      const shown = await apple.waitFor({ timeout: 8000 }).then(() => true, () => false);
      await page.waitForTimeout(700); await page.evaluate(SETTLE);   // the phone's half in (NativeBridge), as 6b waits
      if (shown) await apple.click();
      const asked = await page.waitForSelector("text=Already a GT3 member?", { timeout: 8000 }).then(() => true, () => false);
      const nonce = (await nativeCalls(page)).find((c) => c.plugin === "GT3Device" && c.method === "signInWithApple")?.options?.nonce ?? null;
      await page.waitForTimeout(500); await page.evaluate(SETTLE);
      const sessionUser = () => page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key) ?? "null")?.user?.id ?? null; } catch { return null; } }, `sb-${BACKEND_HOST.split(".")[0]}-auth-token`);
      if (path === "new") {
        if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "apple--already-member") });
        ok("apple link: a first Apple sign-in asks \"Already a GT3 member?\" right away", asked);
        await page.getByRole("button", { name: "I’m new here" }).first().click().catch(() => {});
        const gone = await page.waitForSelector("text=Already a GT3 member?", { state: "detached", timeout: 5000 }).then(() => true, () => false);
        ok("apple link: \"I'm new here\" keeps the new account — the sheet goes, no code is sent, the phone stays signed in to it",
          gone && sent.otp === null && (await sessionUser()) === APPLE_ID, JSON.stringify({ gone, otp: sent.otp, user: await sessionUser() }));
        ok("apple link: no errors (new here)", errors.length === 0, errors.join(" | "));
        await ctx.close();
        continue;
      }
      await page.getByRole("button", { name: "Link my account" }).first().click().catch(() => {});
      await page.fill("#al-email", "owner@smoke.test").catch(() => {});
      if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "apple--email") });
      await page.getByRole("button", { name: "Email me a code" }).first().click().catch(() => {});
      const codeShown = await page.waitForSelector("#al-code", { timeout: 6000 }).then(() => true, () => false);
      await page.fill("#al-code", "12345678").catch(() => {});
      if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "apple--code") });
      await page.locator("form", { has: page.locator("#al-code") }).getByRole("button", { name: "Link my account" }).click().catch(() => {});
      const linked = await page.waitForSelector("text=Linked.", { timeout: 8000 }).then(() => true, () => false);
      await page.waitForTimeout(300);
      if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "apple--linked") });
      ok("apple link: the email is sent a code for an account that exists — never a new account", codeShown && sent.otp?.email === "owner@smoke.test" && sent.otp?.create_user === false, JSON.stringify(sent.otp));
      ok("apple link: the code signs the phone in to that account (an email code, the one typed)", sent.verify?.type === "email" && sent.verify?.token === "12345678" && (await sessionUser()) === OWNER_ID, JSON.stringify(sent.verify));
      ok("apple link: the join goes to the web's API as the member's own account, with the sign-in's Apple token and its nonce",
        sent.link?.idToken === ANSWERS["GT3Device.signInWithApple"].identityToken && !!nonce && sent.link?.nonce === nonce && sent.auth === `Bearer ${SESSION.access_token}`,
        JSON.stringify({ link: sent.link, nonce, auth: sent.auth ? "set" : null }));
      ok("apple link: and says it is done — Linked", linked);
      ok("apple link: Apple's sheet was asked once — the sign-in's token was still fresh", (await nativeCalls(page)).filter((c) => c.plugin === "GT3Device" && c.method === "signInWithApple").length === 1);
      ok("apple link: no errors (link)", errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
  }

  // ── 6e · Settings & privacy › Link Sign in with Apple, for an account signed in with its email (A3) ──
  {
    const ctx = await phoneContext(MAIN, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    let link = null;
    await page.route((u) => u.origin === API_ORIGIN && u.pathname === "/api/account/link-apple", async (route) => {
      const req = route.request(), cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "POST, OPTIONS" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      link = req.postDataJSON();
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: true, joined: false }) });
    });
    await page.goto(`${BASE}/book`, { waitUntil: "load" });
    await page.waitForTimeout(400); await page.evaluate(SETTLE);
    await page.locator('button.acct-av[aria-label="Your account"]').first().click().catch(() => {});
    const settings = page.getByRole("button", { name: /^Settings & privacy/ }).first();
    if (await settings.waitFor({ timeout: 5000 }).then(() => true, () => false)) await settings.click();
    const row = page.getByRole("button", { name: /^Link Sign in with Apple/ }).first();
    const hasRow = await row.waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "account--settings-apple") });
    if (hasRow) await row.click();
    await page.waitForFunction(() => window.__native?.calls.some((c) => c.plugin === "GT3Device" && c.method === "signInWithApple"), null, { timeout: 5000 }).catch(() => {});
    const told = await page.waitForSelector("text=Sign in with Apple is linked", { timeout: 8000 }).then(() => true, () => false);
    const nonce = (await nativeCalls(page)).find((c) => c.plugin === "GT3Device" && c.method === "signInWithApple")?.options?.nonce ?? null;
    ok("apple link: Settings & privacy offers Link Sign in with Apple to an account signed in with its email", hasRow);
    ok("apple link: it asks Apple's sheet with a fresh nonce and sends that token and nonce to the web's API, then says it is linked",
      !!nonce && /^[0-9a-f]{64}$/.test(nonce) && link?.nonce === nonce && link?.idToken === ANSWERS["GT3Device.signInWithApple"].identityToken && told, JSON.stringify({ link, nonce, told }));
    ok("apple link: no errors (Settings)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── 6f · deleting, said in full (A3): a company's weekly office order under their name, and a membership Square
  // hasn't confirmed cancelled yet — the account is deleted, the crew has the rest, and the person is told ──
  {
    const ctx = await phoneContext(MAIN, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    await deleteCodeStandIn(page);
    await page.route((u) => u.origin === API_ORIGIN && u.pathname === "/api/account/erase", async (route) => {
      const req = route.request(), cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const body = req.method() === "GET" ? { blockers: [], membership: true, office: ["Acme Dental"] } : { ok: true, appleManual: false, membershipPending: true };
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    });
    await page.goto(`${BASE}/book`, { waitUntil: "load" });
    await page.waitForTimeout(400); await page.evaluate(SETTLE);
    await page.locator('button.acct-av[aria-label="Your account"]').first().click().catch(() => {});
    const settings = page.getByRole("button", { name: /^Settings & privacy/ }).first();
    if (await settings.waitFor({ timeout: 5000 }).then(() => true, () => false)) await settings.click();
    const row = page.getByRole("button", { name: /^Delete account/ }).first();
    if (await row.waitFor({ timeout: 5000 }).then(() => true, () => false)) await row.click();
    const office = await page.waitForSelector("text=Acme Dental’s weekly office order is under your name", { timeout: 8000 }).then(() => true, () => false);
    const cancelled = await page.locator("text=Your membership is cancelled too").count();
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "account--delete-office") });
    if (office) await page.getByRole("button", { name: "Delete my account" }).click();
    if (office) await enterDeleteCode(page);
    const pending = await page.waitForSelector("text=still going through with Square", { timeout: 8000 }).then(() => true, () => false);
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "account--delete-pending") });
    ok("delete account: a company's weekly office order under their name is said before the red button, and the membership's cancel", office && cancelled === 1);
    ok("delete account: a membership Square hasn't confirmed cancelled is said after — the account is deleted, the crew has it", pending);
    await page.getByRole("button", { name: "Done" }).first().click().catch(() => {});
    await page.waitForURL((u) => ["/", "/menu"].includes(new URL(u).pathname), { timeout: 8000 }).catch(() => {});
    ok("delete account: Done takes the signed-out phone home", ["/", "/menu"].includes(new URL(page.url()).pathname), page.url());
    ok("delete account: no errors (said in full)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── 6h · TWO-STEP FOR THE OWNERS AND ADMINS (R28, 2026-10-18 — the 10/10 audit, security F6; 0433) ──
  // An owner with an authenticator, on a sign-in that hasn't given its code, opens the console: the code is asked for
  // before the console draws, checked against the account's authenticator (Supabase's challenge, then verify), and the
  // console opens. Then an owner with none sets one up in Settings & privacy: the QR code and the key, the first code,
  // and it is on. Supabase's MFA is stood in: the same owner's sessions with and without the code, its factors, and what
  // each call was asked. R37 (UX11-10): turning it on shows the ten recovery codes first, and a recovery code used from
  // the code screen takes a lost authenticator off — the web's two doors for them stood in.
  {
    const RECOVERY_TEN = ["HKMNP-23456", "QRSTU-34567", "VWXYZ-45678", "ABCDE-56789", "FGHJK-67892", "MNPQR-78923", "STUVW-89234", "XYZAB-92345", "CDEFG-23457", "HJKMN-34568"];
    const FACTOR ={ id: "f0000000-0000-4000-8000-0000000000f1", friendly_name: "GT3", factor_type: "totp", status: "verified", created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" };
    const withFactor = { ...OWNER, factors: [FACTOR] };
    const now = Math.floor(Date.now() / 1000);
    const aal1 = ownerSessionWith({ aal: "aal1", amr: [{ method: "otp", timestamp: now - 3600 }] }, withFactor);
    const aal2 = ownerSessionWith({ aal: "aal2", amr: [{ method: "totp", timestamp: now }, { method: "otp", timestamp: now - 3600 }] }, withFactor);
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
    const mfaStandIn = async (page, user, { enrolled = true } = {}) => {
      const sent = { challenge: 0, verify: null, enroll: null, factorVerified: null };
      let me = user;
      await page.route((u) => u.host === BACKEND_HOST && u.pathname.startsWith("/auth/v1/"), async (route) => {
        const req = route.request(), u = new URL(req.url());
        if (req.method() === "OPTIONS") return route.fallback();
        const json = (body) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
        if (u.pathname === "/auth/v1/user") return json(me);
        if (u.pathname === "/auth/v1/factors" && req.method() === "POST") {
          sent.enroll = req.postDataJSON();
          me = { ...me, factors: [...(me.factors ?? []), { ...FACTOR, id: "f0000000-0000-4000-8000-0000000000f2", status: "unverified" }] };
          return json({ id: "f0000000-0000-4000-8000-0000000000f2", type: "totp", friendly_name: sent.enroll?.friendly_name,
            totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h3v3H0zM5 0h3v3H5zM0 5h3v3H0z"/></svg>', secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/GT3%20Performance%20Bar:owner%40smoke.test?secret=JBSWY3DPEHPK3PXP&issuer=GT3%20Performance%20Bar" } });
        }
        const m = u.pathname.match(/^\/auth\/v1\/factors\/([0-9a-f-]+)\/(challenge|verify)$/);
        if (m && m[2] === "challenge") { sent.challenge++; return json({ id: "c0000000-0000-4000-8000-0000000000c1", type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 }); }
        if (m && m[2] === "verify") {
          sent.verify = { factor: m[1], ...req.postDataJSON() };
          me = { ...me, factors: (me.factors ?? []).map((f) => (f.id === m[1] ? { ...f, status: "verified" } : f)) };
          sent.factorVerified = m[1];
          return json({ ...aal2, user: me });
        }
        return route.fallback();
      });
      void enrolled;
      return sent;
    };

    // 1 — the code, asked as the console opens
    const ctx = await phoneContext(MAIN, { owner: true, session: aal1 });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const sent = await mfaStandIn(page, withFactor);
    await page.goto(`${BASE}/crew?s=day`, { waitUntil: "load" });
    const asked = await page.waitForSelector("#ts-code", { timeout: 8000 }).then(() => true, () => false);
    const drawnFirst = await page.locator("section.screen.admin").count();
    const focused = await page.evaluate(() => document.activeElement?.id ?? null);
    // R29: its title is the theme's ink — dark on the day ground, cream on the night one — never cream on the day ground
    // (R28 drew it so: text with no colour of its own inherited the body's, the night theme's cream).
    const ink = await page.evaluate(() => {
      const h = document.querySelector("section.screen h1.h-title"), app = document.querySelector(".app");
      const rgb = (h ? getComputedStyle(h).color : "").match(/[\d.]+/g)?.map(Number) ?? [];
      return { day: !!app?.classList.contains("crew-day"), luma: rgb.length >= 3 ? Math.round(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) : null };
    });
    ok("two-step: the code's title is the theme's ink — dark on the day ground, light on the night one", ink.luma !== null && (ink.day ? ink.luma < 110 : ink.luma > 150), JSON.stringify(ink));
    if (SHOTS && asked) await page.screenshot({ path: shotPath(MAIN, "two-step--code") }).catch(() => {});
    ok("two-step: an owner with an authenticator, on a sign-in without its code, is asked for it before the console draws — the caret in the field",
      asked && drawnFirst === 0 && focused === "ts-code", JSON.stringify({ asked, drawnFirst, focused }));
    await page.fill("#ts-code", "123456").catch(() => {});
    await page.getByRole("button", { name: "Continue" }).click().catch(() => {});
    const opened = await page.waitForSelector("section.screen.admin", { timeout: 8000 }).then(() => true, () => false);
    const stored = await page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key) ?? "null")?.access_token ?? null; } catch { return null; } }, `sb-${BACKEND_HOST.split(".")[0]}-auth-token`);
    ok("two-step: the code is checked with the account's authenticator — challenged, then verified with the six digits — and the console opens on a sign-in that gave it",
      opened && sent.challenge === 1 && sent.verify?.factor === FACTOR.id && sent.verify?.code === "123456" && stored === aal2.access_token,
      JSON.stringify({ opened, challenge: sent.challenge, verify: sent.verify, stored: stored === aal2.access_token }));
    ok("two-step: no errors (the code)", errors.length === 0, errors.join(" | "));
    await ctx.close();

    // 2 — "Not now": the console with the crew's tools — and the whole app with it: ⌘K and the bar are drawn outside the
    // console (components/AppShell), and an owner's panel the database answers empty would read as an all-clear — and a
    // line that asks again; the code given, the owner's tools are back
    const ctx2 = await phoneContext(MAIN, { owner: true, session: aal1 });
    const page2 = await ctx2.newPage();
    const errors2 = watch(page2);
    await mfaStandIn(page2, withFactor);
    const jumpTo = async () => {
      await page2.evaluate(() => window.dispatchEvent(new Event("gt3-open-cmdk")));
      await page2.waitForSelector("#cmdk-list", { timeout: 5000 }).catch(() => {});
      const offered = await page2.$$eval('#cmdk-list [role="option"] span', (els) => els.map((e) => e.textContent.trim())).catch(() => []);
      await page2.keyboard.press("Escape").catch(() => {});
      await page2.waitForSelector("#cmdk-list", { state: "detached", timeout: 3000 }).catch(() => {});
      return offered;
    };
    await page2.goto(`${BASE}/crew?s=day`, { waitUntil: "load" });
    await page2.waitForSelector("#ts-code", { timeout: 8000 }).catch(() => {});
    await page2.getByRole("button", { name: /^Not now/ }).click().catch(() => {});
    const later = await page2.waitForSelector("section.screen.admin", { timeout: 8000 }).then(() => true, () => false);
    const line = await page2.getByText("The owner and admin tools are waiting for your two-step code.").count();
    const waiting = await jumpTo();
    ok("two-step: while the code waits, the app draws the crew's tools — ⌘K offers My Day, and no Money, Catalog, Customers or Team (each would read empty)",
      waiting.includes("My Day") && !["Money", "Catalog", "Customers", "Team"].some((s) => waiting.includes(s)), JSON.stringify(waiting));
    await page2.getByRole("button", { name: "Enter it" }).click().catch(() => {});
    const again = await page2.waitForSelector("#ts-code", { timeout: 5000 }).then(() => true, () => false);
    ok("two-step: Not now opens the console with a line that asks again, and Enter it asks again", later && line === 1 && again, JSON.stringify({ later, line, again }));
    await page2.fill("#ts-code", "123456").catch(() => {});
    await page2.getByRole("button", { name: "Continue" }).click().catch(() => {});
    await page2.waitForSelector("section.screen.admin", { timeout: 8000 }).catch(() => {});
    const given = await jumpTo();
    ok("two-step: …and once it is given, Money and the owner's tools are offered again", given.includes("Money") && given.includes("Team"), JSON.stringify(given));
    ok("two-step: no errors (Not now)", errors2.length === 0, errors2.join(" | "));
    await ctx2.close();

    // 3 — setting one up, in Settings & privacy
    const plain = ownerSessionWith({ aal: "aal1", amr: [{ method: "otp", timestamp: now - 60 }] }, OWNER);
    const ctx3 = await phoneContext(MAIN, { owner: true, session: plain });
    const page3 = await ctx3.newPage();
    await insetsOn(page3, MAIN.top, MAIN.bottom);
    const errors3 = watch(page3);
    const sent3 = await mfaStandIn(page3, OWNER, { enrolled: false });
    // R37: the web's door for recovery codes, stood in — none yet (GET), then the ten made as it turns on (POST).
    const codesAsked = [];
    await page3.route((u) => u.origin === API_ORIGIN && u.pathname === "/api/two-step/codes", async (route) => {
      const req = route.request();
      const cors = { "access-control-allow-origin": req.headers().origin || "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS", vary: "Origin" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      codesAsked.push({ method: req.method(), bearer: /^Bearer \S+/.test(req.headers().authorization ?? "") });
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify(req.method() === "POST" ? { ok: true, codes: RECOVERY_TEN } : { ok: true, left: 0 }) });
    });
    await page3.goto(`${BASE}/book`, { waitUntil: "load" });
    await page3.waitForTimeout(400); await page3.evaluate(SETTLE);
    await page3.locator('button.acct-av[aria-label="Your account"]').first().click().catch(() => {});
    const settings3 = page3.getByRole("button", { name: /^Settings & privacy/ }).first();
    if (await settings3.waitFor({ timeout: 5000 }).then(() => true, () => false)) await settings3.click();
    const row = page3.getByRole("button", { name: /^Two-step sign-in/ }).first();
    const hasRow = await row.waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (hasRow) await row.click();
    const off = await page3.waitForSelector("text=Two-step sign-in is off.", { timeout: 8000 }).then(() => true, () => false);
    await page3.getByRole("button", { name: "Set up two-step sign-in" }).click().catch(() => {});
    const qr = await page3.waitForSelector('img[alt="A QR code for your authenticator app"]', { timeout: 8000 }).then(() => true, () => false);
    const key = await page3.getByText("JBSW Y3DP EHPK 3PXP").count();
    const link = await page3.locator('a[href^="otpauth://"]').count();
    if (SHOTS && qr) await page3.screenshot({ path: shotPath(MAIN, "two-step--setup") }).catch(() => {});
    await page3.fill("#ts-code", "654321").catch(() => {});
    await page3.getByRole("button", { name: "Turn it on" }).click().catch(() => {});
    // R37: the ten shown once, before it says it's on — a list with a name, on the phone's own width.
    const codesShown = await page3.waitForSelector("text=Your recovery codes.", { timeout: 8000 }).then(() => true, () => false);
    const listed = await page3.locator('ol[aria-label="Your ten recovery codes"] li').allTextContents().catch(() => []);
    const sideways = await page3.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (SHOTS && codesShown) await page3.screenshot({ path: shotPath(MAIN, "two-step--codes") }).catch(() => {});
    ok("two-step (R37): turned on, its ten recovery codes are shown once — made on the sign-in that just gave the code, a named list, no sideways scroll",
      codesShown && listed.join() === RECOVERY_TEN.join() && codesAsked.filter((c) => c.method === "POST" && c.bearer).length === 1 && !sideways,
      JSON.stringify({ codesShown, listed: listed.length, codesAsked, sideways }));
    await page3.getByRole("button", { name: /saved them/ }).click().catch(() => {});
    const on = await page3.waitForSelector("text=Two-step sign-in is on.", { timeout: 8000 }).then(() => true, () => false);
    const tenLeft = await page3.getByText("10 of 10 left — each works once").count();
    if (SHOTS && on) await page3.screenshot({ path: shotPath(MAIN, "two-step--on") }).catch(() => {});
    ok("two-step (R37): …I've saved them, and Settings says it's on, with ten of ten codes left", on && tenLeft === 1, JSON.stringify({ on, tenLeft }));
    ok("two-step: Settings & privacy has it for an owner — off, then set up: the QR code, the key in fours, and the iPhone's own link to an authenticator",
      hasRow && off && qr && key === 1 && link === 1 && sent3.enroll?.factor_type === "totp" && sent3.enroll?.issuer === "GT3 Performance Bar",
      JSON.stringify({ hasRow, off, qr, key, link, enroll: sent3.enroll }));
    ok("two-step: its first code turns it on — that authenticator, those digits — and it says so",
      on && sent3.verify?.factor === "f0000000-0000-4000-8000-0000000000f2" && sent3.verify?.code === "654321", JSON.stringify({ on, verify: sent3.verify }));
    ok("two-step: no errors (setting it up)", errors3.length === 0, errors3.join(" | "));
    await ctx3.close();

    // 4 — the authenticator lost: a recovery code from the code screen (R37 — the fresh audit's UX11-10; 0438). Used on a
    // sign-in from just now, it takes the authenticator off — the web's door, stood in — and the app says so and asks
    // them to sign in again, never opening a console whose session Supabase has just ended.
    const justNow = ownerSessionWith({ aal: "aal1", amr: [{ method: "otp", timestamp: now - 60 }] }, withFactor);
    const ctx4 = await phoneContext(MAIN, { owner: true, session: justNow });
    const page4 = await ctx4.newPage();
    await insetsOn(page4, MAIN.top, MAIN.bottom);
    const errors4 = watch(page4);
    await mfaStandIn(page4, withFactor);
    const recoverSent = [];
    await page4.route((u) => u.origin === API_ORIGIN && u.pathname === "/api/two-step/recover", async (route) => {
      const req = route.request();
      const cors = { "access-control-allow-origin": req.headers().origin || "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS", vary: "Origin" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      recoverSent.push({ ...(req.postDataJSON() ?? {}), bearer: /^Bearer \S+/.test(req.headers().authorization ?? "") });
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ ok: true, removed: 1, left: 9 }) });
    });
    await page4.goto(`${BASE}/crew?s=day`, { waitUntil: "load" });
    await page4.waitForSelector("#ts-code", { timeout: 8000 }).catch(() => {});
    await page4.getByRole("button", { name: "Use a recovery code" }).click().catch(() => {});
    const recoverField = await page4.waitForSelector("#ts-recovery", { timeout: 5000 }).then(() => true, () => false);
    const recoverFocused = await page4.evaluate(() => document.activeElement?.id ?? null);
    if (SHOTS && recoverField) await page4.screenshot({ path: shotPath(MAIN, "two-step--recover") }).catch(() => {});
    await page4.fill("#ts-recovery", "hkmnp 23456").catch(() => {});
    await page4.getByRole("button", { name: "Use this code" }).click().catch(() => {});
    const offSaid = await page4.waitForSelector("text=Your authenticator is off your account.", { timeout: 8000 }).then(() => true, () => false);
    const offFocused = await page4.evaluate(() => document.activeElement?.textContent ?? null);
    const consoleDrawn = await page4.locator("section.screen.admin").count();
    if (SHOTS && offSaid) await page4.screenshot({ path: shotPath(MAIN, "two-step--recovered") }).catch(() => {});
    ok("two-step (R37): lost the authenticator — Use a recovery code, on the code screen: its own field, focused; the code sent as typed, with the sign-in's bearer, to the web's API",
      recoverField && recoverFocused === "ts-recovery" && recoverSent.length === 1 && recoverSent[0].code === "hkmnp 23456" && recoverSent[0].bearer,
      JSON.stringify({ recoverField, recoverFocused, recoverSent }));
    ok("two-step (R37): …used: the authenticator is off — said, its line focused — and never the console, whose session is ended",
      offSaid && offFocused === "Your authenticator is off your account." && consoleDrawn === 0, JSON.stringify({ offSaid, offFocused, consoleDrawn }));
    ok("two-step: no errors (a recovery code)", errors4.length === 0, errors4.join(" | "));
    await ctx4.close();
  }

  // ── 6g · MONEY ANSWERS THREE QUESTIONS (2026-10-15, release 3 of the Plan & Money audit; Ryan: "Yes, build it", "Yes,
  // all seven") ──
  // The owner opens Money with a paid shop order waiting on us for eleven days, a chargeback with four days to answer, an
  // office invoice six days late, a refund Square made that the app never recorded, and ingredients over budget. On the
  // iPhone 17 and the SE, Needs attention starts on the first screen — the waiting order was the last panel, 2,618
  // points down — its rows worst first with the level said in words; the waiting order's row opens the shop's queue,
  // which is the Catalog's now. And a link to a panel that moved, opened as a page (a push, a crew member's "Draft their
  // offer letter", a bookmark), lands on its new home rather than looking for it where it was.
  {
    const now = Date.now(), at = (d) => new Date(now + d * 864e5).toISOString();
    const etDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(now + d * 864e5));
    const seed = {
      rpc: {
        report_sales: { days: 7, revenue_cents: 482500, order_count: 74, cogs_pct: 0.31, by_channel: { square_walkup: 182000, cup: 141500, packs: 96000, delivery: 21000, office: 42000 }, cogs_basis: { products: 11, costed: 8, assumed: false }, by_product: [], by_event: [], by_day: [] },
        report_events: [],
        report_spend: { month: `${etDay(0).slice(0, 8)}01`, total_spent_cents: 61200, total_budget_cents: 50000, by_category: [{ category: "ingredients", budget_cents: 50000, spent_cents: 61200 }] },
      },
      v_shop_orders: [{ id: "so-1", created_at: at(-11), status: "paid", who: "Maya T.", total_cents: 6400, items: "1 tee, 1 cap", waiting_on_us: true, waiting_on_printer: false, waiting_on_carrier: false, closed: false, age_hours: 264 }],
      v_shop_queue: [{ orders: 1, on_us: 1, on_printer: 0, on_carrier: 0, closed: 0, gross_cents: 6400, refunded_cents: 0, oldest_on_us_hours: 264 }],
      square_disputes: [{ id: "dp-1", amount_cents: 3800, state: "EVIDENCE_REQUIRED", due_at: at(4), reason: "PRODUCT_NOT_RECEIVED", shop_orders: { ship_name: "Devon P.", email: null } }],
      invoices: [{ id: "inv-1", amount_cents: 42000, due_at: etDay(-6), status: "open", terms: "net15", business_accounts: { company: "Northside Dental" } }],
      v_shop_money_drift: [{ order_id: "so-2", who: "Sam K.", gap_cents: 2200, open_disputes: 0, verdict: "Square refunded more than this app has recorded." }],
      spend_categories: [{ slug: "ingredients", label: "Ingredients", sort: 1, active: true, receipt_required_over_cents: 2500 }],
    };
    for (const phone of [MAIN, PHONES[0]]) {
      const ctx = await phoneContext(phone, { owner: true, seed });
      const page = await ctx.newPage();
      await insetsOn(page, phone.top, phone.bottom);
      const errors = watch(page);
      await page.goto(`${BASE}/crew?s=money`, { waitUntil: "load" });
      await page.waitForFunction(BRIDGE_UP, null, { timeout: 8000 }).catch(() => {});
      await page.waitForSelector("#money-attention .owed-row", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400); await page.evaluate(SETTLE);
      const a = await page.evaluate(() => {
        const sec = document.getElementById("money-attention"), perf = document.getElementById("home-numbers");
        const rows = [...(sec?.querySelectorAll(".owed-row") ?? [])].map((r) => ({ t: (r.querySelector("b")?.textContent ?? "").trim(), i: (r.querySelector("i")?.textContent ?? "").trim(), late: r.classList.contains("late") }));
        const head = (sec?.querySelector(".k-sec-r")?.textContent ?? "").replace(/\s+/g, " ").trim();
        return { top: sec ? Math.round(sec.getBoundingClientRect().top) : null, perf: perf ? Math.round(perf.getBoundingClientRect().top) : null, rows, head, h: innerHeight,
          owed: [...(perf?.querySelectorAll(".owed-row b") ?? [])].map((b) => (b.textContent ?? "").trim()) };
      });
      if (SHOTS) await page.screenshot({ path: shotPath(phone, "money--first-screen") });
      const seen = JSON.stringify(a);
      ok(`${phone.name} money: Needs attention starts on the first screen, under Performance`, a.top !== null && a.perf !== null && a.perf < a.top && a.top < a.h - phone.bottom - 120, seen);
      ok(`${phone.name} money: Performance says what is owed to us`, a.owed.includes("Owed to you"), seen);
      ok(`${phone.name} money: worst first, each row's level said in words before the problem — the order waiting 11 days is critical, the chargeback and the late invoice urgent, the refund and the budget to do`,
        a.rows.length === 5
          && a.rows[0].t === "A shop order is waiting on us" && /^Critical · Maya T\. paid \$64 for 1 tee, 1 cap$/.test(a.rows[0].i) && a.rows[0].late
          && /^Chargeback · \$38 · Devon P\.$/.test(a.rows[1].t) && /^Urgent · /.test(a.rows[1].i)
          && a.rows[2].t === "Northside Dental · $420" && a.rows[2].i === "Urgent · invoice past its date"
          && a.rows[3].t === "Refund in Square, not recorded here" && /^Action required · Sam K\./.test(a.rows[3].i) && !a.rows[3].late
          && a.rows[4].t === "Ingredients over budget" && a.rows[4].i === "Action required · $612 of $500 this month"
          && a.head === "1 critical2 urgent2 to do", seen);
      if (phone === MAIN) {
        await page.locator("#money-attention .owed-row", { hasText: "A shop order is waiting on us" }).first().click();
        await page.waitForSelector("#shoporders.open", { timeout: 8000 }).catch(() => {});
        const w = await page.evaluate(() => ({ s: new URLSearchParams(location.search).get("s"), open: !!document.querySelector("#shoporders.open") }));
        ok("money: the waiting order's row opens the shop's queue — in the Catalog now, open", w.s === "catalog" && w.open, JSON.stringify(w));
      }
      ok(`${phone.name} money: no errors`, errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
    {
      const ctx = await phoneContext(MAIN, { owner: true });
      const page = await ctx.newPage();
      await insetsOn(page, MAIN.top, MAIN.bottom);
      const errors = watch(page);
      await page.goto(`${BASE}/crew?s=money&a=offers`, { waitUntil: "load" });
      await page.waitForFunction(BRIDGE_UP, null, { timeout: 8000 }).catch(() => {});
      await page.waitForSelector("#offers.open", { timeout: 8000 }).catch(() => {});
      const w = await page.evaluate(() => ({ s: new URLSearchParams(location.search).get("s"), open: !!document.querySelector("#offers.open") }));
      ok("money: an old link to a panel that moved, opened as a page (/crew?s=money&a=offers), lands on its new home — Team's offer letters, open", w.s === "team" && w.open, JSON.stringify(w));
      ok("money: no errors (an old link)", errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
  }

  // ── 6c · Alerts in the app (2026-10-11) ──
  // The smoke build has alerts live (scripts/build.app.mjs SMOKE_FLAGS). Settings › Notifications as the owner: Turn on
  // asks iOS (answered yes), registers the phone, and the token Apple gives it (fired here as the registration event)
  // is handed to the database to keep for whoever is signed in (0367 keep_app_push_token); the row then says On. A tapped alert carrying /admin?s=money opens the
  // console's Money — the old address read as the new one.
  {
    const ctx = await phoneContext(MAIN, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const kept = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.host === BACKEND_HOST && u.pathname === "/rest/v1/rpc/keep_app_push_token" && r.method() === "POST") { try { kept.push(r.postDataJSON()); } catch { kept.push({ unreadable: true }); } }
    });
    await page.goto(`${BASE}/crew?s=settings&a=set-notify`, { waitUntil: "load" });
    const turnOn = page.locator("#set-alerts").getByRole("button", { name: "Turn on" });
    const offered = await turnOn.waitFor({ timeout: 8000 }).then(() => true, () => false);
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "alerts--off") });
    if (offered) await turnOn.click();
    await page.waitForFunction(() => window.__native?.calls.some((c) => c.plugin === "PushNotifications" && c.method === "register"), null, { timeout: 5000 }).catch(() => {});
    const TOKEN = "ab".repeat(32);
    await page.evaluate((t) => {
      for (const id of window.__native.listeners["PushNotifications.registration"] ?? []) window.Capacitor.fromNative({ callbackId: id, pluginId: "PushNotifications", methodName: "addListener", success: true, save: true, data: { value: t } });
    }, TOKEN);
    await page.waitForTimeout(900);
    const row = await page.evaluate(() => (document.getElementById("set-alerts")?.innerText || "").replace(/\s+/g, " "));
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "alerts--on") });
    const calls = await nativeCalls(page);
    const one = kept.find((k) => typeof k?.p_token === "string") ?? null;
    ok("alerts: in the app, Settings offers Turn on, which asks iOS and registers the phone",
      offered && calls.some((c) => c.plugin === "PushNotifications" && c.method === "requestPermissions") && calls.some((c) => c.plugin === "PushNotifications" && c.method === "register"));
    ok("alerts: the token Apple gives the phone is handed to the database to keep — never written by the page", one?.p_token === TOKEN && !kept.some((k) => "user_id" in (k ?? {})), JSON.stringify(kept));
    ok("alerts: the row says On", /\bOn\b/.test(row), row);
    await page.evaluate(() => {
      for (const id of window.__native.listeners["PushNotifications.pushNotificationActionPerformed"] ?? []) window.Capacitor.fromNative({ callbackId: id, pluginId: "PushNotifications", methodName: "addListener", success: true, save: true, data: { actionId: "tap", notification: { data: { url: "/admin?s=money" } } } });
    });
    await page.waitForURL(/\/crew\?s=money/, { timeout: 6000 }).catch(() => {});
    ok("alerts: a tapped alert opens the screen it is about — /admin read as /crew", /\/crew\?s=money/.test(page.url()), page.url());
    ok("alerts: no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── 7 · what the phone does for a page: save, share, print, add to the calendar ──
  // The buttons the web answers with a browser trick (lib/deviceActions says which, and why a web view
  // performs none of them), pressed in the app: the phone's own sheet must be asked for, with the right
  // things in it, and the page must stay where it is. Then the same buttons in a plain browser, where
  // there is no phone: the web's own ways, as the web build has them.
  {
    const soon = new Date(Date.now() + 3 * 86400000);
    const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
    const seed = {
      field_ops: [{
        id: "5a10e000-0000-4000-8000-0000000000e1", kind: "event", name: "Night Run", public_title: null, day, starts_at: null, ends_at: null,
        start_time: "6:30pm", end_time: "8pm", day_label: null, when_label: null, time_label: null, location_text: "Falls Park, Greenville SC",
        address: null, lat: null, lng: null, member_only: false, going_count: 0, capacity: null, blurb: "A 5k loop, then cold brew.", menu_tier: null,
        notes: null, note: null, status: "scheduled", completed_at: null, archived_at: null, is_public: true, published_at: "2026-10-01T12:00:00Z", market: "greenville",
      }],
      client_errors: [{
        id: "5a10e000-0000-4000-8000-0000000000e2", message: "TypeError: the smoke's own error", stack: "at smoke (smoke.js:1:1)", url: "https://app.gt3pb.com/menu",
        ua: "Mozilla/5.0", fatal: false, skew: false, count: 3, first_seen: "2026-10-01T12:00:00Z", last_seen: "2026-10-05T12:00:00Z",
      }],
      v_offer_letter: [{
        id: "5a10e000-0000-4000-8000-0000000000e3", status: "sent", market: "greenville", market_label: "Greenville", candidate_name: "Riley Smoke",
        candidate_email: "riley@smoke.test", title: "Bar lead", role: "server", employment_type: "employee", base_cents: 1800, rate_per: "hour",
        commission_pct: null, starts_on: "2026-11-02", reports_to: null, package: [], notes: null, normal_hours: "20 to 30 hours a week",
        pay_schedule: "Every two weeks", pay_method: "Direct deposit", deductions: "Taxes, as the law requires",
        offer_disclaimer: "THIS IS THE SMOKE'S OWN DISCLAIMER, NOT A REAL ONE.", disclaimer_missing: false,
        expires_on: "2026-12-01", sent_at: "2026-10-05T12:00:00Z", responded_at: null, created_at: "2026-10-05T12:00:00Z",
      }],
    };
    const KEPT = ANSWERS["GT3Device.keepFile"].uri;
    const decoded = (b64) => Buffer.from(b64 ?? "", "base64");
    const sameDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

    // In the app.
    {
      const ctx = await phoneContext(MAIN, { owner: true, seed });
      const page = await ctx.newPage();
      await insetsOn(page, MAIN.top, MAIN.bottom);
      const errors = watch(page);
      const settle = async () => { await page.waitForTimeout(400); await page.evaluate(SETTLE); await page.waitForFunction(BRIDGE_UP, null, { timeout: 8000 }).catch(() => {}); };
      // What the page asked of the phone while `fn` ran (the haptic engine aside).
      const asked = async (fn, wait = 1200) => {
        const n = (await nativeCalls(page)).length;
        await fn();
        await page.waitForTimeout(wait);
        return (await nativeCalls(page)).slice(n).filter((c) => c.plugin !== "Haptics" && c.plugin !== "SystemBars");
      };
      const said = (got) => JSON.stringify(got.map((c) => `${c.plugin}.${c.method}`));

      // a CSV export (the error log's, in Settings)
      await page.goto(`${BASE}/crew?s=settings`, { waitUntil: "load" }); await settle();
      const health = page.locator("#set-errors .mpanel-h");
      if (!(await health.count())) ok("device: Settings › App health is there to export from", false, "no #set-errors on /crew?s=settings");
      else {
        await health.click();
        const exportCsv = page.locator("#set-errors button", { hasText: "Export CSV" });
        await exportCsv.waitFor({ timeout: 8000 }).catch(() => {});
        const here = page.url();
        const got = await asked(() => exportCsv.click());
        const keep = got.find((c) => c.plugin === "GT3Device" && c.method === "keepFile");
        const sheet = got.find((c) => c.plugin === "Share" && c.method === "share");
        const csv = decoded(keep?.options.data).toString("utf8");
        ok("device: Export CSV keeps the very file the screen shows", keep?.options.name === "gt3-errors.csv"
          && csv.startsWith("﻿kind,message,where,count,first_seen,last_seen,frame,ua\r\n") && csv.includes("Error,TypeError: the smoke's own error,/menu,3,"),
          `${JSON.stringify(keep?.options.name)} ${JSON.stringify(csv.slice(0, 120))}`);
        ok("device: …and hands it to the share sheet (Save to Files, Mail, AirDrop), the page staying put",
          sheet?.options.files?.[0] === KEPT && got.indexOf(keep) < got.indexOf(sheet) && page.url() === here, `${said(got)}; page now ${page.url()}`);
      }

      // the invite link
      await page.goto(`${BASE}/3mpire`, { waitUntil: "load" }); await settle();
      const invite = page.locator(".referral button.btn-pri");
      await invite.waitFor({ timeout: 8000 }).catch(() => {});
      if (!(await invite.count())) ok("device: /3mpire has the invite link's Share", false, "no Share in .referral");
      else {
        const got = await asked(() => invite.click());
        const sheet = got.find((c) => c.plugin === "Share" && c.method === "share");
        ok("device: Share (the invite link) opens the share sheet with the web's address — never the phone's own",
          got.length === 1 && sheet?.options.url === `${API_ORIGIN}/?ref=${PROFILE.referral_code}` && new RegExp(`use code ${PROFILE.referral_code}`).test(sheet.options.text ?? ""), JSON.stringify(got));
      }

      // the status card
      const avatar = page.locator('button.acct-av[aria-label="Your account"]').first();
      if (!(await avatar.count())) ok("device: the account menu is there to open the member card from", false, "no account avatar on /3mpire");
      else {
        await avatar.click();
        // Show card opens the scannable card; the status card — photo and finish — is its "Show off your status" (A2).
        const cardTile = page.locator("button", { hasText: "Show card" }).first();
        await cardTile.waitFor({ timeout: 5000 }).catch(() => {});
        await cardTile.click().catch(() => {});
        const flex = page.locator(".sheet2 .mp-flex").first();
        await flex.waitFor({ timeout: 5000 }).catch(() => {});
        await flex.click().catch(() => {});
        const shareCard = page.locator(".status-lux button.btn-pri");
        const ready = await page.waitForFunction(() => { const b = document.querySelector(".status-lux button.btn-pri"); return !!b && !b.disabled; }, null, { timeout: 15000 }).then(() => true, () => false);
        ok("device: the member card draws, and its Share is ready", ready);
        if (ready) {
          const got = await asked(() => shareCard.click(), 2500);
          const keep = got.find((c) => c.plugin === "GT3Device" && c.method === "keepFile");
          const sheet = got.find((c) => c.plugin === "Share" && c.method === "share");
          const png = decoded(keep?.options.data);
          ok("device: Share your status hands the card's picture to the share sheet, with its words beside it",
            keep?.options.name === "gt3-status.png" && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && png.length > 10000
            && sheet?.options.files?.[0] === KEPT && /^I'm a GT3 /.test(sheet.options.text ?? "") && got.filter((c) => c.plugin === "Share").length === 1,
            `${said(got)}; ${png.length} bytes`);
        }
        await page.keyboard.press("Escape").catch(() => {});
      }

      // Add to calendar, on an event on Find Us
      await page.goto(`${BASE}/truck`, { waitUntil: "load" }); await settle();
      const eventRow = page.locator('[aria-label="Night Run — details"]').first();
      await eventRow.waitFor({ timeout: 8000 }).catch(() => {});
      if (!(await eventRow.count())) ok("device: Find Us shows the seeded event", false, "no Night Run row on /truck");
      else {
        await eventRow.click();
        await page.locator(".atc > button").first().click();
        const item = page.locator(".atc-menu .atc-item").first();
        const label = (await item.textContent())?.trim() ?? "";
        const got = await asked(() => item.click());
        const ev = got.find((c) => c.plugin === "GT3Device" && c.method === "addEvent")?.options;
        ok("device: Add to calendar offers the phone's own calendar first", label === "Calendar on this iPhone", label);
        ok("device: …and opens its New Event sheet, filled in — the day, 6:30 to 8, the place and the words",
          ev?.title === "Night Run" && ev.allDay === false && sameDay(ev.start) === day && new Date(ev.start).getHours() === 18 && new Date(ev.start).getMinutes() === 30
          && ev.end - ev.start === 90 * 60000 && ev.location === "Falls Park, Greenville SC" && ev.notes === "A 5k loop, then cold brew.", JSON.stringify(ev ?? null));
        ok("device: …with no file made instead", got.length === 1, said(got));
      }

      // Print, on an offer letter
      await page.goto(`${BASE}/offer`, { waitUntil: "load" }); await settle();
      const letter = page.locator("button.cp-go").first();
      await letter.waitFor({ timeout: 8000 }).catch(() => {});
      if (!(await letter.count())) ok("device: /offer shows the seeded offer", false, "no button.cp-go on /offer");
      else {
        await letter.click();
        const print = page.locator(".ofl-bar button", { hasText: "Print / Save PDF" });
        await print.waitFor({ timeout: 5000 }).catch(() => {});
        const got = await asked(() => print.click());
        const printing = await page.evaluate(() => document.body.classList.contains("printing-offer"));
        ok("device: Print opens the phone's print panel, on the letter alone (its print styles on)",
          got.length === 1 && got[0].plugin === "GT3Device" && got[0].method === "printPage" && got[0].options.name === "Offer letter — Riley Smoke" && printing, said(got));
        await page.locator(".ofl-bar button", { hasText: "Close" }).click().catch(() => {});
      }

      // a link that saves a file: a post's photo
      await page.goto(`${BASE}/menu`, { waitUntil: "load" }); await settle();
      const here = page.url();
      const photo = "https://media.example.com/post/IMG_0042.jpg";
      const got = await asked(() => page.evaluate((href) => {
        const a = Object.assign(document.createElement("a"), { href, textContent: "Photo 1" });
        a.setAttribute("download", "");
        document.querySelector("main").appendChild(a); a.click(); a.remove();
      }, photo));
      const keep = got.find((c) => c.plugin === "GT3Device" && c.method === "keepFile");
      const sheet = got.find((c) => c.plugin === "Share" && c.method === "share");
      ok("device: a link that saves a file has the phone fetch it and hands it to the share sheet — not the in-app browser, not nowhere",
        keep?.options.url === photo && keep.options.name === "IMG_0042.jpg" && !("data" in keep.options) && sheet?.options.files?.[0] === KEPT
        && !got.some((c) => c.plugin === "Browser") && page.url() === here, `${said(got)}; page now ${page.url()}`);

      ok("device: no errors", errors.length === 0, errors.join(" | "));
      await ctx.close();
    }

    // In a plain browser: no phone, so the web's own ways — the files download, as on the web.
    {
      const ctx = await phoneContext(MAIN, { owner: true, seed, shell: false });
      const page = await ctx.newPage();
      const errors = watch(page);
      const settle = async () => { await page.waitForTimeout(400); await page.evaluate(SETTLE); await page.waitForFunction(BRIDGE_UP, null, { timeout: 8000 }).catch(() => {}); };
      const download = async (fn) => {
        const got = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
        await fn();
        const d = await got;
        if (!d) return null;
        const path = await d.path().catch(() => null);
        return { name: d.suggestedFilename(), text: path ? readFileSync(path, "utf8") : "" };
      };
      await page.goto(`${BASE}/crew?s=settings`, { waitUntil: "load" }); await settle();
      await page.locator("#set-errors .mpanel-h").click().catch(() => {});
      const exportCsv = page.locator("#set-errors button", { hasText: "Export CSV" });
      await exportCsv.waitFor({ timeout: 8000 }).catch(() => {});
      const csv = await download(() => exportCsv.click());
      ok("device, no phone: Export CSV downloads the file, as on the web",
        csv?.name === "gt3-errors.csv" && csv.text.startsWith("﻿kind,message,where,count,first_seen,last_seen,frame,ua\r\n"), JSON.stringify(csv && { name: csv.name, text: csv.text.slice(0, 60) }));
      await page.goto(`${BASE}/truck`, { waitUntil: "load" }); await settle();
      await page.locator('[aria-label="Night Run — details"]').first().click().catch(() => {});
      await page.locator(".atc > button").first().click().catch(() => {});
      const ics = await download(() => page.locator(".atc-menu .atc-item").first().click());
      ok("device, no phone: Add to calendar downloads the .ics, as on the web",
        ics?.name === "night-run.ics" && /^BEGIN:VCALENDAR\r\n/.test(ics.text) && /SUMMARY:Night Run\r\n/.test(ics.text) && /LOCATION:Falls Park\\, Greenville SC\r\n/.test(ics.text),
        JSON.stringify(ics && { name: ics.name, text: ics.text.slice(0, 80) }));
      ok("device, no phone: no errors", errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
  }

  // ── 8 · the crew header and the lane's sections, one kit (2026-10-07, the pill round) ──
  // Signed in as the owner on My Day, at the standard text size and the largest (lib/textSize: Largest
  // is a 1.26 zoom of the page, and the row may wrap there — each line must still be one line of centres).
  for (const scale of [0, 3]) {
    const ctx = await phoneContext(MAIN, { owner: true });
    if (scale) await ctx.addInitScript((v) => { try { localStorage.setItem("gt3-display", JSON.stringify({ scale: v, bold: false, roomy: false })); } catch { /* refused */ } }, scale);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const at = scale ? "at the largest text size" : "at the standard text size";
    await page.goto(`${BASE}/crew?s=day`, { waitUntil: "load" });
    await page.waitForSelector(".toprow .k-icon-btn", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500); await page.evaluate(SETTLE);
    const r = await page.evaluate(headerReport);
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, `crew-header${scale ? "--largest" : ""}`), clip: { x: 0, y: 0, width: MAIN.width, height: 260 } });
    ok(`header ${at}: it is there`, !r.missing);
    ok(`header ${at}: every control in the row is the kit's — round buttons and a segmented switch, nothing else`, !r.missing && r.foreign.length === 0, r.foreign?.join(", "));
    ok(`header ${at}: the Crew/Customer switch is More's, not the header's (2026-10-09, the navigation round)`, r.mode === null, r.mode);
    ok(`header ${at}: the row's controls share one line of centres (within 1px)${scale ? " — on each line, if the row wraps" : ", on one line"}`,
      !r.missing && r.offCentre.length === 0 && (scale || r.lines === 1), JSON.stringify({ offCentre: r.offCentre, lines: r.lines }));
    ok(`header ${at}: two heights in the row and no others — the round buttons and the switch's track`, !r.missing && new Set(r.heights).size <= 2, r.heights?.join(" "));
    ok(`header ${at}: 44px to the thumb on every control in it and every section in the lane`, !r.missing && r.small.length === 0, r.small?.join(" | "));
    ok(`header ${at}: the words sit in the middle of every segment (within 1.5px)`, !r.missing && r.offText.length === 0, r.offText?.join(", "));
    ok(`header ${at}: the lane's thumb is under the section you are in`, r.thumb?.ok && r.thumb.on === "My Day", r.thumb?.why);
    ok(`header ${at}: the inbox's count rides on it, ringed`, r.badge === null || (r.badge.h === 18 && r.badge.ring), JSON.stringify(r.badge));
    ok(`header ${at}: nothing in it reaches past the phone's edges`, !r.missing && r.wide.length === 0, r.wide?.join(", "));
    ok(`header ${at}: every icon is the kit's size — half its round button`, !r.missing && r.icons.length === 0, r.icons?.join(" "));
    if (!scale) {
      // a tap on another section: the thumb follows, and the section is the one tapped
      await page.locator(".lane-tabs .k-seg-opt", { hasText: "Live Ops" }).first().click().catch(() => {});
      await page.waitForTimeout(700); await page.evaluate(SETTLE);
      const moved = await page.evaluate(headerReport);
      const where = await page.evaluate(() => new URL(location.href).searchParams.get("s"));
      ok("header: a tap on Live Ops takes you there, and the thumb slides under it", moved.thumb?.ok && moved.thumb.on === "Live Ops" && where === "now", JSON.stringify({ thumb: moved.thumb, s: where }));
    }
    ok(`header ${at}: no errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  await browser.close();
  srv.server.close();

  // ── the verdict ──
  const callsOut = [...new Set(apiCalls.map((c) => `${c.method} ${new URL(c.url).pathname}`))];
  console.log(`  API calls, all to ${API_ORIGIN}: ${callsOut.length ? callsOut.join(", ") : "none on these screens"}`);
  if (writes.length) console.log(`  writes the screens made on their own, to the stand-in: ${[...new Set(writes)].join(", ")}`);
  if (outside.size) console.log(`  other hosts the screens reached for (held back here; the app's policy allows them): ${[...outside].join(", ")}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`NATIVE SMOKE: ${pass} passed, ${fail} failed${SHOTS ? ` — pictures in ${SHOTS}` : ""}`);
  process.exit(fail ? 1 : 0);
}
