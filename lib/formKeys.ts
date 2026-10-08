// RETURN SAYS WHAT IT DOES (2026-10-08, the iPhone chrome round, approved). On an iPhone form the Return key
// is labelled for what it will do — "next" on a field with another after it, "go" or "send" on the last —
// and a field marked next moves to the next field rather than sending a form that is half filled in. The
// last field sends it, as Return always did. Fields carry the label (enterKeyHint); this is the move.
import type { KeyboardEvent } from "react";

const SKIP = new Set(["hidden", "checkbox", "radio", "submit", "button", "file", "range", "color", "reset", "image"]);

/** onKeyDown for a field marked enterKeyHint="next": Return goes to the form's next field, if there is one. */
export function nextOnEnter(e: KeyboardEvent<HTMLInputElement>): void {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
  const form = e.currentTarget.form;
  if (!form) return;
  const fields = Array.from(form.elements).filter((el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
    ((el instanceof HTMLInputElement && !SKIP.has(el.type)) || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    && !el.disabled && el.getClientRects().length > 0);
  const next = fields[fields.indexOf(e.currentTarget) + 1];
  if (!next) return;
  e.preventDefault();
  next.focus();
}
