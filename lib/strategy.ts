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

export const STRATEGY_REV = "Rev 1.0 · locked";

export const STRATEGY_CORE: StrategyBlock[] = [
  {
    h: "The two-voice brand",
    lines: [
      "GT3 Brew is the product — editorial voice, lives on bottles and labels.",
      "GT3 Performance Bar is the operator — motivational voice, lives at the counter and in this app (“No Noise”).",
      "Customers order from the Bar and receive Brew. Connective tissue: Pure Signal. No Noise.",
    ],
  },
  {
    h: "Pricing architecture (locked)",
    lines: [
      "Loop $8 — refill into the customer's returned GT3 bottle. The loyalty + margin engine (78% margin).",
      "New $10 — fresh sealed bottle, customer keeps the glass (67% margin).",
      "Performance $14 — sealed + the Salted Latte add (70% margin).",
      "House syrup station free at every tier. Loyalty: every drink earns a stamp, the 10th is free — no window, no minimum return count.",
    ],
  },
  {
    h: "Why the bottle comes back",
    lines: [
      "The returned bottle is the business model: Loop costs $1.75 to serve vs $3.31 sealed — the $2 discount buys a $1.56 cost drop AND a guaranteed repeat visit.",
      "Every mechanic reinforces it: pack pricing on bring-backs, the porch swap on delivery, the stamp on return.",
      "Loop stays exclusive to direct channels — third-party drivers can't verify empties, so Phase 2 platforms sell New/Performance only. The discount is a loyalty perk, not a price.",
    ],
  },
  {
    h: "The daypart system",
    lines: [
      "Rise (morning activation) · Flow (midday focus) · Dusk (evening downshift) — one clean base, three moments.",
      "Brew standard: 1:12 ratio, 16-hour cold extraction at 18°C, single-origin 84+ SCA within 14 days of roast, refractometer QC 1.30–1.50% TDS, batch variance ≤0.05%.",
      "~50 bottles per 5-gal water as concentrate over coffee ice; ~101 at 1:1 dilution.",
    ],
  },
  {
    h: "Delivery: Phase 1 → Phase 2",
    lines: [
      "Phase 1 (now): Sunday 5–8 AM direct, order by Fri 6 PM, 12-bottle minimum, $10 fee waived at 24+, 20-mi zone. Brewed Saturday — freshness is real, not copy.",
      "Phase 2 trigger (ALL must hold): 15+ events/mo ×2 months · Loop ≥25% of transactions · 15+ Sunday orders/mo · 300+ bottles in circulation · 1,200+ bottles/mo · solo capacity maxed near $7K/mo net.",
      "Phase 2: Uber Eats / DoorDash / Instacart at ~30% commission — discovery channel. Sunday direct stays the owned, highest-margin ritual.",
    ],
  },
  {
    h: "The money path",
    lines: [
      "Phase 1 plan: M1 $2,233 net → M2 $4,312 → M3 $7,324 (solo, no helper). 3-month plan: 2,354 bottles, $24.4K revenue, $13.9K net.",
      "$10K-to-live at Month 9: 22 events + 60 Sunday orders + 80 third-party orders/mo, one part-time helper → ~$14.5K gross net, ~$10K take-home.",
      "Launch capital ~$3,971 (bottles, lids, labels, water, insurance, marketing). Phase 2 adds ~$3,330.",
    ],
  },
];

export const GTM_PLAYS: GtmPlay[] = [
  { name: "Sunday Direct Delivery", category: "channel", status: "active",
    what: "Pre-order porch delivery, Sunday 5–8 AM, Greenville metro zone. The owned weekly ritual.",
    roi: "48 orders/mo by M3 · $6,528 revenue · $4,252 net", payback: "<1 month (positive from week 2)",
    inApp: "LIVE — /delivery (zone gate → pack → swap → pay) + the Now run sheet with brew totals & driver outcomes." },
  { name: "Farmers Market Rotation", category: "channel", status: "active",
    what: "4 recurring Saturday market slots (TR, Fountain Inn, +2).",
    roi: "200–240 bottles/mo per slot · $2,000–2,400 per market", payback: "same-day (revenue > fee)",
    inApp: "LIVE — Plan › Events + Truck stops run the calendar; Prep readiness + brew planning; Money › per-event P&L scores each one." },
  { name: "Gym Partnership Program", category: "partnership", status: "planning",
    what: "Pre-class morning cart at CrossFit / functional gyms — target 2–3 recurring.",
    roi: "30–45 bottles · $360–540 per session · 2–3 sessions/wk/gym", payback: "same-day",
    inApp: "READY — book via Business › Pipeline; each session is an event (P&L auto). Attribution lands with the GTM tracker (Sprint B)." },
  { name: "Yoga Studio Partnership Program", category: "partnership", status: "planning",
    what: "Post-class evening cart at yoga studios — target 2 recurring.",
    roi: "20–30 bottles · $250–380 per session", payback: "same-day",
    inApp: "READY — same event machinery as gyms." },
  { name: "Founding 100 Program", category: "community", status: "planning",
    what: "First 100 members: numbered bottles, lifetime Loop pricing, annual gathering.",
    roi: "$250–500/slot upfront = $25K–50K cash · ~$480/yr customer value", payback: "<30 days (funds Phase 1)",
    inApp: "STAGED — membership cards + founding_member flag exist; needs the numbered-slot ledger + pricing hook." },
  { name: "Annual Loop Pass", category: "retention", status: "planning",
    what: "$300 prepaid = 60 Loop drinks over 12 months.",
    roi: "30 passes/mo = $9,000 upfront monthly cash flow", payback: "immediate (cash on sale)",
    inApp: "STAGED — Money › Membership plans + Square subscriptions mirror exist; needs the pass product + redemption counter." },
  { name: "Corporate Wellness Contracts", category: "partnership", status: "planning",
    what: "Monthly on-site service — Michelin, BMW, Prisma, GE, ScanSource targets.",
    roi: "$2,000–4,000/mo per contract", payback: "60–90 days after first pitch",
    inApp: "READY — Business › Pipeline intake + event machinery; the /built one-pager is the pitch leave-behind." },
  { name: "Wholesale Placement", category: "channel", status: "planning",
    what: "1–2 premium retail accounts (Swamp Rabbit Cafe class) at 50–100 bottles/wk.",
    roi: "$1,200–2,400/mo gross profit per account", payback: "<30 days",
    inApp: "NOT YET — needs a wholesale price tier + standing-order sheet (small build when the first account signs)." },
  { name: "Third-Party Delivery", category: "channel", status: "phase-2",
    what: "Uber Eats + DoorDash + Instacart, 7-day delivery beyond the Sunday window.",
    roi: "80 orders/mo at ~$45 avg post-commission · ~$1,600 net/mo", payback: "<30 days (platform-funded)",
    inApp: "PROOFED — delivery_channel is data, not hardcode; Loop tier auto-hides off-direct (lib/delivery, smoke-tested). Waits on the Phase-2 trigger." },
  { name: "Content + Community", category: "campaign", status: "active",
    what: "Weekly IG content + Sunday-delivery reminder newsletter + monthly customer feature.",
    roi: "attribution-tracked acquisition (brand asset, not direct revenue)", payback: "qualitative",
    inApp: "LIVE — Studio: campaign generator (banned-copy linted), brand calendar, review desk → truck display; referral give-$5-get-$5 is the built-in referral engine." },
];

export const GOVERNANCE: StrategyBlock[] = [
  {
    h: "Who changes what",
    lines: [
      "The locked doc (GT3-Brew-Business-Strategy.md) is owner-only. It changes by PR — the banned-copy lint and the smoke suite run on every change, so a rev can't ship copy or math the rules forbid.",
      "Managers read everything and can comment on any block or play. Staff see the plays' status, never the money path.",
      "The Playbook page renders the doc; it never forks it. If this page and the doc disagree, the doc wins and the page is a bug.",
    ],
  },
  {
    h: "How a change happens",
    lines: [
      "Talk it through on the block's thread (tap Discuss) — that's the live room, and the other owners get pinged.",
      "Build or overhaul the play with the guided builder — drafts are visible to everyone, adopted by an owner only.",
      "Log the decision. Append-only, no edits, no deletes — the log is the institution's memory. No strategic call without a log line.",
      "Adopting a draft that changes locked numbers or copy = a doc rev (PR) in the same breath.",
    ],
  },
  {
    h: "When to overhaul",
    lines: [
      "On a trigger, not a mood: a play misses its projected ROI two review cycles running, a Phase-2 condition flips, or the market hands you a fact the doc doesn't have.",
      "Review cadence: monthly against Money's actuals. The Phase 1→2 checklist lives as tracked Goals (Plan › Goals) — owners and managers log the numbers there, and a review means arguing with the board, not re-reading the paragraph.",
      "Overhauls keep the old play's log history — the point is to see what you believed before and why it changed.",
    ],
  },
];

export const FLYWHEEL: string[] = [
  "A guest meets GT3 at an event or the truck (markets, gyms, corporate — the GTM plays fill this).",
  "They join — membership card, stamps, referral code. The app makes them known.",
  "They pre-order cups when the truck's out, reserve packs for Saturday, or get Sunday delivery — three ways to buy without friction.",
  "The bottle comes back — Loop pricing, porch swaps, stamps — margin up, habit locked.",
  "Their words come back too — reviews (scrubbed, approved) go on the truck display; referrals bring the next guest.",
  "Every order feeds Money (P&L, snapshot, economics) so the owner sees exactly which play is working.",
];
