// THE PLAYBOOK — owner-facing strategy, structured. Single source: GT3-Brew-Business-Strategy.md
// (Rev 1.0, locked) + what the app already executes. Rendered at /playbook (owner/crew only).
// Rule: every number here traces to the locked doc — nothing invented, nothing aspirational
// dressed as fact. When the strategy doc revs, this file revs with it, same PR.

export interface StrategyBlock { h: string; lines: string[] }
export interface GtmPlay {
  name: string;
  category: "channel" | "partnership" | "campaign" | "community" | "retention";
  status: "active" | "planning" | "phase-2";
  what: string;          // the play, plain English
  roi: string;           // projected, from the locked doc
  payback: string;
  inApp: string;         // where the app executes or will execute it
}

// The plays by name only (IP0): the Studio offers them as a content theme; what each one is, what it returns and how
// it pays back is the playbook's, served by app/api/playbook. scripts/ip0.test.mjs keeps this list equal to the plays.
export const GTM_PLAY_NAMES: readonly string[] = [
  "Sunday Direct Delivery",
  "Farmers Market Rotation",
  "Gym Partnership Program",
  "Yoga Studio Partnership Program",
  "Founding 100 Program",
  "Annual Loop Pass",
  "Corporate Wellness Contracts",
  "Wholesale Placement",
  "Third-Party Delivery",
  "Content + Community"
];

/** The playbook as the owners-and-admins route returns it. */
export type Playbook = { rev: string; core: StrategyBlock[]; plays: GtmPlay[]; governance: StrategyBlock[]; flywheel: string[] };
