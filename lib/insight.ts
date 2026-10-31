// THE INSIGHT CONTRACT (IMS7-C). One shape for what GT3's engines already decide, so a screen can show the one line that
// matters in context instead of opening each engine's panel. A pure adapter and presentation layer: nothing here decides.
//
//   The Advisor (lib/visionAdvisor), the plan's blockers (lib/visionScore), the room's checks (lib/spatial/evaluate),
//   money attention (lib/moneyAttention), alerts (lib/alertKinds) and the library's status gate (lib/experienceLibrary,
//   0461) keep their own rules, words and order. Each adapter below copies what its engine said — never re-derives it —
//   and adds three presentation things: a stable identity, a level (stop / look / note) and who may see it.
//
// WHAT THE LEVEL IS, AND ISN'T. `level` is how loudly a screen says it, the same three words everywhere. It is not
// authority: `blocks` is true only where an existing rule refuses something (today, one: the database refuses a library
// asset qualified or approved while its judgement is incomplete — 0461). A "stop" from the Advisor is advice; the room's
// errors ask before saving and never refuse. The native value is always kept beside it (`native`).
//
// WHAT IS NEVER MERGED. Severity (level), confidence, readiness and approval are separate fields and never one number.
// `order` is the engine's own ranking (the Advisor's gain), compared only within one engine.
//
// LIFECYCLE. Insights are worked out from the engines each time, so when a condition resolves, the engine stops saying it
// and the insight is gone. `id` stays the same while the condition is the same (numbers may move); `mark` changes only
// when it changes in a way worth saying again (a level, a status, a different set of things). Acknowledgements are the
// ones the system already keeps — a blocker's risk acceptance (0449), an alert's claim or Got it, a library status — and
// `settle` hides an acknowledged insight until its mark moves. No new store: engines with none (the Advisor, the room)
// have no acknowledgement here, said as `state: null`.
import type { Advice } from "./visionAdvisor";
import type { Blocker, BlockerStatus } from "./visionScore";
import type { Finding as SpaceFinding } from "./spatial/evaluate";
import type { AttnRow, Level as AttnLevel } from "./moneyAttention";
import type { AlertSeverity } from "./alertKinds";
import type { Status as LibraryStatus } from "./experienceLibrary";

export type Level = "stop" | "look" | "note";
export const LEVELS: readonly Level[] = ["stop", "look", "note"];
export const LEVEL_WORD: Record<Level, string> = { stop: "Stop", look: "Look", note: "Note" };

export type Engine = "advisor" | "blocker" | "space" | "money" | "alert" | "library";
/** Who may see it — what the source screen already allows, never wider. `member`: anyone in the vision; `editor`: owners
 *  and admins; `owner`: owners; `investor`: someone on a share link; `team`: crew with the alert. */
export type Scope = "owner" | "editor" | "member" | "investor" | "team";
export type Ref = { kind: "plan" | "layout" | "item" | "asset" | "order" | "invoice" | "dispute" | "budget" | "alert"; id: string; name?: string };
/** Acknowledgement or resolution as the source keeps it; null where the source keeps none. */
export type State = "open" | "in_progress" | "pending_verification" | "risk_accepted" | "acceptance_lapsed" | "claimed" | "acknowledged";
/** What kind of thing it is about (IMS7 refinement). Set per engine rule in one table (CLASS), never per screen. */
export type Domain = "safety" | "regulatory" | "operational" | "approval" | "evidence" | "financial" | "spatial" | "readiness" | "optimization" | "info";
/** Where it ranks for a person deciding (Ryan, 2026-10-31): 1 verified safety, regulatory or operational blockers ·
 *  2 required approvals or missing mandatory evidence · 3 material financial and spatial conflicts · 4 readiness
 *  dependencies · 5 optimization · 6 information. A rank, not an authority: `blocks` still comes only from an enforcing rule. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6;
/** The screen an insight belongs to — where its action is taken. */
export type Surface = "plans" | "store" | "library" | "money" | "alerts" | "investor";

export type Insight = {
  /** Stable while the condition is the same: engine · rule · subject · what within it. */
  id: string;
  engine: Engine;
  /** The engine's own rule that said it ("waits_on", "door", "costs_unpriced", "dispute"…). */
  rule: string;
  subject: Ref;
  related: Ref[];
  /** The engine's own severity, unchanged: { scale, value }. */
  native: { scale: string; value: string };
  level: Level;
  /** Only where an existing authoritative rule refuses something; `refuses` says what. */
  blocks: boolean;
  refuses?: string;
  words: string;
  action: string | null;
  go: { section: string; anchor?: string } | null;
  /** When the source says it was last true (an alert's clock); null when it's true now, worked out from current data. */
  observedAt: string | null;
  /** Which version of the engine's method said it, and as of when (the score's method, an alert's last sighting). */
  basis: { version: string | null; asOf: string | null };
  evidence: { says: string; source?: string }[];
  /** Only where the source has one (a fact's confidence); never derived from the level. */
  confidence: string | null;
  /** Kept apart from the level, when the source says them. */
  readiness: string | null;
  approval: LibraryStatus | null;
  visibility: Scope[];
  state: State | null;
  /** Changes only when the condition changes in a way worth saying again. */
  mark: string;
  /** The engine's own rank, higher first; compared only within an engine. */
  order: number;
  /** The engine's own identifier for what it found: a blocker key, an attention key, an alert id, a fact or asset id, a
   *  finding's sorted item ids — copied, never made up. */
  sourceId: string;
  domain: Domain;
  tier: Tier;
  /** The screen it belongs to (its go.section). */
  home: Surface | null;
  /** A shared condition several engines see (a plan waiting on another): `gather` keeps one. */
  condition?: string;
  /** Engines that said the same condition, when `gather` folded them into this one. */
  alsoFrom?: Engine[];
};

// ── IDENTITY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** FNV-1a, 32-bit, base 36: short, deterministic and the same in every browser and in Node. Not a security hash. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
const idOf = (engine: Engine, rule: string, subject: Ref, about?: string | null) =>
  [engine, rule, `${subject.kind}:${subject.id}`, about ? fingerprint(about) : ""].filter(Boolean).join("|");

// ── DOMAIN AND TIER: one table, by engine and rule (and the native value where the rule alone doesn't decide) ─────────
type Class = [Domain, Tier];
const CLASS: Record<Engine, Record<string, Class | ((native: string) => Class)>> = {
  advisor: {
    waits_on: ["readiness", 4], risk_unplanned: ["readiness", 4],
    over_capacity: ["operational", 3], rent_decides: ["financial", 3], channel_loses: ["financial", 3], assumption_wrong: ["financial", 3],
    capacity_unchecked: ["optimization", 5], research_due: ["optimization", 5], score_top: ["optimization", 5],
  },
  // A plan's readiness blockers are readiness dependencies; an owner's live risk acceptance is information.
  blocker: { "*": (n) => (n === "risk_accepted" ? ["info", 6] : ["readiness", 4]) },
  // A room's detected error in a door, route or work zone is a verified safety finding; an overlap is a spatial conflict;
  // anything that needs a site check is never tier 1 — it hasn't been verified.
  space: { "*": (n) => (n === "error" ? ["safety", 1] : ["spatial", 3]), geometry: ["spatial", 3] },
  money: { "*": (n) => (n === "critical" ? ["operational", 1] : ["financial", 3]) },
  alert: { "*": (n) => (n === "critical" ? ["operational", 1] : n === "important" ? ["operational", 3] : ["info", 6]) },
  library: {
    status: (n) => (n === "rejected" || n === "restricted" ? ["approval", 1] : ["approval", 2]),
    findings: ["evidence", 5], going_unapproved: ["approval", 2],
    not_in_plan: ["financial", 3], cost_differs: ["financial", 3], size_differs: ["spatial", 3],
    no_cost: ["info", 6], needs_quantity: ["info", 6], size_turned: ["info", 6], shared_room: ["info", 6],
  },
};
export function classify(engine: Engine, rule: string, native: string): Class {
  const c = CLASS[engine][rule] ?? CLASS[engine]["*"] ?? ["info", 6];
  return typeof c === "function" ? c(native) : c;
}
const HOME: Record<string, Surface> = { plans: "plans", store: "store", library: "library", money: "money" };

/** Builds an insight with every field said (the adapters' one constructor; lib/planFixtures uses it too). Domain and tier
 *  come from CLASS unless an adapter says otherwise (a site check is never tier 1). */
export const insight = (o: Pick<Insight, "engine" | "rule" | "subject" | "native" | "level" | "words" | "visibility"> & Partial<Insight> & { about?: string | null }): Insight => {
  const { about, ...rest } = o;
  const [domain, tier] = classify(o.engine, o.rule, o.native.value);
  return {
    id: idOf(o.engine, o.rule, o.subject, about), related: [], blocks: false, action: null, go: null, observedAt: null,
    basis: { version: null, asOf: null }, evidence: [], confidence: null, readiness: null, approval: null, state: null,
    mark: `${o.level}`, order: 0, sourceId: about ? `${o.subject.id}:${about}` : o.subject.id, domain, tier,
    home: o.go ? HOME[o.go.section] ?? null : null, ...rest,
  };
};

// ── SEVERITY: native → level (presentation only) ────────────────────────────────────────────────────────────────────────
/** Every mapping in one table, so it can be read and tested. The native value always travels with the insight. */
export const LEVEL_OF = {
  advisor: { stop: "stop", look: "look" },
  // A blocker open or past its acceptance stops; one being worked on is a look; an owner's live risk acceptance is a note
  // (accepted is not resolved — it is still said, never dropped).
  blocker: { open: "stop", acceptance_lapsed: "stop", in_remediation: "look", pending_verification: "look", risk_accepted: "note" },
  // A room's error stops, a warning is a look; a check to make on site is a look at most (it hasn't been detected).
  space: { error: "stop", warn: "look" },
  money: { critical: "stop", urgent: "look", action: "look" },
  alert: { critical: "stop", important: "look", fyi: "note" },
  // In a room or a spec: rejected or restricted stops; anything short of approved is a look; approved says nothing.
  library: { rejected: "stop", restricted: "stop", candidate: "look", under_research: "look", evidence_incomplete: "look", qualified: "look" },
} as const satisfies Record<Engine, Record<string, Level>>;

const BLOCKER_STATE: Record<BlockerStatus, State> = { open: "open", in_remediation: "in_progress", pending_verification: "pending_verification", risk_accepted: "risk_accepted", acceptance_lapsed: "acceptance_lapsed" };

// ── ADAPTERS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The Advisor's advice. Owners and admins see it (Plans shows the Advisor to editors only). Advice, never a block. */
export function fromAdvice(a: Advice, o: { scoreVersion?: string | null } = {}): Insight {
  return insight({
    engine: "advisor", rule: a.rule, about: a.about, subject: { kind: "plan", id: a.planId, name: a.plan },
    native: { scale: "advisor", value: a.level }, level: LEVEL_OF.advisor[a.level], words: a.words, action: a.action,
    go: { section: "plans", anchor: a.planId }, basis: { version: a.rule === "score_top" ? o.scoreVersion ?? null : null, asOf: null },
    visibility: ["owner", "editor"], mark: `${a.level}|${a.rule}|${a.about ?? ""}`, order: a.gain, sourceId: `${a.planId}:${a.rule}${a.about ? `:${a.about}` : ""}`,
    condition: a.rule === "waits_on" ? `plan:${a.planId}|waiting_on` : undefined,
  });
}

/** A plan's readiness blocker. Investors on a link already see blockers and their acceptances (lib/visionScore), so the
 *  blocker's own words are investor-visible; its free-text acceptance note is not carried here. Never a block: readiness
 *  is a stage by policy, not a gate. */
export function fromBlocker(b: Blocker, plan: Ref, o: { scoreVersion: string; readiness?: string | null }): Insight {
  return insight({
    engine: "blocker", rule: b.key, subject: { ...plan, kind: "plan" }, native: { scale: "blocker", value: b.status },
    level: LEVEL_OF.blocker[b.status], words: b.says, action: b.remedy.action, go: { section: "plans", anchor: plan.id },
    basis: { version: o.scoreVersion, asOf: b.acknowledged?.at ?? null }, readiness: o.readiness ?? null,
    visibility: ["owner", "editor", "investor"], state: BLOCKER_STATE[b.status], sourceId: b.key,
    evidence: [{ says: b.effect }], mark: `${b.status}|${b.acknowledged?.reviewBy ?? ""}`,
    condition: b.key === "waiting_on" ? `plan:${plan.id}|waiting_on` : undefined,
  });
}

/** A finding of the room's checks. The Studio shows them to anyone who opens the room; saving with an error asks first and
 *  never refuses, so it never blocks. */
export function fromSpace(f: SpaceFinding, room: Ref, o: { profile?: string | null } = {}): Insight {
  const native = f.level;
  const level: Level = f.source === "site_check" && LEVEL_OF.space[native] === "stop" ? "look" : LEVEL_OF.space[native];
  const ids = [...f.ids].sort();
  return insight({
    engine: "space", rule: f.check, about: ids.join(","), subject: { ...room, kind: "layout" },
    related: ids.map((id) => ({ kind: "item" as const, id })), native: { scale: "space", value: `${native}${f.source === "site_check" ? "·site_check" : ""}` },
    level, words: f.words, action: null, go: { section: "store", anchor: room.id }, basis: { version: o.profile ?? null, asOf: null },
    visibility: ["member", "owner", "editor"], mark: `${level}|${f.check}|${ids.join(",")}`, sourceId: `${f.check}:${ids.join(",")}`,
  });
}

/** A row of money attention (crew HQ: owners and admins). Its key is already stable. */
export function fromMoney(r: AttnRow): Insight {
  const cut = r.key.indexOf(":");
  const [kind, id] = cut >= 0 ? [r.key.slice(0, cut), r.key.slice(cut + 1)] : [r.key, r.key];
  const ref: Ref = { kind: kind === "dispute" ? "dispute" : kind === "invoice" ? "invoice" : kind === "budget" ? "budget" : "order", id };
  return insight({
    engine: "money", rule: kind, subject: ref, native: { scale: "moneyAttention", value: r.level },
    level: LEVEL_OF.money[r.level as AttnLevel], words: r.title, action: r.detail, go: r.go,
    visibility: ["owner", "editor"], mark: `${r.level}|${r.key}`, evidence: [{ says: r.side }], sourceId: r.key,
  });
}

export type AlertIn = { id: string; severity: AlertSeverity; category: string; title: string; created_at: string; last_seen_at?: string | null;
  occurrences?: number | null; ack_at?: string | null; claimed_by?: string | null; target_user_id?: string | null };
/** An alert. Its own clock (alertWhen's rule): a recurring one is as of its last sighting; acknowledged or claimed is said. */
export function fromAlert(a: AlertIn): Insight {
  const recurring = (a.occurrences ?? 1) > 1;
  const at = recurring && a.last_seen_at ? a.last_seen_at : a.created_at;
  return insight({
    engine: "alert", rule: a.category, subject: { kind: "alert", id: a.id }, native: { scale: "alert", value: a.severity },
    level: LEVEL_OF.alert[a.severity], words: a.title, observedAt: at, basis: { version: null, asOf: a.last_seen_at ?? a.created_at },
    visibility: ["team"], state: a.ack_at ? "acknowledged" : a.claimed_by ? "claimed" : "open", sourceId: a.id,
    // A recurrence is news: a claimed or acknowledged alert seen again after that moves its mark.
    mark: `${a.severity}|${recurring ? a.occurrences : 1}`,
  });
}

/** A library asset placed in a room or listed on a spec. `blockers` are the database's own (std_material_blockers): while
 *  any stand, the database refuses qualified or approved — the one rule here that blocks. Approved says nothing. */
export function fromLibrary(a: { id: string; name: string; status: LibraryStatus; status_reason?: string | null }, o: { blockers: readonly string[]; placedIn?: Ref | null; pending?: number }): Insight[] {
  const out: Insight[] = [];
  const subject: Ref = { kind: "asset", id: a.id, name: a.name };
  const related = o.placedIn ? [o.placedIn] : [];
  if (a.status !== "approved") {
    const level = LEVEL_OF.library[a.status];
    const said = a.status === "rejected" ? `${a.name} was rejected for GT3${a.status_reason ? `: ${a.status_reason}` : "."}`
      : a.status === "restricted" ? `${a.name} is restricted for GT3${a.status_reason ? `: ${a.status_reason}` : "."}`
      : `${a.name} isn't approved for GT3 yet.`;
    out.push(insight({
      engine: "library", rule: "status", subject, related, native: { scale: "library", value: a.status }, level, words: said,
      action: o.blockers[0] ?? null, go: { section: "library", anchor: a.id }, approval: a.status,
      blocks: o.blockers.length > 0, refuses: o.blockers.length ? "qualified or approved, until the Standard's judgement is complete" : undefined,
      evidence: o.blockers.map((says) => ({ says, source: "the Standard" })), visibility: ["owner", "editor"],
      mark: `${a.status}|${[...o.blockers].sort().join("|")}`,
    }));
  }
  if (o.pending && o.pending > 0) out.push(insight({
    engine: "library", rule: "findings", subject, related, native: { scale: "library", value: "pending_facts" }, level: "look",
    words: `${o.pending} research finding${o.pending === 1 ? "" : "s"} on ${a.name} to decide.`, action: "Review them", go: { section: "library", anchor: a.id },
    approval: a.status, visibility: ["owner", "editor"], mark: `findings|${o.pending}`,
  }));
  return out;
}

// ── PRESENTATION ──────────────────────────────────────────────────────────────────────────────────────────────────────
const RANK: Record<Level, number> = { stop: 0, look: 1, note: 2 };
/** Where several engines see one condition, the one with the authoritative record speaks: a blocker (it has a lifecycle
 *  and an acceptance) over the Advisor's advice about it. */
const AUTHORITY: Engine[] = ["library", "blocker", "space", "money", "alert", "advisor"];

/** All of them, once each: deduplicated by id and by shared condition (keeping the authoritative engine's, the louder
 *  level, and naming the others), in a stable order — level, then what refuses something, then the caller's engine
 *  preference, then the engine's own rank, then id. Deterministic for the same input. */
export function gather(lists: readonly (readonly Insight[])[], o: { prefer?: readonly Engine[] } = {}): Insight[] {
  const byId = new Map<string, Insight>();
  for (const i of lists.flat()) { const had = byId.get(i.id); if (!had || RANK[i.level] < RANK[had.level]) byId.set(i.id, i); }
  const byCond = new Map<string, Insight>();
  const out: Insight[] = [];
  for (const i of byId.values()) {
    if (!i.condition) { out.push(i); continue; }
    const had = byCond.get(i.condition);
    if (!had) { byCond.set(i.condition, i); continue; }
    const [keep, fold] = AUTHORITY.indexOf(i.engine) < AUTHORITY.indexOf(had.engine) ? [i, had] : [had, i];
    byCond.set(i.condition, { ...keep, level: RANK[fold.level] < RANK[keep.level] && keep.state !== "risk_accepted" ? fold.level : keep.level,
      alsoFrom: [...new Set([...(keep.alsoFrom ?? []), fold.engine, ...(fold.alsoFrom ?? [])])] });
  }
  out.push(...byCond.values());
  const pref = o.prefer ?? [];
  const p = (e: Engine) => (pref.includes(e) ? pref.indexOf(e) : pref.length);
  return out.sort((a, b) => RANK[a.level] - RANK[b.level] || Number(b.blocks) - Number(a.blocks) || p(a.engine) - p(b.engine)
    || (a.engine === b.engine ? b.order - a.order : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What this viewer may see: only insights whose source already shows it to them. */
export function visibleTo(list: readonly Insight[], scopes: readonly Scope[]): Insight[] {
  return list.filter((i) => i.visibility.some((s) => scopes.includes(s)));
}

/** An acknowledgement the system already keeps, as { id, mark } at the time it was given. */
export type Ack = { id: string; mark: string };
/** Hides what's been acknowledged until it changes in a way worth saying again (its mark moves). A blocker's live risk
 *  acceptance stays said (as a note — investors see it), and a lapsed one is open again. */
export function settle(list: readonly Insight[], acks: readonly Ack[]): Insight[] {
  const seen = new Map(acks.map((a) => [a.id, a.mark]));
  return list.filter((i) => i.engine === "blocker" || seen.get(i.id) !== i.mark);
}

/** Said with an older method than the engine's current one (a stored score from before a method change). */
export function isStale(i: Insight, current: Partial<Record<Engine, string>>): boolean {
  const v = current[i.engine];
  return !!v && !!i.basis.version && i.basis.version !== v;
}

/** The order a person deciding should see them in (Ryan's six tiers): tier first; then what's about the thing in hand;
 *  then what refuses something; then the caller's engine preference; then each engine's own rank; then id. Deduplicated
 *  first (gather). Deterministic for the same input. The level isn't the order: a loud warning about something else
 *  doesn't outrank a required approval. */
export function rank(list: readonly Insight[], o: { subject?: string | null; prefer?: readonly Engine[] } = {}): Insight[] {
  const pref = o.prefer ?? [];
  const p = (e: Engine) => (pref.includes(e) ? pref.indexOf(e) : pref.length);
  const mine = (i: Insight) => (o.subject && (i.subject.id === o.subject || i.related.some((r) => r.id === o.subject)) ? 0 : 1);
  return gather([list]).sort((a, b) => a.tier - b.tier || mine(a) - mine(b) || Number(b.blocks) - Number(a.blocks) || p(a.engine) - p(b.engine)
    || (a.engine === b.engine ? b.order - a.order : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The one line a screen shows, and the rest one tap away. NO REPEATS ACROSS ADJACENT SCREENS: the line is an insight
 *  that belongs to this screen (its home), or one about the thing in hand, or a tier 1–2 one (a verified blocker, a
 *  required approval) wherever it is — never another screen's lesser finding; those wait under "n more". */
export function primary(list: readonly Insight[], o: { surface?: Surface; subject?: string | null; prefer?: readonly Engine[] } = {}): { top: Insight | null; more: number; all: Insight[] } {
  const all = rank(list, o);
  const fits = (i: Insight) => !o.surface || i.home === o.surface || i.tier <= 2 || (!!o.subject && (i.subject.id === o.subject || i.related.some((r) => r.id === o.subject)));
  const top = all.find(fits) ?? null;
  return { top, more: all.length - (top ? 1 : 0), all: top ? [top, ...all.filter((i) => i !== top)] : all };
}
