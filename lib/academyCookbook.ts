// THE COOKBOOK — GT3's recipes, ratios and process specs (IP0 containment, 2026-10-27).
//
// CONFIDENTIAL. Moved out of lib/academy.ts, which ships to every browser that opens /academy: production served all of
// it to anyone, signed in or not. This module is read only on the server — app/api/academy/cookbook (staff, the
// Academy's audience) and the agents' knowledge (lib/operatorKb, lib/agentKnowledge). scripts/ip0.test.mjs fails the
// build's tests if any client module can reach it. Who may read it is one constant in that route (COOKBOOK_AUDIENCE).
import type { Cookbook } from "./academy";

export const COOKBOOK: Record<string, Cookbook> = {
  "rise": { weighs: true, batch: "Standard Batch — GT3 (1:13, ~18-hr cold extraction).", brew: ["Weigh beans 1:13 to mineral water", "Cold-extract ~18 hrs", "Filter, log batch + signal score (target 8+)"], serve: ["Pour over ice", "Top with organic coconut water", "Serve in glass, made to order"], storage: "Keep cold; use within the standard hold window.", quality: "Signal Score 8+ (Energy/Clarity/Flavor/Smoothness).", troubleshoot: [{ issue: "Too bitter", fix: "Check grind/time — over-extraction; pull back toward spec." }, { issue: "Weak", fix: "Verify 1:13 ratio and full 18-hr extraction." }] },
  "flow": { batch: "Standard Batch — GT3 with cacao-nib infusion.", brew: ["Brew base to spec", "Infuse organic cacao nibs", "Filter and log batch"], serve: ["Pour over ice in glass"], storage: "Keep cold; standard hold window.", quality: "Signal Score 8+; cacao aroma present, not muddy.", troubleshoot: [{ issue: "Muddy/silty", fix: "Improve filtration after nib infusion." }] },
  "dusk": { batch: "Standard Batch — GT3 with cinnamon + cardamom.", brew: ["Brew base to spec", "Add Ceylon cinnamon + green cardamom", "Filter and log batch"], serve: ["Pour over ice; garnish per spec"], storage: "Keep cold; standard hold window.", quality: "Spice aromatic, balanced — not gritty.", troubleshoot: [{ issue: "Gritty", fix: "Use infusion, not loose ground spice in the bottle." }] },
  "nature_aid": { batch: "Mix to order (no long batch).", brew: ["Combine coconut water + lime juice", "Add organic maple syrup + sea salt to spec", "Stir until fully dissolved"], serve: ["Serve cold, in glass"], storage: "Make to order; keep cold.", quality: "Balanced sweet-and-salt, never cloying.", troubleshoot: [{ issue: "Too sweet", fix: "Reduce maple to spec." }, { issue: "Tastes flat", fix: "A pinch more sea salt lifts it." }] },
  "tide": { batch: "Blend to order (no long batch).", brew: ["Combine young coconut water + young organic Thai coconut meat", "Add measured organic local honey per spec", "Blend until smooth"], serve: ["Serve cold, in glass, immediately"], storage: "Make to order; do not hold blended.", quality: "Smooth, no separation at serve.", troubleshoot: [{ issue: "Too sweet", fix: "Reduce honey to spec; honey is the only added sweetener." }, { issue: "Separating", fix: "Serve immediately after blend." }] },
  "nitro": { batch: "Keg the Standard Batch cold brew (Torpedo keg + pure N₂).", brew: ["Chill the cold brew to 34–40°F first", "Fill the keg leaving headspace (don't top off)", "Hook up PURE nitrogen; set the regulator to 35 PSI (range 30–45 — not 10)", "Gently shake/roll the keg 2–5 min at 35 PSI to dissolve nitrogen", "Rest cold 30–60 min minimum — overnight is better"], serve: ["Open the stout/nitro faucet fully, pour straight, no ice", "Let it cascade and settle into a creamy head"], storage: "Keep the keg cold and pressurized at ~35 PSI.", quality: "Tight cascade + fine, creamy microfoam.", troubleshoot: [{ issue: "Flat pour", fix: "Flush the restrictor disc; confirm ~35 PSI, keg cold + rested. Just charged → needs more rest." }, { issue: "Foamy/wild", fix: "Keg too warm or over-pressured — cool fully, ease toward 35 PSI." }] },
  "cold_extract": { weighs: true, batch: "Standard Batch — GT3: 1:13 beans to mineral water, ~18-hr extraction.", brew: ["Weigh to 1:13", "Cold-extract ~18 hrs", "Filter; log batch + signal score"], serve: ["Use as the base for Rise/Flow/Dusk/Nitro"], storage: "Keep cold; honor the hold window.", quality: "Signal Score 8+; smoothness is the watch metric.", troubleshoot: [{ issue: "Low smoothness signal", fix: "Adjust grind/time toward spec; re-profile." }] },
  "salted_maple": {
      byVolume: true,
      batch: "10 oz bottle: 6.5 fl oz DUSK, 2 fl oz goat milk, 3 tbsp Salted Maple Syrup. 32 oz bottle: 20 fl oz DUSK, 6 fl oz goat milk, 9 tbsp syrup (½ cup + 1 tbsp). More bottles: multiply the 10 oz amounts. One batch of syrup makes 8 × 10 oz bottles.",
      brew: [
        "Syrup (makes 8 bottles): warm 12 fl oz organic maple syrup in a pan on low heat.",
        "Stir in 2 tbsp sea salt until it dissolves.",
        "Take it off the heat as soon as it starts to bubble — don't let it bubble over.",
        "Cool, then store in a glass container.",
        "To build a bottle, shake or stir the syrup first.",
        "Into a 10 oz bottle: 6.5 fl oz DUSK, 2 fl oz goat milk, 3 tbsp syrup (a 32 oz bottle: 20 fl oz, 6 fl oz, 9 tbsp).",
        "Cap and shake. No extra salt — it's all in the syrup.",
      ],
      serve: ["Over ice, or served warm per build", "Made to order"],
      storage: "Make to order. Syrup: glass container; shake or stir before each use.",
      quality: "Sweet-salty balance; maple-forward, not cloying.",
      troubleshoot: [{ issue: "Too sweet or too salty", fix: "Check the build: 3 tbsp syrup per 10 oz bottle and no added salt." }],
    },
  "bone_broth": { batch: "Cook a batch per broth spec.", brew: ["Cook pasture-raised bones for hours per spec", "Strain, season to spec", "Cool and hold safely"], serve: ["Serve hot in cup", "Hold hot at safe temp"], storage: "Hold hot; discard outside safe hold window.", quality: "Clear, rich, well-seasoned; no off-notes.", troubleshoot: [{ issue: "Greasy", fix: "Skim fat; strain again." }, { issue: "Flat", fix: "Season to spec; check cook time." }] },
  "coconut_shake": { batch: "Blend to order.", brew: ["Blend coconut water + extra coconut meat for body", "Add honey to spec"], serve: ["Serve cold immediately"], storage: "Make to order.", quality: "Creamy, smooth, no separation.", troubleshoot: [{ issue: "Too thin", fix: "Add coconut meat for body." }] },
};
