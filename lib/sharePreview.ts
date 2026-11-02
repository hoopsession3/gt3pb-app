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
export const NOT_TEXT = new Set(["id", "program_id", "plan_id", "layout_id", "needs_plan_id", "kind", "status", "state", "horizon", "format", "phase",
  "start_on", "target_on", "due_on", "done_on", "retrieved_at", "approved_at", "pinned_at", "expires_at", "at", "reviewBy", "on", "confidence",
  "category", "key", "demandFrom", "bearing", "likelihood", "impact", "topic", "version", "sort", "show_asks", "deal"]);
// Where each kind of free text is filed, by its path (array positions as []; scenario names as <scenario>).
const FILED: [RegExp, string][] = [
  [/^\$\.label$/, "link"],
  [/^\$\.programs\[\]\.(title|summary|why|lane|emoji)$/, "programs"],
  [/^\$\.plans\[\]\.(name|place|summary|why|gate|customer|market|positioning)$/, "plans"],
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

// ── THE INSPECTOR'S WORDS (IMS8 P6) ─────────────────────────────────────────────────────────────────────────────────
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listed = (w: string[]) => (w.length <= 2 ? w.join(" and ") : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`);

/** What a link sends, in one sentence, counted from the response itself — never from what was ticked. */
export function sendsSentence(payload: J): string {
  const p = obj(payload), plans = arr(p.plans).map(obj);
  const money = plans.filter((x) => x.money).length, needs = plans.reduce((a, x) => a + arr(x.needs).map(obj).filter((n) => !n.done_on).length, 0);
  const research = plans.reduce((a, x) => a + arr(x.research).length, 0), asks = arr(p.asks).length, rooms = arr(p.layouts).length, programs = arr(p.programs).length;
  const parts = [
    programs && count(programs, "program"),
    plans.length && `${count(plans.length, "plan")}${money ? ` (${money === plans.length ? (money === 1 ? "with its approved money case" : "each with its approved money case") : `${money} with an approved money case`})` : ""}`,
    needs && count(needs, "open need"),
    research && count(research, "research finding"),
    asks && count(asks, "ask"),
    rooms && count(rooms, "room"),
  ].filter((x): x is string => !!x);
  const { fields } = textFields(payload);
  return parts.length ? `It sends ${listed(parts)} — and ${count(fields, "text field")} written by you or your team, each shown word for word below.` : "It sends nothing of the plan yet — only who it's for.";
}

/** How many text fields a response carries (each a distinct value, as the inspector lists them) and a few to recognise
 *  them by: the first value of up to three categories, shortest first within each (IMS8 P11 — a bare count of "your
 *  writing" said what, not which). */
export function textFields(payload: J): { fields: number; examples: { title: string; text: string }[] } {
  const { sections, other } = previewOf(payload);
  const fields = sections.reduce((a, s) => a + s.texts.length, 0) + other.length;
  const examples = sections.filter((s) => s.key !== "link" && s.texts.length).slice(0, 3)
    .map((s) => ({ title: s.title, text: [...s.texts].sort((a, b) => a.length - b.length)[0] }));
  return { fields, examples };
}

/** What the investor's screen works out from what's sent — figures and judgements that aren't sent as text, so the owner
 *  knows they'll appear (IMS8 P11: included, excluded and derived, told apart). Only what this response supports. */
export function derivedOf(payload: J): string[] {
  const p = obj(payload), plans = arr(p.plans).map(obj), out: string[] = [];
  const cases = plans.filter((x) => x.money).map((x) => str(x.name) ?? "A plan");
  if (cases.length) out.push(`From ${listed(cases)}'s approved money: opening cost, funding needed, monthly cash for three years in three scenarios, break-even, payback, return before and after the investor, and the investor's return (IRR) — worked out on their screen by the same model you use`);
  if (cases.length) out.push("A readiness score and what's still to close, worked out from the approved money and its accepted research — a checklist, not a probability");
  if (arr(p.asks).length) out.push("Totals of the asks by where each stands (open, committed, funded) — an ask with no amount is said as being priced, never $0");
  if (arr(p.layouts).length) out.push("Each room's floor area, from its recorded width and depth, and how guests might flow through it at a chosen pace");
  if (plans.some((x) => arr(x.needs).length)) out.push("Next steps: the open needs, soonest first");
  return out;
}

/** Never on any link: what vision_share_payload (0467) doesn't name. Said so a person knows, not guesses. */
export const NEVER_SENT = [
  "Who made the link, its key, and who opened it",
  "Notes on needs, and who owns them",
  "A room's notes; library links, suppliers and prices of what's placed",
  "Money that isn't approved — drafts and versions after the link's date",
  "Research that isn't accepted",
  "Recipes, the Standard, HQ, and anything outside the vision",
] as const;

/** What this response leaves out that it could have carried: the asks, and per plan its money and research. */
export function notChosen(payload: J): string[] {
  const p = obj(payload), out: string[] = [];
  if (p.show_asks !== true) out.push("The asks — not chosen");
  for (const x of arr(p.plans).map(obj)) {
    const name = str(x.name) ?? "A plan";
    if (!x.money) out.push(`${name}'s money — not chosen, or not approved yet`);
    if (x.research == null) out.push(`${name}'s research — not chosen`);
    if (!arr(x.needs).length) out.push(`${name}'s open needs — not chosen`);
  }
  return out;
}
