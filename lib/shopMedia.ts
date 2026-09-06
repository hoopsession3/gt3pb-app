// SHOP MEDIA (0278) — real photos and video on a product, owned by the owner.
//
// The old shape was two columns of bare URL strings: `image_url` (the hero) and `images` (a gallery),
// both filled by pasting an Apliiq mockup address. That can't carry video — there is nowhere to say
// "this one is a clip, here's its poster frame" — and nothing in it survives a reorder, because a
// JSON array of strings has no identity per item.
//
// So `media` is the canonical shape now: an ORDERED list of items that each know what they are.
// The legacy columns are still written on every save (hero = first image's url, images = the image
// urls in order), because five other surfaces read them — the Shop grid, the MerchManager row
// thumbnail, the Apliiq importer, the checkout line item, and the order email. Nothing that reads
// the old shape has to change or even know this exists. That is the whole point: additive, and the
// old readers keep seeing exactly what they saw before.
//
// Pure and deterministic on purpose — every rule below is covered in scripts/smoke.cjs.

export type MediaKind = "image" | "video";

export type MediaItem = {
  id: string;            // stable across reorders — the storage path, which is already unique
  url: string;
  kind: MediaKind;
  poster?: string;       // video only: the still shown before play (and in the grid)
  alt?: string;          // real alt text, author-supplied; the shop falls back to the product title
};

// What the picker accepts, and what storage will actually take. Kept here (not in the component) so
// the limits are one fact the tests can assert rather than a string in a JSX attribute.
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(",");

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;   // 12 MB — a phone photo, uncompressed, fits
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;  // 100 MB — ~60s of phone 1080p
export const MAX_ITEMS = 12;                        // a story nobody scrolls past; also a storage guard

export const BUCKET = "shop";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Never throws, never returns null — an unknown/absent kind reads as an image, the safe default
 *  (an image that is really a video renders a broken poster; a video that is really an image would
 *  mount a <video> on a jpeg and show nothing at all). */
export function toKind(v: unknown): MediaKind {
  return v === "video" ? "video" : "image";
}

/** MIME → kind. Anything unrecognised is not media at all; callers reject before this matters. */
export function kindOfType(mime: string): MediaKind | null {
  const m = (mime || "").toLowerCase();
  if ((IMAGE_TYPES as readonly string[]).includes(m)) return "image";
  if ((VIDEO_TYPES as readonly string[]).includes(m)) return "video";
  // Some phones hand up "video/mp4;codecs=..." or an empty type for .mov — fall back to the prefix.
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  return null;
}

export function maxBytesFor(kind: MediaKind): number {
  return kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export const prettyBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** The gate the picker runs before a byte is uploaded. Returns a reason a human can act on. */
export function validateFile(file: { name?: string; type?: string; size?: number }): { ok: true; kind: MediaKind } | { ok: false; reason: string } {
  const kind = kindOfType(file.type ?? "");
  if (!kind) return { ok: false, reason: `${file.name || "That file"} isn't a photo or a video.` };
  const size = file.size ?? 0;
  const cap = maxBytesFor(kind);
  if (size > cap) {
    return { ok: false, reason: `${file.name || "That file"} is ${prettyBytes(size)} — the limit for a ${kind} is ${prettyBytes(cap)}.` };
  }
  return { ok: true, kind };
}

/** Room left before MAX_ITEMS. Negative counts are impossible; an over-full list returns 0. */
export function slotsLeft(current: readonly unknown[]): number {
  return Math.max(0, MAX_ITEMS - (current?.length ?? 0));
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────

/** The one way to read a product's media, whatever era its row is from.
 *  Precedence: a real `media` array wins; otherwise it is SYNTHESISED from image_url + images so a
 *  product nobody has touched since 0271 still opens in the story viewer. Duplicates collapse, the
 *  hero always sorts first, and anything unparseable is dropped rather than rendered as a hole. */
export function readMedia(p: {
  media?: unknown;
  image_url?: string | null;
  images?: unknown;
} | null | undefined): MediaItem[] {
  if (!p) return [];
  const out: MediaItem[] = [];
  const seen = new Set<string>();
  const push = (url: string, kind: MediaKind, poster?: string, alt?: string, id?: string) => {
    const u = str(url);
    if (!u || seen.has(u) || out.length >= MAX_ITEMS) return;
    seen.add(u);
    const item: MediaItem = { id: str(id) || u, url: u, kind };
    const po = str(poster); if (po) item.poster = po;
    const a = str(alt); if (a) item.alt = a;
    out.push(item);
  };

  if (Array.isArray(p.media) && p.media.length) {
    for (const raw of p.media) {
      if (typeof raw === "string") { push(raw, "image"); continue; }
      if (!isRecord(raw)) continue;
      push(str(raw.url), toKind(raw.kind), str(raw.poster), str(raw.alt), str(raw.id));
    }
    if (out.length) return out;
  }

  // Legacy: hero first, then the gallery, all images.
  push(str(p.image_url), "image");
  if (Array.isArray(p.images)) for (const raw of p.images) if (typeof raw === "string") push(raw, "image");
  return out;
}

/** The still to show in a grid/thumbnail for one item: a video shows its poster if it has one. */
export function thumbOf(item: MediaItem | undefined): string | null {
  if (!item) return null;
  return item.kind === "video" ? (item.poster || null) : item.url;
}

/** The product's cover — first item with something showable, else null. A product whose only media
 *  is a poster-less video has no cover, and the caller draws its placeholder instead of a black box. */
export function coverOf(items: readonly MediaItem[]): string | null {
  for (const it of items) { const t = thumbOf(it); if (t) return t; }
  return null;
}

export const countKind = (items: readonly MediaItem[], kind: MediaKind): number =>
  items.reduce((n, i) => n + (i.kind === kind ? 1 : 0), 0);

export const hasVideo = (items: readonly MediaItem[]): boolean => countKind(items, "video") > 0;

// ── writing ──────────────────────────────────────────────────────────────────────────────────────

/** Move an item, returning a NEW array. Out-of-range indices are a no-op, not a crash — the UI's
 *  up/down buttons at the ends of the list rely on that instead of guarding at every call site. */
export function move(items: readonly MediaItem[], from: number, to: number): MediaItem[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** Promote an item to the cover position. Same no-op contract as move(). */
export function makeCover(items: readonly MediaItem[], id: string): MediaItem[] {
  const i = items.findIndex((x) => x.id === id);
  return i <= 0 ? [...items] : move(items, i, 0);
}

export function removeAt(items: readonly MediaItem[], id: string): MediaItem[] {
  return items.filter((x) => x.id !== id);
}

export function setAlt(items: readonly MediaItem[], id: string, alt: string): MediaItem[] {
  return items.map((x) => (x.id === id ? { ...x, alt: alt.trim() || undefined } : x));
}

/** What actually goes in the UPDATE. `media` is canonical; `image_url`/`images` are derived so every
 *  pre-0278 reader keeps working unchanged — that back-compat is the contract, not a nicety.
 *  A video-only product still gets a hero if any clip has a poster, so the shop grid is never blank. */
export function toColumns(items: readonly MediaItem[]): { media: MediaItem[]; image_url: string | null; images: string[] } {
  const media = items.slice(0, MAX_ITEMS).map((i) => {
    const o: MediaItem = { id: i.id, url: i.url, kind: i.kind };
    if (i.poster) o.poster = i.poster;
    if (i.alt) o.alt = i.alt;
    return o;
  });
  const images = media.filter((i) => i.kind === "image").map((i) => i.url);
  const posters = media.filter((i) => i.kind === "video" && i.poster).map((i) => i.poster as string);
  return { media, image_url: images[0] ?? posters[0] ?? null, images };
}

// ── the story viewer's clock ─────────────────────────────────────────────────────────────────────

export const STORY_IMAGE_MS = 4200;   // how long a photo holds before it advances on its own

/** Where a tap lands. The left third goes back, the rest goes forward — Instagram's split, and the
 *  reason the back target is generous is that a mis-tap forward is far more annoying than one back. */
export function tapZone(x: number, width: number): "prev" | "next" {
  if (!(width > 0)) return "next";
  return x < width / 3 ? "prev" : "next";
}

/** Advance/retreat with a hard stop at each end; `null` means "there is nowhere to go" and the
 *  viewer closes (forward) or ignores it (back). Keeps the boundary logic out of the component. */
export function step(index: number, count: number, dir: 1 | -1): number | null {
  if (count <= 0) return null;
  const next = index + dir;
  if (next < 0) return null;
  if (next >= count) return null;
  return next;
}
