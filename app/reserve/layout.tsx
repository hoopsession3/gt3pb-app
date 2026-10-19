import type { Metadata } from "next";
import type { ReactNode } from "react";
import { titleOf } from "@/lib/routeTitles";
import { pageMeta } from "@/lib/seo";

// The screen's name in the document title (R12 — the 10/10 audit, F11): what the tab, the history and the switcher
// show, and what a screen reader is told when the app moves here (Next announces a route change only when the title
// changes). The name is lib/routeTitles' — the title bar's and the back label's.
// …and what search and a share card say about it (R42, lib/seo): its own description, canonical address and card.
export const metadata: Metadata = { title: titleOf("/reserve"), ...pageMeta("/reserve") };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
