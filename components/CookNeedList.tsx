"use client";

import Icon from "./Icon";
import CookEnforcement from "./CookEnforcement";
import { cookQuantity } from "@/lib/brewMath";

// ── WHAT YOU NEED, STATED TO SOMEBODY WHO IS ABOUT TO MEASURE IT (2026-10-01) ──────────────────
// A new operator is joining who will be cooking. Two screens showed a scaled ingredient list and
// both wrote it the same wrong way — `{qty}{unit}`, whatever the recipe happened to store:
//
//   components/BrewSteps.tsx     "What you need"            the sheet you brew from
//   components/BrewPlanner.tsx   "Exact recipe — scaled ×N" the plan you brew from
//
// So "560 g" never showed ounces, "32 oz" never showed grams, and nothing anywhere said to level
// the scale. Fixing it in two places would have meant two renderings of the same safety rule,
// which is how they drift — one gets edited and the other quietly becomes the old advice. This is
// the ONE home for stating a batch's ingredient list to a cook. Both screens call it.
//
// The numbers themselves are not decided here: cookQuantity() in lib/brewMath owns that, reusing
// the same TO_GRAMS table the batch-sizing math uses. This file owns how it LOOKS; that file owns
// what it SAYS. Neither has a copy of the other's job.

export type CookIngredient = {
  name: string;
  qty: number | string;
  unit?: string | null;
  /** false = a fixed line (one filter per brew) that does not scale with batch size. */
  scales?: boolean;
};

export default function CookNeedList({ ingredients }: { ingredients: CookIngredient[] }) {
  const need = ingredients.filter((i) => i?.name).map((i) => ({ ing: i, q: cookQuantity(i.qty, i.unit) }));
  if (need.length === 0) return null;
  const weighed = need.filter((x) => x.q.needsScale).length;

  return (
    <>
      {/* ONE band, and only when something on THIS list actually goes on a scale. Two deliberate
          restraints, both learned the hard way in this app:

          — NOT one per weighed line. Four copies of the same sentence is the heartbeat flood in
            miniature; repetition is exactly what taught an owner to scroll past the word
            "critical". It is said once, loudly, and names how many lines it governs.
          — NOT on a list with nothing weighed. A warning that appears where it does not apply
            stops being a warning.

          Measured at 420px, every word of this costs about 20px of red. Each sentence is an
          instruction a batch can be ruined without — surface, tare, target, re-zero, scope — so the
          copy is tight rather than short: a band nobody finishes reading is the flood again in one
          paragraph. */}
      {weighed > 0 && (
        <CookEnforcement label="Scale">
          Scale on a <b>hard, flat, level surface</b> — a counter, not a cutting board, towel, tray,
          or the lip of a sink. Empty container on, <b>TARE / ZERO</b> to <b>0</b>, then add until
          the display matches. <b>Re-zero for every ingredient.</b> The{" "}
          {weighed === 1 ? "line" : `${weighed} lines`} marked <b>WEIGH</b> below{" "}
          {weighed === 1 ? "is" : "are"} weighed; everything else is poured or counted and does not
          go on the scale.
        </CookEnforcement>
      )}

      <ul className="ck-need">
        {need.map(({ ing, q }, n) => (
          <li key={n} className={q.needsScale ? "weigh" : undefined}>
            <b>
              <span className="ck-pri">{q.primary}</span>
              {/* Both systems on anything weighed, because the scale in the room and the cookbook
                  on the shelf are not guaranteed to speak the same one. */}
              {q.alt && <i className="ck-alt">{q.alt}</i>}
            </b>
            <span className="ck-need-n">
              {ing.name}
              {ing.scales === false && <i className="ck-fixed">fixed</i>}
              {q.needsScale && <em className="ck-weigh"><Icon name="scale" /> WEIGH</em>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
