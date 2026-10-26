// WHAT THE MARKET SAYS (R56, phase D — Ryan, 2026-10-25: "continuous AI market research with citations, never
// invented"). Pure: the topics, the rule that keeps a finding (its address is one the web search returned — a link the
// model wrote that no search returned is dropped), and how old a finding is. The route (app/api/vision/research) runs
// the search; 0450 vision_research keeps what survives, "proposed" until an owner or admin accepts it.

export const TOPICS = ["demand", "competition", "costs", "location", "rules", "trends"] as const;
export type Topic = (typeof TOPICS)[number];
export const TOPIC_WORD: Record<Topic, string> = {
  demand: "Demand", competition: "Who else is there", costs: "What things cost", location: "The location", rules: "Rules and permits", trends: "Trends",
};
export type Finding = { topic: Topic; claim: string; figure: string | null; source_url: string; source_title: string | null; published: string | null };
export type Bearing = "for" | "against" | "neutral";
export const BEARING_WORD: Record<Bearing, string> = { for: "Supports the plan", against: "Weighs against it", neutral: "Neither way" };
export type Research = Finding & { id: string; plan_id: string; status: "proposed" | "accepted" | "rejected"; retrieved_at: string; bearing?: Bearing | null };

/** One way to compare addresses: https, no fragment, no trailing slash, the host in lower case. Null: not a web address. */
export function normUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}

/** Every address the web search returned in a response's content blocks — its results and its citations. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function searchedUrls(blocks: readonly any[]): Set<string> {
  const out = new Set<string>();
  const add = (u: unknown) => { const n = normUrl(u); if (n) out.add(n); };
  for (const b of blocks ?? []) {
    if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) add(r?.url);
    if (b?.type === "text" && Array.isArray(b.citations)) for (const c of b.citations) add(c?.url);
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The findings to keep: a known topic, a claim, and an address the search returned. The rest is said as dropped. */
export function verify(raw: readonly unknown[], seen: ReadonlySet<string>): { kept: Finding[]; dropped: { claim: string; why: string }[] } {
  const kept: Finding[] = [], dropped: { claim: string; why: string }[] = [];
  const str = (v: unknown, n: number) => { const s = typeof v === "string" ? v.trim() : ""; return s ? s.slice(0, n) : null; };
  const once = new Set<string>();
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const claim = str(o.claim, 600);
    if (!claim) { dropped.push({ claim: "", why: "no claim" }); continue; }
    if (!(TOPICS as readonly string[]).includes(String(o.topic))) { dropped.push({ claim, why: "not one of the topics" }); continue; }
    const url = normUrl(o.source_url);
    if (!url) { dropped.push({ claim, why: "no source address" }); continue; }
    if (!seen.has(url)) { dropped.push({ claim, why: "its source wasn't one the search returned" }); continue; }
    const key = `${url}|${claim.toLowerCase()}`;
    if (once.has(key)) continue;
    once.add(key);
    kept.push({ topic: o.topic as Topic, claim, figure: str(o.figure, 120), source_url: url, source_title: str(o.source_title, 300), published: str(o.published, 60) });
  }
  return { kept, dropped };
}

export const STALE_DAYS = 90;
/** Days since GT3 read it; stale past ninety — research is a reading of the market on a day, not a fact for ever. */
export function age(retrievedAt: string, now = Date.now()): { days: number; stale: boolean } {
  const days = Math.max(0, Math.floor((now - Date.parse(retrievedAt)) / 86_400_000));
  return { days, stale: days > STALE_DAYS };
}
export const domainOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** How often a plan's research is checked again (R60, 0453). */
export const EVERY = [0, 30, 60, 90] as const;
export const EVERY_WORD: Record<(typeof EVERY)[number], string> = { 0: "Only when asked", 30: "Every 30 days", 60: "Every 60 days", 90: "Every 90 days" };
/** Whether a plan's scheduled check is due: a schedule set, and never run or run longer ago than it. */
export function isDue(p: { research_every_days?: number; research_last_at?: string | null }, now = Date.now()): boolean {
  const every = p.research_every_days ?? 0;
  if (!every) return false;
  return !p.research_last_at || now - Date.parse(p.research_last_at) >= every * 86_400_000;
}
/** What's new in a run: a finding whose source and claim aren't already stored for the plan, in any state. */
export function novel<T extends { source_url: string; claim: string }>(found: readonly T[], known: readonly { source_url: string; claim: string }[]): T[] {
  const key = (x: { source_url: string; claim: string }) => `${normUrl(x.source_url) ?? x.source_url}|${x.claim.trim().toLowerCase()}`;
  const seen = new Set(known.map(key));
  return found.filter((f) => !seen.has(key(f)));
}
