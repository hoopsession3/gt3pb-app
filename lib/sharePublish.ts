// A LINK IS MADE AND CHANGED THROUGH REVIEW (IMS8 P5, the bridge to 0472). Since 0472 the database makes and changes a
// link only through vision_share_publish, with the fingerprint of a review and exactly its material findings confirmed;
// direct inserts and scope updates are refused. Every way the Links tab makes or changes a link — make it, change what
// it shows, its money, move it to the latest approval — goes through these two calls, so nothing that worked stops
// working, and nothing is published that wasn't reviewed. The confirming itself is the screen's (a sheet listing the
// material findings, word for word); this file says what they are.
import type { SupabaseClient } from "@supabase/supabase-js";
import { payloadChecks, readinessOf, type PublishFinding } from "./publishReadiness";
import { isClosed } from "./refusal";

/** What a person chose, as the database reads it (vision_share_candidate). Only what's named changes. */
export type LinkDraft = {
  label?: string; show_asks?: boolean;
  program_ids?: string[]; plan_ids?: string[]; need_plans?: string[]; layout_ids?: string[]; money_plans?: string[]; research_plans?: string[];
  /** How long it lives: 0 until turned off, else 1–365 days from publishing. */
  days?: number;
  /** Move what the link shows of the money to the latest approval (an owner's). */
  repin?: boolean;
};
export type Review = { payload: unknown; fingerprint: string; material: string[]; latest: Record<string, number>; private_names: string[]; published_fingerprint?: string | null; changed?: boolean | null };

type Rpc = Pick<SupabaseClient, "rpc">;
const fail = (e: { code?: string; message?: string }) => Object.assign(new Error(e.message ?? "Couldn't reach the links"), { code: e.code });

export async function reviewLink(sb: Rpc, share: string | null, draft: LinkDraft): Promise<Review> {
  const { data, error } = await sb.rpc("vision_share_review", { p_share: share, p_draft: draft });
  if (error) throw fail(error);
  const r = data as Review;
  return { ...r, material: [...(r.material ?? [])], latest: r.latest ?? {}, private_names: r.private_names ?? [] };
}

/** What must be confirmed, in words: the server's material ids (authoritative), each said by lib/publishReadiness when it
 *  finds the same one on the same response — and said plainly when it doesn't, so nothing is confirmed unseen. */
export function toConfirm(r: Review, moneyPlans: readonly string[] = []): { ids: string[]; findings: PublishFinding[]; words: string[] } {
  const mine = readinessOf(payloadChecks(r.payload, { latestApproved: r.latest, privateNames: r.private_names, moneyPlans })).all.filter((f) => f.cls === "material");
  const by = new Map(mine.map((f) => [f.confirm!, f]));
  return { ids: r.material, findings: r.material.map((id) => by.get(id)).filter((f): f is PublishFinding => !!f), words: r.material.map((id) => by.get(id)?.words ?? `Something to confirm (${id.split(":")[0].replace(/_/g, " ")}).`) };
}

export async function publishLink(sb: Rpc, share: string | null, draft: LinkDraft, r: Review, confirmed: readonly string[]): Promise<{ id: string; token: string }> {
  const { data, error } = await sb.rpc("vision_share_publish", { p_share: share, p_draft: draft, p_fingerprint: r.fingerprint, p_confirm: [...confirmed] });
  if (error) throw fail(error);
  return data as { id: string; token: string };
}

/** A publish refused because it changed since review (PT409) or the confirmations didn't match (PT422): nothing was
 *  shared, and reviewing again is the way on. */
// PT409 is lib/refusal's (isClosed: the row moved on since it was read — the same meaning here); PT422 is 0472's own.
export const isStale = (e: unknown): boolean => isClosed(e as { code?: string }) || (e as { code?: string })?.code === "PT422";
