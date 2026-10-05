// THE APP'S SCROLL, TO THE TOP — one home (2026-10-05, the gesture round).
//
// The app scrolls inside <main id="body"> (components/AppShell), not the document, so the phone's own
// tap on the status bar never reaches it. This is the way up: the tab you are on, tapped again (the
// bottom tab bar, the crew lane's first section — every iPhone tab bar answers it so), and a screen
// that starts over at its top (the order form loading a pack to change or your usual). It used to be
// written out twice in components/OrderFunnel; and it is its own small file, not lib/anchors (the
// crew's jumps into a panel), because the tab bar is on every guest's page and the panel jumps are not.

export function scrollToTop(): void {
  if (typeof document === "undefined") return;
  document.getElementById("body")?.scrollTo({ top: 0, behavior: "smooth" });
}
