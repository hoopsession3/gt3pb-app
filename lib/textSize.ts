// The four text sizes' names, smallest first (2026-10-06, the settings round) — one home for the words:
// the size buttons' names in components/DisplayToggle and Settings' Text size row (lib/settingsGlance).
// A file of its own because the rail that draws those buttons rides every page, and it should not carry
// Settings' other words (and lib/money, lib/office with them) to a guest reading the menu.
// The three past Largest (R12 — the 10/10 audit, F1) are the accessibility sizes, named by how big: the page drawn half
// again, three-quarters again and twice its size — where an iPhone's Larger Accessibility Sizes reach.
export const TEXT_SIZE_WORDS = ["Standard", "Large", "Larger", "Largest", "150%", "175%", "200%"] as const;
