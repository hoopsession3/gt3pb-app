// THE CASE'S HEADLINES (IP1.2, the editorial pass; split out of lib/visionPresent so the presenter's first chunk carries no
// money formatter — only the lazy case slide reads these). A slide's title says what its numbers mean, from the engine.
import type { Model } from "./visionMoney";
import { dollars } from "./finance";

/** The ask's headline: the plan's bottom line, after the investor is paid. */
export function askHeadline(m: Model, structure: string): string {
  const inv = structure !== "none";
  const n = inv ? m.paybackAfterMonth : m.paybackMonth;
  if (m.startupSpend <= 0) return "Nothing to earn back — the plan opens without startup costs.";
  if (n) return `Earns back its opening cost by month ${n}${inv ? ", after paying the investor" : ""}.`;
  return `Doesn't earn back its opening cost within three years${inv ? " once the investor is paid" : ""}.`;
}

/** The cash headline: the low point, said plainly. */
export function cashHeadline(m: Model): string {
  const open = m.months[0].cumulative - m.months[0].net;
  let low = open, at = 0;
  m.months.forEach((x, i) => { if (x.cumulative < low) { low = x.cumulative; at = i + 1; } });
  return low >= 0 ? `In the plan, cash never falls below ${dollars(low)}.` : `In the plan, cash runs ${dollars(-low)} short in month ${at}.`;
}
