// THE IPHONE APP, OPENED THE WAY A PHONE OPENS IT (2026-10-06, the iPhone round).
//
//   npm run build:app -- --smoke && npm run smoke:native     (`npm run verify` runs both, last)
//   node scripts/smoke.native.mjs --shots <dir>              (and keeps a picture of every screen)
//
// out/ is the app's copy of the screens (scripts/build.app.mjs): what `npx cap sync ios` puts inside the
// iPhone app. This opens it on three iPhones, with the phone's side of Capacitor stood in for: every
// page as a guest, every crew section as a signed-in owner (in the crew's Day look on two phones and
// the dark look on the third), a customer's sheet, the crew's first-run guide. It holds the app to what
// a native app owes the person holding it:
//
//   1. IT FITS EVERY PHONE. No sideways scroll at 375, 402 or 440 points wide, and nothing a person
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
  "Share.share": { activityType: "com.apple.UIKit.activity.SaveToCameraRoll" },
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
const PROFILE = { id: OWNER_ID, display_name: "Smoke Owner", role: "owner", is_admin: true, market: "greenville", leads_market: "greenville", title: null, referred_by: null, created_at: "2026-01-01T00:00:00Z", points: 0, credit_cents: 0, tenant_id: TENANT_ID };
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

// `seed` gives a table rows of its own (block 7 needs an event, an error and an offer letter on screen);
// every other table stays empty.
function standIn(writes, seed = {}) {
  return (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const asOwner = (req.headers().authorization ?? "") === `Bearer ${SESSION.access_token}`;
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
    if ((m = path.match(/^\/rest\/v1\/rpc\/(\w+)$/))) return answer(200, asOwner ? OWNER_RPC[m[1]] ?? null : m[1] in OWNER_RPC && m[1] !== "current_tenant" ? false : null);
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
  console.log(`NATIVE SMOKE — the smoke build of out/ (${built.toISOString().replace("T", " ").slice(0, 16)} UTC): ${pages.length} screens and ${sections.length} crew sections × ${PHONES.length} iPhones; on the phone: ${plugins.map((p) => p.name).join(", ")}`);

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
  async function phoneContext(phone, { owner = false, theme = null, guide = false, seed = {}, shell = true } = {}) {
    const ctx = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
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
      }, [`sb-${BACKEND_HOST.split(".")[0]}-auth-token`, SESSION, theme, !guide]);
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

  // ── 2–5 · the app's behaviour, on the 6.3" phone ──
  {
    const ctx = await phoneContext(MAIN);
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const settle = async () => { await page.waitForTimeout(400); await page.evaluate(SETTLE); };

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

  // ── 6 · deleting your account, in the app (App Store Review Guideline 5.1.1(v)) ──
  // Signed in, from the avatar's menu: the row, its screen (loaded when tapped — so it must be in the
  // export), what it asks the web's API, and after the red button a phone that is signed out and home.
  // The stand-in API answers {} — nothing stands in the way — so this walks the whole way through.
  {
    const ctx = await phoneContext(MAIN, { owner: true });
    const page = await ctx.newPage();
    await insetsOn(page, MAIN.top, MAIN.bottom);
    const errors = watch(page);
    const from = apiCalls.length;
    const asked = (method) => apiCalls.slice(from).some((c) => c.method === method && new URL(c.url).pathname === "/api/account/erase");
    await page.goto(`${BASE}/book`, { waitUntil: "load" });
    await page.waitForTimeout(400); await page.evaluate(SETTLE);
    const pill = page.locator('button.acct-av[aria-label="Your account"]').first();
    const hasPill = (await pill.count()) > 0;
    if (hasPill) await pill.click();
    const row = page.getByRole("button", { name: /^Delete account/ }).first();
    const hasRow = await row.waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (hasRow) await row.click();
    const said = await page.waitForSelector("text=This deletes your GT3 account for good", { timeout: 8000 }).then(() => true, () => false);
    await page.waitForTimeout(300);
    const under = await page.evaluate(underTheBars, { top: MAIN.top, bottom: MAIN.bottom });
    if (SHOTS) await page.screenshot({ path: shotPath(MAIN, "account--delete") });
    ok("delete account: the avatar's menu has the row, in the app", hasPill && hasRow, `pill ${hasPill}, row ${hasRow}`);
    ok("delete account: its screen opens from the export and says what goes and what stays", said);
    ok("delete account: it asks the web's API first", asked("GET"));
    ok("delete account: nothing on its screen is under the system's bars", under.length === 0, findings(under));
    const red = page.getByRole("button", { name: "Delete my account" });
    if (said) await red.click();
    await page.waitForURL((u) => ["/", "/truck"].includes(new URL(u).pathname), { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const after = await page.evaluate((key) => ({ path: location.pathname, session: localStorage.getItem(key), told: document.body.innerText.includes("Your account is deleted.") }),
      `sb-${BACKEND_HOST.split(".")[0]}-auth-token`);
    // home sends a guest on to Find Us (app/page.tsx, the front door), so either is home
    ok("delete account: the red button asks the web's API, then this phone is signed out and home, and told",
      asked("POST") && ["/", "/truck"].includes(after.path) && after.session === null && after.told, JSON.stringify({ posted: asked("POST"), ...after, session: after.session ? "still here" : null }));
    ok("delete account: no errors", errors.length === 0, errors.join(" | "));
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
      const settle = async () => { await page.waitForTimeout(400); await page.evaluate(SETTLE); };
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
      const invite = page.locator("button.ref-share");
      await invite.waitFor({ timeout: 8000 }).catch(() => {});
      if (!(await invite.count())) ok("device: /3mpire has the invite link's Share", false, "no button.ref-share");
      else {
        const got = await asked(() => invite.click());
        const sheet = got.find((c) => c.plugin === "Share" && c.method === "share");
        ok("device: Share (the invite link) opens the share sheet with the web's address — never the phone's own",
          got.length === 1 && sheet?.options.url === `${API_ORIGIN}/?ref=GT3PB-3MP` && /use code GT3PB-3MP/.test(sheet.options.text ?? ""), JSON.stringify(got));
      }

      // the status card
      const avatar = page.locator('button.acct-av[aria-label="Your account"]').first();
      if (!(await avatar.count())) ok("device: the account menu is there to open the member card from", false, "no account avatar on /3mpire");
      else {
        await avatar.click();
        const cardRow = page.locator("button", { hasText: "Your member card" }).first();
        await cardRow.waitFor({ timeout: 5000 }).catch(() => {});
        await cardRow.click().catch(() => {});
        const shareCard = page.locator("button.status-share");
        const ready = await page.waitForFunction(() => { const b = document.querySelector("button.status-share"); return !!b && !b.disabled; }, null, { timeout: 15000 }).then(() => true, () => false);
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
        await page.locator(".atc-btn").first().click();
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
      const settle = async () => { await page.waitForTimeout(400); await page.evaluate(SETTLE); };
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
      await page.locator(".atc-btn").first().click().catch(() => {});
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
    ok(`header ${at}: the mode is a switch — Crew chosen, Customer beside it`, r.mode === "Crew:true Customer:false", r.mode);
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
