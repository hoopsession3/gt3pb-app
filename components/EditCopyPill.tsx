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

  const go = () => {
    // Force the "Copy & wording" panel open even if it was previously collapsed — otherwise the
    // anchor we're jumping to isn't in the DOM yet and the scroll silently lands nowhere.
    try { localStorage.setItem("gt3-mpanel-set-copy", "1"); } catch { /* ignore */ }
    window.location.href = `/crew?s=settings&a=${copyGroupAnchor(group)}`;
  };

  return (
    <button type="button" className="edit-copy-pill" onClick={go} aria-label={`Edit ${label ?? group.toLowerCase()} copy`}>
      <Icon name="edit" size={12} /> Edit
    </button>
  );
}
