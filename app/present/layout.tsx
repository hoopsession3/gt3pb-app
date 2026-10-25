import type { Metadata } from "next";
import type { ReactNode } from "react";
import { titleOf } from "@/lib/routeTitles";
import { PRIVATE_META } from "@/lib/seo";

// A private link to the plan (R52): never in search, never a canonical; the token rides after the #, so no server sees it.
export const metadata: Metadata = { title: titleOf("/present"), ...PRIVATE_META };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
