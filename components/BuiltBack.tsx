"use client";

import {  } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { useCanGoBack } from "@/lib/clientPage";

// Back control for the bare partner-share page (/built has no nav). Shows ONLY when you arrived from
// somewhere in-app (history to go back to) — a partner opening the share link fresh sees nothing, so
// the page stays clean for them.
export default function BuiltBack() {
  const router = useRouter();
  const show = useCanGoBack();   // a store since R17 (lib/clientPage): false on the server and while hydrating
  if (!show) return null;
  return <button type="button" className="k-icon-btn glass built-back" onClick={() => router.back()} aria-label="Back"><Icon name="chevronLeft" /></button>;
}
