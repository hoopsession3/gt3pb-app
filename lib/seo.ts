// SEARCH AND SHARING (R42 — the standards' "Search and sharing", 2026-10-19; Ryan: "What's not in our standards").
//
// A public page is found, shared and understood from what the server sends; everything else is kept out of search.
// This file is the one list of which is which, and what each public page says about itself:
//
//   PUBLIC_PAGES   every page a guest may find, with its own description — the sitemap's list (app/sitemap), and each
//                  page's description, canonical address and share card (pageMeta)
//   FRONT_DOOR     "/": a member's home, which sends a guest — and so a search engine — on to Find Us (proxy.ts,
//                  app/page.tsx). It keeps the house description and share card and names no address of its own.
//   PRIVATE_META   every other page: noindex — the crew's screens, the work screens (lib/surfaces), a person's own
//                  order or office account, share links, a lesson only a member may read
//   businessJsonLd the business as structured data, from what the app already says about it: its markets
//                  (lib/markets), its public profiles (lib/connect), its address for questions
//   menuJsonLd     the menu as structured data, from the same drinks the page shows (app/menu/layout)
//
// The page's title is its own (its layout's or page's), and a share card's title and description are the page's —
// Next fills og:title, og:description and the twitter card's from them, so no page says its name twice.
// scripts/r42.test holds every route to one or the other; scripts/search.check reads the built pages' heads before a
// push; scripts/verify.prod reads production's after one.
import type { Metadata } from "next";
import { MARKETS, MARKET_REGION } from "./markets";
import { CONNECT_APP, CONNECT_GROUPS, CONNECT_PRIMARY } from "./connect";
import { moneyPlain } from "./money";

export const SITE = CONNECT_APP;                        // https://app.gt3pb.com
export const SITE_NAME = "GT3 Performance Bar";
export const HOME_DESCRIPTION =
  "Whole-food functional drinks — cold-extracted coffee, whole-coconut hydration and bone broth. Order ahead, reserve a drop, and manage your membership.";

/** The share card: the brand's own mark (public/brand/gt3pb-bar-01.png) on cream, 1200 × 630 — public/og/gt3pb.png. */
export const SHARE_IMAGE = { url: "/og/gt3pb.png", width: 1200, height: 630, alt: "GT3 Performance Bar — Only the best for you" } as const;

/** What every page's share card carries; a public page adds its own address. */
const SHARE_CARD = { type: "website", siteName: SITE_NAME, locale: "en_US", images: [{ ...SHARE_IMAGE }] } as const;
const LARGE_CARD = { card: "summary_large_image" } as const;

/** The house defaults (app/layout): the brand's description and card, and no address — a page names its own. */
export const HOUSE_META: Pick<Metadata, "description" | "openGraph" | "twitter"> = {
  description: HOME_DESCRIPTION,
  openGraph: { ...SHARE_CARD, images: [{ ...SHARE_IMAGE }] },
  twitter: { ...LARGE_CARD },
};

/** "/" — Today, a member's home. A guest is sent on to Find Us, so search lists Find Us in its place. */
export const FRONT_DOOR = "/";

/** Every page a guest may find, in the app's own words (each page's opening lines). 50 to 160 characters: what a
 *  search result shows before it cuts the line. */
export const PUBLIC_PAGES: Readonly<Record<string, string>> = {
  "/truck": "Where the GT3 Performance Bar truck is next, across the Carolinas and Georgia — and how to bring the bar to your event.",
  "/events": "Where the GT3 Performance Bar truck is next, across the Carolinas and Georgia — and how to bring the bar to your event.",
  "/menu": "The GT3 menu with prices: cold-extracted coffee, whole-coconut hydration and bone broth. Order here, and it'll be waiting when you reach the window.",
  "/shop": "GT3 bottles and merch. Tell us you're coming and we'll brew it to order — picked up at a truck stop, or delivered prepaid to your door.",
  "/reserve": "Reserve a pack of GT3 bottles: 3, 6 or 12, brewed to order for pickup at a truck stop or prepaid delivery to your door.",
  "/delivery": "Sunday delivery in Greenville: a pack of GT3 bottles brewed to order, prepaid, and on your porch before sunrise Sunday. Order by Friday 6 PM.",
  "/3mpire": "The 3MPIRE, GT3's membership: a stamp on every drink and the next cup on us after ten — and $5 each when a friend joins with your code.",
  "/book": "Book the GT3 Performance Bar for your event — offsites, run clubs, launches, weddings. We bring the full bar and pour on site.",
  "/craft": "How GT3 builds every drink from whole, recognizable food: coffee to switch on, coconut and minerals to carry you, bone broth to rebuild.",
  "/primal": "GT3 Nutrition — Return to Primal: real fuel, explained simply. Free to start, and every lesson ends in a stack you can order. Educational, never medical.",
  "/privacy": "What GT3 Performance Bar collects to run your order and nothing more, who sees it, and how your data stays your call. Payments never touch our servers.",
  "/terms": "The terms for ordering from GT3 Performance Bar: orders, packs and delivery, texts, and what can change.",
  "/texts": "What GT3 Performance Bar texts — only your own orders: a confirmation, a pickup reminder, your porch drop, any change — how you say yes, and how you stop.",
};

/** A page reachable two ways names one canonical address: /events is Find Us, kept alive for links already shared. */
export const CANONICAL_OF: Readonly<Record<string, string>> = { "/events": "/truck" };

/** The pages the sitemap lists: every public page at its canonical address, once. */
export const SITEMAP_PATHS: readonly string[] = Object.keys(PUBLIC_PAGES).filter((p) => !(p in CANONICAL_OF));

/** A lesson's address (app/primal/l/[slug]): public when its lesson is (rookie lessons, by the database's own rule). */
export const lessonPath = (slug: string): string => `/primal/l/${encodeURIComponent(slug)}`;

/** An address on the site, whole: what a sitemap and structured data name. */
export const absolute = (path: string): string => (path === "/" ? SITE : `${SITE}${path}`);

/** Whether search may list a path: the front door, a public page, or a lesson (the lesson's own page says no when its
 *  lesson isn't public). Everything else is noindex. */
export function indexable(path: string): boolean {
  const p = path.split(/[?#]/)[0] || "/";
  return p === FRONT_DOOR || Object.prototype.hasOwnProperty.call(PUBLIC_PAGES, p) || /^\/primal\/l\/[^/]+$/.test(p);
}

/** A description no longer than a search result shows: cut at a word, with an ellipsis. */
export function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:—–-]+$/, "")}…`;
}

/** A lesson's description: its summary (the one-liner its cards show), else its subtitle, else Primal's own. */
export const lessonDescription = (l: { summary?: string | null; subtitle?: string | null }): string =>
  clip(l.summary?.trim() || l.subtitle?.trim() || PUBLIC_PAGES["/primal"]);

/** A public page's description, canonical address and share card. */
export function pageMeta(path: string): Pick<Metadata, "description" | "alternates" | "openGraph" | "twitter"> {
  const description = PUBLIC_PAGES[path];
  if (!description) throw new Error(`lib/seo: ${path} is not a public page — PRIVATE_META, or add it to PUBLIC_PAGES`);
  return publicMeta(CANONICAL_OF[path] ?? path, description);
}

/** The same for a page whose words are the database's (a lesson): its own address and description. */
export function publicMeta(canonical: string, description: string, type: "website" | "article" = "website"): Pick<Metadata, "description" | "alternates" | "openGraph" | "twitter"> {
  return {
    description,
    alternates: { canonical },
    openGraph: { ...SHARE_CARD, type, images: [{ ...SHARE_IMAGE }], url: canonical },
    twitter: { ...LARGE_CARD },
  };
}

/** Every page that isn't public: kept out of search. It names no canonical address and its card none — so a page
 *  under a public one never inherits that page's (a share of it opens it, not the page above). */
export const PRIVATE_META: Pick<Metadata, "robots" | "alternates" | "openGraph" | "twitter"> = {
  robots: { index: false, follow: false },
  alternates: {},
  openGraph: { ...SHARE_CARD, images: [{ ...SHARE_IMAGE }] },
  twitter: { ...LARGE_CARD },
};

/** The business, as structured data — only what the app already says about it. */
export function businessJsonLd(): Record<string, unknown> {
  const profiles = [CONNECT_PRIMARY, ...CONNECT_GROUPS.flatMap((g) => g.links.map((l) => l.href))]
    .filter((h) => /^https:\/\//.test(h) && !h.startsWith(SITE));
  return {
    "@context": "https://schema.org",
    "@type": "FoodEstablishment",
    "@id": `${SITE}/#business`,
    name: SITE_NAME,
    url: SITE,
    logo: `${SITE}/icon-512.png`,
    image: absolute(SHARE_IMAGE.url),
    description: HOME_DESCRIPTION,
    email: "hello@gt3pb.com",
    hasMenu: absolute("/menu"),
    areaServed: MARKETS.map((m) => ({ "@type": "City", name: MARKET_REGION[m] })),
    sameAs: [...new Set(profiles)],
  };
}

/** A drink as the menu's structured data says it: what the page shows of it. */
export type MenuJsonDrink = { name: string; line: string; why: string; priceCents: number | null };

/** The menu, as structured data: its sections and drinks in the page's order, each with the price the page shows. A
 *  drink with no price says none (it is never "free"). */
export function menuJsonLd(sections: readonly { line: string; drinks: readonly MenuJsonDrink[] }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Menu",
    "@id": `${absolute("/menu")}#menu`,
    name: `${SITE_NAME} menu`,
    url: absolute("/menu"),
    inLanguage: "en-US",
    hasMenuSection: sections.map((s) => ({
      "@type": "MenuSection",
      name: s.line,
      hasMenuItem: s.drinks.map((d) => ({
        "@type": "MenuItem",
        name: d.name,
        ...(d.why ? { description: d.why } : {}),
        ...(typeof d.priceCents === "number" && d.priceCents > 0
          ? { offers: { "@type": "Offer", price: moneyPlain(d.priceCents), priceCurrency: "USD" } }
          : {}),
      })),
    })),
  };
}

/** JSON for a <script type="application/ld+json">: a "<" can never close the tag it sits in. */
export const jsonLdText = (data: unknown): string => JSON.stringify(data).replace(/</g, "\\u003c");
