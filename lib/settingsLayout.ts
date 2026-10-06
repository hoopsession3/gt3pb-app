// SETTINGS, AS A LIST (2026-10-06, the settings round).
//
// The order of Settings and who sees each panel in it, written once. app/crew/page.tsx (SettingsHome)
// draws the page by hand — every panel is a different component — and scripts/smoke.cjs holds that
// page to this list: each panel under its section, in this order, behind this gate. A panel moved,
// added or re-gated in one place and not the other fails the smoke, by name.
//
// The gates are the ones each panel had where it came from. The page itself opens for every role,
// so a server, a contractor or an operator sees You and nothing else. lib/obligations reads the
// gates too: a Needs-you row that lands in Settings is only for someone who will see where it lands.

export type SettingsGate = "everyone" | "admin" | "owner";
export type SettingsPanel = { id: string; gate: SettingsGate };
export type SettingsSection = { label: string; panels: readonly SettingsPanel[] };

export const SETTINGS_LAYOUT: readonly SettingsSection[] = [
  { label: "You", panels: [
    { id: "set-notify", gate: "everyone" },      // the mutes & quiet hours (the inbox's gear opens the same)
    { id: "set-alerts", gate: "everyone" },      // order alerts on this phone (was the foot of Live Ops)
    { id: "set-sound", gate: "everyone" },       // the pass's chime (the Pass keeps its bell)
    { id: "set-theme", gate: "everyone" },       // day, dark or Auto (the floating moon went: lib/theme)
    { id: "set-display", gate: "everyone" },     // text size, bold, spacing (the rail keeps a copy — customers have no Settings)
    { id: "set-digest", gate: "admin" },         // the founder digest
  ] },
  { label: "Ordering & payments", panels: [
    { id: "set-pay", gate: "admin" },            // card checkout, pay at pickup, subscriptions (was Money › Get paid)
    { id: "set-dial", gate: "admin" },           // the cup-ordering dial (was Plan › Route, shown to every manager)
    { id: "set-office", gate: "admin" },         // office delivery price & minimum
  ] },
  { label: "Menu & availability", panels: [
    { id: "menu", gate: "admin" },               // the menu (was Money › Catalog & pricing)
    { id: "plans", gate: "admin" },              // membership plans (was Money)
    { id: "cust-codes", gate: "admin" },         // discount codes (was Customers)
    { id: "cust-perks", gate: "admin" },         // founding perks (was Customers)
    { id: "set-lists", gate: "admin" },          // every dropdown's list
  ] },
  { label: "Team & access", panels: [
    { id: "set-invite", gate: "owner" },         // inviting someone in a role (was Team)
    { id: "set-lanes", gate: "admin" },          // who owns each lane (was Team's org chart)
  ] },
  { label: "Markets & legal", panels: [
    { id: "set-markets", gate: "admin" },        // admins see it; opening a city stays the owner's call
  ] },
  { label: "Integrations", panels: [
    { id: "set-integrations", gate: "admin" },   // what is connected
    { id: "set-outlook", gate: "owner" },        // connect Outlook (was under the calendar)
  ] },
  { label: "AI", panels: [
    { id: "set-train", gate: "owner" },          // Train the AI (was Team)
    { id: "set-ai", gate: "admin" },             // the copilots
    { id: "set-spend", gate: "admin" },          // what they cost
  ] },
  { label: "Copy & brand", panels: [
    { id: "set-copy", gate: "admin" },           // every line guests read
    { id: "splash", gate: "admin" },             // the app splash
    { id: "set-broadcast", gate: "admin" },      // a live message to everyone
  ] },
  { label: "Advanced", panels: [
    { id: "set-admintrail", gate: "admin" },
    { id: "set-errors", gate: "admin" },
    { id: "set-changelog", gate: "admin" },
    { id: "set-audit", gate: "admin" },
  ] },
];

/** Who sees the Settings panel with this id — null when no panel in Settings has that id. */
export function settingsGate(id?: string | null): SettingsGate | null {
  if (!id) return null;
  for (const s of SETTINGS_LAYOUT) for (const p of s.panels) if (p.id === id) return p.gate;
  return null;
}

/** A section's own gate: the widest gate of anything in it (a header is drawn when any panel is). */
export function sectionGate(s: SettingsSection): SettingsGate {
  return s.panels.some((p) => p.gate === "everyone") ? "everyone" : s.panels.some((p) => p.gate === "admin") ? "admin" : "owner";
}
