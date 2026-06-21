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
};
