// The four text sizes' names, smallest first (2026-10-06, the settings round) — one home for the words:
// the size buttons' names in components/DisplayToggle and Settings' Text size row (lib/settingsGlance).
// A file of its own because the rail that draws those buttons rides every page, and it should not carry
// Settings' other words (and lib/money, lib/office with them) to a guest reading the menu.
export const TEXT_SIZE_WORDS = ["Standard", "Large", "Larger", "Largest"] as const;
