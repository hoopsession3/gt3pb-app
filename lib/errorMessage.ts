// ONE HOME for "the message of whatever was thrown".
//
// 2026-10-02: sixty copies of `String(e?.message ?? e).slice(0, N)` — N being 300, 200, 180 or
// 160 depending on which file you were in — and forty-nine `catch (e: any)` written only so that
// `e?.message` would type-check. Same expression, same reason, sixty homes. Thrown values are
// `unknown` on purpose in strict TypeScript; this is the one place that peels a message off one.
//
// Semantics are exactly the old expression's: an Error (or anything with a `message`) gives its
// message; anything else is stringified; `max` caps it when a caller is putting it on the wire.
export function errorMessage(e: unknown, max?: number): string {
  const m = e !== null && typeof e === "object" && "message" in e && (e as { message?: unknown }).message !== undefined
    ? String((e as { message: unknown }).message)
    : String(e);
  return max === undefined ? m : m.slice(0, max);
}
