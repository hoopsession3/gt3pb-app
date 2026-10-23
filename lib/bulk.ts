// BULK ACTIONS, ONE WAY (R48 — Ryan, 2026-10-23: "areas where you can do multiple things for multiple items, like
// allowing me to take off multiple items offline… as an industry standard"; the console audit: 0 of 50 lists could
// select more than one row). Pure: what a selection is, what running one action over it did, and how that is said.
//
// The standard every bulk action here keeps (scripts/r48.test.mjs holds it):
//   · select all means everything the list SHOWS — its filter and search — never rows the reader can't see;
//   · the confirm names the count and what will happen, before anything is written;
//   · each row is written on its own and answered on its own — a refusal names the row and why, never a blanket "Saved";
//   · what was there before is kept, so Undo puts back exactly that, for the rows that changed (lib/catalog UNDO_MS);
//   · the database is the gate and the record: a row the role may not change is refused there, and the table's audit
//     trigger writes who changed what (Settings › Activity log).

export type Outcome = { ok: string[]; failed: { id: string; why: string }[] };

/** Every selected id still in the list as shown — a row filtered away or gone since is not acted on. */
export function inView(selected: ReadonlySet<string>, shownIds: readonly string[]): string[] {
  return shownIds.filter((id) => selected.has(id));
}

/** Toggle one id; select all (or none) of what is shown. */
export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
export function toggleAll(selected: ReadonlySet<string>, shownIds: readonly string[]): Set<string> {
  const all = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  return all ? new Set([...selected].filter((id) => !shownIds.includes(id))) : new Set([...selected, ...shownIds]);
}

/** Run one write per id, a few at a time; each answers for itself (null = done, a string = why it was refused). */
export async function runEach(ids: readonly string[], write: (id: string) => Promise<string | null>, at = 4): Promise<Outcome> {
  const out: Outcome = { ok: [], failed: [] };
  for (let i = 0; i < ids.length; i += at) {
    const batch = ids.slice(i, i + at);
    const answers = await Promise.all(batch.map(async (id) => {
      try { return await write(id); } catch (e) { return e instanceof Error && e.message ? e.message : "it didn't save"; }
    }));
    batch.forEach((id, k) => { const why = answers[k]; if (why === null) out.ok.push(id); else out.failed.push({ id, why }); });
  }
  return out;
}

/** "Hid 4 items." · "Hid 3 of 4 — Market Tote: that row is locked." Plural by count; names every refusal. */
export function outcomeWords(o: Outcome, verbPast: string, nameOf: (id: string) => string, noun: [string, string] = ["item", "items"]): string {
  const n = o.ok.length + o.failed.length;
  const word = (k: number) => (k === 1 ? noun[0] : noun[1]);
  if (!o.failed.length) return `${verbPast} ${n} ${word(n)}.`;
  const why = o.failed.map((f) => `${nameOf(f.id)}: ${f.why}`).join(" · ");
  if (!o.ok.length) return `Nothing changed — ${why}`;
  return `${verbPast} ${o.ok.length} of ${n} ${word(n)} — ${why}`;
}

/** The confirm's words: what, how many, and that it can be undone for a minute. */
export function confirmWords(verb: string, n: number, noun: [string, string] = ["item", "items"], where = ""): { title: string; body: string; confirmLabel: string } {
  const what = `${n} ${n === 1 ? noun[0] : noun[1]}`;
  return { title: `${verb} ${what}${where ? ` ${where}` : ""}?`, body: "Each one is changed on its own; anything that can't be is named. You can undo it for a minute.", confirmLabel: `${verb} ${what}` };
}
