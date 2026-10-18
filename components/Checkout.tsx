"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useCartSaid } from "./useCartSaid";
import { useAuth } from "./AuthProvider";
import { useCustomerKnown, useKnownField, invalidateCustomerKnown } from "./useCustomerKnown";
import { authedFetch } from "@/lib/authedFetch";
import { PAY_DEADLINE_MS } from "@/lib/deadline";
import { subscribePush } from "@/lib/push";
import { offStopMenu } from "@/lib/catalog";
import { CUP_MARKETS } from "@/lib/markets";
import { useAvailability } from "@/lib/availability";
import { perBottle, PRICING } from "@/lib/orderAhead";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useOrderingOpen } from "./useOrderingOpen";
import { closedWords, confirmWords, pickupWords, readyWords } from "@/lib/ordering";
import { useSiteCopy } from "@/lib/copy";
import { usePayAtPickup } from "./usePayAtPickup";
import { squareClientReady } from "@/lib/square";
import { money } from "@/lib/money";
import { trackFunnel } from "@/lib/funnel";
import Sheet, { CloseButton } from "./Sheet";
import OrderConfirm from "./OrderConfirm";
import PaymentCard, { type PaymentCardHandle } from "./PaymentCard";
import Icon from "@/components/Icon";
import { holdsKey, useIdemKey } from "./useIdemKey";
import type { CupLine } from "@/lib/cupPrice";
import { payErrorText } from "@/lib/idempotency";
import { haptic } from "@/lib/haptics";
import { Segmented } from "@/components/controls";
import { holdTicket, isTicket, ticketPath } from "@/lib/tickets";
import { holdRef } from "@/lib/paidRef";
import { useChanged } from "@/lib/useChanged";
import Said from "./Said";

// THE TIP SIGNS THE KEY (2026-10-12, C7 of the customer audit, approved). What is bought and what it costs — the items
// and the tip — are the checkout key's whole signature (lib/idempotency attemptFor), and the key is kept beside the cart
// now, through an app restart (components/useIdemKey, durable). A restart put the tip back to "No tip": a new signature,
// a new key, and a retry of a payment whose answer was lost was charged as a new checkout. So the tip is kept as the key
// is used and comes back with it while the key is held; it is forgotten once the order is placed. No key held: no tip,
// as always — the guest opts in.
//
// THE TIP'S CHOICE, NOT ITS CENTS (2026-10-15, R7 of the customer re-audit). The key was signed with the tip in cents,
// and the cents move with the price: a restart, Pay tapped before the server's price answered (the menu's prices, not a
// member's), a refusal with the new price, and the next tap signed a third amount — a third key, and the card charged
// again. The choice ("15%") is what the customer picked, and it does not move when the price does; the amount itself is
// the server's to check (expectedCents). A key held from before signs in cents, and is kept (attemptFor's `was`).
// And while a payment's answer never came, the cart and the tip hold still (lib/payHold): a change there was a new key.
const CO_IDEM = "gt3-co-idem", CO_TIP = "gt3-co-tip";
const TIPS: readonly number[] = [0, 0.15, 0.2, 0.25];
function restoredTip(): number {
  if (typeof window === "undefined" || !holdsKey(CO_IDEM, true)) return 0;
  try { const t = Number(localStorage.getItem(CO_TIP)); return TIPS.includes(t) ? t : 0; } catch { return 0; }
}

export default function Checkout() {
  const { cart, inc, dec, toast, checkout, coOpen: open, closeCheckout: onClose, priceCents, nameOf } = useApp();
  // A − or + here is said (R12 — the 10/10 audit, F2): the new count of that drink and of the order. A − that takes the
  // last of a line out removes the button pressed with the line, so focus goes to the sheet itself, not the page under it.
  const track = useCartSaid(() => document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="checkout-title"]'));
  const router = useRouter();
  // The confirmation moment — same shape as pickup/delivery's OrderConfirm. Lines/name are captured
  // at success time because checkout() clears the cart right after (lines would otherwise read empty
  // by the time the confirm screen renders).
  // readyFrom/pickup are the SERVER's promise (/api/checkout answers with what it recorded), so the
  // screen says what the order says — not what this sheet last read, which can be a minute old.
  const [done, setDone] = useState<{ paid: boolean; total: number; lines: [string, number][]; name: string; warn?: string; ref?: string; readyFrom: string | null; pickup: string; no?: string; ticket?: string | null } | null>(null);
  // Closed: the confirmation is let go, during render (R17, lib/useChanged); opened: the funnel hears it (an effect — it
  // is outside React).
  if (useChanged(open) && !open) setDone(null);
  useEffect(() => { if (open) trackFunnel("order", "open"); }, [open]);
  const { profile } = useAuth();
  const paymentRef = useRef<PaymentCardHandle>(null);
  // ONE KEY PER CHECKOUT (2026-10-11, lib/chargeOnce). The key used to be minted per card token, and
  // every tap of Pay asked the card form for a new token — so a retry after a lost answer went to
  // Square as a request it had never seen, and the card was charged again. Now what is being bought
  // and what it costs (the items and the tip) are the key's whole signature: it holds across taps,
  // across Pay and "pay at the truck", and across a restart (localStorage, beside the cart), and while
  // the last answer is unknown the SAME card token goes out with it. The server claims the key before it
  // calls Square, so a retry is told what happened to the first try — "order in", or "still confirming"
  // — and is never charged again. Paid, or refused by Square, and the next tap is a new checkout.
  const idem = useIdemKey(CO_IDEM, true);
  // A payment whose answer never came (R7): the cart and the tip hold still until it is answered, or the customer lets it go.
  const held = idem.isOpen();
  const heldCard = idem.heldCard();
  const [letGo, setLetGo] = useState(false);
  // "Check on my payment" (R7b): asks the server about the held key alone — never charges, never places an order. While it
  // is out nothing else sends and nothing lets the key go (the ref reaches a fast tap a render before `checking` does): an
  // answer about one key must never land on another.
  const [checking, setChecking] = useState(false);
  const checkingNow = useRef(false);
  // Where focus goes when the hold box it sat in goes away (R7b): to the button that now sends.
  const sendBtn = useRef<HTMLButtonElement>(null);
  const focusSend = useRef(false);
  useEffect(() => { if (!held && focusSend.current) { focusSend.current = false; sendBtn.current?.focus(); } }, [held]);
  const [checkWords, setCheckWords] = useState("");
  // A word that is not an error, said where Pay is: "that payment never reached us — you can pay now".
  const [payNote, setPayNote] = useState("");
  // Both buttons send through here, one at a time: a tap on either while the other is still answering
  // is turned away before it reaches the network (`busy` reaches a fast second tap a render late).
  const sending = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // A PAYMENT THAT DID NOT GO THROUGH IS FELT (2026-10-05, the haptics round). The card's own errors
  // and the charge's are said here, inline, not in a toast — so they buzz from here, once each time
  // one appears. What this sheet says with toast() already buzzes from AppProvider.
  useEffect(() => { if (err) haptic("error"); }, [err]);

  // "Ready in ~8 min" is only true when there's a truck to make it. One shared rule (useOrderingOpen
  // → lib/ordering, on the read /api/checkout makes too): outside the window the sheet offers the
  // pack reserve instead, and inside it the sheet says where to pick up and when it will be made.
  const { market: viewerMarket } = useViewerMarket(CUP_MARKETS);
  const ordering = useOrderingOpen(open, viewerMarket);
  const o = ordering.ordering;
  const t = useSiteCopy();
  // Before the first read lands nothing is claimed; the server's answer fills the confirmation.
  const promised = (data: { readyFrom?: string | null; pickup?: string } | null) => ({
    readyFrom: data && "readyFrom" in data ? data.readyFrom ?? null : o?.readyFrom ?? null,
    pickup: data?.pickup ?? (o ? pickupWords(o) : "At the truck"),
  });
  // Operator's pay-later switch (Money section). Governs whether the "pay at the truck" pre-order
  // path is offered — on its own when Square is off, or alongside the card when Square is on.
  const payLater = usePayAtPickup(open);

  // The drinks and their prices are the menu's (AppProvider — the Catalog, R2); the charge is priced by the server.
  const lines = Object.entries(cart);
  const items = lines.flatMap(([id, q]) => Array<string>(q).fill(id)); // flat list for the charge + order record
  const priceOf = (id: string) => priceCents(id);
  const totalCents = items.reduce((s, id) => s + priceOf(id), 0);
  // THE SERVER'S PRICE, BEFORE PAY (C2, 2026-10-12). /api/checkout/quote prices this cart the way the charge will — a
  // member's perks applied and named, a price the owner changed after the menu loaded — and the button shows that amount
  // and sends it; the charge refuses any other (lib/cupPrice). Until the quote answers, the menu's prices, as before, and
  // a refusal's new amount replaces it (priceChanged): the card is never charged an amount the button did not say.
  const itemsKey = items.join(",");
  const [quote, setQuote] = useState<{ key: string; subtotalCents: number; lines: CupLine[] } | null>(null);
  // A QUOTE THAT DIDN'T ANSWER IS SAID (R7, 2026-10-15). It was swallowed: the sheet showed the menu's prices — a member's
  // perk missing — and nothing said they might not be the price. The menu's prices still stand in, Pay still refuses an
  // amount it would not take, and the sheet says so, with a tap to ask again.
  const [quoteMissed, setQuoteMissed] = useState<string | null>(null);   // the cart whose quote didn't answer
  // A quote that REFUSED the cart (409 — a drink off the menu, or sold out since it was added: lib/catalog cartRefusal) is
  // said as what it is, and Pay waits for the cart to change (R7b) — "we couldn't check" with Check again never could.
  const [quoteRefused, setQuoteRefused] = useState<{ key: string; words: string } | null>(null);
  const [quoteTry, setQuoteTry] = useState(0);
  useEffect(() => {
    if (!open || !itemsKey) return;
    let alive = true;
    authedFetch("/api/checkout/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: itemsKey.split(",") }) })
      .then(async (r) => ({ status: r.status, d: await r.json().catch(() => null) }))
      .then(({ status, d }) => {
        if (!alive) return;
        if (status >= 200 && status < 300 && d && typeof d.subtotalCents === "number" && Array.isArray(d.lines)) {
          setQuote({ key: itemsKey, subtotalCents: d.subtotalCents, lines: d.lines }); setQuoteMissed(null); setQuoteRefused(null);
        } else if (status === 409 && d && typeof d.error === "string") {
          setQuoteRefused({ key: itemsKey, words: d.error }); setQuoteMissed(null);
        } else setQuoteMissed(itemsKey);
      })
      .catch(() => { if (alive) setQuoteMissed(itemsKey); });
    return () => { alive = false; };
  }, [open, itemsKey, quoteTry]);
  const priced = quote && quote.key === itemsKey ? quote : null;
  const unquoted = !priced && quoteMissed === itemsKey;
  const refusedNow = quoteRefused && quoteRefused.key === itemsKey ? quoteRefused.words : null;
  const lineOf = (id: string) => priced?.lines.find((l) => l.slug === id) ?? null;
  const subtotalCents = priced ? priced.subtotalCents : totalCents;
  const repriced = (d: { priceChanged?: boolean; subtotalCents?: unknown; lines?: unknown }) => {
    if (d?.priceChanged && typeof d.subtotalCents === "number" && Array.isArray(d.lines)) setQuote({ key: itemsKey, subtotalCents: d.subtotalCents, lines: d.lines as CupLine[] });
  };
  // A cart line that sold out mid-order blocks submission (the server refuses it anyway — this is
  // the polite version: name the item, let them remove it, keep the rest of the order alive).
  const { soldOut } = useAvailability(viewerMarket);   // the city this checkout is for (0408: an 86 is for one city)
  const blocked86 = lines.filter(([id]) => soldOut.has(id)).map(([id]) => nameOf(id));
  // A drink the stop doesn't pour (its menu, stop_menu 0393) blocks the same way, by name and with the stop's: Pay
  // refuses it anyway (R2, 2026-10-13). No menu set, or not read yet: nothing is blocked here.
  const stopName = o?.stop?.name ?? null;
  // A drink that is sold out is said once, as sold out — not twice.
  const notHere = offStopMenu(items.filter((id) => !soldOut.has(id)), ordering.stopMenu ? [...ordering.stopMenu] : null).map(nameOf);
  // The server's own refusal of the cart (the quote's 409, R7b) blocks the same way, in its words, when nothing on the
  // phone has said it already.
  const refusedOnly = !!refusedNow && !blocked86.length && !notHere.length;
  const blocked = blocked86.length + notHere.length + (refusedOnly ? 1 : 0);
  const blockedWords = refusedOnly ? `${refusedNow} Remove it with the − button to continue.` : blocked > 0 ? `${[
    blocked86.length ? `${blocked86.join(" · ")} just sold out` : "",
    notHere.length ? `${notHere.join(" · ")} ${notHere.length === 1 ? "isn't" : "aren't"} poured at ${stopName ?? "this stop"}` : "",
  ].filter(Boolean).join(", and ")} — remove ${blocked === 1 ? "it" : "them"} with the − button to continue.` : "";
  // Said to a screen reader when it appears (R6), from a live region that is there BEFORE it does (R7): a status region
  // inserted already holding its words is one VoiceOver often skips — sold-out changes live, often while focus is on the
  // card form. The note on screen is the same words; the region below the name field is what is read.
  const blockedNote = blocked > 0 ? <div className="co-86">{blockedWords}</div> : null;
  const blockedLabel = refusedOnly ? "Remove what isn't on the menu" : blocked86.length ? "Remove sold-out items" : "Remove what this stop doesn't pour";
  // A name is required so the operator can call the order at pickup. It starts from what we know
  // (lib/customerKnown: what they asked to be called, else the name on their record or their last
  // order — not only display_name, which is often empty) and is theirs the moment they type. A guest
  // types one; the field says it is a name, so the phone's own autofill offers it.
  const known = useCustomerKnown(open);
  const [name, setName] = useKnownField(known?.callName || profile?.display_name);
  const customer = name.trim();

  // Tip (card path only; pre-orders tip in person). Default to NO tip so selecting card never
  // silently marks the price up — the guest opts in.
  const [tipPct, setTipPct] = useState(restoredTip);
  // Kept as the key is used — the tip that signed THIS key, not whatever the buttons say later.
  const keepTip = () => { try { localStorage.setItem(CO_TIP, String(tipPct)); } catch { /* the key still holds; only a restart's tip is lost */ } };
  const tipCents = Math.round(subtotalCents * tipPct);
  const grandCents = subtotalCents + tipCents;
  // What signs this checkout's key: the drinks, and the tip the customer picked (R7) — and, for a key held from before
  // R7, what it was signed as then: the tip in cents, at the server's price or at the menu's.
  const signed = { items, tip: tipPct };
  const signedBefore = [{ items, tipCents }, { items, tipCents: Math.round(totalCents * tipPct) }];
  // The string three places below print. It was "19.99" with a "$" glued on at each site, which is
  // how the same total could read one way here and another on the receipt.
  const total = money(grandCents);

  // The upsell line's numbers come straight from the pricing grid (lib/orderAhead) — the 6-pack
  // bring-back per-bottle price against the $10 cup at the truck, % rounded down. Nothing is
  // hardcoded here, so a grid change updates the copy on its own; if the math ever can't produce
  // a sane pair, `null` quietly falls back to the original line.
  const packUpsell = (() => {
    try {
      const size = 6;
      const per = perBottle(size, "return");
      const cup = PRICING.walkup.single;
      if (!Number.isFinite(per) || !Number.isFinite(cup) || per <= 0 || per >= cup) return null;
      const pct = Math.floor(((cup - per) / cup) * 100);
      if (pct < 1) return null;
      return { size, per: `$${per.toFixed(2)}`, pct };
    } catch {
      return null;
    }
  })();

  // Order-status alerts, offered once the order is in (R7, 2026-10-15) — not asked on the way to the card, where the
  // browser's question sat between Pay and the payment, and was asked of a guest the push could never reach (a push
  // follows an account). A member on the web whose browser has not been asked gets "Ping me when it's ready" on the
  // confirmation; it runs inside that tap (a user gesture), as the browser requires.
  // Read while drawing the confirmation — a screen only a tap in this browser ever reaches, so no server draws it.
  // What it says after the tap is what the browser answered (R7b): "We'll ping you" only once alerts are on — not after a
  // No, and not for the next order in this session (the sheet stays mounted; placed() asks afresh). Not offered for a
  // charge that didn't record: there is no order yet to ping about.
  const [alertAsked, setAlertAsked] = useState<"no" | "asking" | "on" | "off">("no");
  const canAskAlerts = (() => {
    if (!done || !profile || (done.warn && !done.ticket)) return false;
    try { return typeof Notification !== "undefined" && Notification.permission === "default" && "serviceWorker" in navigator && "PushManager" in window; }
    catch { return false; }   // no Notification here: nothing to offer
  })();
  const alertAsk: "ask" | "asking" | "on" | "off" | null = alertAsked !== "no" ? alertAsked : canAskAlerts ? "ask" : null;
  const enableAlerts = async () => {
    setAlertAsked("asking");
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") setAlertAsked((await subscribePush(!!profile?.is_admin)) ? "on" : "off");
      else setAlertAsked("off");
    } catch { setAlertAsked("off"); }
  };
  // WHAT WENT IN, SAID ONCE (2026-10-11). One key covers this checkout whichever button sent it, so an
  // answer can belong to the other button: a payment that went through while its answer was lost comes
  // back when "pay at the truck" is tapped, and a pre-order comes back to Pay. The server says which it
  // was (`paid`); the confirmation says what happened, not which button was pressed.
  type Placed = { paid?: boolean; warn?: string; ref?: string; readyFrom?: string | null; pickup?: string; amount?: number; no?: string; ticket?: string | null };
  const placed = (data: Placed, byCard: boolean) => {
    try { localStorage.removeItem(CO_TIP); } catch { /* ignore */ }
    // The next order in this session starts from no tip and is asked about alerts afresh (R7b): the sheet stays mounted.
    setTipPct(0); setAlertAsked("no"); setPayNote(""); setCheckWords("");
    const capturedLines = [...lines], capturedName = customer;
    const p = promised(data);
    // The order's number and its ticket (R3b — board 09): the link that shows this order to whoever holds it, guests too.
    // The phone keeps it (lib/tickets), so it is not lost with this sheet.
    const t = { no: typeof data.no === "string" ? data.no : undefined, ticket: isTicket(data.ticket) ? data.ticket : null };
    if (t.ticket && t.no) holdTicket(t.ticket, t.no);
    if (typeof data.paid === "boolean" ? data.paid : byCard) {
      trackFunnel("order", "paid");
      haptic("paid");
      toast(data.warn || `Paid ${total} — order in. ${readyWords(p.readyFrom ? { state: "ahead", readyFrom: p.readyFrom } : { state: "live", readyFrom: null })}`);
      checkout({ silentToast: true }); // clears cart — this toast already fired above
      // data.warn/data.ref carry the "charged but not yet recorded" fallback (server alerted the
      // crew and generated a reference code) — capture them into `done` so the PERSISTENT confirm
      // screen shows it, not just a toast that auto-dismisses in a few seconds. Previously this was
      // dropped entirely: the toast above never even rendered (React batches it with checkout()'s own
      // toast and only the last one shows), and `done` had nowhere to put it even if it had.
      // What was charged, as the server says it — not what this screen worked out (C2).
      setDone({ paid: true, total: typeof data.amount === "number" ? data.amount : grandCents, lines: capturedLines, name: capturedName, warn: data.warn, ref: data.ref, ...p, ...t });
      // Charged, and no order to track (R7): the reference outlives this sheet — the order bar says it until the crew has it.
      if (data.warn && !t.ticket) holdRef(typeof data.ref === "string" ? data.ref : "", typeof data.amount === "number" ? data.amount : grandCents);
      invalidateCustomerKnown();
    } else {
      trackFunnel("order", "pickup");
      haptic("success");
      toast(`${items.length} drink${items.length === 1 ? "" : "s"} pre-ordered — ${p.readyFrom ? "made when we open" : "ready in about 8 minutes"}`);
      checkout({ silentToast: true }); // clears cart — this toast already fired above
      setDone({ paid: false, total: typeof data.amount === "number" ? data.amount : subtotalCents, lines: capturedLines, name: capturedName, ...p, ...t });
      invalidateCustomerKnown();   // the next form starts from this order
    }
  };

  // Pre-orders (pay at the truck) go through /api/checkout now too (no sourceId = pay-at-pickup) —
  // same availability + ordering-window checks the paid path always had, instead of inserting
  // directly from the client. `orders` no longer has a client write door at all. They carry the
  // checkout's key, so a retry after "we're offline" is answered with the first order, not a second.
  const recordPreOrder = async (): Promise<{ error: { message: string } | null; data?: Placed }> => {
    keepTip();
    const attempt = await idem.begin(signed, undefined, signedBefore);
    idem.sent(attempt.key, false);   // held open until its answer (R7b): an app closed now reopens holding it
    try {
      const res = await authedFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, customer, market: viewerMarket, idempotencyKey: attempt.key, expectedCents: subtotalCents }),
      }, { deadlineMs: PAY_DEADLINE_MS });
      const data = await res.json();
      idem.settle(attempt.key, res.status, data);
      // Placed is `ok: true`, nothing less (R7b): a key a check closed answers 200 with "never reached us".
      if (!res.ok || data?.ok !== true) { repriced(data); return { error: { message: data?.error || "That didn't go through — try again." } }; }
      return { error: null, data };
    } catch {
      idem.settle(attempt.key, null, null);
      return { error: { message: "We're offline right now — try again in a moment." } };
    }
  };

  // Pay-at-pickup: record the order UNPAID and hand off — the guest pays at the truck. Shared by the
  // standalone pickup button and the "or pay at pickup" secondary action when card is also offered.
  // Used to just toast-and-close with no confirmation screen at all; now shows the same OrderConfirm
  // the paid path gets.
  const sendPreOrder = async () => {
    if (busy || sending.current || checkingNow.current) return; // guard against a double-tap firing two pre-orders the kitchen makes
    setErr("");
    if (blocked > 0) { setErr(refusedOnly ? "Remove what isn't on the menu first" : blocked86.length ? "Remove the sold-out items first" : "Remove what this stop doesn't pour first"); return; }
    if (!customer) { setErr("Add a name for pickup"); return; }
    if (items.length === 0) return;
    setBusy(true);
    sending.current = true;
    try {
      const { error, data } = await recordPreOrder();
      // The server's own words when it refused (the truck closed between the read and the tap — it
      // says when it opens); the generic retry only when there are none.
      if (error) { setErr(error.message || "That didn't go through — give it another tap"); return; }
      placed(data ?? {}, false);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  // "Check on my payment" (R7b): asks /api/checkout about the held key alone (lib/chargeOnce.checkOnly) — its claim's own
  // answer, or "never reached us" with the key closed so a late arrival can't charge. Nothing is charged or placed by it;
  // the drinks and the name go along for the crew's alert, should the check find a payment that stopped half way.
  const checkHeld = async () => {
    if (checkingNow.current || sending.current) return;
    const key = idem.heldKey(), card = idem.heldCard();
    if (!key) return;   // the key this checkout's holder began and still holds — the only one a check asks about
    checkingNow.current = true;
    setChecking(true); setCheckWords(""); setErr("");
    try {
      const res = await authedFetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ check: true, idempotencyKey: idem.heldKey(), card, items, customer: customer || undefined }),
      }, { deadlineMs: PAY_DEADLINE_MS });
      const data = await res.json().catch(() => null);
      if (idem.heldKey() !== key) return;   // let go meanwhile: this answer is about a checkout that is no longer here
      if (data?.checked === true && data.charged === false) {
        // Never reached us: the key is closed on the server, and here; the cart is the customer's again.
        focusSend.current = true;
        idem.forget(); setLetGo(false);
        setPayNote(typeof data.error === "string" ? data.error : "That never reached us — nothing was charged.");
        return;
      }
      if (res.ok && data?.ok === true) { idem.settle(key, res.status, data); placed(data, card); return; }
      if (data?.declined === true) {
        // Square refused the card that payment was sent with: nothing was charged, and the checkout is theirs again (it was
        // held for as long as two hours, each check repeating Square's raw words).
        focusSend.current = true;
        idem.settle(key, res.status, data); setLetGo(false);
        const why = payErrorText(data.error);
        setErr(/nothing was charged|not been charged/i.test(why) ? why : `Your last payment didn't go through — nothing was charged. ${why}`);
        return;
      }
      setCheckWords(typeof data?.error === "string" ? data.error : "We couldn't check just now — try again in a moment.");
    } catch {
      setCheckWords("We're offline — check again when you have signal. You won't be charged twice.");
    } finally {
      checkingNow.current = false;
      setChecking(false);
    }
  };

  const pay = async () => {
    if (busy || sending.current || checkingNow.current) return; // guard a fast double-tap before the button's disabled attribute takes effect
    setErr(""); setPayNote("");
    if (!customer) { setErr("Add a name for pickup"); return; }
    if (!ready) return;
    // The weight of committing money — felt once the tap is going to charge, not on a tap the guards
    // turned away (a missing name buzzes as the error it is).
    haptic("heavy");
    setBusy(true);
    sending.current = true;
    let sent: string | null = null;
    try {
      // This checkout's key, and the card token already sent under it while the last answer is
      // unknown — a fresh one from the card form only when there is none.
      keepTip();
      const attempt = await idem.begin(signed, () => paymentRef.current!.tokenize(), signedBefore);
      if (!attempt.token) {
        setErr("Card details look off — check and retry.");
        return;
      }
      trackFunnel("order", "pay_start");
      sent = attempt.key;
      idem.sent(attempt.key, true);   // held open until its answer (R7b): an app closed now reopens holding it
      const res = await authedFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: attempt.token, items, tipCents, customer, market: viewerMarket, idempotencyKey: attempt.key, expectedCents: grandCents }),
      }, { deadlineMs: PAY_DEADLINE_MS });
      const data = await res.json();
      idem.settle(attempt.key, res.status, data);
      // Paid is `ok: true`, nothing less (R7b): a key a check closed (another tab's) answers 200 with "never reached us".
      if (!res.ok || data?.ok !== true) {
        repriced(data);
        // The price changed (C2): the server's sentence carried the old tip in cents; the button re-tips the new subtotal.
        // Said from what the button will now say, so the two never name different totals (R7b).
        if (data?.priceChanged && typeof data.subtotalCents === "number") {
          const next = data.subtotalCents + Math.round(data.subtotalCents * tipPct);
          setErr(`The price changed — your total is now ${money(next)}. Nothing was charged; tap Pay to pay ${money(next)}.`);
        } else setErr(payErrorText(data.error));
        return;
      }
      placed(data, true);
    } catch {
      // Nothing sent: the card form itself failed. Sent and no answer: we can't tell whether the card
      // was captured before the connection dropped — so the key and the card token are kept, and the
      // server answers a key it has seen without charging it again. Tapping Pay asks about THIS payment.
      if (sent) idem.settle(sent, null, null);
      setErr(sent ? "Couldn't confirm the payment — tap Pay to retry. You won't be charged twice." : "Card details look off — check and retry.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  // "That never reached us — you can pay now", from a status region that is on the page before its words are (a region
  // inserted already holding them is one VoiceOver often skips), in whichever way this checkout sends (R7b).
  const payNoteRegion = <p className={payNote ? "text-footnote text-cream-dim" : "sr-only"} role="status">{payNote}</p>;

  return (
    // Held while the card is being charged (2026-10-05): every way out of the sheet — the pull, a tap
    // outside, Escape — gives and stays put until the charge answers. A do-nothing onClose used to stand
    // in for this, and a tap outside then faded the sheet out for good — "Order in." with it.
    <Sheet open={open} onClose={onClose} dismissible={!busy} detents={false} className="paper" labelledBy="checkout-title"
      header={<div className="co-head"><div className="oa-kicker" id="checkout-title">Checkout</div><CloseButton onClick={onClose} /></div>}>
      {done ? (
        <OrderConfirm
          // A charge that didn't record is not "Order in" with a check and "ready in about 8 minutes" (R7b): it is paid, and the
          // reference is what the window needs — said first, with what happens next.
          title={done.warn && !done.ticket ? (done.ref ? `Paid — show ref #${done.ref} at the window` : "Paid — show this at the window") : done.no ? `Order ${done.no} is in.` : "Order in."}
          sub={done.warn && !done.ticket ? "Your order didn't save, so the crew has been told to add it. Your order bar keeps the ref until they have it." : confirmWords(done.readyFrom, done.paid)}
          totalCents={done.total}
          totalLabel={done.paid ? "paid" : "due at the truck"}
          warn={done.warn}
          rows={[
            ...done.lines.map(([id, q]) => ({ label: nameOf(id), value: `${q}×` })),
            { label: "For", value: done.name },
            { label: "Pickup", value: done.pickup },
            ...(done.ref ? [{ label: "Ref", value: `#${done.ref}` }] : []),
            { label: done.paid ? "Paid" : "Pay at pickup", value: money(done.total) },
          ]}
          // With a ticket, the next thing is the order itself — where it is, and telling the truck you're coming (board
          // 09); the pack's pitch is on the ticket. Without one (0395 not pasted, or a charge that didn't record), as before.
          // No ticket (a charge that didn't record): Done, and the reference above stays — not a pack's pitch (R7).
          ctaLabel={done.ticket ? "Track your order" : "Done"}
          onCta={() => { const tk = done.ticket; onClose(); if (tk) router.push(ticketPath(tk)); }}
          secondaryLabel={done.ticket ? "Done" : undefined}
          onSecondary={done.ticket ? onClose : undefined}
          aside={alertAsk ? (
            <button type="button" className="sub-link" disabled={alertAsk !== "ask"} onClick={() => { void enableAlerts(); }}>
              {alertAsk === "on" ? "We'll ping you when it's ready" : alertAsk === "off" ? "Alerts are off on this browser — your order bar shows where it is" : alertAsk === "asking" ? "Turning alerts on…" : "Ping me when it's ready"}
            </button>
          ) : undefined}
        />
      ) : (
        <>
              <div className="spec-label">Name for pickup</div>
              <input
                className="co-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who's this order for?"
                maxLength={40}
                aria-label="Name for pickup"
                autoComplete="name"
                enterKeyHint="done"
              />
              <p className="sr-only" role="status" aria-live="polite">{blockedWords}</p>
              <div className="spec-label" style={{ marginTop: 16 }}>Your pre-order</div>
              {lines.map(([id, q]) => (
                <div className="co-line" key={id} data-co-line={id}>
                  <span className="co-qty">
                    <button type="button" className="k-icon-btn" aria-label={`Remove one ${nameOf(id)}`} onClick={() => { track(id); dec(id); }} disabled={busy || held}>−</button>
                    <b>{q}</b>
                    <button type="button" className="k-icon-btn" aria-label={`Add one ${nameOf(id)}`} onClick={() => { track(id); inc(id); }} disabled={busy || held}>+</button>
                    {nameOf(id)}
                    {lineOf(id)?.perk && <em className="ml-1.5 not-italic text-caption2 text-gold2">{lineOf(id)!.perk}</em>}
                  </span>
                  <span>{money((lineOf(id)?.cents ?? priceOf(id)) * q)}</span>
                </div>
              ))}

              {/* One quiet line — the closed state and the post-pay screen own the full pack pitch
                  in their moments; while paying, the cart is the hero. */}
              {ordering.open && (
                <button type="button" className="co-upsell-line" onClick={() => router.push("/reserve")}>
                  {packUpsell ? (
                    <>Bottles for your week? <b>Reserve a {packUpsell.size}-pack for the next drop — bottles from {packUpsell.per}, save {packUpsell.pct}% ›</b></>
                  ) : (
                    <>Bottles for your week? <b>Reserve a pack for the next drop ›</b></>
                  )}
                </button>
              )}

              {/* WHERE AND WHEN, before the money (2026-10-04). The sheet said neither: an order placed
                  at 7am for an 11am stop read "Pay $10" here and "Ready in ~8 min" after it. */}
              {o?.open && (
                <div className="co-pickup">
                  <Icon name="pin" /> <b>{pickupWords(o)}</b>
                  <span className="co-pickup-when">{readyWords(o)}{o.stop?.pickup ? " Skip the line at pickup." : ""}</span>
                </div>
              )}

              {/* A SEND WHOSE ANSWER NEVER CAME (R7, R7b): said first, above everything that may have changed since — the truck
                  closing, a drink selling out — with the one action that answers it: ask about that payment, never pay again.
                  The drinks and the tip hold still until it is answered (and while this phone is sending, nothing is said). */}
              {held && !busy && (
                <div className="honest">
                  <Said as="span"><b>{heldCard ? "Your last payment hasn't been confirmed yet." : "Your last order hasn't been confirmed yet."}</b>{" "}
                  {heldCard
                    ? "Check on it before paying again — you won't be charged twice, and your drinks and tip stay as they are until it's answered."
                    : "Check on it before sending it again — your drinks stay as they are until it's answered."}</Said>
                  <button type="button" className="btn-pri btn-wide mt-3" onClick={() => { void checkHeld(); }} disabled={checking}>
                    <span>{checking ? "Checking…" : heldCard ? "Check on my payment" : "Check on my order"}</span>
                  </button>
                  {checkWords && <span className="block mt-2" role="alert">{checkWords}</span>}
                  {letGo ? (
                    <>
                      <span className="block mt-2">Only start over if the crew says it didn&apos;t go through — otherwise this would be a second order.</span>
                      <button type="button" className="co-paylater" disabled={checking} onClick={() => { if (checkingNow.current) return; focusSend.current = true; idem.forget(); setLetGo(false); setErr(""); setCheckWords(""); }}><b>Start over</b></button>
                      <button type="button" className="co-paylater" onClick={() => setLetGo(false)}>Keep waiting</button>
                    </>
                  ) : (
                    <button type="button" className="co-paylater" disabled={checking} onClick={() => setLetGo(true)}>The crew says it didn&apos;t go through? <b>Start over</b></button>
                  )}
                </div>
              )}

              {!ordering.open ? (
                <div className="co-closed">
                  <div className="co-closed-t"><Icon name="coffee" /> The truck isn&apos;t taking online orders right now</div>
                  {o && <p className="co-closed-s">{closedWords(o, { closing: t("findus.cta_closed") })}</p>}
                  {/* A city held closed takes no pack either (0412, R7b re-audit): no pitch for one it would refuse. */}
                  {!o?.held && (
                    <>
                      <p className="co-closed-s">Want it locked in anyway? A <b>pack reserve</b> is brewed to your order and waiting at the next drop.</p>
                      <button type="button" className="btn-pri btn-wide mt-4.5" onClick={() => { onClose(); router.push("/reserve"); }}><span>Reserve a pack instead</span></button>
                    </>
                  )}
                  <div className="signoff">Your cart stays right here for when we&apos;re pouring.</div>
                </div>
              ) : squareClientReady ? (
                <>
                  <div className="co-line"><span>Subtotal</span><span>{money(subtotalCents)}</span></div>
                  {unquoted && (
                    <p className="text-footnote text-cream-dim mt-1.5">
                      <Said as="span">These are the menu&apos;s prices — we couldn&apos;t check yours just now. Pay checks before your card is charged.</Said>{" "}
                      <button type="button" className="btn-ter" onClick={() => setQuoteTry((n) => n + 1)}>Check again</button>
                    </p>
                  )}
                  <div className="spec-label" style={{ marginTop: 16 }}>Add a tip</div>
                  <Segmented label="Tip" kind="choice" fill className="mt-0.5 mb-1.5" value={String(tipPct)} onChange={(k) => setTipPct(Number(k))} disabled={busy || held}
                    options={TIPS.map((p) => ({ key: String(p), label: p === 0 ? "No tip" : `${Math.round(p * 100)}%` }))} />
                  <div className="spec-label" style={{ marginTop: 16 }}>Card</div>
                  <div className="sq-wrap">
                    <PaymentCard ref={paymentRef} className="sq-card" tone="paper" onReady={setReady} onError={(m) => setErr(m ?? "")} />
                    {!ready && <div className="sk sq-sk-bar" />}
                  </div>
                  {err && <div className="auth-err" role="alert">{err}</div>}
                  <div className="co-foot">
                    {blockedNote}
                    {payNoteRegion}
                    <div className="co-line co-total"><span>Total</span><span>{total}</span></div>
                    <button ref={sendBtn} type="button" className="btn-pri btn-wide mt-4.5" onClick={pay} disabled={held || !ready || busy || items.length === 0 || !customer || blocked > 0}>
                      <span>{busy ? "Charging…" : held ? "Check on your last payment first" : blocked > 0 ? blockedLabel : !customer ? "Add a name above" : ready ? `Pay ${total}` : "Loading card…"}</span>
                    </button>
                    {/* Card is primary; pay-at-pickup is the secondary path when the operator allows it. */}
                    {payLater.on && (
                      <button type="button" className="co-paylater" onClick={sendPreOrder} disabled={held || busy || items.length === 0 || !customer || blocked > 0}>
                        or <b>pay at the truck</b> — send pre-order
                      </button>
                    )}
                    <div className="signoff">Secured by Square · skip the line at pickup.<br />Your card is never stored here — Square handles it. The charge shows as <b>GT3 Performance Bar</b>.</div>
                  </div>
                </>
              ) : payLater.on ? (
                <>
                  {blockedNote}
                  {err && <div className="auth-err" role="alert">{err}</div>}
                  {payNoteRegion}
                  <div className="co-line co-total"><span>Total</span><span>{money(subtotalCents)}</span></div>
                  <div className="honest" style={{ marginTop: 16 }}>
                    This is a <b>pre-order</b>{" "}— we&apos;ll have it ready and you pay at the truck.
                  </div>
                  <button ref={sendBtn} type="button" className="btn-pri btn-wide mt-4.5" onClick={sendPreOrder} disabled={held || busy || !customer || items.length === 0 || blocked > 0}>
                    <span>{busy ? "Sending…" : held ? "Check on your last order first" : blocked > 0 ? blockedLabel : "Send pre-order"}</span>
                  </button>
                </>
              ) : (
                <div className="co-closed">
                  <div className="co-closed-t">Checkout isn&apos;t switched on yet</div>
                  <p className="co-closed-s">Card payments arrive with the Square keys, and pay-at-the-truck is turned off right now. Come see us at the window.</p>
                </div>
              )}
            </>
      )}
    </Sheet>
  );
}
