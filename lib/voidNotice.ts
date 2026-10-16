import { authedFetch } from "./authedFetch";

// THE MEMBER'S EMAIL FOR A CUP THE CREW VOIDED (R7, sent from the Pass) — and, since R9, from the offline replay too: a
// void made with no signal landed later and nobody wrote. Sent once the void has landed; /api/notify reads the order
// and says nothing for one that is not void or has no member. Best-effort: the void stands either way.
export function notifyVoid(id: string): void {
  void (async () => {
    try {
      await authedFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "order_void", id }) });
    } catch { /* best-effort */ }
  })();
}
