// THE APP ICON AND THE LAUNCH SCREEN, FROM THE BRAND FILE (2026-10-06, the iPhone round).
//
//   node scripts/ios.assets.mjs      → ios/App/App/Assets.xcassets (AppIcon, Splash) — committed
//
// The icon is the one the home-screen install already shows (public/icon-512.png): the GT3 "3" in GT3
// Red on a charcoal that falls from the brand's Charcoal (#2A2820) at the top to the app's own ground
// (#15140F) at the bottom, the glyph centred at 60% of the height. Here it is drawn at Apple's 1024 px
// from the vector — native/brand/3.svg, the brand-lock master's own paths, never redrawn — so it is
// sharp where the 512 px web icon would be upscaled. Apple refuses an App Store icon with an alpha
// channel, so both images are flattened to RGB.
//
// The launch screen is the app's ground with the same "3" at its centre, small: what the app opens
// on, then hands to the first screen (capacitor.config.ts SplashScreen, components/NativeBridge).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const XC = join(ROOT, "ios", "App", "App", "Assets.xcassets");
const GLYPH = readFileSync(join(ROOT, "native", "brand", "3.svg"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const exe = ["/opt/pw-browsers/chromium", process.env.PW_CHROME].filter(Boolean);

const page = (size, glyphH, background) => `<!doctype html><html><head><style>
  html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}
  body{background:${background};display:grid;place-items:center}
  svg{height:${glyphH}px;width:auto;display:block}
</style></head><body>${GLYPH}</body></html>`;

async function render(browser, html, size, out) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(html);
  const tmp = `${out}.rgba.png`;
  await p.screenshot({ path: tmp, omitBackground: false });
  await p.close();
  // Flatten to RGB: Apple refuses an icon with an alpha channel, opaque or not.
  const r = spawnSync("python3", ["-c", `from PIL import Image; import os; Image.open("${tmp}").convert("RGB").save("${out}", optimize=True); os.remove("${tmp}")`]);
  if (r.status !== 0) throw new Error(`could not flatten ${out}: ${r.stderr}`);
}

const browser = await chromium.launch(exe.length ? { executablePath: exe[0] } : {});
try {
  const icon = join(XC, "AppIcon.appiconset");
  mkdirSync(icon, { recursive: true });
  await render(browser, page(1024, 612, "linear-gradient(180deg,#2A2820 0%,#15140F 100%)"), 1024, join(icon, "AppIcon-512@2x.png"));
  writeFileSync(join(icon, "Contents.json"), JSON.stringify({
    images: [{ filename: "AppIcon-512@2x.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
    info: { author: "xcode", version: 1 },
  }, null, 2) + "\n");

  const splash = join(XC, "Splash.imageset");
  mkdirSync(splash, { recursive: true });
  // One image serves every scale: the storyboard fills the screen with it (scaleAspectFill), so the
  // 2732 px square is cropped at the sides on a phone and the glyph stays centred, ~110 pt tall.
  for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
    await render(browser, page(2732, 360, "#15140F"), 2732, join(splash, name));
  }
  console.log("ios.assets — AppIcon (1024, RGB) and Splash (2732, RGB) drawn from native/brand/3.svg");
} finally {
  await browser.close();
}
