// A LINK THAT CARRIES ONE INSTRUCTION, TAKEN ONCE (2026-10-04, the form audit).
//
// Links into the crew console carry one-time instructions beside the section: ?a=<panel> (jump to
// it), ?promote=<person> (open Bring-someone-on with them chosen), and now ?offer_for=,
// ?agreement_for= and the Academy's ?assign=. Each is read, acted on, and removed from the address
// so a refresh or a later section change never repeats it — and each consumer hand-rolled the same
// lines to do that. These are those lines, once.
//
// Reading and removing are separate on purpose. A component reads in a useState initializer, so the
// value is there on its first render; it removes in an effect, because removing rewrites the address
// and a render must not have side effects (React may run an initializer twice).

/** ?name= from the address, or null — on the server, or when it is not there. */
export function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  try { return new URL(window.location.href).searchParams.get(name); } catch { return null; }
}

/** Remove ?name= from the address without adding a history entry or touching anything else. */
export function dropParam(name: string): void {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(name)) return;
    u.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  } catch { /* an address we cannot parse is not worth failing over */ }
}

/** Both, for an effect that acts on the value right away. */
export function takeParam(name: string): string | null {
  const v = readParam(name);
  if (v != null) dropParam(name);
  return v;
}
