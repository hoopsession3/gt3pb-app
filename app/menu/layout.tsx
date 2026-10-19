import type { Metadata } from "next";
import type { ReactNode } from "react";
import { titleOf } from "@/lib/routeTitles";
import { jsonLdText, menuJsonLd, pageMeta } from "@/lib/seo";
import { catalogForGuests } from "@/lib/guestRead";
import { menuOf, sectionsOf, seedMenu, shownCents } from "@/lib/drinks";
import { APP_BUILD } from "@/lib/native";
import { ServerMenu } from "@/components/AppProvider";

// The screen's name in the document title (R12 — the 10/10 audit, F11): what the tab, the history and the switcher
// show, and what a screen reader is told when the app moves here (Next announces a route change only when the title
// changes). The name is lib/routeTitles' — the title bar's and the back label's.
// …and what search and a share card say about it (R42, lib/seo): its own description, canonical address and card.
export const metadata: Metadata = { title: titleOf("/menu"), ...pageMeta("/menu") };

// THE MENU ON THE SERVER'S PAGE (R42 — the standards' "Search and sharing"). The Catalog, read as a guest (lib/guestRead;
// the page is remade at most every minute, on a visit after it), is the menu's first paint (components/AppProvider
// ServerMenu, which lends it to the drink sheet and the cart too) and its structured data — the same drinks, in the same
// order, at the prices the page shows (lib/drinks shownCents), so what search reads is what a guest sees. With no read
// (a CI build, or one that failed) both are the code list's stand-in, as the page has always been. The iPhone app's
// export reads nothing here: its pages are made once, for the phone, which reads the Catalog itself as the menu opens.
export default async function Layout({ children }: { children: ReactNode }) {
  const rows = APP_BUILD ? null : await catalogForGuests();
  const bySlug = new Map((rows ?? []).map((r) => [r.slug, r]));
  const sections = sectionsOf(rows ? menuOf(rows) : seedMenu()).map((s) => ({
    line: s.line,
    drinks: s.drinks.map((d) => ({ name: d.name, line: d.line, why: d.why || d.lines[0] || "", priceCents: shownCents(bySlug.get(d.slug), d.slug) })),
  }));
  return (
    <>
      <ServerMenu rows={rows}>{children}</ServerMenu>
      {APP_BUILD ? null : <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(menuJsonLd(sections)) }} />}
    </>
  );
}
