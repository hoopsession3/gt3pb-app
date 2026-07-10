// Guarded haptic feedback — a quiet premium-PWA touch. No-ops where unsupported
// (iOS Safari ignores it; Android/installed PWAs buzz). Keep patterns short.
export function haptic(pattern: number | number[] = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export const HAPTIC = {
  tap: 8,
  add: 12,
  success: [14, 40, 14] as number[],
  alert: [200, 100, 200] as number[],
  // rituals — one signature per moment, used once per moment
  arm: [16, 50, 16, 50, 26] as number[],   // going live: two beats, then the engine
  paid: [10, 30, 18] as number[],           // money settled (a pack flips to paid in your hand)
};
