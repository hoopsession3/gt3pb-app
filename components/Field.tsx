"use client";

import { useId, type ReactNode } from "react";

// THE LABELLED FIELD — the primitive this app never had.
//
// ── WHY IT EXISTS ──────────────────────────────────────────────────────────────────────────────
// 129 of 600 form controls in this codebase have no accessible name. 100 of them lean on a
// placeholder, which disappears the moment somebody types and is not a name in the first place;
// 29 have nothing at all, and ~20 of those are visible, focusable controls a screen reader
// announces as "edit text" and nothing else.
//
// That number is not carelessness. It is the predictable result of there being no shared field:
// every input in the app is hand-written, so every input is an opportunity to forget. The reverse
// experiment already ran in this codebase and worked — Sheet's CloseButton REQUIRES an aria-label,
// and icon-only buttons without a name are down to 4 out of 1,060.
//
// So: a field where the label is not optional. `label` is a required prop, and it is wired to the
// control by a generated id rather than by hoping the caller passes matching ones.
//
// ── WHAT IT IS NOT ─────────────────────────────────────────────────────────────────────────────
// Not a form library, not a validation framework, not a replacement for .prod-f. It renders the
// same .prod-f markup the app already styles, so a converted field is visually identical to the
// one beside it — this is a correctness primitive wearing the existing design system, not a new
// one. Adopt it as screens are touched; do not sweep 129 call sites in one commit.
//
// ── INPUT TYPES ────────────────────────────────────────────────────────────────────────────────
// The brief asks for phone → tel, money → currency-aware, date → a date control. Those are
// properties of the DATA, so they belong on a `kind`, not on every caller remembering the right
// combination of type + inputMode + autoComplete. On a phone, `inputMode="decimal"` is the
// difference between a numeric keypad and hunting through a QWERTY layout.

type Kind = "text" | "email" | "tel" | "money" | "number" | "date" | "time" | "url" | "multiline";

const INPUT: Record<Exclude<Kind, "multiline">, {
  type: string; inputMode?: "text" | "email" | "tel" | "decimal" | "numeric" | "url"; autoComplete?: string;
}> = {
  text:   { type: "text" },
  email:  { type: "email",  inputMode: "email", autoComplete: "email" },
  tel:    { type: "tel",    inputMode: "tel",   autoComplete: "tel" },
  money:  { type: "text",   inputMode: "decimal" },   // text, not number: a spinner on a price is wrong
  number: { type: "text",   inputMode: "numeric" },
  date:   { type: "date" },
  time:   { type: "time" },
  url:    { type: "url",    inputMode: "url" },
};

export function Field({
  label, kind = "text", value, onChange, placeholder, hint, error, required,
  disabled, rows = 3, prefix, children, id: providedId,
}: {
  /** REQUIRED. Not optional, on purpose — see the header. */
  label: string;
  kind?: Kind;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** A sentence under the control, announced with it. */
  hint?: string;
  /** A problem with what is currently entered. Announced, and never colour alone. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  rows?: number;
  /** e.g. "$" — decoration only, so it is hidden from assistive tech. */
  prefix?: string;
  /** A select or a custom control instead of an input; still gets the label and the ids. */
  children?: (a: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
  id?: string;
}) {
  const auto = useId();
  const id = providedId ?? `f-${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  const a11y = { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined };

  return (
    <div className={`fld${error ? " bad" : ""}`}>
      {/* htmlFor to a generated id — a caller cannot forget to match them, because they never see them */}
      <label className="fld-l" htmlFor={id}>
        {label}{required && <span className="fld-req" aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>

      {children ? children(a11y) : kind === "multiline" ? (
        <textarea {...a11y} className="fld-in" rows={rows} value={value} placeholder={placeholder}
                  disabled={disabled} required={required}
                  onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className={prefix ? "fld-wrap" : undefined}>
          {prefix && <span className="fld-pre" aria-hidden="true">{prefix}</span>}
          <input {...a11y} {...INPUT[kind]} className="fld-in" value={value} placeholder={placeholder}
                 disabled={disabled} required={required}
                 onChange={(e) => onChange(e.target.value)} />
        </div>
      )}

      {hint && <p className="fld-hint" id={hintId}>{hint}</p>}
      {/* The word, not the colour. role="alert" so a validation failure is announced rather than
          discovered by a sighted person noticing the border changed. */}
      {error && <p className="fld-err" id={errId} role="alert">{error}</p>}
    </div>
  );
}

export default Field;
