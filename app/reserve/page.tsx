"use client";

import AccountPill from "@/components/AccountPill";
import EditCopyPill from "@/components/EditCopyPill";
import EditableCopy from "@/components/EditableCopy";
import Watermark from "@/components/Watermark";
import { Masthead, ClosingBeat } from "@/components/kit";
import OrderFunnel from "@/components/OrderFunnel";
import Reserves from "@/components/Reserves";
import { useSiteCopy } from "@/lib/copy";

// Order-ahead / reserve-your-drop screen, on the kit. One-off Saturday pre-orders — no
// subscription, no plan. Shop's Bottles aisle at a door of its own (the tab bar lights Shop here):
// one line, then the choices. The guest story that followed the order — the Menu tab's three acts
// again, and a button to that tab — went on 2026-10-09; the menu is one tap away.
export default function ReserveScreen() {
  const t = useSiteCopy();
  return (
    <section className="screen" id="s-reserve">
      <Watermark variant="landing" />
      {/* reserve.kicker replaces what was a hardcoded "Order ahead" eyebrow — same text, now
          owner-editable. Still has an Edit pill (unlike Menu/Member card): confirm_return/
          confirm_new (in OrderFunnel's order-done screen) are wired to the copy system but not
          inline-click-editable — see the comment at that note= line for why — so real Settings-only
          content remains in this group. */}
      <Masthead eyebrow={<EditableCopy k="reserve.kicker" value={t("reserve.kicker")} />} right={<div className="mast-right"><EditCopyPill group="Reserve flow" /><AccountPill /></div>} />
      {/* New this round — reserve.headline had no render site anywhere (round o's discovery). Added
          here, same slot/pattern as menu.statement right under its masthead. */}
      <EditableCopy k="reserve.headline" value={t("reserve.headline")} as="p" className="mast-stmt" multiline />
      <Reserves />
      {/* Under the line above it, not against it (2026-10-09). */}
      <div className="mt-4"><OrderFunnel initialMode="pickup" /></div>
      <ClosingBeat />
    </section>
  );
}
