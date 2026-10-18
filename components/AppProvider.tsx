"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { drinkFrom, fallbackCents, MAX_CUPS, menuOf, nameFrom, seedMenu, type Drink, type MenuRow } from "@/lib/drinks";
import { payHeldOpen } from "@/lib/payHold";
import { useCupAvailability } from "@/components/useCupAvailability";
import { haptic } from "@/lib/haptics";
import { apiUrl } from "@/lib/native";
import { announce } from "@/components/Announcer";
import { TOAST_AFTER_HOLD_MS, toastHoldMs } from "@/lib/toastTiming";
import { sayable } from "@/lib/failureWords";
import { useHydrated } from "@/lib/clientState";

type ToastVariant = "success" | "error" | "info";
/** One thing the toast can do — "Undo" after a swipe cleared a flag (2026-10-05, the gesture round). */
export type ToastAction = { label: string; run: () => void };

interface AppCtx {
  // toast
  toast: (msg: string, variant?: ToastVariant, opts?: { action?: ToastAction }) => void;
  hideToast: () => void;
  /** A finger on the toast or focus in it (true) stops its clock; letting go (false) starts what was left. */
  holdToast: (on: boolean) => void;
  // cart (pre-order) — quantity per drink
  cart: Record<string, number>;
  cartCount: number;
  isInCart: (id: string) => boolean;
  qtyOf: (id: string) => number;
  bump: (id: string) => void;
  inc: (id: string) => void;
  dec: (id: string) => void;
  checkout: (opts?: { silentToast?: boolean }) => void;
  // drink sheet
  openId: string | null;
  openDrink: (id: string) => void;
  closeDrink: () => void;
  // checkout sheet
  coOpen: boolean;
  openCheckout: () => void;
  closeCheckout: () => void;
  // ANY payment surface is on screen — the drinks sheet, or the shop's own checkout view.
  // The floating CartBar hid for `coOpen` and only `coOpen`, so while Ryan was paying $32 for a cap
  // the drinks bar sat across the bottom of the shop checkout reading "Review 1 drink · $10", on
  // top of the Pay button, quoting a different cart and a different total (2026-09-29). Two carts,
  // one floating bar, and a flag that only knew about one of them.
  payOpen: boolean;
  setPayOpen: (v: boolean) => void;
  // one-tap reorder: the cart becomes a past order (Undo brings back what it held) and checkout opens on it
  reorder: (items: string[]) => void;
  // authoritative price (cents) for a drink — the Catalog's, else the code list's until /api/menu lands; never a crash
  priceCents: (id: string) => number;
  // THE MENU IS THE CATALOG (2026-10-13, R2): the cup menu, a drink by its slug, and a name for an order line — one
  // answer for every screen (lib/drinks). `menu` is the code list's menu until the Catalog has been read, and when it
  // can't be: never empty. `menuRead` says whether the Catalog answered.
  menu: Drink[];
  menuRead: boolean;
  drinkOf: (id: string) => Drink;
  nameOf: (id: string) => string;
  refreshMenu: () => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}

// WHAT DOESN'T CHANGE WITH THE CART (R22 — the 10/10 audit, performance F19). The cart, the sheets and the reorder lived in
// the one value every screen read, so a drink tapped into the cart drew every screen that only wanted to say a toast or
// name a drink — the Pass's lanes included, on a crew phone that ordered. The toast's controls and the menu are their own
// value now, changing only when the menu does; the 148 places that read nothing else read this (useAppStable), and only
// the cart's own screens hear the cart. useApp still answers everything, as it always did.
export type AppStable = Pick<AppCtx, "toast" | "hideToast" | "holdToast" | "priceCents" | "menu" | "menuRead" | "drinkOf" | "nameOf" | "refreshMenu">;
const StableCtx = createContext<AppStable | null>(null);
export function useAppStable(): AppStable {
  const v = useContext(StableCtx);
  if (!v) throw new Error("useAppStable must be used within AppProvider");
  return v;
}

// WHAT THE TOAST SAYS, APART FROM WHAT THE APP DOES (R13 — the 10/10 audit's performance pass, F19). The toast's words and
// whether it is up lived in the one context every screen reads (useApp, 149 places), so each toast — up, then down a few
// seconds later — drew the whole app twice: the chrome, every sheet, and on the Pass every lane. Only the toast itself
// reads them now (components/Toast); `toast()` and the rest stay where they were, and do not change.
type ToastState = { toastMsg: string; toastShown: boolean; toastVariant: ToastVariant; toastAction: ToastAction | null };
const ToastCtx = createContext<ToastState>({ toastMsg: "", toastShown: false, toastVariant: "success", toastAction: null });
export function useToastState(): ToastState {
  return useContext(ToastCtx);
}

/** The cart this phone kept, cleaned (R7: whole drinks, up to what one order holds), or null. Any drink is kept for
 *  now: which are still on the menu is the Catalog's to say, once it has been read (AppProvider). Reads storage. */
function savedCart(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem("gt3-cart");
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<string, number> = {};
    // Whole, up to what one order holds (R7): it came back as 9 of a drink, which is a different cart — and a different
    // checkout key, so a payment whose answer was lost was paid again under a new one.
    let room = MAX_CUPS;
    for (const [id, q] of Object.entries(saved)) {
      if (id && typeof q === "number" && Number.isFinite(q) && q >= 1 && room > 0) { clean[id] = Math.min(room, Math.floor(q)); room -= clean[id]; }
    }
    return Object.keys(clean).length ? clean : null;
  } catch { return null; }
}

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const [toastMsg, setToastMsg] = useState("");
  const [toastShown, setToastShown] = useState(false);
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");
  const [toastAction, setToastAction] = useState<ToastAction | null>(null);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The shown toast's clock: what it had left when last started, when that was, and whether someone is holding it.
  const left = useRef(0);
  const since = useRef(0);
  const held = useRef(false);

  const hideToast = useCallback(() => {
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = null;
    held.current = false;
    setToastShown(false);
    setToastAction(null);
  }, []);
  const runToast = useCallback((ms: number) => {
    if (tRef.current) clearTimeout(tRef.current);
    left.current = ms;
    since.current = Date.now();
    tRef.current = setTimeout(() => { tRef.current = null; held.current = false; setToastShown(false); setToastAction(null); }, ms);
  }, []);
  // HOW LONG, AND SAID (R12 — the 10/10 audit, F3): the words set the time (lib/toastTiming), and every toast is said to a
  // screen reader as it shows (components/Announcer — the toast is no longer a live region of its own), an error
  // assertively; one with something to do says where that is.
  //
  // AN ERROR IS FELT (2026-10-05, the haptics round). Every error toast in the app comes through here,
  // so this is the one home for the error feel: a screen that says it with toast() is not to buzz it
  // again. An error shown inline, in the screen's own words, buzzes where it is set.
  //
  // AN ERROR IS SAID IN PLAIN WORDS (R34 — the fresh audit's UX11-11): the screens say a failure in plain words
  // (lib/failureWords), and this door holds them to it — a raw "JWT expired" or "Failed to fetch" that reached a toast,
  // from a screen or a helper's text, is put in plain words before it is shown or said (lib/failureWords sayable).
  const toast = useCallback((said: string, variant: ToastVariant = "success", opts?: { action?: ToastAction }) => {
    const msg = variant === "error" ? sayable(said) : said;
    if (variant === "error") haptic("error");
    setToastMsg(msg);
    setToastVariant(variant);
    setToastAction(opts?.action ?? null);
    setToastShown(true);
    held.current = false;
    runToast(toastHoldMs(msg, variant, !!opts?.action));
    announce(opts?.action ? `${msg}. ${opts.action.label} is in the message at the bottom of the screen.` : msg, variant === "error" ? "assertive" : "polite");
  }, [runToast]);
  const holdToast = useCallback((on: boolean) => {
    if (on) {
      if (held.current || !tRef.current) return;
      held.current = true;
      clearTimeout(tRef.current);
      tRef.current = null;
      left.current = Math.max(0, left.current - (Date.now() - since.current));
    } else {
      if (!held.current) return;
      held.current = false;
      runToast(Math.max(TOAST_AFTER_HOLD_MS, left.current));
    }
  }, [runToast]);

  // One source of truth for the menu and its prices: the Catalog, via /api/menu (lib/drinks). Shared so the cart bar,
  // the menu, the drink sheet and checkout can never show three different drinks or totals. Until it lands — and when it
  // can't be read — the code list's menu and prices stand in; Pay asks the Catalog itself either way. Read once per
  // session and again whenever the menu opens (refreshMenu), so a drink added in the Catalog shows the next time the menu opens.
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<MenuRow[] | null>(null);
  const reading = useRef(false);
  // What the Catalog's first answer does to a cart restored from the phone (set below, once the cart exists): a drink taken
  // off the menu since it went in comes out, said once. Only the first answer of the session — a later read can come from
  // an edge copy a few seconds older than a drink just added — and never a read that failed (the code list's menu is a
  // stand-in, not a verdict). A drink taken off mid-session is named by Pay ("isn't on the menu any more").
  const pruneCart = useRef<(rows: MenuRow[]) => void>(() => {});
  const pruned = useRef(false);
  const refreshMenu = useCallback(() => {
    if (reading.current) return;
    reading.current = true;
    // A read that hangs gives up after 10 seconds, so it never holds every later read (the truck's board reads every minute).
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const quit = setTimeout(() => ctrl?.abort(), 10_000);
    fetch(apiUrl("/api/menu"), ctrl ? { signal: ctrl.signal } : undefined).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setPrices(d.prices || {});
      // An empty list is an answer (nothing on sale); null is a read that failed — the code list's menu stays.
      if (Array.isArray(d.items)) {
        setRows(d.items as MenuRow[]);
        if (!pruned.current) { pruned.current = true; pruneCart.current(d.items as MenuRow[]); }
      }
    }).catch(() => {}).finally(() => { clearTimeout(quit); reading.current = false; });
  }, []);
  useEffect(() => { refreshMenu(); }, [refreshMenu]);
  // Live: the 86s, and every product's name (the crew read every row) — for an order line the menu's rows don't name.
  const { soldOut, names: liveNames } = useCupAvailability();
  const bySlug = useMemo(() => new Map((rows ?? []).map((r) => [r.slug, r])), [rows]);
  const menu = useMemo(() => (rows ? menuOf(rows) : seedMenu()), [rows]);
  const drinkOf = useCallback((id: string) => drinkFrom(bySlug.get(id) ?? null, id), [bySlug]);
  const nameOf = useCallback((id: string) => nameFrom(rows, id, liveNames), [rows, liveNames]);
  const priceCents = useCallback((id: string) => prices[id] ?? bySlug.get(id)?.price_cents ?? fallbackCents(id) ?? 0, [prices, bySlug]);

  const [cart, setCart] = useState<Record<string, number>>({});
  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);
  // The order follows the customer (2026-08-01, 10/10-flow round): the CartBar already rides
  // every screen in-session — what the cart did NOT survive was a refresh or the PWA being
  // closed and reopened mid-build. Mirror it to localStorage: hydrate once on mount (in an
  // effect, not the useState initializer, so SSR HTML and the first client render agree — and
  // never clobbering a cart already being built this session), validate ids against the live
  // menu so a retired drink can't resurrect into an order, then persist every change. A cleared
  // cart (checkout success) writes the empty object through the same mirror.
  // THE CART COMES BACK AS THE PAGE BECOMES THE BROWSER'S (R17). Still not the useState initializer — the server and the
  // hydrating render draw an empty cart, as before — but read the render after (lib/clientState useHydrated), not by an
  // effect that set state as it mounted. Written back only once read: an empty cart written first would erase it.
  const hydrated = useHydrated();
  const [restored, setRestored] = useState(false);
  if (hydrated && !restored) {
    setRestored(true);
    const saved = savedCart();
    if (saved) setCart((c) => (Object.keys(c).length ? c : saved));
  }
  useEffect(() => { if (restored) { try { localStorage.setItem("gt3-cart", JSON.stringify(cart)); } catch { /* ignore */ } } }, [cart, restored]);
  const isInCart = useCallback((id: string) => (cart[id] ?? 0) > 0, [cart]);
  const qtyOf = useCallback((id: string) => cart[id] ?? 0, [cart]);

  // bump = toggle in/out (menu tap); inc/dec adjust quantity (checkout / detail).
  //
  // WHAT THE TAP DID, IN THE HAND (2026-10-05, the haptics round). Adding a drink is a firmer tap than
  // taking one out, so bump has to know which it is before it asks for the update — and an updater
  // must stay pure (React may run it twice). It reads the cart as last rendered from this mirror, kept
  // in an effect: a ref is never written while rendering.
  const cartNow = useRef(cart);
  useEffect(() => { cartNow.current = cart; }, [cart]);
  useEffect(() => {
    pruneCart.current = (read: MenuRow[]) => {
      // A payment waiting on its answer holds the cart as it was paid for (lib/payHold); Pay names what is off the menu.
      if (payHeldOpen()) return;
      const onMenu = new Set(menuOf(read).map((d) => d.slug));
      const gone = Object.keys(cartNow.current).filter((id) => !onMenu.has(id));
      if (!gone.length) return;
      setCart((prev) => { const next = { ...prev }; for (const id of gone) delete next[id]; return next; });
      toast(`${gone.map((id) => nameFrom(read, id)).join(" · ")} ${gone.length === 1 ? "isn't" : "aren't"} on the menu any more — taken out of your order`, "info");
    };
  }, [toast]);
  const [coOpen, setCoOpen] = useState(false);
  const openCheckout = useCallback(() => setCoOpen(true), []);
  const closeCheckout = useCallback(() => setCoOpen(false), []);
  // THE CART HOLDS STILL WHILE A PAYMENT IS UNCONFIRMED (2026-10-15, R7 — lib/payHold). The checkout's key is signed over
  // what is in the cart, so a drink added after Pay's answer was lost was a new key, and a second charge if the first had
  // gone through. Said once, with the way back to the payment; checkout itself holds its own controls.
  const holding = useCallback((): boolean => {
    if (!payHeldOpen()) return false;
    toast("Your last payment hasn't been confirmed yet — check on it before changing your order", "error", { action: { label: "Open", run: () => setCoOpen(true) } });
    return true;
  }, [toast]);
  // The most one order holds (MAX_CUPS) — said here, before Pay refuses it.
  const full = useCallback((): boolean => {
    if (Object.values(cartNow.current).reduce((s, n) => s + n, 0) < MAX_CUPS) return false;
    toast(`${MAX_CUPS} drinks is the most one order holds`, "error");
    return true;
  }, [toast]);
  const bump = useCallback((id: string) => {
    if (holding()) return;
    if (!cartNow.current[id] && full()) return;
    if (cartNow.current[id]) haptic("light"); else haptic("medium");
    setCart((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  }, [holding, full]);
  const inc = useCallback((id: string) => {
    if (holding() || full()) return;
    haptic("increase");
    setCart((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }, [holding, full]);
  const dec = useCallback((id: string) => { if (holding()) return; haptic("decrease"); setCart((prev) => {
    const next = { ...prev };
    const q = (next[id] ?? 0) - 1;
    if (q <= 0) delete next[id];
    else next[id] = q;
    return next;
  }); }, [holding]);

  const checkout = useCallback((opts?: { silentToast?: boolean }) => {
    const count = Object.values(cart).reduce((s, n) => s + n, 0);
    if (count === 0) {
      toast("Tap + on a drink to build your order");
      return;
    }
    // Callers that already showed their own (more specific, e.g. a payment reference code) toast
    // right before calling checkout() pass silentToast — otherwise this generic one and the caller's
    // fire in the same batched render pass, and only the LAST setState-triggered toast ever renders.
    // That used to silently swallow a customer's "show this ref at the window" fallback message.
    if (!opts?.silentToast) toast(`${count} drinks pre-ordered — ready in about 8 minutes`);
    setCart({});
  }, [cart, toast]);

  const [openId, setOpenId] = useState<string | null>(null);
  const openDrink = useCallback((id: string) => setOpenId(id), []);
  const closeDrink = useCallback(() => setOpenId(null), []);

  // A surface that is not the drinks sheet claims this while it is taking a payment. Kept separate
  // from coOpen because coOpen also OPENS the drinks sheet — one flag cannot both mean "a payment
  // is happening" and "show this particular sheet".
  const [payOpen, setPayOpen] = useState(false);
  // ORDER AGAIN IS THAT ORDER (2026-10-13, R3 of the customer audit, approved: "Order again replaces the cart"). It used to
  // add the past order to whatever the cart held — a cart the phone keeps for days — so one tap could check out last
  // week's half-built order with the usual on top, at a total nobody had seen. Now the cart becomes the order and checkout
  // opens on it; a cart that held something else comes back with Undo.
  // 86'd items are filtered here so one-tap reorder can never build a cart that dead-ends at
  // checkout — the customer is told what's out, and the rest of their usual carries on.
  // A drink no longer on the menu (the Catalog's cup menu, or the code list's until it is read) is said, by name, and left
  // out — it used to vanish without a word, and an order made only of such drinks did nothing at all.
  const reorder = useCallback((items: string[]) => {
    if (holding()) return;
    // Until the Catalog has answered, the menu is the code list's stand-in: a drink only the Catalog knows is kept, and Pay
    // decides — never "isn't on the menu any more" about a drink that is.
    const onMenu = new Set([...menu.map((d) => d.slug), ...(rows ? [] : items)]);
    const gone = [...new Set(items.filter((id) => !onMenu.has(id)))].map((id) => nameFrom(rows, id));
    const out = [...new Set(items.filter((id) => onMenu.has(id) && soldOut.has(id)))].map((id) => nameFrom(rows, id));
    const ok = items.filter((id) => onMenu.has(id) && !soldOut.has(id));
    const said = [
      gone.length ? `${gone.join(" · ")} ${gone.length === 1 ? "isn't" : "aren't"} on the menu any more` : "",
      out.length ? `${out.join(" · ")} ${out.length === 1 ? "is" : "are"} sold out today` : "",
    ].filter(Boolean).join(", and ");
    if (ok.length === 0) { if (said) toast(said, "error"); return; }
    const next: Record<string, number> = {};
    ok.forEach((id) => { next[id] = (next[id] ?? 0) + 1; });
    const before = cartNow.current;
    const same = Object.keys(before).length === Object.keys(next).length && Object.entries(next).every(([id, q]) => before[id] === q);
    setCart(next);
    setCoOpen(true);
    if (said) toast(`${said} — the rest is in your order`, "error");
    else if (Object.keys(before).length && !same) toast("Replaced what was in your order", "info", { action: { label: "Undo", run: () => { setCart(before); setCoOpen(false); } } });
  }, [toast, soldOut, menu, rows, holding]);

  const stable = useMemo<AppStable>(
    () => ({ toast, hideToast, holdToast, priceCents, menu, menuRead: rows !== null, drinkOf, nameOf, refreshMenu }),
    [toast, hideToast, holdToast, priceCents, menu, rows, drinkOf, nameOf, refreshMenu]
  );
  const value = useMemo<AppCtx>(
    () => ({ ...stable, cart, cartCount, isInCart, qtyOf, bump, inc, dec, checkout, openId, openDrink, closeDrink, coOpen, openCheckout, closeCheckout, payOpen, setPayOpen, reorder }),
    [stable, cart, cartCount, isInCart, qtyOf, bump, inc, dec, checkout, openId, openDrink, closeDrink, coOpen, openCheckout, closeCheckout, payOpen, setPayOpen, reorder]
  );
  const toastState = useMemo<ToastState>(() => ({ toastMsg, toastShown, toastVariant, toastAction }), [toastMsg, toastShown, toastVariant, toastAction]);

  return <StableCtx.Provider value={stable}><Ctx.Provider value={value}><ToastCtx.Provider value={toastState}>{children}</ToastCtx.Provider></Ctx.Provider></StableCtx.Provider>;
}
