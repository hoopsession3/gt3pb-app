import type { SupabaseClient } from "@supabase/supabase-js";

// ONE CHANGE TO THE MUTED LIST, MADE TO THE LIST AS IT IS NOW (R8, 2026-10-16). notif_prefs.muted_categories (0177) holds
// two people's switches in one list: the crew's categories (components/NotifPrefs — order, money, brew…) and the account's
// own kinds (components/NotificationsSheet — order updates, pickup reminders; lib/customerNotify). Each screen read the
// list once, when it opened, and wrote the whole of it back on every tap — so a crew member with their console open since
// the morning, muting Brew, wrote back the Order updates switch as it stood that morning, and the switch they had turned
// off on their phone at noon was on again. Now a tap reads the row, changes the one thing it was asked to, and writes
// that: what another screen changed in between is kept. Not a lock — two taps in the same instant on two screens can still
// cross — but the hours-long window is gone.

type Muted = { muted: string[]; error: null } | { muted: null; error: string };

/** Read the row's muted list now, apply `change`, and write the result (with `also`, if given — nothing else is sent, so the
 *  rest of the row stays as it is). The list written is returned, for the screen to draw. */
export async function writeMuted(
  sb: SupabaseClient, userId: string, change: (fresh: string[]) => string[], also: Record<string, unknown> = {},
): Promise<Muted> {
  const { data, error } = await sb.from("notif_prefs").select("muted_categories").eq("user_id", userId).maybeSingle();
  if (error) return { muted: null, error: error.message };
  const fresh = ((data as { muted_categories?: string[] | null } | null)?.muted_categories) ?? [];
  const muted = change(fresh);
  const { error: werr } = await sb.from("notif_prefs").upsert({ user_id: userId, muted_categories: muted, ...also }, { onConflict: "user_id" });
  return werr ? { muted: null, error: werr.message } : { muted, error: null };
}

/** The list with `key` muted or not — every other entry kept as it was. */
export const withMuted = (list: readonly string[], key: string, mute: boolean): string[] => {
  const rest = list.filter((k) => k !== key);
  return mute ? [...rest, key] : rest;
};
