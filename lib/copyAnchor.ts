// A COPY GROUP'S ANCHOR — one home (2026-10-06, the settings-by-category round).
//
// The copy editor (components/SiteCopyEditor) gives each group an id, and the owner-only Edit pill on
// a live page (components/EditCopyPill) links to it: /crew?s=settings&a=sc-craft-page. Since Settings
// went by category the editor sits inside a row, Brand & customer app, that is closed at rest — so
// lib/settingsLayout has to recognise a copy group's anchor to open that row first. The prefix and
// the slug live here, small, so the jump code can read them without the whole copy table.

/** Every copy group's anchor starts with this. */
export const COPY_ANCHOR_PREFIX = "sc-";

/** group → a stable DOM id, derived from the group name so a new group never registers a slug. */
export function copyGroupAnchor(group: string): string {
  return COPY_ANCHOR_PREFIX + group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
