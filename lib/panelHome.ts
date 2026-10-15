// WHERE A PANEL LIVES NOW (2026-10-06, the settings round and the settings-by-category round).
//
// Settings gathered what changes a feature out of four other sections. A link written before that
// still names the old place: an alert row keeps the link it was raised with, and so does a bookmark
// or a pg_cron producer. Every panel that moved kept its id, so for most of them only the section is
// different. This table says where each one went. alertDest (app/crew/page.tsx) and obligationGo
// (lib/obligations.ts) both pass their answer through panelHome, so an old link lands on the new home.
//
// Not here on purpose: Money's "pay" panel. It stayed in Money — Get paid, listing refunds, chargebacks
// and what is owed since 2026-10-15 — and refund alerts (/crew?s=money&a=pay) belong there. The payment
// switches it used to hold are one tap on from it, under "Payment settings ›".

export type PanelPlace = { section: string; anchor?: string };

// SETTINGS BY CATEGORY (2026-10-06, the same day). What a business sells or says left Settings: the
// menu, the plans, codes and perks are the Catalog section, with the merch and the lessons that sat
// in Money's "Catalog & pricing"; a broadcast is Customers › Messages. A link from before either
// round lands on the Catalog in one step — each old place is listed here, not chained. The rows that
// were folded into one row per topic (the pass's sound into Notifications, the dial into Ordering &
// delivery…) kept their ids as parts and stayed in Settings, so they need no line here: lib/anchors
// opens the row that holds them (lib/settingsLayout, settingsHolder).

/** "section#anchor" as it was before the settings rounds → where that panel is now. */
export const PANEL_MOVES: Readonly<Record<string, PanelPlace>> = {
  "money#menu": { section: "catalog", anchor: "menu" },
  "money#plans": { section: "catalog", anchor: "plans" },
  "money#merch": { section: "catalog", anchor: "merch" },
  "money#lessons": { section: "catalog", anchor: "lessons" },
  "customers#cust-codes": { section: "catalog", anchor: "cust-codes" },
  "customers#cust-perks": { section: "catalog", anchor: "cust-perks" },
  "settings#menu": { section: "catalog", anchor: "menu" },
  "settings#plans": { section: "catalog", anchor: "plans" },
  "settings#cust-codes": { section: "catalog", anchor: "cust-codes" },
  "settings#cust-perks": { section: "catalog", anchor: "cust-perks" },
  "settings#set-broadcast": { section: "customers", anchor: "cust-broadcast" },
  // Train the AI had no panel on Team, only its own block's id. In Settings it is a part of AI.
  "team#ai-training": { section: "settings", anchor: "set-train" },
  // MONEY KEEPS THE BOOKS (2026-10-15, release 3 of the Plan & Money audit). Seven panels that were never about the
  // books went where their work is; each kept its id. Alerts raised before today still say ?s=money&a=shoporders (a
  // stalled shop order) or &a=resv (a reserve owed), and a crew member's page links &a=offers and &a=operators.
  "money#shoporders": { section: "catalog", anchor: "shoporders" },
  "money#resv": { section: "catalog", anchor: "resv" },
  "money#subs": { section: "customers", anchor: "subs" },
  "money#subint": { section: "customers", anchor: "subint" },
  "money#funnels": { section: "customers", anchor: "funnels" },
  "money#operators": { section: "team", anchor: "operators" },
  "money#offers": { section: "team", anchor: "offers" },
};

/** Where a section and anchor point today: the new home when the panel moved, else what was asked. */
export function panelHome(section: string, anchor?: string | null): PanelPlace {
  const moved = anchor ? PANEL_MOVES[`${section}#${anchor}`] : undefined;
  if (moved) return { ...moved };
  return anchor ? { section, anchor } : { section };
}
