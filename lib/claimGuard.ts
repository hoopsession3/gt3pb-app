// Output claim-guard — the last line of defense for a health-adjacent brand. Nothing the AI SAYS to
// a guest or a staffer may assert a health / medical / allergen effect, even if the model's own
// guardrails slip or a jailbreak coaxes it (the red-team's F5: the system prompts are strong but
// NOTHING enforced them on output). Deterministic + FAIL-SAFE: on a hit we drop the model's text and
// return a compliant redirect. Negation-aware, so ordinary reframes ("we don't make detox claims",
// "it won't cure anything") pass, but affirmative claims ("this detoxes you", "cures your cold") are
// caught. This is the binding claim-compliance rule made mechanical — see the brand claim memory.

// The prohibited-claim set: disease/cure/detox, inflammation/blood-sugar, immune, gene-expression,
// the retired absolutes (toxin-free / microplastic / heavy-metal-free), and allergen/medical safety.
const CLAIM = [
  /\bdetox\w*/i, /\bcleanses?\b/i, /\bcures?\b/i, /\bheals?\b/i, /\btreats?\b/i,
  /\bprevents?\s+(disease|illness|sickness|cancer|diabetes)/i,
  /\banti-?inflammator/i, /\breduces?\s+inflammation\b/i,
  /\b(balances?|stabiliz\w+|regulates?)\s+(your\s+)?blood\s*sugar\b/i,
  /\blowers?\s+(your\s+)?(blood\s*sugar|blood\s*pressure|cholesterol)\b/i,
  /\bwon'?t\s+spike\s+(your\s+)?blood\s*sugar\b/i,
  /\bboosts?\s+(your\s+)?immun/i, /\bimmune[- ]?boost/i,
  /\bgene\s*expression\b/i, /\bepigenetic\w*/i,
  /\btoxin[- ]?free\b/i, /\bflush(es|ing)?\s+(out\s+)?toxins?\b/i, /\bmicroplastics?[- ]?free\b/i,
  /\bheavy[- ]?metal[- ]?free\b/i, /\bmold[- ]?free\b/i,
  /\blactose[- ]?free\b/i, /\bdairy[- ]?free\b/i,
  /\bsafe\s+for\s+(a\s+|your\s+)?(milk|dairy|nut|peanut)\s*allerg/i,
  /\bsafe\s+for\s+diabetics?\b/i,
  /\bclinically\b/i, /\bmedicinal\b/i, /\bweight[- ]?loss\b/i,
];

// A negator (or "no"/"without") in the ~34 chars right before the match means it's a reframe/denial,
// not a claim — let it through. Catches "we don't detox", "it's not a cure", "no health claims".
const NEG = /\b(not|never|no|non|without|isn'?t|aren'?t|wasn'?t|won'?t|can'?t|cannot|don'?t|doesn'?t|didn'?t|wouldn'?t|shouldn'?t|nothing|neither|avoid|skip)\b[^.!?]{0,20}$/i;

export function claimSafe(text: string): { ok: boolean; hit: string | null } {
  const t = text || "";
  for (const re of CLAIM) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (!m) continue;
    const before = t.slice(Math.max(0, m.index - 34), m.index);
    if (NEG.test(before)) continue; // negated / reframed — allowed
    return { ok: false, hit: m[0] };
  }
  return { ok: true, hit: null };
}

// The compliant redirect we return in place of a tripped reply — on-brand, points anything medical to
// the crew or a doctor, and offers the thing we CAN talk about (what's in the cup).
export const CLAIM_FALLBACK =
  "I can tell you exactly what's in it and why we chose it — but I can't speak to health, medical, or allergy effects. For anything like that, the crew at the window or your doctor is the right call. Want the rundown on what's actually in the drink?";
