// WHAT A CHANGE TO THE ORDER SAYS (R12 — the 10/10 audit, F2). Adding a drink from its row on the menu, or a − / + in
// checkout, changed the order and said nothing a screen reader could hear: the cart bar that appeared is a plain button,
// and the row's button pressed was replaced by another. These are the words said instead (components/useCartSaid,
// through the app's live region), short, the drink first, then where the order stands.

const inOrder = (count: number): string => `${count} ${count === 1 ? "drink" : "drinks"} in your order`;

/** The words for `name` going from `was` to `now` in an order that now holds `count` drinks; "" when nothing changed. */
export function cartSaid(name: string, was: number, now: number, count: number): string {
  if (now === was) return "";
  if (now === 0) return `${name} taken out — ${count === 0 ? "your order is empty" : inOrder(count)}.`;
  if (was === 0) return `${name} added — ${inOrder(count)}.`;
  return `${now} ${name} — ${inOrder(count)}.`;
}
