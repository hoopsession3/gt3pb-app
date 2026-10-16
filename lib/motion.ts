// A SCROLL THE SCRIPT ASKS FOR MOVES AS THE PERSON ASKED (R12 — the 10/10 audit's accessibility pass, F21). The
// stylesheet's Reduce Motion rule (app/globals.css: scroll-behavior:auto under prefers-reduced-motion) cannot reach a
// scroll a script asks for with behavior "smooth" — the call's own word wins over the page's — so a tab tapped again, a
// menu category, a field in a sheet and an anchor each glided across the page for someone who had asked their phone not
// to. Every such call asks here instead: "smooth", unless Reduce Motion is on.

/** "auto" (a jump) when the person asked for less motion, else "smooth". */
export function scrollMotion(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "smooth";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
