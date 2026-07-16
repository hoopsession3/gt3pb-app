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

// A negator (or "no"/"without") ANYWHERE in the same sentence as the match means it's a reframe/
// denial, not a claim — let it through. Catches "we don't detox" (negator before) AND "detox isn't
// something we claim" (negator after) — sentence-scoped, not a fixed-width lookback, because natural
// hedges vary in length and routinely put the negator AFTER the trigger word ("immune support isn't
// something I can speak to"). A backward-only fixed window can never catch that second shape at all,
// regardless of how wide it is — this bit the concierge for real: Haiku's own compliant hedges (the
// exact phrasing the system prompt asks for) were tripping the guard and getting silently swapped for
// the canned CLAIM_FALLBACK, so two different guest questions came back with byte-identical replies.
const NEG = /\b(not|never|no|non|without|isn'?t|aren'?t|wasn'?t|won'?t|can'?t|cannot|don'?t|doesn'?t|didn'?t|wouldn'?t|shouldn'?t|nothing|neither|avoid|skip)\b/i;

export function claimSafe(text: string): { ok: boolean; hit: string | null } {
  const t = text || "";
  for (const base of CLAIM) {
    // Scan EVERY occurrence, not just the first. A negated first mention ("we don't claim it detoxes")
    // must NOT let a later affirmative one ("…but it detoxes your liver") slip past — the old code
    // exec'd once and `continue`d on a negated first hit, skipping the rest of that pattern entirely.
    const re = new RegExp(base.source, base.flags.includes("g") ? base.flags : `${base.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++; // guard against a zero-width match looping forever
      // The sentence containing THIS occurrence — nearest .!? (or string edge) on each side — checked
      // for a negator in either direction. Recomputed per-occurrence so a later, different sentence
      // still gets caught even if an earlier one in the same reply was a legitimate negated reframe.
      const sentStart = Math.max(t.lastIndexOf(".", m.index - 1), t.lastIndexOf("!", m.index - 1), t.lastIndexOf("?", m.index - 1)) + 1;
      const afterRel = t.slice(re.lastIndex).search(/[.!?]/);
      const sentEnd = afterRel === -1 ? t.length : re.lastIndex + afterRel;
      const sentence = t.slice(sentStart, sentEnd);
      if (NEG.test(sentence)) continue;  // this occurrence is negated/reframed — check the next one
      return { ok: false, hit: m[0] };   // an un-negated occurrence — a real claim
    }
  }
  return { ok: true, hit: null };
}

// The compliant redirect we return in place of a tripped reply — on-brand, points anything medical to
// the crew or a doctor, and offers the thing we CAN talk about (what's in the cup).
export const CLAIM_FALLBACK =
  "I can tell you exactly what's in it and why we chose it — but I can't speak to health, medical, or allergy effects. For anything like that, the crew at the window or your doctor is the right call. Want the rundown on what's actually in the drink?";

// claimSafe() checks ONE string. Most of the ~25 AI copy routes don't return a single chat string —
// they force a `tool_use` call (draft_captions, brief_campaign, prep_list, …) whose real guest/staff-
// facing prose lives nested inside the tool's structured `input` (a caption three levels deep in
// `options[1].caption`, a briefing's `by_area[3].note`, etc.). claimSafe() alone never sees those —
// which is exactly the gap this session's audit found: only operator + concierge (plain r.text chat)
// were ever wired up. claimSafeDeep() walks an arbitrary object/array — the whole tool_use `input`,
// or any slice of it — and runs claimSafe() on every string leaf it finds, so a claim can't hide in a
// field nobody thought to name explicitly. Returns the FIRST hit (dot/bracket path + matched text) so
// a caller can log exactly which field tripped; ok:true means every string leaf passed.
export function claimSafeDeep(value: unknown, path = ""): { ok: boolean; path: string | null; hit: string | null } {
  if (typeof value === "string") {
    const r = claimSafe(value);
    return r.ok ? { ok: true, path: null, hit: null } : { ok: false, path: path || "(root)", hit: r.hit };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = claimSafeDeep(value[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true, path: null, hit: null };
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = claimSafeDeep(v, path ? `${path}.${k}` : k);
      if (!r.ok) return r;
    }
    return { ok: true, path: null, hit: null };
  }
  return { ok: true, path: null, hit: null }; // numbers/booleans/null — nothing to scan
}
