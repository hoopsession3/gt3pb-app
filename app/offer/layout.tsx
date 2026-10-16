import type { Metadata } from "next";
import type { ReactNode } from "react";
import { titleOf } from "@/lib/routeTitles";

// The screen's name in the document title (R12 — the 10/10 audit, F11): what the tab, the history and the switcher
// show, and what a screen reader is told when the app moves here (Next announces a route change only when the title
// changes). The name is lib/routeTitles' — the title bar's and the back label's.
export const metadata: Metadata = { title: titleOf("/offer") };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
