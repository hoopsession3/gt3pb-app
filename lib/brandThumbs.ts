import ASSETS from "./brandAssets.json";

// THE BRAND KIT'S PICTURES AT THE SIZE THEY ARE SHOWN (R13 — the 10/10 audit's performance pass, F14).
//
// The Brand Kit's tiles are 84 points tall, and they showed the masters themselves: an 8000 × 7151 photograph, two
// 5034 × 4500 ones, the 6083 × 4297 handle — over 500 MB of picture once a phone has unpacked them for a grid of
// thumbnails, which is more than an iPhone gives a web view before it closes it. Each master the kit lists
// (brand_assets, 0059) has a copy 480 pixels on its long side in public/brand/thumb — exported from the master, never
// redrawn (the brand lock) — and the tile shows that. The tile's link still opens the master, which is what someone
// taking a logo or a photo for a post or a print wants.
//
// IN THE IPHONE APP the six largest masters are left out of the app (scripts/build.app.mjs, `webOnly`: 4 MB the app
// would carry for a link few will open); their link opens the web's copy, in the in-app browser.
export const BRAND_THUMBS: Readonly<Record<string, string>> = ASSETS.thumbs;
export const BRAND_WEB_ONLY: readonly string[] = ASSETS.webOnly;

/** What a tile shows: the thumbnail of a master the kit knows, else the address as it is (an upload, a link). Pure. */
export function brandThumb(url: string): string {
  return BRAND_THUMBS[url] ?? url;
}

/** Where a tile's link goes: the master — on the web (`origin`) when the app was built without it. Pure. */
export function brandMaster(url: string, app: boolean, origin: string): string {
  return app && BRAND_WEB_ONLY.includes(url) ? origin + url : url;
}
