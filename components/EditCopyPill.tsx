"use client";

import { useAuth, roleOf } from "./AuthProvider";
import Icon from "@/components/Icon";
import { copyGroupAnchor } from "@/lib/copy";

// EDIT-THIS-PAGE PILL — Ryan's ask, 7/16: an owner looking at a live page should be able to jump
// straight to the exact SiteCopyEditor group that controls it, instead of hunting through Settings.
// Owner-only ON PURPOSE (not admin, not staff, not members, not guests) — this is real estate on
// customer-facing pages, and every other role already has its own path into Settings from inside
// the crew console same as today; this pill is strictly an extra, faster door for the top tier.
//
// Hard navigation (window.location, not next/navigation's router): OperatorSectionProvider only
// reads ?s=/?a= off the URL in its ONE-TIME mount effect, and it lives in AppShell above every
// route, so a client-side route change from a storefront page wouldn't re-run that hydration. A
// real page load guarantees the crew console mounts fresh and lands on the right section + anchor.
export default function EditCopyPill({ group, label }: { group: string; label?: string }) {
  const { profile } = useAuth();
  if (roleOf(profile) !== "owner") return null;

  // The group's editor is drawn only while its Settings row is open. This used to force that open by
  // writing the row's remembered state before leaving — and since the settings round (2026-10-06)
  // Settings' rows remember nothing, so the jump landed on a closed list and found no group. The
  // jump opens the row itself now: lib/anchors asks lib/settingsLayout which row holds a copy group.
  const go = () => { window.location.href = `/crew?s=settings&a=${copyGroupAnchor(group)}`; };

  return (
    <button type="button" className="edit-copy-pill" onClick={go} aria-label={`Edit ${label ?? group.toLowerCase()} copy`}>
      <Icon name="edit" size={12} /> Edit
    </button>
  );
}
