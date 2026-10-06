// WHERE A PANEL LIVES NOW (2026-10-06, the settings round).
//
// Settings gathered what changes a feature out of four other sections. A link written before that
// still names the old place: an alert row keeps the link it was raised with, and so does a bookmark
// or a pg_cron producer. Every panel that moved kept its id, so for most of them only the section is
// different. This table says where each one went. alertDest (app/crew/page.tsx) and obligationGo
// (lib/obligations.ts) both pass their answer through panelHome, so an old link lands on the new home.
//
// Not here on purpose: Money's "pay" panel. It stayed in Money with the Refunds & disputes link, and
// refund alerts (/crew?s=money&a=pay) belong there. The payment switches it used to hold are one tap
// on from it, under "Payment settings ›".

export type PanelPlace = { section: string; anchor?: string };

/** "section#anchor" as it was before the settings round → where that panel is now. */
export const PANEL_MOVES: Readonly<Record<string, PanelPlace>> = {
  "money#menu": { section: "settings", anchor: "menu" },
  "money#plans": { section: "settings", anchor: "plans" },
  "customers#cust-codes": { section: "settings", anchor: "cust-codes" },
  "customers#cust-perks": { section: "settings", anchor: "cust-perks" },
  // Train the AI had no panel on Team, only its own block's id. In Settings it is a panel of its own.
  "team#ai-training": { section: "settings", anchor: "set-train" },
};

/** Where a section and anchor point today: the new home when the panel moved, else what was asked. */
export function panelHome(section: string, anchor?: string | null): PanelPlace {
  const moved = anchor ? PANEL_MOVES[`${section}#${anchor}`] : undefined;
  if (moved) return { ...moved };
  return anchor ? { section, anchor } : { section };
}
