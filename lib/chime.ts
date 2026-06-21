// Two-tone "new order" chime via Web Audio — no asset, no network. iOS unlocks the
// AudioContext on the operator's first gesture (e.g. the mute toggle), so the first
// arrival may be silent until then; every one after rings.
/* eslint-disable @typescript-eslint/no-explicit-any */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") ctx.resume();
  } catch { /* */ }
}

export function chime() {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx!.destination);
      const t = now + i * 0.14;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t);
      o.stop(t + 0.18);
    });
  } catch { /* */ }
}
