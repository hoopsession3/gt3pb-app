// SETTINGS, BY CATEGORY (2026-10-06, the settings-by-category round).
//
// The order of Settings and who sees each row in it, written once. app/crew/page.tsx (SettingsHome)
// draws the page by hand — every row is a different component — and scripts/smoke.cjs holds that
// page to this list: each row under its group, in this order, behind this gate, and each part inside
// the row that holds it. A row moved, added or re-gated in one place and not the other fails the
// smoke, by name.
//
// WHY THIS SHAPE. Ryan, on the first Settings: "Are the settings even organized? … are the settings
// organized based on categories … industry standard, which makes it less friction?" They were nine
// groups of 29 rows, and a third of them were not settings at all. The shape now is the one a
// phone's Settings and a store's admin share:
//   · YOU — this person and this phone: the account, notifications, display. Every role has it.
//   · BUSINESS — how the business behaves: payments, ordering, locations, the team, reports, what is
//     connected, the AI, the brand guests see. Owners and admins.
//   · ADVANCED — about the software itself: what changed, what broke, the lists every picker reads.
// What a business SELLS or SAYS is not a setting, so it is not here: the menu, merch, lessons,
// membership plans, codes and perks are the Catalog section; a broadcast is Customers › Messages;
// the changelog is the Guide's What's new. (Shopify keeps Products, Customers and Discounts out of
// its Settings page the same way — help.shopify.com, "Accessing administration options on the
// Settings page".) Ryan chose this over keeping them here (2026-10-06: "Move them out").
//
// ONE TOPIC, ONE ROW. Notifications, this phone's order alerts and the pass's sound were three rows;
// the look and the text size were two. Each topic is one row now, and what used to be a row of its
// own is a PART inside it — it keeps its id, so every link to it still lands: lib/anchors opens the
// row that holds a part before it scrolls to the part (settingsHolder below).
//
// The gates are the ones each panel had where it came from. The page itself opens for every role,
// so a server, a contractor or an operator sees You and nothing else. lib/obligations reads the
// gates too: a Needs-you row that lands in Settings is only for someone who will see where it lands.

import { COPY_ANCHOR_PREFIX } from "./copyAnchor";

export type SettingsGate = "everyone" | "admin" | "owner";
export type SettingsPart = { id: string; gate: SettingsGate };
export type SettingsPanel = { id: string; gate: SettingsGate; parts?: readonly SettingsPart[] };
export type SettingsSection = { label: string; panels: readonly SettingsPanel[] };

export const SETTINGS_LAYOUT: readonly SettingsSection[] = [
  { label: "You", panels: [
    { id: "set-account", gate: "everyone" },                                 // name, photo, sign-in: the account menu's door
    { id: "set-notify", gate: "everyone", parts: [
      { id: "set-alerts", gate: "everyone" },                                // order alerts on this phone
      { id: "set-sound", gate: "everyone" },                                 // the pass's chime (the Pass keeps its bell)
    ] },                                                                     // then what pings you & quiet hours
    { id: "set-display", gate: "everyone", parts: [
      { id: "set-theme", gate: "everyone" },                                 // day, dark or auto
    ] },                                                                     // then text size, bold, spacing
  ] },
  { label: "Business", panels: [
    { id: "set-pay", gate: "admin" },                                        // card checkout, pay at pickup, subscriptions
    { id: "set-ordering", gate: "admin", parts: [
      { id: "set-dial", gate: "admin" },                                     // when cup pre-orders open
      { id: "set-office", gate: "admin" },                                   // office delivery price & minimum
    ] },
    { id: "set-markets", gate: "admin" },                                    // which cities can open (opening one is the owner's)
    { id: "set-team", gate: "admin", parts: [
      { id: "set-invite", gate: "owner" },                                   // inviting someone in a role
      { id: "set-lanes", gate: "admin" },                                    // who owns each lane
    ] },
    { id: "set-digest", gate: "admin" },                                     // reports: the founder digest
    { id: "set-integrations", gate: "admin", parts: [
      { id: "set-outlook", gate: "owner" },                                  // connect Outlook
    ] },
    { id: "set-ai", gate: "admin", parts: [
      { id: "set-train", gate: "owner" },                                    // Train the AI
      { id: "set-spend", gate: "admin" },                                    // what the copilots cost
    ] },
    { id: "set-brand", gate: "admin", parts: [
      { id: "set-copy", gate: "admin" },                                     // every line guests read
      { id: "splash", gate: "admin" },                                       // the app splash
    ] },
  ] },
  { label: "Advanced", panels: [
    { id: "set-admintrail", gate: "admin" },                                 // the activity log: who changed what
    { id: "set-errors", gate: "admin", parts: [
      { id: "set-audit", gate: "admin" },                                    // every review run on the app
    ] },                                                                     // app health: errors, then audits
    { id: "set-lists", gate: "admin" },                                      // every dropdown's list
  ] },
];

/** The row that holds this part (or this copy group) — null for a row itself, or an id not in Settings. */
export function settingsHolder(id?: string | null): string | null {
  if (!id) return null;
  // A copy group's anchor (lib/copy copyGroupAnchor) sits inside the copy editor, inside Brand.
  if (id.startsWith(COPY_ANCHOR_PREFIX)) return "set-brand";
  for (const s of SETTINGS_LAYOUT) for (const p of s.panels) if (p.parts?.some((x) => x.id === id)) return p.id;
  return null;
}

/** Who sees the Settings row or part with this id — null when nothing in Settings has that id. */
export function settingsGate(id?: string | null): SettingsGate | null {
  if (!id) return null;
  if (id.startsWith(COPY_ANCHOR_PREFIX)) return "admin";
  for (const s of SETTINGS_LAYOUT) for (const p of s.panels) {
    if (p.id === id) return p.gate;
    const part = p.parts?.find((x) => x.id === id);
    if (part) return part.gate;
  }
  return null;
}

/** A section's own gate: the widest gate of anything in it (a header is drawn when any row is). */
export function sectionGate(s: SettingsSection): SettingsGate {
  return s.panels.some((p) => p.gate === "everyone") ? "everyone" : s.panels.some((p) => p.gate === "admin") ? "admin" : "owner";
}
