// THE PACK A REQUEST DESCRIBES (2026-10-12) — read one way by /api/reserve (a new pack) and /api/reserve/change (a pack
// changed in place, 0388), so the two cannot disagree about a name, a size, a mix, a pickup day or a price. These were
// /api/reserve's own lines, moved here word for word when the change route needed the same answers.

import { PRICING, FLAVORS, isPackSize, mixComplete, dropForStop, nextDrop, dropDateKey, packTotal, toCents, type GlassPath, type Mix, type PackSize } from "./orderAhead";
import { refillIsFree, applyOrderBenefits, type Benefit } from "./benefits";

export type PackPick = { name: string; phone: string; size: PackSize; glass: GlassPath; mix: Mix };

/** The pack a request asks for, or the 400 that says what is wrong with it. Flavor counts come from trusted keys only. */
export function packPick(body: { name?: unknown; phone?: unknown; size?: unknown; glass?: unknown; mix?: unknown }):
  { pick: PackPick } | { status: number; error: string } {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const size = Number(body.size);
  const glass: GlassPath = body.glass === "new" ? "new" : "return";
  if (!name || !phone) return { status: 400, error: "Add your name and phone — the crew uses them at pickup." };
  if (!isPackSize(size)) return { status: 400, error: "Pick a pack size (3, 6, or 12)." };
  const asked = (body.mix && typeof body.mix === "object" ? body.mix : {}) as Partial<Record<string, unknown>>;
  const mix: Mix = { RISE: 0, FLOW: 0, DUSK: 0 };
  for (const f of FLAVORS) mix[f] = Math.max(0, Math.floor(Number(asked[f] ?? 0)));
  if (!mixComplete(mix, size)) return { status: 400, error: "Your flavor picks must add up to the pack size." };
  if (!PRICING.allowFlavorMix && FLAVORS.filter((f) => mix[f] > 0).length > 1) {
    return { status: 400, error: "This drop is single-flavor — pick one flavor for the whole pack." };
  }
  return { pick: { name, phone, size, glass, mix } };
}

/**
 * The pickup days on offer, each with its order cutoff: the truck's real upcoming stops (the caller reads them), or
 * the Saturday cadence when the route is empty.
 */
export function offeredDays(stops: readonly { starts_at: string }[] | null | undefined): Map<string, Date> {
  const offered = new Map<string, Date>();
  for (const st of stops ?? []) offered.set(dropDateKey(new Date(st.starts_at)), dropForStop(st.starts_at).cutoff);
  if (offered.size === 0) { const fb = nextDrop(); offered.set(dropDateKey(fb.sat), fb.cutoff); }
  return offered;
}

/** A requested pickup day as a day key: a plain key, or a full instant read through the same ET day rule. */
export function requestedDay(raw: unknown): string {
  const s = String(raw ?? "");
  const parsed = new Date(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : Number.isNaN(parsed.getTime()) ? s.slice(0, 10) : dropDateKey(parsed);
}

/**
 * What a pack costs this member, in cents: the grid, then their benefits — a founding member bringing bottles back
 * refills free (packs are always straight brew), else the deepest percent then amount off, floored at 0.
 */
export function packCents(size: number, glass: GlassPath, benefits: Benefit[]): number {
  if (glass === "return" && refillIsFree(benefits)) return 0;
  return applyOrderBenefits(toCents(packTotal(size, glass)), benefits);
}

