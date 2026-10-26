// THE STUDIO'S WIDTH RULE (S1) — pure, so it's tested by itself (scripts/s1.test.mjs); components/vision/useStudioSize
// measures the studio and asks it.
//   phone  — under 760: the canvas, a docked inspector over its foot, the library in a sheet
//   mid    — 760 to 1,099: the canvas and an inspector beside it, the library in a sheet
//   wide   — 1,100 and up: canvas · inspector, the library beside them on a tap (open from the start when roomy)
export type StudioSize = "phone" | "mid" | "wide";
export const sizeOf = (w: number): StudioSize => (w >= 1100 ? "wide" : w >= 760 ? "mid" : "phone");
/** Wide enough that the library can stand beside the canvas and still leave the plan and the 3D their room. */
export const roomyAt = 1400;
