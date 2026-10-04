// WHO AN @ REACHES (2026-10-04, the form audit).
//
// A reply in a Discuss thread notifies anyone @named in it (comments.mentions, then an alert each).
// It worked by substring: every crew member whose first name appeared after an @ anywhere in the
// text. So "@Chris" pinged every Chris, "@Chirs" pinged nobody, a crew member with no display name
// could not be reached at all — and the person sending saw none of it until somebody did not reply.
//
// Now the @ is a pick list: typing "@" offers the crew whose first name starts with what follows,
// a tap puts "@First" in the text and remembers WHICH person it was. Before Send, the thread says
// who will be notified and which @words reach nobody (or more than one person), so a typo is seen
// while it can still be fixed. A name typed by hand still works when it names exactly one person.
// Pure, so scripts/smoke.cjs can hold it to that.

export type Mentionable = { id: string; display_name: string | null };

const firstOf = (p: Mentionable) => (p.display_name ?? "").trim().split(/\s+/)[0] ?? "";

/** The @word being typed at the end of the text, without its @ ("" right after the @), or null. */
export function mentionDraft(text: string): string | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
  return m ? m[1] : null;
}

/** The people an @word could mean: first name starting with it, case-insensitive. */
export function mentionChoices(people: readonly Mentionable[], draft: string): Mentionable[] {
  const d = draft.toLowerCase();
  return people.filter((p) => firstOf(p).length > 1 && firstOf(p).toLowerCase().startsWith(d));
}

/** The text with the @word being typed replaced by "@First " — and the token that now stands for them. */
export function insertMention(text: string, p: Mentionable): { text: string; token: string } {
  const token = `@${firstOf(p)}`;
  return { text: text.replace(/@([^\s@]*)$/, `${token} `), token };
}

/**
 * Who a message notifies by @: the people picked from the list whose @token is still in the text,
 * then any @word typed by hand that names exactly one person. An @word that matches nobody, or more
 * than one person, reaches no one — it comes back in `unresolved`, to be said before sending.
 * `picked` maps a person's id to the token inserted for them.
 */
export function resolveMentions(
  text: string, people: readonly Mentionable[], picked: Readonly<Record<string, string>>,
): { ids: string[]; unresolved: string[] } {
  const words = [...text.matchAll(/(?:^|\s)@([^\s@.,!?;:]+)/g)].map((m) => m[1]);
  const lower = (s: string) => s.toLowerCase();
  const ids: string[] = [];
  const unresolved: string[] = [];
  const covered = new Set<string>();
  for (const [id, token] of Object.entries(picked)) {
    const w = token.replace(/^@/, "");
    if (words.some((x) => lower(x) === lower(w)) && people.some((p) => p.id === id)) { ids.push(id); covered.add(lower(w)); }
  }
  for (const w of words) {
    if (covered.has(lower(w))) continue;
    const hits = people.filter((p) => firstOf(p).length > 1 && lower(firstOf(p)) === lower(w));
    if (hits.length === 1) { if (!ids.includes(hits[0].id)) ids.push(hits[0].id); }
    else if (!unresolved.includes(`@${w}`)) unresolved.push(`@${w}`);
  }
  return { ids, unresolved };
}
