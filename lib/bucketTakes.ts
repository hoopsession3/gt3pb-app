// WHAT EACH BUCKET TAKES (R18 review, 2026-10-17 — the 10/10 audit, security F12). The storage buckets hold their own
// limits now — 0421: a profile photo and a VIP proof photo; 0423: the rest; 0292: a receipt's size — and storage refused
// a file past them in its own words ("The object exceeded the maximum allowed size", "mime type … is not supported"),
// after the whole file had gone up. Every upload asks here first (lib/uploads, lib/receipts) and is told in a person's
// words before a byte is sent. scripts/r18.test.mjs reads 0421, 0423 and 0292 and fails when this and they disagree.
// The type is lib/fileType's — what the file was handed over as, or what its name says. Pure.
import { fileType } from "./fileType";
export { fileType };   // lib/uploads takes both with one fetch, as a file is sent

const MB = 1024 * 1024;
const PHOTO = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"] as const;

export type BucketTakes = { maxBytes: number; types: readonly string[]; said: string };

export const BUCKET_TAKES: Readonly<Record<string, BucketTakes>> = {
  avatars: { maxBytes: 10 * MB, types: PHOTO, said: "a photo (JPEG, PNG, WebP, HEIC or GIF)" },
  vip: { maxBytes: 10 * MB, types: PHOTO, said: "a photo (JPEG, PNG, WebP, HEIC or GIF)" },
  content: { maxBytes: 100 * MB, types: ["image/*", "video/*"], said: "a picture or a video" },
  // The shop's picker, type for type (lib/shopMedia) — a public bucket takes no SVG (R18 review).
  shop: { maxBytes: 100 * MB, types: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "video/mp4", "video/quicktime", "video/webm"], said: "a JPEG, PNG, WebP, AVIF or GIF picture, or an MP4, MOV or WebM video" },
  brand: { maxBytes: 12 * MB, types: ["image/*"], said: "a picture" },
  training: { maxBytes: 12 * MB, types: ["image/*"], said: "a picture" },
  intake: { maxBytes: 25 * MB, types: ["image/*", "application/pdf", "text/plain", "text/csv", "text/markdown"], said: "a picture, a PDF or a text file" },
  "note-files": { maxBytes: 25 * MB, types: ["image/*", "application/pdf", "text/plain"], said: "a picture, a PDF or a text file" },
  receipts: { maxBytes: 20 * MB, types: ["image/*", "application/pdf"], said: "a photo or a PDF" },
};

/** Why this bucket won't take this file, in words a person can act on — or null when it will. The type is lib/fileType's;
 *  a file neither its type nor its name says anything about is refused here, in words, not by storage in its own. */
export function bucketRefusal(bucket: string, file: { size?: number; type?: string; name?: string }): string | null {
  const t = BUCKET_TAKES[bucket];
  if (!t) return null;
  if ((file.size ?? 0) > t.maxBytes) return `That file is over ${t.maxBytes / MB} MB — pick a smaller one.`;
  const type = fileType(file);
  if (!type) return `We couldn't tell what kind of file that is — this takes ${t.said}.`;
  if (!t.types.some((a) => (a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a))) {
    return `That kind of file can't go here — it takes ${t.said}.`;
  }
  return null;
}
