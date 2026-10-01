"use client";

import Icon from "./Icon";

// ── THE THING THAT MUST NOT BE MISSED (2026-10-01) ─────────────────────────────────────────────
// A new operator is joining who will also be cooking. Ryan asked for enforcements in red,
// highlighted, animated, "to make sure that nothing gets messed up".
//
// THREE THINGS THIS DELIBERATELY DOES THAT A RED ANIMATED DIV WOULD NOT:
//
// 1. IT IS NOT RED TEXT. globals.css already learned this the hard way — "brand red is a FILL
//    color; as small TEXT on dark it sits under 3:1". A safety instruction rendered in failing
//    contrast is a safety instruction nobody reads. So: a filled red band with cream type on it,
//    which is both the highest contrast available and the loudest thing on the screen.
//
// 2. COLOUR IS NEVER THE ONLY SIGNAL. Roughly one man in twelve has a red-green colour vision
//    deficiency, and this is a kitchen hiring cooks, not a design portfolio. The band carries an
//    icon AND the word CHECK AND its own border, so it still reads as "stop and look" in greyscale.
//
// 3. THE ANIMATION STOPS FOR ANYONE WHO ASKED IT TO. prefers-reduced-motion is not a nicety —
//    for somebody with vestibular sensitivity a pulsing band is a reason to look away from the
//    exact instruction we need them to read. Under that setting the band keeps the red, the icon
//    and the border and simply holds still, so nothing is lost but the movement.
//
// role="alert" so a screen reader announces it when it appears, rather than leaving it to be
// discovered by someone scrubbing the page.
export default function CookEnforcement({
  children,
  label = "Check",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <p className="ck-enforce" role="alert">
      <span className="ck-enforce-tag" aria-hidden="true">
        <Icon name="warning" />
        <b>{label.toUpperCase()}</b>
      </span>
      <span className="ck-enforce-t">{children}</span>
    </p>
  );
}
