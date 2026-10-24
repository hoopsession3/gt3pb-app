// EVERY PANEL, FINDABLE BY THE WORDS AN OWNER TYPES (R48 — Ryan, 2026-10-23: "searching now works, but it's not clear
// where I go. One would think that what I'm looking for would be in settings under business"; the console audit: ⌘K found
// the 15 section names and never a panel — "store", "prices", "merch", "course", "students", "discount" found nothing).
//
// One row per <Panel id> in app/crew/page.tsx: where it lives (its section), its title as the panel says it, and the
// words someone looking for it would type. The palette (components/CommandPalette) offers a panel to whoever may open its
// section, and opens it where it is (lib/anchors). scripts/r48.test.mjs fails a release when a panel is missing here or
// a row names a panel that is gone — a new panel is findable the day it ships.
import type { OpSection } from "@/components/OperatorSection";

export type PanelEntry = { id: string; section: OpSection; title: string; words: readonly string[] };

export const PANEL_INDEX: readonly PanelEntry[] = [
  // ── Catalog: what the business sells ──
  { id: "menu", section: "catalog", title: "Menu & products", words: ["store", "products", "drinks", "prices", "price", "menu", "sold out", "86", "hide item", "turn off", "items"] },
  { id: "merch", section: "catalog", title: "The Shop · merch", words: ["store", "shop", "merch", "shirts", "hats", "tote", "products", "hide item", "publish", "apliiq", "prices"] },
  { id: "shoporders", section: "catalog", title: "The Shop · orders", words: ["shop orders", "merch orders", "ship", "refund", "fulfil", "printer", "tracking"] },
  { id: "resv", section: "catalog", title: "Reserve drops", words: ["drops", "reserve", "limited", "bottles", "preorder"] },
  { id: "students", section: "catalog", title: "GT3 Nutrition · students", words: ["course", "nutrition", "students", "enrolled", "give access", "primal", "buyers", "course price"] },
  { id: "lessons", section: "catalog", title: "GT3 Nutrition · lessons", words: ["course", "nutrition", "lessons", "primal", "return to primal", "write lesson", "publish lesson"] },
  { id: "plans", section: "catalog", title: "Membership plans", words: ["membership", "plans", "subscription", "monthly", "pricing"] },
  { id: "cust-codes", section: "catalog", title: "Discount codes", words: ["discount", "coupon", "promo", "code", "deal"] },
  { id: "cust-perks", section: "catalog", title: "Founding perks", words: ["perks", "founding", "vip", "benefits", "rewards"] },
  // ── Money: the books ──
  { id: "pay", section: "money", title: "Get paid", words: ["invoices", "owed", "refunds", "chargebacks", "disputes", "payments"] },
  { id: "sales", section: "money", title: "Sales", words: ["sales", "revenue", "report", "income", "takings"] },
  { id: "pnl", section: "money", title: "Events", words: ["event profit", "p&l", "profit", "event costs"] },
  { id: "snapshot", section: "money", title: "Subscriptions", words: ["recurring", "mrr", "subscriptions", "members revenue"] },
  { id: "econ", section: "money", title: "Margins by product", words: ["margin", "cost", "profit per drink", "prices"] },
  { id: "cogs", section: "money", title: "COGS calculator", words: ["cogs", "cost of goods", "recipe cost"] },
  { id: "spend", section: "money", title: "Spend vs budget", words: ["spend", "budget", "expenses", "receipts", "purchases"] },
  { id: "orders", section: "money", title: "Orders · by the day bought", words: ["orders", "order history", "cup orders", "shop orders", "pickups", "deliveries", "office orders", "purchase date", "date", "void", "history", "receipts", "accountant", "export"] },
  // ── Customers ──
  { id: "cust-vip", section: "customers", title: "Bottle-owner proofs", words: ["vip", "bottle", "proof", "verify", "founding"] },
  { id: "cust-book", section: "customers", title: "Customer book", words: ["customers", "guests", "members", "people", "users", "contacts", "loyalty", "points"] },
  { id: "cust-broadcast", section: "customers", title: "Broadcast", words: ["announce", "message everyone", "ad", "promo", "banner"] },
  { id: "subs", section: "customers", title: "Members", words: ["members", "subscribers", "monthly"] },
  { id: "subint", section: "customers", title: "Waiting for a plan", words: ["waitlist", "interest", "waiting"] },
  { id: "funnels", section: "customers", title: "Funnels", words: ["funnel", "drop off", "conversion", "signups"] },
  // ── Team ──
  { id: "team-org", section: "team", title: "Org chart", words: ["org chart", "reports to", "team", "staff"] },
  { id: "team-usage", section: "team", title: "Who's in the system", words: ["usage", "active", "who's using", "logins"] },
  { id: "operators", section: "team", title: "Operator agreements", words: ["operators", "royalties", "deals", "contracts"] },
  { id: "offers", section: "team", title: "Offer letters", words: ["hire", "offer", "job", "recruit"] },
  // ── Plan, Prep, Studio ──
  { id: "schedule-gaps", section: "plan", title: "Needs sorting · events & stops", words: ["schedule", "gaps", "events", "stops", "unsorted"] },
  { id: "plan-discussions", section: "plan", title: "Discussions", words: ["threads", "comments", "discussions"] },
  { id: "prep-board", section: "prep", title: "Work every open task", words: ["tasks", "todo", "to do", "checklist", "prep"] },
  { id: "shoots", section: "studio", title: "Shoot planning", words: ["shoot", "photo", "video", "shot list", "call sheet"] },
  { id: "reviews", section: "studio", title: "Customer reviews", words: ["reviews", "ratings", "testimonials"] },
  // ── Settings ──
  { id: "set-notify", section: "settings", title: "Notifications", words: ["alerts", "notifications", "sound", "quiet hours", "ring"] },
  { id: "set-display", section: "settings", title: "Display", words: ["dark mode", "theme", "text size", "appearance"] },
  { id: "set-store", section: "settings", title: "Store & catalog", words: ["store", "catalog", "products", "merch", "course", "prices", "what we sell", "shop"] },
  { id: "set-pay", section: "settings", title: "Payments & checkout", words: ["payments", "card", "square", "checkout", "pay at pickup"] },
  { id: "set-ordering", section: "settings", title: "Ordering & delivery", words: ["ordering", "delivery", "preorder", "office delivery", "minimum"] },
  { id: "set-markets", section: "settings", title: "Locations & markets", words: ["cities", "locations", "markets", "open a city"] },
  { id: "set-team", section: "settings", title: "Team & permissions", words: ["roles", "permissions", "invite", "access", "owner", "admin"] },
  { id: "set-digest", section: "settings", title: "Reports", words: ["digest", "daily report", "summary email"] },
  { id: "set-integrations", section: "settings", title: "Integrations", words: ["integrations", "connected", "outlook", "calendar"] },
  { id: "set-ai", section: "settings", title: "AI", words: ["ai", "copilots", "train", "assistant"] },
  { id: "set-brand", section: "settings", title: "Brand & customer app", words: ["copy", "words", "splash", "brand", "text on the app"] },
  { id: "set-admintrail", section: "settings", title: "Activity log", words: ["audit", "history", "who changed", "log", "activity"] },
  { id: "set-errors", section: "settings", title: "App health", words: ["errors", "crashes", "health", "bugs"] },
  { id: "set-lists", section: "settings", title: "Data & lists", words: ["dropdowns", "options", "lists", "pickers"] },
];

/** A panel matches when every word typed is in its title, its section's name or one of its words. */
export function panelMatches(e: PanelEntry, sectionLabel: string, q: string): boolean {
  const hay = [e.title, sectionLabel, ...e.words].join(" ").toLowerCase();
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((t) => hay.includes(t));
}
