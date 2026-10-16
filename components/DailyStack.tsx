"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import Button from "@/components/Button";
import { InfoRow } from "@/components/kit";
import Eyebrow from "@/components/today/Eyebrow";
import { useCupAvailability } from "@/components/useCupAvailability";
import { money } from "@/lib/money";
import type { Ordering } from "@/lib/ordering";
import { CAFFEINE, DAYS, PREFS, SLOT_WORD, STACK_KEY, missingWords, parseAnswers, stackButton, stackFor, type Day, type Pref } from "@/lib/dailyStack";

// THE DAILY STACK (2026-10-13, R4 of the customer audit — "Daily Stack 2", decision (a), approved). Two questions — the
// day, and caffeine or not — and a fine-tune of preferences for whoever wants one; the stack shows as soon as both are
// answered, with no pretend wait. Its drinks are the Catalog's, only the ones the truck can make now (lib/dailyStack),
// and its button follows the truck: order now, pre-order for when it opens, or keep it for the next stop. The answers
// stay on this phone (localStorage) and go nowhere else. It replaced components/GenerateDay: five questions and six
// flags about sleep, soreness, energy, the gut and the joints, answered with nutrient talk and three drinks whatever
// the truck had.

type Props = { ordering: Ordering | null; stopMenu: ReadonlySet<string> | null };

const saved = () => { try { return parseAnswers(localStorage.getItem(STACK_KEY)); } catch { return null; } };

export default function DailyStack({ ordering, stopMenu }: Props) {
  const { menu, menuRead, bump, isInCart, toast, openCheckout, openDrink } = useApp();
  const { user } = useAuth();
  const { soldOut } = useCupAvailability();
  // The sheet mounts on a tap, never on the server: the phone's last answers are read once, as it opens.
  const [last] = useState(saved);
  const [day, setDay] = useState<Day | null>(last?.day ?? null);
  const [caffeine, setCaffeine] = useState<boolean | null>(last ? last.caffeine : null);
  const [prefs, setPrefs] = useState<Pref[]>(last ? [...last.prefs] : []);
  const [fine, setFine] = useState(!!last?.prefs.length);

  const keep = (next: { day: Day | null; caffeine: boolean | null; prefs: Pref[] }) => {
    if (!next.day || next.caffeine === null) return;
    try { localStorage.setItem(STACK_KEY, JSON.stringify({ day: next.day, caffeine: next.caffeine, prefs: next.prefs })); } catch { /* private mode: nothing kept */ }
  };
  const pickDay = (d: Day) => { setDay(d); keep({ day: d, caffeine, prefs }); };
  const pickCaffeine = (c: boolean) => { setCaffeine(c); keep({ day, caffeine: c, prefs }); };
  const togglePref = (p: Pref) => {
    const next = prefs.includes(p) ? prefs.filter((x) => x !== p) : [...prefs, p];
    setPrefs(next); keep({ day, caffeine, prefs: next });
  };

  const answered = day !== null && caffeine !== null;
  const stack = answered ? stackFor({ day, caffeine, prefs }, menu, soldOut, stopMenu) : null;
  // WHAT THE BUTTON ADDS, AT A PRICE THAT IS TRUE (R7). "Add to order · $X" summed every pick at the menu's price: a drink
  // already in the cart (which the button does not add again) was in X, and a member's perks were not — checkout then
  // said another number. X is now what goes in; and it is said to a guest only, whose price is the menu's. A member's
  // perks are the server's to price (checkout quotes them), and asking it here would send the stack's picks off the phone.
  const adding = stack ? stack.picks.filter((p) => !isInCart(p.drink.slug)) : [];
  const menuCents = adding.length && adding.every((p) => typeof p.drink.priceCents === "number")
    ? adding.reduce((s, p) => s + (p.drink.priceCents as number), 0) : null;
  const button = stack ? stackButton(ordering, user ? null : menuCents, money) : null;
  // Every pick in the cart already: the button says so, and opens it.
  const allIn = !!stack && stack.picks.length > 0 && adding.length === 0;
  const label = !button ? "" : allIn ? (button.kind === "save" ? "In your cart for the next stop" : "In your order — review it") : button.label;
  // "Not today" needs the Catalog's caffeine (lib/drinks): until the menu is read — or when it can't be — it is not
  // "nothing the truck can make" (R7), only not known yet.
  const unknownCaffeine = caffeine === false && !menuRead;
  const nothing = unknownCaffeine ? "we can't tell which drinks have no caffeine until the menu loads — try again in a moment" : "nothing the truck can make right now";

  // WHAT A SCREEN READER HEARS (2026-10-14, R6 — the audit: the result was never announced). One sentence, from a quiet
  // region of its own: the stack's drinks in order, or what is missing. The card itself is no live region any more — its
  // buttons and the fine-tune chips were read out as "updates" whenever they changed. The sentence is written into the
  // region after it is on the page, so a stack restored from the phone as the sheet opens is heard too (a region
  // announces what changes in it, never what it starts with).
  const said = stack ? `${caffeine ? "Your stack" : "Your stack, no caffeine"}: ${stack.picks.map((p) => `${SLOT_WORD[p.slot]}, ${p.drink.name}`).join("; ") || nothing}.${stack.missing.length && !unknownCaffeine ? ` ${missingWords(stack.missing)}` : ""}` : "";
  const sayRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (sayRef.current) sayRef.current.textContent = said; }, [said]);

  const go = () => {
    if (!stack || !button || !stack.picks.length) return;
    for (const p of adding) bump(p.drink.slug);
    if (button.kind === "save") { toast(allIn ? "It's in your cart — there when cup orders open." : "Saved in your cart — it's there when cup orders open."); return; }
    openCheckout();
  };

  const chips = <T extends string | boolean>(label: string, opts: readonly [T, string][], on: (v: T) => boolean, pick: (v: T) => void) => (
    <div className="flex flex-col gap-2">
      <div className="text-callout font-semibold text-cream">{label}</div>
      <div className="k-chips" role="group" aria-label={label}>
        {opts.map(([v, l]) => (
          <button key={String(v)} type="button" className={`k-chip${on(v) ? " on" : ""}`} aria-pressed={on(v)} onClick={() => pick(v)}>{l}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {chips("What's your day?", DAYS, (v) => v === day, pickDay)}
      {chips("Caffeine?", CAFFEINE, (v) => v === caffeine, pickCaffeine)}
      {/* The stack, as soon as both are answered — nothing that has focus is taken away (the old sheet swapped its whole
          form for the result); what it says is heard from the line just below (R6). */}
      <p ref={sayRef} className="sr-only" aria-live="polite" aria-atomic="true" />
      <div>
        {stack && button && (
          <div className="k-card flex flex-col gap-1">
            <Eyebrow>{caffeine ? "Your stack" : "Your stack · no caffeine"}</Eyebrow>
            {stack.picks.length > 0 && (
              <div className="k-rows">
                {stack.picks.map((p) => (
                  <InfoRow key={p.slot} lead={SLOT_WORD[p.slot]} name={p.drink.name} sub={p.why}
                    trailing={p.drink.priceCents !== null ? <span className="font-mono text-subhead text-cream">{money(p.drink.priceCents)}</span> : undefined}
                    onClick={() => openDrink(p.drink.slug)} ariaLabel={`${p.drink.name} — ${p.why}`} />
                ))}
              </div>
            )}
            {unknownCaffeine && !stack.picks.length
              ? <p className="k-rsub whitespace-normal">We can&apos;t tell which drinks have no caffeine until the menu loads — try again in a moment.</p>
              : stack.missing.length > 0 && <p className="k-rsub whitespace-normal">{missingWords(stack.missing)}</p>}
            <Button kind="primary" wide className="mt-2" disabled={!stack.picks.length} onClick={go}>
              {label}
            </Button>
            <div className="mt-2 flex items-center justify-between gap-3">
              <button type="button" className="btn-ter" aria-expanded={fine} onClick={() => setFine(!fine)}>Fine-tune</button>
              <span className="text-footnote text-cream-dim">Your answers stay on this phone</span>
            </div>
            {fine && <div className="mt-2">{chips("Anything you like?", PREFS, (v) => prefs.includes(v), togglePref)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
