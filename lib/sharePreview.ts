// WHAT A LINK SENDS, SAID BEFORE IT'S SENT (IMS7-0467). Ryan: "a concise pre-share preview showing the actual information
// categories and free-text content that an investor will receive." The preview reads the link's real response — the
// database builds it with the same function the link's door uses (vision_share_payload) — and this sorts it for a
// person: each category, how many, and every piece of free text in it, word for word. Nothing is summarised away: any
// text this doesn't know where to file lands in "Anything else", so a field added to the response later is shown, not
// hidden. Pure.

import { moneyRound } from "./money";

type J = unknown;
type Obj = Record<string, J>;
export type PreviewSection = { key: string; title: string; count: number; texts: string[] };
export type Preview = { sections: PreviewSection[]; other: string[]; total: number };

const obj = (v: J): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: J): J[] => (Array.isArray(v) ? v : []);
const str = (v: J): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Fields that carry no one's words — ids, dates, fixed words and numbers — by key, wherever they sit.
const NOT_TEXT = new Set(["id", "program_id", "plan_id", "layout_id", "needs_plan_id", "kind", "status", "state", "horizon", "format", "phase",
  "start_on", "target_on", "due_on", "done_on", "retrieved_at", "approved_at", "pinned_at", "expires_at", "at", "reviewBy", "on", "confidence",
  "category", "key", "demandFrom", "bearing", "likelihood", "impact", "topic", "version", "sort", "show_asks"]);
// Where each kind of free text is filed, by its path (array positions as []; scenario names as <scenario>).
const FILED: [RegExp, string][] = [
  [/^\$\.label$/, "link"],
  [/^\$\.programs\[\]\.(title|summary|why|lane|emoji)$/, "programs"],
  [/^\$\.plans\[\]\.(name|place|summary|why|gate|customer|market|positioning|deal)$/, "plans"],
  [/^\$\.plans\[\]\.needs\[\]\.label$/, "needs"],
  [/^\$\.asks\[\]\.(label|note)$/, "asks"],
  [/^\$\.plans\[\]\.money\.baseline\.scenarios\.<scenario>\.(uses|mix)\[\]\.label$/, "money"],
  [/^\$\.plans\[\]\.money\.baseline\.acknowledged\[\]\.note$/, "money"],
  [/^\$\.plans\[\]\.research\[\]\.(claim|figure|source_title|source_url)$/, "research"],
  [/^\$\.plans\[\]\.risks\[\]\.(words|mitigation)$/, "risks"],
  [/^\$\.layouts\[\]\.name$/, "rooms"],
  [/^\$\.layouts\[\]\.items\[\]\.(label|why)$/, "rooms"],
];
const TITLES: Record<string, string> = { link: "Who it's for", programs: "Roadmap programs", plans: "Plans", needs: "Open needs", asks: "Where capital may be needed",
  money: "Approved money", research: "Research", risks: "Risks", rooms: "Rooms" };

/** Every string in the response, with its path — so nothing is missed. */
function strings(v: J, path: string, out: { path: string; key: string; text: string }[], key = "") {
  if (Array.isArray(v)) { for (const x of v) strings(x, `${path}[]`, out, key); return; }
  if (v && typeof v === "object") { for (const [k, x] of Object.entries(v as Obj)) strings(x, path.endsWith(".scenarios") ? `${path}.<scenario>` : `${path}.${k}`, out, k); return; }
  const s = str(v);
  if (s) out.push({ path, key, text: s });
}

export function previewOf(payload: J): Preview {
  const p = obj(payload), plans = arr(p.plans).map(obj);
  const count: Record<string, number> = {
    link: str(p.label) ? 1 : 0,
    programs: arr(p.programs).length,
    plans: plans.length,
    needs: plans.reduce((a, x) => a + arr(x.needs).length, 0),
    asks: arr(p.asks).length,
    money: plans.filter((x) => x.money).length,
    research: plans.reduce((a, x) => a + arr(x.research).length, 0),
    risks: plans.reduce((a, x) => a + arr(x.risks).length, 0),
    rooms: arr(p.layouts).length,
  };
  const texts: Record<string, string[]> = Object.fromEntries(Object.keys(TITLES).map((k) => [k, []]));
  const other: string[] = [];
  const all: { path: string; key: string; text: string }[] = [];
  strings(payload, "$", all);
  for (const s of all) {
    const home = FILED.find(([re]) => re.test(s.path))?.[1];
    if (home) { if (!texts[home].includes(s.text)) texts[home].push(s.text); }
    else if (!NOT_TEXT.has(s.key) && !/^\$\.plans\[\]\.waits_on\[\]$|pillars\[\]$/.test(s.path)) other.push(s.text);
  }
  // The amounts asked for are said with the asks (numbers, not free text, but the point of the category).
  for (const a of arr(p.asks).map(obj)) { const u = typeof a.amount_cents === "number" ? (a.amount_cents === 0 ? "no capital needed" : moneyRound(a.amount_cents)) : "amount to be set"; if (u && str(a.label)) texts.asks = texts.asks.map((t) => (t === str(a.label) ? `${t} — ${u}` : t)); }
  const sections = Object.keys(TITLES).filter((k) => count[k] > 0 || texts[k].length > 0).map((k) => ({ key: k, title: TITLES[k], count: count[k], texts: texts[k] }));
  return { sections, other: [...new Set(other)], total: all.length };
}

/** The plans and needs a link carries (IMS8 A1): only plans ticked under a program that's ticked, and needs only of those
 *  plans — a plan whose program was unticked isn't carried, unseen, into the link. Pure. */
export function inScope(plans: readonly { id: string; program_id?: string | null }[], programs: readonly string[], pickPlans: readonly string[], pickNeeds: readonly string[]): { plans: string[]; needs: string[] } {
  const ok = new Set(plans.filter((p) => p.program_id && programs.includes(p.program_id)).map((p) => p.id));
  const kept = pickPlans.filter((id) => ok.has(id));
  return { plans: kept, needs: pickNeeds.filter((id) => kept.includes(id)) };
}
