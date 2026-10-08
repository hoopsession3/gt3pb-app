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

// EACH TAB KEEPS ITS PLACE (2026-10-08, the iPhone chrome round, approved). An iPhone app's tabs each
// remember where you were: Menu, then Shop, then Menu again lands where you left the menu, and Back
// returns to the spot you came from. Before, every move started the next screen at its top. A link to a
// new screen still does: only a tab bar tap and a step through history (Back, Forward, a swipe) come back.
//
// The shell records each screen's place as it scrolls (keepPlace, keyed by its path) and asks placeFor()
// when the screen changes. returnToPlace() marks the move under way as a return; placeFor() takes that
// mark, so one return is never mistaken for the next move.
const places = new Map<string, number>();
let returning = false;

/** The move about to happen goes back to a screen: it should open where it was left. */
export function returnToPlace(): void { returning = true; }

/** Where the screen at `key` was left, when the move under way is a return; 0 when it is not. */
export function placeFor(key: string): number {
  const back = returning;
  returning = false;
  return back ? places.get(key) ?? 0 : 0;
}

/** The screen at `key` is scrolled to `top`. */
export function keepPlace(key: string, top: number): void { places.set(key, top); }

/** Scroll `body` to `top`, waiting for a page that is still drawing its content (its height grows as
 *  its data arrives) for up to 1.2s — and giving up the moment the person scrolls themselves. */
export function restorePlace(body: HTMLElement, top: number): () => void {
  body.scrollTop = top;
  if (top <= 0) return () => {};
  let stop = false;
  const t0 = Date.now();
  const quit = () => { stop = true; };
  body.addEventListener("touchstart", quit, { passive: true, once: true });
  body.addEventListener("wheel", quit, { passive: true, once: true });
  const step = () => {
    if (stop || Date.now() - t0 > 1200) return;
    if (Math.abs(body.scrollTop - top) > 2) body.scrollTop = top;
    if (Math.abs(body.scrollTop - top) > 2) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => { stop = true; body.removeEventListener("touchstart", quit); body.removeEventListener("wheel", quit); };
}
