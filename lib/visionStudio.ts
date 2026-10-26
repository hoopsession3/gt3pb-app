// THE STUDIO'S WIDTH RULE (S1) — pure, so it's tested by itself (scripts/s1.test.mjs); components/vision/useStudioSize
// measures the studio and asks it.
//   phone  — under 760: the canvas, a docked inspector over its foot, the library in a sheet
//   mid    — 760 to 1,099: the canvas and an inspector beside it, the library in a sheet
//   wide   — 1,100 and up: canvas · inspector, the library beside them on a tap (open from the start when roomy)
export type StudioSize = "phone" | "mid" | "wide";
export const sizeOf = (w: number): StudioSize => (w >= 1100 ? "wide" : w >= 760 ? "mid" : "phone");
/** Wide enough that the library can stand beside the canvas and still leave the plan and the 3D their room. */
export const roomyAt = 1400;

/** The default view (S1.1, the gate's question 5): the plan and the 3D side by side only where both stay readable — a
 *  studio at least SPLIT_AT wide (a 13-inch iPad on its side, a desktop) — and the plan alone narrower (a phone, an iPad
 *  upright, Split View), the 3D a tap away. Measured on the phone check: an iPad upright split two 240px panes. */
export const SPLIT_AT = 1000;
export const defaultView = (width: number): "plan" | "both" => (width >= SPLIT_AT ? "both" : "plan");

type Sized = { x_in: number; y_in: number; rot: 0 | 90 | 180 | 270; w_in: number; d_in: number };
/** A thing resized by its corner handle (S1.1 — sizes dragged, not typed): the top-left corner of its footprint stays
 *  put, the dragged corner snaps to the six-inch grid, never smaller than six inches, never through the far walls. A
 *  thing turned a quarter swaps which way is its width. Returns the new size and centre. */
export function resizeTo<T extends Sized>(it: T, corner: { x: number; y: number }, room: { width_in: number; depth_in: number }, step = 6): Pick<T, "w_in" | "d_in" | "x_in" | "y_in"> {
  const turned = it.rot === 90 || it.rot === 270;
  const fw0 = turned ? it.d_in : it.w_in, fh0 = turned ? it.w_in : it.d_in;
  const x0 = it.x_in - fw0 / 2, y0 = it.y_in - fh0 / 2;
  const sn = (v: number) => Math.round(v / step) * step;
  const fw = Math.max(step, Math.min(room.width_in - x0, sn(corner.x - x0)));
  const fh = Math.max(step, Math.min(room.depth_in - y0, sn(corner.y - y0)));
  const w = turned ? fh : fw, d = turned ? fw : fh;
  return { w_in: w, d_in: d, x_in: x0 + fw / 2, y_in: y0 + fh / 2 } as Pick<T, "w_in" | "d_in" | "x_in" | "y_in">;
}
