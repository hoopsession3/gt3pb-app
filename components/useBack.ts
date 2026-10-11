"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { appHistory } from "@/lib/appHistory";
import { isTabRoot, titleOf, upOf } from "@/lib/routeTitles";
import { surfaceOf } from "@/lib/surfaces";
import { useOperatorSection } from "./OperatorSection";

// WHERE BACK GOES FROM HERE, AND ITS NAME (2026-10-08, the navigation round: redesign 2, approved). One
// answer for the title bar's ‹ (components/TitleBar) and the edge swipe (components/SwipeBack), so the two
// never disagree:
//   · a view the screen opened inside itself (an Academy lesson) — Back closes it ("‹ Academy");
//   · in the crew console, the section before this one, while there is one (the console's own history);
//   · a tab's own screen — nothing: a tab is where a way through the app starts;
//   · any other screen — the screen before it in this visit ("‹ Menu"), or, with none, the place its old
//     in-page ‹ went (lib/routeTitles upOf: an Academy link opened from an email still has a way out).
// Until the page has hydrated, only what the address alone decides — the server drew the same.

export type BackWay = { label: string; go: () => void };

const noop = () => () => {};
const server = () => -1;

export function useBack(): BackWay | null {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { canGoBack, back } = useOperatorSection();
  const hist = appHistory();
  const v = useSyncExternalStore(hist ? hist.subscribe : noop, hist ? hist.version : server, server);
  const up = upOf(pathname);
  const toUp = up ? { label: titleOf(up), go: () => router.push(up) } : null;
  if (!hist || v < 0) return surfaceOf(pathname) === "console" ? null : toUp;

  const label = hist.stepLabel();
  if (label) return { label, go: () => hist.back() };
  if (surfaceOf(pathname) === "console") {
    if (!canGoBack) return null;
    const prev = hist.previous();
    return { label: prev ? titleOf(prev) : "Back", go: () => { back(); } };
  }
  if (isTabRoot(pathname)) return null;
  const prev = hist.previous();
  if (prev) return { label: titleOf(prev), go: () => hist.back() };
  return toUp;
}
