"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { MENU_SLUG_FLAGS } from "@/lib/packlist";

// MENU & RIG CHIPS — the ONE editor for the menu/rig/site flags that events and stops share
// (menu_*, rig, power_available, water_available). The July 2026 redundancy audit found two
// drifting copies: EventCard wrote rig 'cart_only' while the prep hub's MenuEditor wrote 'cart'
// (0110 had to widen the CHECK to accept both), labels disagreed ("Broth" vs "Bone broth"), and
// EventCard flattened power/water to booleans when packListFor treats "no" (false) and "unknown"
// (null) differently. Option sets, labels, and interaction live here only.
//
// The MENU group now renders the live catalog (products where active, 0062) instead of the five
// hardcoded flags, and — when `ownerType`/`ownerId` are wired — persists picks to the 0173
// event_menu_items relation itself, while still patching the legacy menu_* boolean through
// `onPatch` (via lib/packlist's MENU_SLUG_FLAGS) so pre-cutover readers never drift. If the
// catalog fetch comes back empty, it falls back to the five known flags exactly as before.
//
// Setup & Site persistence stays with the caller: pass the current row as `value` and receive
// column patches via `onPatch` — EventCard routes them through its events update, MenuEditor
// keeps its self-contained save. `variant` maps to the host surface's existing chip classes.

export type RigKey = "cart_only" | "trailer_only" | "trailer_plus_cart";
export type MenuKey = "menu_nitro" | "menu_nature_aid" | "menu_salted_maple" | "menu_bottles" | "menu_broth";

export const MENU_FLAGS: { key: MenuKey; label: string }[] = [
  { key: "menu_nitro", label: "Nitro" },
  { key: "menu_nature_aid", label: "Nature Aide" },
  { key: "menu_salted_maple", label: "Salted Maple" },
  { key: "menu_bottles", label: "Bottles" },
  { key: "menu_broth", label: "Bone broth" },
];

// The load-out space math keys off "trailer" in the value (lib/loadout.ts rigToBox), so these
// route automatically.
export const RIG_OPTIONS: { key: RigKey; label: string }[] = [
  { key: "cart_only", label: "🛻 Cart" },
  { key: "trailer_only", label: "🚚 Trailer only" },
  { key: "trailer_plus_cart", label: "🚚 Trailer + cart" },
];

// The exact column list these chips read/write — use for every supabase select of these flags.
export const MENU_RIG_COLUMNS = `rig, power_available, water_available, ${MENU_FLAGS.map((m) => m.key).join(", ")}`;

// Read side stays loose (rig: string) so untyped stop rows fit;
// the patch side is strict so writes can only be canonical values.
export type MenuRigValue = { rig?: string | null; power_available?: boolean | null; water_available?: boolean | null } & {
  [K in MenuKey]?: boolean | null;
};
export type MenuRigPatch = { rig?: RigKey | null; power_available?: boolean | null; water_available?: boolean | null } & {
  [K in MenuKey]?: boolean;
};

// Class map onto each host surface's existing chip skin — no new CSS, no visual churn.
const SKIN = {
  ev: { h: "ev-sub-h", row: "ev-chips", chip: "ev-chip", siteRow: "ev-chips", tog: "ev-chip" },
  ts: { h: "menued-h", row: "ts-chips", chip: "ts-chip", siteRow: "menued-site", tog: "menued-tog" },
} as const;

const triLabel = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "—");

export default function MenuRigChips({ value, onPatch, variant, ownerType, ownerId }: {
  value: MenuRigValue;
  onPatch: (patch: MenuRigPatch) => void;
  variant: keyof typeof SKIN;
  ownerType?: "event" | "stop"; // with ownerId: menu picks persist to event_menu_items (0173)
  ownerId?: string;
}) {
  const c = SKIN[variant];
  const rigOn = (k: RigKey) => value.rig === k;
  const ownerCol = ownerType && ownerId ? (ownerType === "event" ? "event_id" : "stop_id") : null;

  // The live catalog — every active product is offerable, not just the five with legacy columns.
  const [products, setProducts] = useState<{ slug: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    if (!supabase) return;
    supabase.from("products").select("slug, name").eq("active", true).order("sort")
      .then(({ data }) => { if (alive) setProducts((data as { slug: string; name: string }[]) ?? []); });
    return () => { alive = false; };
  }, []);

  // Relation state (0173): which product slugs this event/stop pours.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const loadPicked = useCallback(async () => {
    if (!supabase || !ownerCol || !ownerId) return;
    const { data } = await supabase.from("event_menu_items").select("product_slug").eq(ownerCol, ownerId);
    setPicked(new Set((((data as { product_slug: string }[] | null) ?? [])).map((r) => r.product_slug)));
  }, [ownerCol, ownerId]);
  useEffect(() => { loadPicked(); }, [loadPicked]);

  const toggleProduct = async (slug: string) => {
    const flag = MENU_SLUG_FLAGS[slug] as MenuKey | undefined;
    // No owner wired (or no client) — legacy behavior: patch the boolean column only.
    if (!ownerCol || !ownerId || !supabase) {
      if (flag) onPatch({ [flag]: !value[flag] });
      return;
    }
    const on = picked.has(slug);
    const next = new Set(picked);
    if (on) next.delete(slug); else next.add(slug);
    setPicked(next); // optimistic — reload on error
    const res = on
      ? await supabase.from("event_menu_items").delete().eq(ownerCol, ownerId).eq("product_slug", slug)
      : await supabase.from("event_menu_items").insert({ [ownerCol]: ownerId, product_slug: slug });
    if (res.error) { loadPicked(); return; }
    // Keep the legacy boolean in step so old readers (economics, inventory, agent routes, and
    // packListFor's fallback) agree with the relation. Off only when NO picked slug still maps.
    if (flag) {
      const flagOn = [...next].some((s) => MENU_SLUG_FLAGS[s] === flag);
      if (flagOn !== !!value[flag]) onPatch({ [flag]: flagOn });
    }
  };
  // yes → no → unknown: "no" is a real answer (packListFor gates the EcoFlow / water kit on it),
  // "—" means nobody has asked the venue yet. Never collapse the two.
  const cycleTri = (k: "power_available" | "water_available") => {
    const cur = value[k];
    onPatch({ [k]: cur === true ? false : cur === false ? null : true });
  };
  return (
    <>
      {/* BEO framing: MENU is one section; SETUP & SITE is another. Never one grab-bag headline. */}
      <div className={c.h}>Menu — what we&apos;re pouring</div>
      <div className={c.row}>
        {products.length > 0
          ? products
              // without an owner the only persistence is the five legacy columns — hide unmapped items
              .filter((p) => ownerCol || MENU_SLUG_FLAGS[p.slug])
              .map((p) => {
                const flag = MENU_SLUG_FLAGS[p.slug] as MenuKey | undefined;
                const on = ownerCol ? picked.has(p.slug) : !!(flag && value[flag]);
                return (
                  <button key={p.slug} type="button" className={`${c.chip}${on ? " on" : ""}`} aria-pressed={on}
                    onClick={() => toggleProduct(p.slug)}>{on ? "✓ " : ""}{p.name}</button>
                );
              })
          : MENU_FLAGS.map((m) => (
              <button key={m.key} type="button" className={`${c.chip}${value[m.key] ? " on" : ""}`} aria-pressed={!!value[m.key]}
                onClick={() => onPatch({ [m.key]: !value[m.key] })}>{value[m.key] ? "✓ " : ""}{m.label}</button>
            ))}
      </div>
      <div className={c.h}>Setup — the rig we bring</div>
      <div className={c.row}>
        {RIG_OPTIONS.map((r) => (
          <button key={r.key} type="button" className={`${c.chip}${rigOn(r.key) ? " on" : ""}`} aria-pressed={rigOn(r.key)}
            onClick={() => onPatch({ rig: rigOn(r.key) ? null : r.key })}>{r.label}</button>
        ))}
      </div>
      <div className={c.h}>Site — ask the venue</div>
      <div className={c.siteRow}>
        <button type="button" className={c.tog} onClick={() => cycleTri("power_available")}>Power · <b>{triLabel(value.power_available)}</b></button>
        <button type="button" className={c.tog} onClick={() => cycleTri("water_available")}>Water · <b>{triLabel(value.water_available)}</b></button>
      </div>
    </>
  );
}
