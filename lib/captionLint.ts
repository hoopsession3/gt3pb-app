// Caption linter — pure, deterministic. Catches the things that bite a health-adjacent beverage
// brand before a caption ships: medical/nutrition claims, missing honey disclosure, the "ChatGPT
// smell," and weak hooks. Advisory, not blocking — flags for the writer to decide.

export type LintLevel = "warn" | "info";
export interface LintFinding { level: LintLevel; tag: string; msg: string }

const HEALTH = [
  /\bcures?\b/i, /\bdetox/i, /\bheals?\b/i, /\bclinically\b/i, /\bweight[- ]?loss\b/i,
  /\banti-?inflammatory\b/i, /\bboosts?\s+(your\s+)?immun/i, /\blowers?\s+(your\s+)?(blood|cholesterol)/i,
  /\btreats?\b/i, /\bprevents?\s+(disease|illness|sickness)/i, /\bmedicinal\b/i, /\bcortisol\b/i,
];
const SMELL = [
  /\belevate\b/i, /\bunleash\b/i, /\bindulge\b/i, /\bgame[- ]?changer\b/i, /look no further/i,
  /it'?s not just/i, /whether you'?re/i, /\bdiscover\b/i, /\bperfect for\b/i, /\blevel up\b/i, /\bexperience the\b/i,
];

// Common GT3/brand misspellings — a typo on a premium brand reads as carelessness.
const TYPOS: [RegExp, string][] = [
  [/\borgin\b/i, "origin"], [/\boriginn?\b(?<!origin)/i, "origin"], [/\bintenton\w*/i, "intentionally"],
  [/\bhydraton\b/i, "hydration"], [/\bseperate/i, "separate"], [/\bdefinately\b/i, "definitely"],
  [/\bspeciality\b/i, "specialty"], [/\boccassion/i, "occasion"],
  // brand product name — it's "Nature's Aide", never "Nature Aide" / "Nature Aid" / "Nature's Aid"
  [/\bnature'?s? aid\b/i, "Nature's Aide"], [/\bnature aide\b/i, "Nature's Aide"],
];

export function lintCaption(text: string): LintFinding[] {
  const out: LintFinding[] = [];
  const t = (text || "").trim();
  if (!t) return out;
  for (const [re, fix] of TYPOS) { const m = t.match(re); if (m) { out.push({ level: "warn", tag: "spelling", msg: `Likely typo "${m[0]}" → "${fix}".` }); break; } }
  for (const re of HEALTH) { const m = t.match(re); if (m) { out.push({ level: "warn", tag: "claim", msg: `Possible health claim — "${m[0]}". GT3 doesn't make medical/nutrition claims.` }); break; } }
  if (/\b(no|zero|without)\b[^.!?\n]*\bsugar\b/i.test(t) || /\bsugar[- ]?free\b/i.test(t)) out.push({ level: "warn", tag: "disclosure", msg: "Says no/zero sugar — disclose the sweetener (organic local honey in Tide, organic maple in Nature's Aide / Salted Maple Latte, and other sweetened items)." });
  const smell = [...new Set(SMELL.filter((re) => re.test(t)).map((re) => (t.match(re)![0]).toLowerCase()))];
  if (smell.length) out.push({ level: "info", tag: "voice", msg: `"ChatGPT smell": ${smell.join(", ")} — cut for the GT3 voice.` });
  const first = (t.split("\n")[0] || "").trim();
  if (/^(hi|hey|hello|welcome|good\s+(morning|afternoon|evening))\b/i.test(first) || /^discover\b/i.test(first) || (first.endsWith("?") && first.length < 70))
    out.push({ level: "info", tag: "hook", msg: "Open harder — the first line should earn the next, not greet or ask." });
  if (/!\s*\S+\s*!/.test(t) || /!!/.test(t)) out.push({ level: "info", tag: "voice", msg: "Exclamation points read hyped — GT3 is measured." });
  return out;
}
