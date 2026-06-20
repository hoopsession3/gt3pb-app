import type { KeyboardEvent } from "react";

// Makes a non-semantic clickable element (div/span ported from the mouse-only v3
// prototype) keyboard- and screen-reader-operable without changing its visuals:
// role=button + focusable + Enter/Space activation. Spread onto the element.
export function clickable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
