// IS THIS LINK READY TO SEND? (IMS8 P4, the publishing studio's judgement.) Ryan: "three distinct readiness bands…
// every finding carries source, explanation, go and severity… reuse score / money / spatial / library / roadmap." Pure,
// deterministic, no AI: it reads two things and decides nothing the engines haven't.
//
//   draftChecks(draft, ctx)       — before review: what the database refuses (enforced) or needs an owner (approval).
//   payloadChecks(payload, opts)  — on the reviewed response, word for word what the investor would receive: what you
//                                   must confirm (material), what's worth a look (concern), and wording (editorial).
//   readinessOf(findings)         — the band, one verdict, the first three findings and how many more.
//
// THE FIVE CLASSES (IMS8 plan §5). enforced: the database refuses it, never offered. approval: an existing rule needs an
// owner (0451: only an owner gives a link money) — a tap never overrides either. material: true of what would be sent and
// worth an owner's explicit yes (an amount that will read "Being priced", a cost line with no price, words that look
// internal, a newer approved version than the one the link shows) — each has a stable `confirm` id, and P5's server
// review computes the same ids from the same response and accepts a link only with exactly those confirmed. concern and
// editorial never stop anything.
//
// THE RULES THE SERVER MIRRORS (0472) are the ones marked material; their patterns are exported (INTERNAL_WORDS,
// INTERNAL_RE_SOURCES) so the database's copy is tested against these, not retyped from memory.
import { insight, LEVEL_OF, type Insight, type Ref } from "./insight";
import { NOT_TEXT } from "./sharePreview";
import { toVision } from "./visionRead";
import { figuresOf } from "./visionCase";
import { investorReadiness } from "./investorView";

export type PublishClass = "enforced" | "approval" | "material" | "concern" | "editorial";
export const CLASSES: readonly PublishClass[] = ["enforced", "approval", "material", "concern", "editorial"];
export const CLASS_WORD: Record<PublishClass, string> = { enforced: "Can't go", approval: "Needs the owner", material: "Confirm before sharing", concern: "Worth a look", editorial: "Wording" };
export type PublishFinding = Insight & { cls: PublishClass; confirm: string | null };
export type Band = "cant" | "confirm" | "ready";
export const BAND_WORD: Record<Band, string> = { cant: "Can't share yet", confirm: "Ready once you confirm", ready: "Ready to share" };

type J = unknown;
type Obj = Record<string, J>;
const obj = (v: J): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: J): J[] => (Array.isArray(v) ? v : []);
const str = (v: J): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function finding(cls: PublishClass, rule: string, subject: Ref, words: string, o: { action?: string; go?: Insight["go"]; about?: string; evidence?: Insight["evidence"]; refuses?: string } = {}): PublishFinding {
  const i = insight({
    engine: "publish", rule, subject, about: o.about, native: { scale: "publish", value: cls }, level: LEVEL_OF.publish[cls], words,
    action: o.action ?? null, go: o.go ?? null, evidence: o.evidence ?? [], visibility: ["owner", "editor"],
    blocks: cls === "enforced" || cls === "approval", refuses: o.refuses, mark: `${cls}|${rule}|${subject.id}${o.about ? `|${o.about}` : ""}`,
  });
  return { ...i, cls, confirm: cls === "material" ? `${rule}:${subject.kind}:${subject.id}` : null };
}

// ── BEFORE REVIEW: the draft ────────────────────────────────────────────────────────────────────────────────────────
export type DraftIn = { label: string; programs: readonly string[]; plans: readonly string[]; needs: readonly string[]; rooms: readonly string[]; money?: readonly string[]; showAsks: boolean };
export type DraftCtx = { canEdit: boolean; isOwner: boolean;
  programs: readonly { id: string; title: string }[]; rooms: readonly { id: string; name: string }[];
  plans: readonly { id: string; name: string; program_id: string | null; shareable?: boolean }[] };

export function draftChecks(d: DraftIn, ctx: DraftCtx): PublishFinding[] {
  const out: PublishFinding[] = [];
  const link: Ref = { kind: "link", id: "draft" };
  if (!ctx.canEdit) out.push(finding("enforced", "no_editor", link, "Only an owner or admin makes a link.", { refuses: "vision_shares: owners and admins only (0447)" }));
  if (!d.label.trim()) out.push(finding("enforced", "no_label", link, "Say who it's for — the link is named for them.", { action: "Name it", refuses: "a link has a name (0447)" }));
  if (!d.programs.length && !d.rooms.length) out.push(finding("enforced", "nothing_chosen", link, "Nothing is chosen yet — pick at least one program or room. Nothing is included until you choose it.", { action: "Choose what it shows" }));
  const known = { programs: new Set(ctx.programs.map((p) => p.id)), rooms: new Set(ctx.rooms.map((r) => r.id)), plans: new Map(ctx.plans.map((p) => [p.id, p])) };
  for (const id of [...d.programs.filter((x) => !known.programs.has(x)), ...d.rooms.filter((x) => !known.rooms.has(x)), ...d.plans.filter((x) => !known.plans.has(x))])
    out.push(finding("enforced", "not_this_business", { kind: "link", id }, "Something chosen isn't this business's — it's left out.", { refuses: "a link shows only its own business's records (0464, 0467)" }));
  for (const id of d.plans) {
    const p = known.plans.get(id);
    if (!p) continue;
    if (p.shareable === false) out.push(finding("enforced", "plan_not_shown", { kind: "plan", id, name: p.name }, `${p.name} isn't marked "Show it on a link", so it won't go.`, { action: "Mark it to show", go: { section: "plans", anchor: id }, refuses: "only plans marked to show (0448)" }));
    else if (!p.program_id || !d.programs.includes(p.program_id)) out.push(finding("enforced", "plan_not_shown", { kind: "plan", id, name: p.name }, `${p.name} is in a program that isn't chosen, so it won't go.`, { action: "Choose its program", refuses: "a plan goes only under a chosen program (0467)" }));
  }
  for (const id of d.money ?? []) {
    const p = known.plans.get(id);
    if (!ctx.isOwner) out.push(finding("approval", "money_owner_only", { kind: "plan", id, name: p?.name }, `Only an owner can give a link ${p?.name ?? "a plan"}'s money.`, { refuses: "vision_shares case guard: owners only (0451)" }));
    if (!d.plans.includes(id)) out.push(finding("enforced", "money_without_plan", { kind: "plan", id, name: p?.name }, `${p?.name ?? "A plan"}'s money is chosen but the plan isn't — it won't go.`, { action: "Choose the plan", refuses: "money goes only with its plan (0467)" }));
  }
  return out;
}

// ── ON THE RESPONSE: what would be sent ─────────────────────────────────────────────────────────────────────────────
/** Words that read as internal. Matched whole-word, any case. The database (0472) holds the same list. */
export const INTERNAL_WORDS = ["internal", "confidential", "do not share", "don't share", "not for investors", "private", "password", "secret", "api key", "token"] as const;
/** An email address and a phone number, as regular expressions both engines read (no lookbehind, no named groups). */
export const INTERNAL_RE_SOURCES = { email: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", phone: "\\(?[0-9]{3}\\)?[ .-][0-9]{3}[ .-][0-9]{4}" } as const;
const WORD_RE = new RegExp(`(^|[^A-Za-z0-9])(${INTERNAL_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})($|[^A-Za-z0-9])`, "i");
const EMAIL_RE = new RegExp(INTERNAL_RE_SOURCES.email), PHONE_RE = new RegExp(INTERNAL_RE_SOURCES.phone);
const PLACEHOLDER_RE = /^(tbd|tbc|todo|tk|x{2,}|placeholder|n\/a|set the amount\.?|\?+|-+|…|\.{3})$|lorem ipsum/i;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}‍️\s]+$/u;
const DRAFT_ROOM_RE = /^(untitled|new room|copy of|draft|test)\b|\(copy\)|^room \d+$/i;

/** Why a text reads as internal, or null. `names` are the business's own private names (the library's suppliers and makers). */
export function internalWhy(text: string, names: readonly string[] = []): string | null {
  const w = WORD_RE.exec(text);
  if (w) return `says "${w[2].toLowerCase()}"`;
  if (EMAIL_RE.test(text)) return "has an email address";
  if (PHONE_RE.test(text)) return "has a phone number";
  const t = text.toLowerCase();
  const n = names.map((x) => x.trim()).filter((x) => x.length >= 3).find((x) => t.includes(x.toLowerCase()));
  return n ? `names ${n}, from your library` : null;
}

/** A free-text value: what it belongs to, its field, the part of the subject it sits in (its needs, research, risks, the
 *  money's lines, a room's things, the asks — "" for the subject itself), and the words. */
export type Text = { subject: Ref; key: string; area: string; text: string };
/** Every free-text value in the response, with what it belongs to: the link, a program, a plan (its needs, money, research
 *  and risks ride inside it), a room — and an ask, under its plan or else its program. Ids, dates and fixed words aren't text. */
export function textsOf(payload: J): Text[] {
  const p = obj(payload), out: Text[] = [];
  const walk = (v: J, subject: Ref, key: string, area: string) => {
    if (Array.isArray(v)) { if (key !== "pillars" && key !== "waits_on") for (const x of v) walk(x, subject, key, AREAS.has(key) ? key : area); return; }
    if (v && typeof v === "object") { for (const [k, x] of Object.entries(v as Obj)) walk(x, subject, k, area); return; }
    const s = str(v);
    if (s && !NOT_TEXT.has(key)) out.push({ subject, key, area, text: s });
  };
  const label = str(p.label);
  if (label) out.push({ subject: { kind: "link", id: "link" }, key: "label", area: "", text: label });
  for (const x of arr(p.programs).map(obj)) walk(x, { kind: "program", id: String(x.id), name: str(x.title) ?? undefined }, "", "");
  for (const x of arr(p.plans).map(obj)) walk(x, { kind: "plan", id: String(x.id), name: str(x.name) ?? undefined }, "", "");
  for (const x of arr(p.asks).map(obj)) walk(x, x.plan_id ? { kind: "plan", id: String(x.plan_id) } : { kind: "program", id: String(x.program_id) }, "", "asks");
  for (const x of arr(p.layouts).map(obj)) walk(x, { kind: "layout", id: String(x.id), name: str(x.name) ?? undefined }, "", "");
  return out;
}

const AREAS = new Set(["needs", "research", "risks", "uses", "mix", "acknowledged", "items", "asks"]);
const KIND_WORD: Record<string, string> = { link: "The link", program: "Roadmap program", plan: "Plan", layout: "Room" };
const AREA_WORD: Record<string, string> = { needs: "an open need", research: "a research finding", risks: "a risk", uses: "an approved cost line", mix: "an approved menu line",
  acknowledged: "an accepted risk's reason", items: "a thing in the room", asks: "an ask" };
const FIELD_WORD: Record<string, string> = { label: "name", title: "title", summary: "summary", why: "why", lane: "lane", emoji: "emoji", name: "name", place: "place",
  gate: "when it goes", customer: "customer", market: "market", positioning: "positioning", note: "note", claim: "claim", figure: "figure", source_title: "source",
  source_url: "source link", words: "words", mitigation: "what we'd do", deal: "deal" };
/** Where a value sits, said for a person: "Plan · Gym bar · a research finding's claim". */
export function whereOf(t: Pick<Text, "subject" | "key" | "area">, name?: string): string {
  if (t.subject.kind === "link") return "The link's name";
  const field = FIELD_WORD[t.key] ?? t.key;
  return [KIND_WORD[t.subject.kind] ?? t.subject.kind, name ?? t.subject.name ?? "", t.area ? `${AREA_WORD[t.area] ?? t.area}'s ${field}` : field].filter(Boolean).join(" · ");
}
/** A server confirmation id is a finding's id and a short hash of the exact content it found (0472): "rule:kind:id:hash".
 *  This says whether it's the one this finding (rule:kind:id) is. */
export const isFor = (serverId: string, confirm: string | null): boolean => !!confirm && serverId.slice(0, serverId.lastIndexOf(":")) === confirm;

export type PayloadOpts = {
  /** The money the draft asked for (plan ids), so a plan with no approved version yet is said. */
  moneyPlans?: readonly string[];
  /** The latest approved version per plan — a link pinned to an older one shows the older (P8 republishes). */
  latestApproved?: Readonly<Record<string, number>>;
  /** The business's own private names (library suppliers and makers). */
  privateNames?: readonly string[];
};
const goOf = (s: Ref): Insight["go"] => (s.kind === "plan" ? { section: "plans", anchor: s.id } : s.kind === "layout" ? { section: "store", anchor: s.id } : s.kind === "program" ? { section: "roadmap" } : { section: "links" });

export function payloadChecks(payload: J, o: PayloadOpts = {}): PublishFinding[] {
  const p = obj(payload), out: PublishFinding[] = [];
  const plans = arr(p.plans).map(obj), layouts = arr(p.layouts).map(obj);
  const nameOf = new Map<string, string>([...plans.map((x) => [String(x.id), str(x.name) ?? "A plan"] as [string, string]), ...arr(p.programs).map(obj).map((x) => [String(x.id), str(x.title) ?? "A program"] as [string, string]), ...layouts.map((x) => [String(x.id), str(x.name) ?? "A room"] as [string, string])]);
  const ref = (s: Ref): Ref => ({ ...s, name: s.name ?? nameOf.get(s.id) });

  // material — the server binds these (0472)
  const unset = arr(p.asks).map(obj).filter((a) => a.amount_cents == null);
  if (p.show_asks === true && unset.length) out.push(finding("material", "asks_unset", { kind: "link", id: "link" },
    `${plural(unset.length, "ask")} will read "Being priced" — ${unset.map((a) => str(a.label)).filter(Boolean).join(", ")}.`, { action: "Set the amounts, or confirm", go: { section: "roadmap" }, evidence: unset.map((a) => ({ says: String(a.label ?? ""), source: "vision_asks" })) }));
  for (const x of plans) {
    const money = obj(x.money), sc = obj(obj(money.baseline).scenarios);
    const lines = new Map<string, string>();
    for (const s of Object.values(sc)) for (const u of arr(obj(s).uses).map(obj)) if (u.unitCents == null) lines.set(String(u.id ?? u.label), String(u.label ?? "A line"));
    if (lines.size) out.push(finding("material", "uses_unpriced", ref({ kind: "plan", id: String(x.id) }),
      `${nameOf.get(String(x.id))}'s approved money has ${plural(lines.size, "cost line")} with no price: ${[...lines.values()].join(", ")}. The investor sees them unpriced.`, { action: "Price them and approve again, or confirm", go: { section: "money", anchor: String(x.id) }, evidence: [{ says: `approved version ${money.version ?? "?"}`, source: "vision_plan_versions" }] }));
    const latest = o.latestApproved?.[String(x.id)];
    if (x.money && typeof money.version === "number" && typeof latest === "number" && latest > money.version) out.push(finding("material", "newer_approval", ref({ kind: "plan", id: String(x.id) }),
      `${nameOf.get(String(x.id))} has a newer approved version (${latest}) than the one this link shows (${money.version}).`, { action: "Share the newer one, or confirm", go: { section: "links" }, evidence: [{ says: `pinned ${String(p.pinned_at ?? "")}`, source: "vision_shares.pinned_at" }] }));
  }
  // Each flagged passage in full, where it is and why — the confirmation is for these exact words (0472 binds the id to them).
  const why = new Map<string, { s: Ref; passages: { says: string; source: string }[] }>();
  for (const t of textsOf(payload)) {
    const r = internalWhy(t.text, o.privateNames);
    if (!r) continue;
    const k = `${t.subject.kind}:${t.subject.id}`;
    const e = why.get(k) ?? { s: ref(t.subject), passages: [] };
    if (!e.passages.some((x) => x.says === t.text)) e.passages.push({ says: t.text, source: `${whereOf(t, e.s.name)} — ${r}` });
    why.set(k, e);
  }
  for (const { s, passages } of why.values()) out.push(finding("material", "internal_words", s,
    `${passages.length === 1 ? "This passage" : `These ${passages.length} passages`} may be meant for inside, and will be in the link exactly as written unless you change ${passages.length === 1 ? "it" : "them"}.`,
    { action: "Edit the words", go: goOf(s), evidence: passages }));

  // concern — worth a look, never stops
  for (const x of arr(p.programs).map(obj)) if (!x.target_on) out.push(finding("concern", "program_no_target", ref({ kind: "program", id: String(x.id) }), `${nameOf.get(String(x.id))} has no target date — the roadmap reads "to be set".`, { action: "Set a target", go: { section: "roadmap" } }));
  for (const x of plans) {
    const id = String(x.id), name = nameOf.get(id);
    if (!str(x.gate)) out.push(finding("concern", "plan_no_gate", ref({ kind: "plan", id }), `${name} doesn't say when it goes (its gate is empty).`, { action: "Set the gate", go: { section: "plans", anchor: id } }));
    const loose = arr(x.needs).map(obj).filter((n) => !n.done_on && !n.due_on);
    if (loose.length) out.push(finding("concern", "need_no_due", ref({ kind: "plan", id }), `${plural(loose.length, "open need")} in ${name} ${loose.length === 1 ? "has" : "have"} no date.`, { action: "Date them", go: { section: "plans", anchor: id } }));
    if (o.moneyPlans?.includes(id) && !x.money) out.push(finding("concern", "money_not_approved", ref({ kind: "plan", id }), `${name}'s money is chosen, but it has no approved version yet — the link shows none.`, { action: "Approve its money", go: { section: "money", anchor: id } }));
  }
  const vision = toVision(payload);
  for (const x of plans) {
    const id = String(x.id), c = vision.cases?.[id];
    if (!c) continue;
    const room = vision.layouts.find((l) => l.id === (x.layout_id as string)) ?? null;
    const r = investorReadiness(figuresOf(c, room).scores.base, { kind: "plan", id });
    if (r.open.length) out.push(finding("concern", "blockers_open", ref({ kind: "plan", id }), `The investor will read that ${nameOf.get(id)} still has to close: ${r.open.join(", ")}.`, { action: "Close them, or accept the risk", go: { section: "plans", anchor: id }, evidence: r.insights.map((i) => ({ says: i.words, source: "visionScore" })) }));
  }
  for (const l of layouts) {
    const id = String(l.id), name = str(l.name) ?? "";
    if (DRAFT_ROOM_RE.test(name)) out.push(finding("concern", "room_draft_name", ref({ kind: "layout", id }), `The room "${name}" reads like a draft name.`, { action: "Rename it", go: { section: "store", anchor: id } }));
    if (!arr(l.items).length) out.push(finding("concern", "room_empty", ref({ kind: "layout", id }), `The room "${name || "unnamed"}" has nothing in it yet.`, { action: "Open the room", go: { section: "store", anchor: id } }));
  }

  // editorial — wording
  const seen = new Map<string, Set<string>>();
  for (const t of textsOf(payload)) {
    const s = ref(t.subject);
    if (PLACEHOLDER_RE.test(t.text)) out.push(finding("editorial", "placeholder", s, `"${t.text}" reads as a placeholder (${s.name ?? "the link"}).`, { about: `${t.key}:${t.text}`, go: goOf(s) }));
    else if (t.key !== "emoji" && EMOJI_ONLY_RE.test(t.text)) out.push(finding("editorial", "lone_emoji", s, `A field in ${s.name ?? "the link"} is only an emoji.`, { about: `${t.key}:${t.text}`, go: goOf(s) }));
    if (t.text.length >= 20) { const k = t.text.toLowerCase(); const w = seen.get(k) ?? new Set(); w.add(`${s.kind}:${s.id}:${t.key}`); seen.set(k, w); }
  }
  for (const [k, where] of seen) if (where.size > 1) out.push(finding("editorial", "duplicate", { kind: "link", id: "link" }, `The same words appear ${where.size} times: "${k.length > 60 ? `${k.slice(0, 57)}…` : k}".`, { about: k }));
  return out;
}

// ── THE VERDICT ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CLASS_RANK: Record<PublishClass, number> = { enforced: 0, approval: 1, material: 2, concern: 3, editorial: 4 };
export type Readiness = { band: Band; verdict: string; top: PublishFinding[]; more: number; all: PublishFinding[]; materialIds: string[] };
/** One band, one verdict, the first three findings (by class, then tier, then id) and how many more. Deterministic. */
export function readinessOf(list: readonly PublishFinding[], shown = 3): Readiness {
  const all = [...new Map(list.map((f) => [f.id, f])).values()].sort((a, b) => CLASS_RANK[a.cls] - CLASS_RANK[b.cls] || a.tier - b.tier || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stop = all.filter((f) => f.cls === "enforced" || f.cls === "approval").length, confirm = all.filter((f) => f.cls === "material");
  const look = all.length - stop - confirm.length;
  const band: Band = stop ? "cant" : confirm.length ? "confirm" : "ready";
  const tail = look ? ` · ${plural(look, "thing")} worth a look` : "";
  const verdict = band === "cant" ? `${BAND_WORD.cant} — ${plural(stop, "thing")} to fix first` : band === "confirm" ? `${BAND_WORD.confirm} ${plural(confirm.length, "thing")}${tail}` : `${BAND_WORD.ready}${tail}`;
  return { band, verdict, top: all.slice(0, shown), more: Math.max(0, all.length - shown), all, materialIds: [...new Set(confirm.map((f) => f.confirm!))].sort() };
}

/** The confirmations a person gave are exactly the material findings — none missing, none made up. (0472 checks the same.) */
export function confirmationsMatch(given: readonly string[], materialIds: readonly string[]): boolean {
  const a = [...new Set(given)].sort(), b = [...new Set(materialIds)].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
