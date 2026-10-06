"use client";

import { usePassMuted, setPassMuted } from "@/lib/passSound";
import { useThemeChoice, setTheme, type ThemeChoice } from "@/lib/theme";
import { unlockAudio } from "@/lib/chime";
import { haptic } from "@/lib/haptics";

// SETTINGS › YOU — two of this phone's own settings, each one row (2026-10-06, the settings round).
// The pass's sound was changeable only from the bell on the Pass, and day or dark only from a floating
// moon. The bell stays on the Pass, where a muted chime is noticed; both read and write the one home
// each has (lib/passSound, lib/theme), so a change made here is the one the Pass shows. The moon went
// when Appearance gained Auto (lib/theme says why).

/** The pass's chime for a new order, on this phone — the same switch as the bell on the Pass. */
export function PassSound() {
  const muted = usePassMuted();
  const flip = () => {
    if (muted) haptic("toggleOn"); else haptic("toggleOff");
    setPassMuted(!muted);
    unlockAudio(); // a phone plays sound only after a tap has allowed it; this is that tap
  };
  return (
    <div className="pay-row">
      <div className="pay-row-l">
        <div className="pay-row-t">Pass sound</div>
        <div className="pay-row-s">
          {muted
            ? "Muted on this phone. New orders still flash on the pass."
            : "A chime and a buzz on this phone when a new order lands on the pass, and when a guest says they're outside."}
        </div>
      </div>
      <button type="button" role="switch" aria-checked={!muted} aria-label="Pass sound" className={`pay-toggle${!muted ? " on" : ""}`} onClick={flip}>
        <span className="pay-toggle-knob" />
      </button>
    </div>
  );
}

const LOOKS: readonly { v: ThemeChoice; label: string }[] = [{ v: "day", label: "Day" }, { v: "dark", label: "Dark" }, { v: "auto", label: "Auto" }];
const SAYS: Record<ThemeChoice, string> = {
  day: "Reads best outdoors, in the sun.",
  dark: "Easier on the eyes at night.",
  auto: "Follows this phone’s own light or dark setting.",
};

/** Day, dark or Auto for the crew console, on this phone. A choice of three, so a segmented control under
 *  the words, the width of the row — not three small pills squeezed beside them. */
export function Appearance() {
  const choice = useThemeChoice();
  const pick = (t: ThemeChoice) => {
    if (t === choice) return;
    haptic("selection");
    setTheme(t);
  };
  return (
    <div className="set-stack">
      <div className="pay-row-t">Appearance</div>
      <div className="pay-row-s">{SAYS[choice]}</div>
      <div className="set-seg" role="radiogroup" aria-label="Appearance">
        {LOOKS.map((l) => (
          <button key={l.v} type="button" role="radio" aria-checked={choice === l.v} className={choice === l.v ? "on" : undefined} onClick={() => pick(l.v)}>{l.label}</button>
        ))}
      </div>
    </div>
  );
}
