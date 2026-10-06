"use client";

import { useSyncExternalStore } from "react";

// A SETTING THIS PHONE KEEPS (2026-10-06, the settings round).
//
// The theme, the pass's sound and the text size are kept on the device, in localStorage. The sound and
// the text size are changed in two places: where they always were (the pass's bell, the rail) and
// Settings › You (the theme only there, since the moon went). Each copy used to read the value once,
// when it mounted, and keep its own state after that. So a second copy on screen was out of date the
// moment the first one changed the value, and its next tap wrote the old value back.
//
// A pref is a small store now. Every copy reads it while it renders, a write tells every copy, and
// another tab's write does too (the storage event). The server has no localStorage, so it draws the
// default; the phone redraws with its own value right after hydration — no mismatch, as before.

export type DevicePref = {
  key: string;
  read: () => string | null;
  write: (value: string) => void;
  subscribe: (onChange: () => void) => () => void;
};

// This tab's last write, by key. A browser can refuse to store (a full disk, a locked-down private
// window). The switch must still move, so the store answers from here until another tab speaks.
const latest = new Map<string, string>();

export function devicePref(key: string): DevicePref {
  const event = `gt3-pref:${key}`;
  return {
    key,
    read: () => {
      if (latest.has(key)) return latest.get(key) ?? null;
      try { return localStorage.getItem(key); } catch { return null; }
    },
    write: (value) => {
      latest.set(key, value);
      try { localStorage.setItem(key, value); } catch { /* kept for this tab above */ }
      if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
    },
    subscribe: (onChange) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key !== null && e.key !== key) return;
        latest.delete(key);   // another tab wrote it: its value wins
        onChange();
      };
      window.addEventListener(event, onChange);
      window.addEventListener("storage", onStorage);
      return () => { window.removeEventListener(event, onChange); window.removeEventListener("storage", onStorage); };
    },
  };
}

/** The pref's stored value as this render should see it. Null on the server and while hydrating. */
export function useDevicePref(pref: DevicePref): string | null {
  return useSyncExternalStore(pref.subscribe, pref.read, () => null);
}
