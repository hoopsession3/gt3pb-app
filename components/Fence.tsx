"use client";

import { Component, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { recoverFromCrash } from "./ErrorReporter";

// ONE PIECE FAILS ALONE (R11, 2026-10-16 — the 10/10 audit). Everything AppShell draws around the page — the toast, the
// cart bar, the nav, the rail, the lazy sheets — sits in the root layout, above app/error.tsx, so a throw in any one of
// them took the whole app down to the last screen; and on the Pass the rail and the alert strip shared the board's
// boundary, so a pickup widget's crash cleared the board mid-service. Each piece is fenced now:
//  · it steps aside (draws nothing, or the `fallback` it was given) and the screen it sat on keeps working;
//  · it is reported once, through the same decision as every crash screen — and a piece that failed because the tab is
//    one build behind (its lazy chunk is gone) heals the tab with the same capped reload, as the page boundary does;
//  · it is tried again on the next screen, so a passing failure does not leave the nav gone for the rest of the visit.
//  · `again` is what a person does to ask for the piece once more (the cart opened, a sheet asked for): when it changes,
//    the piece is tried again then too.
type Props = { name: string; again?: unknown; fallback?: (retry: () => void) => ReactNode; children?: ReactNode };
type Tried = { failed: boolean; at: string | null; again: unknown };

export default function Fence(props: Props) {
  return <FenceAt {...props} at={usePathname()} />;
}

class FenceAt extends Component<Props & { at: string | null }, Tried> {
  state: Tried = { failed: false, at: this.props.at, again: this.props.again };
  static getDerivedStateFromError() { return { failed: true }; }
  // A new screen, or a new ask, is a new try (the state holds the screen and the ask the piece last drew for).
  static getDerivedStateFromProps(p: { at: string | null; again?: unknown }, s: Tried): Partial<Tried> | null {
    return p.at !== s.at || !Object.is(p.again, s.again) ? { failed: false, at: p.at, again: p.again } : null;
  }
  componentDidCatch(error: Error) {
    console.error(error);
    recoverFromCrash(error, { where: `piece:${this.props.name}`, fatal: false });
  }
  retry = () => this.setState({ failed: false });
  render() {
    if (!this.state.failed) return this.props.children ?? null;
    return this.props.fallback ? this.props.fallback(this.retry) : null;
  }
}
