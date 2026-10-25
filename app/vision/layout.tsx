import type { Metadata } from "next";
import type { ReactNode } from "react";
import { titleOf } from "@/lib/routeTitles";
import { PRIVATE_META } from "@/lib/seo";

// The vision (R52): the crew's — kept out of search (lib/seo), named in the tab (lib/routeTitles).
export const metadata: Metadata = { title: titleOf("/vision"), ...PRIVATE_META };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
