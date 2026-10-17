// WHAT FITS IN ONE REQUEST (R15, 2026-10-17 — the 10/10 audit, API F6).
//
// Vercel refuses a request body over 4.5 MB before the route runs (413 FUNCTION_PAYLOAD_TOO_LARGE, and not as JSON), so
// the transcriber's "up to 12 MB a file, 8 files" became "Transcription failed" for one ordinary phone photo: a 3.4 MB
// picture is 4.5 MB as base64. The picker now shrinks a photo to what handwriting needs (components/NoteAttach) and
// sends the files in as many requests as it takes, each under REQUEST_BUDGET; a file that cannot fit alone is said by
// name. Pure: sizes in, batches out (scripts/r15.test.mjs).

/** Base64 bytes one request may carry: under the platform's 4.5 MB with room for the JSON around it. */
export const REQUEST_BUDGET = 3_800_000;

/** The longest side a photo is sent at. Handwriting reads at it; a 12-megapixel photo is four times it. */
export const PHOTO_MAX_SIDE = 2000;

/**
 * Indices of `sizes` grouped in order into batches whose sum is at most `budget`; a size over the budget on its own is
 * returned in `tooBig`, never in a batch. Order is kept, so the transcript reads in the order the files were picked.
 */
export function batchBySize(sizes: readonly number[], budget: number = REQUEST_BUDGET): { batches: number[][]; tooBig: number[] } {
  const batches: number[][] = [], tooBig: number[] = [];
  let cur: number[] = [], sum = 0;
  sizes.forEach((n, i) => {
    if (!(n >= 0) || n > budget) { tooBig.push(i); return; }
    if (cur.length && sum + n > budget) { batches.push(cur); cur = []; sum = 0; }
    cur.push(i); sum += n;
  });
  if (cur.length) batches.push(cur);
  return { batches, tooBig };
}

/** The size a photo is drawn at so its longest side is at most `max` — never enlarged. */
export function fitWithin(width: number, height: number, max: number = PHOTO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * k), height: Math.round(height * k) };
}
