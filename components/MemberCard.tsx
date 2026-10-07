"use client";

import dynamic from "next/dynamic";

// THE MEMBER CARD, LOADED WHEN IT IS OPENED (2026-10-06, the iPhone round, part 3).
//
// StatusCard — the card that spins, takes your photo and draws your status for sharing — opens from
// the account menu, the stamp card and the membership card, which is to say from every customer
// screen. It was imported into each of them, so every screen downloaded it before anyone asked to
// see it: 4.2–4.8 KB of script, gzipped, on each of fourteen routes (measured 2026-10-07 against
// 47e762e; scripts/design.ratchet.mjs WEIGHT). This is the one door to it: the card's code loads when
// the card is opened, and in the app, where it is bundled, that is no wait at all. scripts/smoke.cjs
// holds every screen to this door.
const StatusCard = dynamic(() => import("./StatusCard"), { ssr: false });

export default function MemberCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <StatusCard open onClose={onClose} /> : null;
}
