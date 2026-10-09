import type { ButtonHTMLAttributes, ReactNode } from "react";

// ONE SET OF BUTTONS (2026-10-09, the button round: redesign 7, approved by Ryan).
//
// The house stylesheet held 31 separate recipes for a button. Given the same word they came out in 19
// heights, 10 corner radii, 9 type sizes and 14 fills, three set in capitals, and 17 of them showed nothing
// under the finger. Now there are four kinds in two sizes, drawn by app/globals.css "03 · Buttons":
//
//   primary      filled — GT3 red on a customer's screen, gold in the crew console. One per screen: the thing
//                the screen is for.
//   secondary    outlined — every other action that stands as a button.
//   quiet        gold words, no box — an action beside the main one, or at the head of a section (+ Add).
//   destructive  red words, no box — the action that cannot be taken back, and the "yes" of the question
//                that asks first (components/ConfirmSheet).
//
// Regular stands 50pt with body-size words. Compact stands 36pt with subheadline words and is for the crew's
// lists only (a row's Restore, Make primary, Approve); its tap still reaches 44pt. A button sizes to its words;
// `wide` spans its column. Every button dims and settles a little under the finger, the way iOS's buttons do.
//
// <Button kind="secondary" compact onClick={…}>Restore</Button> is the same element as
// <button className="btn-sec btn-sm" onClick={…}>Restore</button>: the classes are the kit, and either way of
// writing it is the kit. A link or a label drawn as a button takes the classes from btn():
// <Link href="/menu" className={btn("primary", { wide: true })}>See the menu</Link>. A screen may place a
// button (margin, flex, grid) and a light screen inks it through its tokens; nothing restyles one
// (scripts/css.audit.mjs, ONE SET OF BUTTONS).

export type ButtonKind = "primary" | "secondary" | "quiet" | "destructive";

const KIND: Record<ButtonKind, string> = { primary: "btn-pri", secondary: "btn-sec", quiet: "btn-ter", destructive: "btn-del" };

export type ButtonLook = {
  /** 36pt, for a row in a crew list (the filled and outlined kinds; the words-only kinds have one size). */
  compact?: boolean;
  /** Span the column (the filled and outlined kinds). */
  wide?: boolean;
  /** Placement only — margin, flex, grid — as utilities. */
  className?: string;
};

/** The kit's classes for a button of this kind: for a link or a label drawn as one. */
export function btn(kind: ButtonKind, { compact, wide, className }: ButtonLook = {}): string {
  const box = kind === "primary" || kind === "secondary";
  return [KIND[kind], box && compact ? "btn-sm" : "", box && wide ? "btn-wide" : "", className ?? ""].filter(Boolean).join(" ");
}

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & ButtonLook & { kind: ButtonKind; children?: ReactNode };

/** A button, of one of the kit's four kinds. `type` is passed through as written: inside a form a button with
 *  none submits it, as a plain <button> does. */
export default function Button({ kind, compact, wide, className, children, ...rest }: Props) {
  return <button {...rest} className={btn(kind, { compact, wide, className })}>{children}</button>;
}
