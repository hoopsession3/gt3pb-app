// THE MENUS' SHEETS (2026-10-08, the iPhone chrome round, approved). Ask us, Connect and Display rode the floating
// rail; on a phone the rail is gone, and they open from the header (Ask us, beside the account avatar) and from the
// menus (the account menu, the crew's More). Any of those says which with an event; components/AppShell hears it
// and loads components/HelpSheets on the first ask, so nothing of theirs loads with the page.
export const HELP_EVENTS = ["gt3-open-concierge", "gt3-open-connect", "gt3-open-display"] as const;
export type HelpEvent = (typeof HELP_EVENTS)[number];
/** The latest ask: which sheet, and a count so the same sheet asked twice opens twice. */
export type Asked = { which: HelpEvent; n: number };
