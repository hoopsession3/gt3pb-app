"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStable } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useCustomerKnown, useKnownField, invalidateCustomerKnown } from "./useCustomerKnown";
import { usePayAtPickup } from "./usePayAtPickup";
import OrderConfirm from "@/components/OrderConfirm";
import { useStepFocus } from "./useStepFocus";
import EditableCopy from "@/components/EditableCopy";
import { useSiteCopy, fillCopy } from "@/lib/copy";
import PaymentCard, { type PaymentCardHandle } from "./PaymentCard";
import MyPacks, { packMix, packDayLabel, type MyPack } from "./MyPacks";
import dynamic from "next/dynamic";
import { trackFunnel } from "@/lib/funnel";
import Sheet, { CloseButton } from "./Sheet";
import Icon from "@/components/Icon";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { PAY_DEADLINE_MS } from "@/lib/deadline";
import { squareClientReady } from "@/lib/square";
import { haptic } from "@/lib/haptics";
import { packClosesAt, closesWords, PICKUP_STOPS_READ } from "@/lib/pickupDay";
import { packRoad } from "@/lib/packRoad";
import TextYes from "./TextYes";
import { scrollToTop } from "@/lib/appScroll";
import {
  PACK_SIZES, PACK_TAG, PACK_HINT, FLAVOR_DESC,
  packTotal, perBottle, saveAmount, dropForStop, nextDrop, dropDateKey, type GlassPath,
} from "@/lib/orderAhead";
import {
  quoteDelivery, deliverySlotChoices, zipInZone, maxRefills,
  DELIVERY_PACKS, DELIVERY_PRICING, SALTED_LATTE,
} from "@/lib/delivery";
import { money } from "@/lib/money";
import { weekdayOf } from "@/lib/dates";
import { useIdemKey, type Attempt } from "./useIdemKey";
import { isSettled } from "@/lib/settled";
import { apiUrl } from "@/lib/native";
import AddressField from "./AddressField";
import Said from "./Said";
import { rovingKeys } from "./roving";
import { useHydrated } from "@/lib/clientState";
import { useMinute } from "@/lib/useMinute";
import { failureWords, failureOr } from "@/lib/failureWords";

// ORDER FUNNEL — one screen, two fulfillment modes. Pickup (Saturday truck-stop reserve →
// /api/reserve) and Delivery (Sunday prepaid → /api/delivery/checkout) were separate screens with
// separate carts; flipping mode meant re-entering the whole order. This unifies them: a segmented
// Pickup|Delivery toggle sits at the top, and the SHARED cart (flavor mix + bring-back preference)
// survives the flip — only the bottle count snaps to the target mode's nearest valid tier. The two
// backends stay exactly as they were (they ARE different fulfillment); only the UI is one.
// Both /reserve and /delivery render this; the toggle updates the URL in place (no remount).

type Mode = "pickup" | "delivery";
type Step = "start" | "size" | "build" | "glass" | "details" | "pay" | "done";
type Flav = "rise" | "flow" | "dusk";
const FLAVS: Flav[] = ["rise", "flow", "dusk"];
const FLAV_LABEL: Record<Flav, string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK" };
const FLAV_DESC: Record<Flav, string> = { rise: FLAVOR_DESC.RISE, flow: FLAVOR_DESC.FLOW, dusk: FLAVOR_DESC.DUSK };
const dayName = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
// "Fri 9 AM": when a pickup's ordering closes, said as the delivery days say theirs.
const closesAt = (d: Date) => d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).replace(":00", "");
// Sunday label from the slot's REAL date, not its list position — after Friday's 6 PM cutoff the first
// choice rolls a week out, so "this Sunday" by index was calling an 8-days-away slot "this Sunday".
const sunLabel = (key: string) => {
  const days = Math.round((new Date(`${key}T12:00:00`).getTime() - Date.now()) / 86400000);
  return days <= 7 ? "this Sunday" : days <= 14 ? "next Sunday" : "the Sunday after";
};
const PICKUP_TIERS = PACK_SIZES as readonly number[]; // [3, 6, 12]
// What a pack checkout's key is signed over: what is being bought and what it costs (lib/idempotency,
// attemptFor) — never the card token, and not the name or phone, which a customer may fix after a lost
// answer without it becoming a second order. One literal for the card send and the pay-later send, so
// the two buttons share the checkout's key: a pay-later tap after a card answer was lost is answered
// with that reservation (/api/reserve finds it by the key) instead of placing another.
const pickupSig = (count: number | null, bringBack: boolean | null, mix: Record<Flav, number>, drop: string, code: string | undefined) =>
  ({ path: "pickup", count, bringBack, mix, drop, code });

// A PACK CHANGED IN PLACE (0388, 2026-10-12 — C5 of the customer audit). Its Pay step is its own screen, loaded when a
// member changes a pack: every visitor to /reserve and /delivery carried it for a path few take.
const PackChangePay = dynamic(() => import("./PackChangePay"));

// The office order is its own screen, loaded when an office is chosen (2026-10-04): every visitor to
// /reserve and /delivery downloaded it for a path few of them take. Choosing "For the office" warms
// it, so the sheet opens at once.
const OfficeOrder = dynamic(() => import("./OfficeOrder"));
// Sign-in, on the details step for a guest only — loaded as a guest opens the funnel (below), not in every visitor's first
// download of /reserve, /delivery and /shop (R8, 2026-10-16: the routes' weight).
const SignIn = dynamic(() => import("@/components/SignIn"));
// The held-payment notice loads when something is held (components/HeldNotice) — a moment few customers see.
const HeldNotice = dynamic(() => import("./HeldNotice"), { ssr: false });

/** ?code= from the scan's link (0268: /c/CODE sends people to /reserve?code=CODE), cleaned — "" when there is none.
 *  Plain location.search, read once (OrderFunnel): a malformed query string never breaks the funnel. */
function askedCode(): string {
  try {
    const c = new URLSearchParams(window.location.search).get("code");
    return c && c.trim() ? c.trim().toUpperCase().slice(0, 40) : "";
  } catch { return ""; }
}

export default function OrderFunnel({ initialMode, syncUrl = true, initialAudience = "home" }: { initialMode: Mode; syncUrl?: boolean; initialAudience?: "home" | "office" }) {
  const { toast } = useAppStable();
  const { user, profile } = useAuth();
  // A guest will be asked to sign in at the details step: its screen is fetched now, so it is there when they arrive.
  useEffect(() => { if (!user) void import("@/components/SignIn").catch(() => {}); }, [user]);
  const payLater = usePayAtPickup();
  const router = useRouter();
  const t = useSiteCopy();

  const [mode, setMode] = useState<Mode>(initialMode);
  // Funnel analytics (anonymous, no PII): which flow the visitor entered.
  useEffect(() => { trackFunnel(mode === "delivery" ? "delivery" : "reserve", "start"); }, [mode]);
  const [step, setStep] = useState<Step>(initialMode === "delivery" ? "start" : "size");
  // Each step replaces the last, and its Continue goes with it (R12 — the 10/10 audit, F5): focus goes to the new step's
  // heading. The receipt focuses its own (OrderConfirm).
  const stepRoot = useRef<HTMLDivElement>(null);
  useStepFocus(step, stepRoot, { skip: step === "done", pick: () => stepRoot.current?.querySelector<HTMLElement>("h2.dl-h") });
  // Delivery fork: a home order (residential Sunday packs, the flow below) vs an office order (B2B
  // bulk, Monday 5–8 AM, amber gallon jugs — a purpose-built sheet, never the pack cart).
  // /delivery?for=office opens on the office side (2026-10-12, A2 of the account audit): Shop's "For your office" and
  // the office page's "Set up office delivery" land there, and app/delivery passes it in.
  const [audience, setAudience] = useState<"home" | "office">(initialAudience);
  const [officeOpen, setOfficeOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  // ── shared cart (survives the mode flip) ──
  const [count, setCount] = useState<number | null>(initialMode === "pickup" ? 6 : null);
  const [mix, setMix] = useState<Record<Flav, number>>({ rise: 0, flow: 0, dusk: 0 });
  // First-timers see the price they'll actually pay (new glass); signed-in members default to
  // bring-back. The glass step can only make it cheaper — never a mid-funnel surprise.
  // A choice the customer made is theirs (R5): every glass button marks it touched, so signing in at the details step
  // never flips "Need new glass" to bring-back — the pickup's new-glass button didn't, and a guest who chose new glass
  // and signed in with a code was put on the cheaper return pack without being asked.
  const [bringBack, setBringBack] = useState(false);
  const glassTouched = useRef(false);
  useEffect(() => { if (user && !glassTouched.current) setBringBack(true); }, [user]);

  // ── delivery-only ──
  // The two Sundays on offer when the page opened — replaced by the server's when the one picked closed while the
  // page was open (C4: "That Sunday just closed — pick the next one.").
  const [choices, setChoices] = useState(() => deliverySlotChoices(Date.now()));
  const [when, setWhen] = useState(0);
  const slot = choices[when];
  // Same-day awareness: before payment we check the customer's record for anything already booked
  // on the chosen day — packs AND deliveries — and confirm a 2nd/3rd order instead of silently
  // stacking look-alikes. dupOk remembers the confirmation for THIS day only.
  const [dupRows, setDupRows] = useState<{ kind: "pickup" | "delivery"; label: string }[] | null>(null);
  const [dupOk, setDupOk] = useState<string | null>(null); // the day key the user confirmed
  // THE CUSTOMER'S OWN DETAILS START FROM WHAT WE KNOW (lib/customerKnown, 2026-10-04): the name and
  // phone on their record or last order, and the door their last delivery went to — the ZIP, the
  // street, the gate code. The weekly delivery is a repeat purchase that was retyped every week.
  // Each field is theirs the moment they type in it (useKnownField).
  // Asked for when it can be used: the delivery funnel (its ZIP is the first thing it asks) or the
  // details step — not on every visit to the shop by a signed-in member who is only browsing.
  const known = useCustomerKnown(mode === "delivery" || step === "details");
  const [zip, setZip] = useKnownField(known?.delivery?.zip);
  const [zone, setZone] = useState<"ask" | "in" | "out">("ask");
  const [wlEmail, setWlEmail] = useKnownField(known?.email);
  const [wlSent, setWlSent] = useState(false);
  const [premiums, setPremiums] = useState<Record<string, number>>({});
  const [bulkItems, setBulkItems] = useState<{ slug: string; name: string }[]>([{ slug: SALTED_LATTE.key, name: SALTED_LATTE.label }]);
  // How many empties go out — null until the customer sets the number. Bringing back with no number means every bottle
  // that can be a refill: the price the size tiles show (R5, 2026-10-13). It started at 0, so a member — on bring-back by
  // default — saw $106 on the 12-pack tile, the glass step's "Bringing mine back" lit with 0 empties, and was charged $130.
  const [refills, setRefills] = useState<number | null>(null);
  const [ack, setAck] = useState(false);
  // The yes to texts (R5, 0398 — components/TextYes): never ticked for them; sent with the order, which records it.
  const [textYes, setTextYes] = useState(false);
  const [access, setAccess] = useKnownField(known?.delivery?.access);
  const [street, setStreet, streetKnown] = useKnownField(known?.delivery?.street);
  // the ZIP of the address last picked from the street's suggestions, held against the one the zone check passed
  const [pickedZip, setPickedZip] = useState("");
  const [city, setCity] = useKnownField(known?.delivery?.city);

  // ── pickup-only ──
  const [stops, setStops] = useState<{ id: string; name: string | null; starts_at: string }[]>([]);
  // Whether the stops have been read yet — until then the Saturday picker keeps its place (below).
  const [stopsRead, setStopsRead] = useState(false);
  // No city taking packs (R7b re-audit — lib/packRoad): no stop left, and the founding city, whose Saturday the cadence is,
  // held closed. Said where the pickup is, before the size — not after Pay is tapped.
  const [packsPaused, setPacksPaused] = useState(false);
  const [stopIdx, setStopIdx] = useState(0);
  // The clock, minute by minute (lib/useMinute) — 0 on the server and while hydrating (lib/clientState), so the
  // prerendered page draws no countdown to disagree with the phone's. A store since R17, not an effect's interval.
  const hydrated = useHydrated();
  const minute = useMinute();
  const now = hydrated ? minute : 0;
  const [replacing, setReplacing] = useState<MyPack | null>(null);
  // Kept with whose it is (R17): no member is no usual, said while rendering; the read sets its answer when it comes.
  const [usualFor, setUsual] = useState<{ user: string; pack: MyPack | null } | null>(null);
  const usual = user && usualFor?.user === user.id ? usualFor.pack : null;
  const [packsKey, setPacksKey] = useState("");

  // ── shared checkout ──
  const [name, setName] = useKnownField(known?.fullName || profile?.display_name);
  const [phone, setPhone] = useKnownField(known?.phone);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // The order's errors — the card, the charge, a missing name — are said inline, under the form, and
  // felt from here once each time one appears, as the drinks checkout does (2026-10-05, the haptics
  // round). What this screen says with toast() already buzzes from AppProvider.
  useEffect(() => { if (err) haptic("error"); }, [err]);
  // `change`: the pack was changed in place, and what moved — charged, refunded, or being refunded by the crew.
  const [done, setDone] = useState<{ total: number; label?: string; warn?: string; paid: boolean; ref?: string; change?: { charged: number; refunded: number; pending: number } } | null>(null);

  // ── discount code (0176 member_benefits, scope='code'). The server reprices authoritatively; this
  // is a live PREVIEW so the customer sees the code land before they pay. Percent-off and free-refill
  // codes discount the pack order; slug-targeted / set-price codes belong to the cups channel, so we
  // accept them as valid but don't move the pack total (a gentle note explains).
  type CodeBenefit = { kind: "percent_off" | "price_override" | "free_refill" | "amount_off"; target: string | null; percent: number | null; value_cents: number | null; label: string };
  // ?code= from the scan's link, taken into the box ONCE — the first render after hydration, during render, with no
  // effect setting it as the page mounts (R17). Once: Pickup ⇄ Delivery rewrites the address without its query
  // (switchMode), and a code read from the address on every render went empty under a chip still saying "applied" —
  // the quote and Pay went out with no code, at the full price (the R17 review, F1).
  const [code, setCode] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeAdopted, setCodeAdopted] = useState(false);
  if (hydrated && !codeAdopted) {
    setCodeAdopted(true);
    const asked = askedCode();
    if (asked) { setCode(asked); setCodeOpen(true); }
  }
  const [codeState, setCodeState] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  const [codeBenefit, setCodeBenefit] = useState<CodeBenefit | null>(null);
  const codeClean = code.trim().toUpperCase().replace(/\s+/g, "");
  // QR hand-off (0268): /c/CODE sends people here as /reserve?code=CODE — the box opens itself with
  // the code in it, so "scan → order → it applies" is zero typing. Plain location.search (not the
  // useSearchParams hook) keeps this client component out of a Suspense boundary requirement.

  const checkCode = useCallback(async () => {
    if (!supabase || !codeClean) { setCodeState("idle"); setCodeBenefit(null); return; }
    setCodeState("checking");
    const { data } = await supabase.from("member_benefits")
      .select("kind, target, percent, value_cents, label")
      .eq("active", true).eq("scope", "code").ilike("code", codeClean.replace(/[%_\\]/g, (c) => `\\${c}`)).maybeSingle();
    if (!data) { setCodeState("bad"); setCodeBenefit(null); haptic("error"); return; }
    setCodeBenefit(data as CodeBenefit); setCodeState("ok"); haptic("success");
  }, [codeClean]);
  const clearCode = () => { setCode(""); setCodeBenefit(null); setCodeState("idle"); };

  const perf = Object.values(premiums).reduce((s, n) => s + (n || 0), 0);
  const picked = mix.rise + mix.flow + mix.dusk + (mode === "delivery" ? perf : 0);
  const refillCap = count ? maxRefills(count, perf) : 0;
  const refillCount = bringBack ? Math.min(refillCap, refills ?? refillCap) : 0;
  const deliveryQuote = useMemo(
    () => (mode === "delivery" && count ? quoteDelivery(count, perf, refillCount, "direct") : null),
    [mode, count, perf, refillCount]
  );

  // pickup drop / countdown
  const stop = stops[stopIdx] ?? null;
  const drop = useMemo(() => (stop?.starts_at ? dropForStop(stop.starts_at) : nextDrop(now ? new Date(now) : new Date())), [stop, now]);
  const pickupTotalCents = count ? Math.round(packTotal(count, bringBack ? "return" : "new") * 100) : 0;
  // When this pack's drop will close, said where the customer is told they can cancel (R5): the one rule, by its stop
  // (lib/pickupDay) — "before the drop closes" named no time, and nothing enforced it until 0397.
  const packCloses = stop ? packClosesAt(dropDateKey(drop.sat), stop) : drop.cutoff;
  const packCloseWords = packCloses ? closesWords(packCloses) : "the drop closes";
  const baseTotalCents = mode === "delivery" ? (deliveryQuote?.totalCents ?? 0) : pickupTotalCents;
  // A valid code's effect on the shown order total — mirrors the server (lib/benefits): free-refill
  // zeroes a bring-back pack; percent-off (whole order / straight-brew) discounts the total. Other
  // kinds (set-price, slug-targeted) are cups-channel perks, so they don't move the pack total.
  const codeDiscountCents = useMemo(() => {
    if (mode !== "pickup" || codeState !== "ok" || !codeBenefit) return 0;  // pickup is the code-honoring channel today
    const wholeOrder = codeBenefit.target === null || codeBenefit.target === "straight_brew";
    if (codeBenefit.kind === "free_refill" && wholeOrder && bringBack) return baseTotalCents;
    if (codeBenefit.kind === "percent_off" && wholeOrder && typeof codeBenefit.percent === "number") return Math.round(baseTotalCents * (codeBenefit.percent / 100));
    if (codeBenefit.kind === "amount_off" && wholeOrder && typeof codeBenefit.value_cents === "number") return Math.min(baseTotalCents, codeBenefit.value_cents);   // the $5-off QR card (0268)
    return 0;
  }, [codeState, codeBenefit, baseTotalCents, mode, bringBack]);
  // THE SERVER'S PRICE FOR THIS PACK (R7b, /api/reserve/quote): a signed-in member's perks — a founding member's
  // bring-back refill is on us (0176) — are the server's to apply, and the page priced a pack from the grid and a code
  // alone: "Pay $42.00" for a pack the server prices at $0. Asked whenever the pack, its glass or the code changes; until
  // it answers (or when it can't), the page's own number, which the charge refuses only upward (lib/shownTotal).
  const packSig = mode === "pickup" && count && user ? JSON.stringify([count, bringBack, codeState === "ok" ? codeClean : null]) : null;
  const [packQuote, setPackQuote] = useState<{ sig: string; cents: number; perk: string | null } | null>(null);
  useEffect(() => {
    if (!packSig) return;
    let alive = true;
    const [size, back, code] = JSON.parse(packSig) as [number, boolean, string | null];
    authedFetch("/api/reserve/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ size, glass: back ? "return" : "new", code: code ?? undefined }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.totalCents === "number") setPackQuote({ sig: packSig, cents: d.totalCents, perk: typeof d.perk === "string" ? d.perk : null }); })
      .catch(() => { /* the page's own number stands; the charge refuses only upward */ });
    return () => { alive = false; };
  }, [packSig]);
  const quoted = packQuote && packQuote.sig === packSig ? packQuote : null;
  const totalCents = quoted ? quoted.cents : Math.max(0, baseTotalCents - codeDiscountCents);
  // THE TOTAL ON THE PAY BUTTON IS THE MOST IT CHARGES (R5, lib/shownTotal). It goes with the order; a server total above
  // it comes back refused, with that total, and is shown here for this cart — the next tap agrees to it. A change to the
  // cart (size, flavours, glass, empties, day, code) takes it back to the page's own number.
  const cartSig = JSON.stringify(mode === "delivery"
    ? ["delivery", count, mix, premiums, refillCount, slot?.deliveryDateKey ?? null]
    : ["pickup", count, bringBack, mix, dropDateKey(drop.sat), codeState === "ok" ? codeClean : null]);
  const [agreed, setAgreed] = useState<{ sig: string; cents: number } | null>(null);
  const payCents = agreed && agreed.sig === cartSig ? agreed.cents : totalCents;
  // On us: nothing to pay, and no card to ask for — the server reserves it settled. Not once the server has said a higher
  // total for this cart (a code that lapsed between the quote and the tap): the card form is back, with that total.
  const onUs = mode === "pickup" && !!quoted && quoted.cents === 0 && payCents === 0;
  const raisedTotal = useCallback((data: { totalChanged?: unknown; totalCents?: unknown }) => {
    if (data?.totalChanged === true && typeof data.totalCents === "number") setAgreed({ sig: cartSig, cents: data.totalCents });
  }, [cartSig]);
  const countdown = useMemo(() => {
    if (mode !== "pickup" || !now) return "";
    const ms = drop.cutoff.getTime() - now; if (ms <= 0) return "";
    const h = Math.floor(ms / 36e5), d = Math.floor(h / 24);
    return d > 0 ? `${d}d ${h % 24}h` : `${h}h ${Math.floor((ms % 36e5) / 6e4)}m`;
  }, [mode, drop, now]);

  // ── effects ──

  // delivery: dynamic premium adds (Money → Menu bulk-orderable). Falls back to Salted Latte.
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.from("products").select("slug, name").eq("bulk_orderable", true).eq("bulk_tier", "premium").eq("active", true).eq("sold_out", false).order("bulk_sort")
      .then(({ data }) => { if (live && data && data.length) setBulkItems(data as { slug: string; name: string }[]); });
    return () => { live = false; };
  }, []);

  // pickup: the next scheduled stops = the pickup choices (deduped by drop day, still open).
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let live = true;
    sb.from("stops").select("id, name, starts_at, market").is("archived_at", null).is("canceled_at", null).neq("status", "done").not("starts_at", "is", null)
      .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(PICKUP_STOPS_READ)
      .then(async ({ data }) => {
        // Not a stop in a city held closed, or not open yet (0412, R7b re-audit — lib/packRoad): the server refuses a pack
        // there. A read of the cities that fails offers what the road has, and the server says.
        const all = (data ?? []) as { id: string; name: string | null; starts_at: string; market?: string | null }[];
        const road = data ? await packRoad(sb, all).catch(() => null) : null;
        if (!live) return;
        setStopsRead(true);
        if (!data) return;
        setPacksPaused(!!road && road.error === null && road.taking.length === 0 && road.foundingHeld);
        const seen = new Set<string>();
        const uniq = (road && road.error === null ? road.taking : all).filter((st) => {
          if (dropForStop(st.starts_at).cutoff.getTime() <= Date.now()) return false;
          // The ET day, as the server keys it (dropDateKey) — a UTC slice put a stop after 8pm Eastern on the next day (R5).
          const k = dropDateKey(new Date(st.starts_at));
          if (seen.has(k)) return false; seen.add(k); return true;
        }).slice(0, 4);
        setStops(uniq);
      });
    return () => { live = false; };
  }, []);

  // pickup: "Your usual" — the member's most recent pack, one-tap reload.
  useEffect(() => {
    if (!supabase || !user) return;
    let live = true;
    supabase.from("drop_orders").select("*").eq("user_id", user.id).is("canceled_at", null)
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { if (live) setUsual({ user: user.id, pack: (data?.[0] as MyPack) ?? null }); });
    return () => { live = false; };
  }, [user, packsKey]);

  // Square card — mounted by the shared <PaymentCard> only while step==="pay" is in the tree; React's
  // own mount/unmount lifecycle handles attach/teardown across step changes, so no effect needed here.
  const paymentRef = useRef<PaymentCardHandle>(null);
  // ONE KEY PER CHECKOUT (2026-10-11, lib/idempotency), one holder per mode. Persisted, not just
  // in-memory: a customer on slow venue/porch WiFi — exactly this app's environment — navigates away
  // mid-charge and comes back, and this page REMOUNTS (unlike Checkout.tsx's sheet, which stays
  // mounted). A plain ref would be empty by then, so the retry would carry a genuinely new key and
  // Square could not dedupe it — a real double charge. The persisting alone was not enough, though:
  // the key used to be signed over the card token, and every tap of Pay asked the card form for a new
  // one, so a retry carried a new key anyway. Now the token is not in the signature, and while the
  // last answer is unknown the SAME token goes out again, so Square replays the first payment instead
  // of making a second (after a remount the token is gone; Square then refuses the key rather than
  // charging it, and /api/reserve answers a pack it already holds by the key before it charges).
  // Pickup and delivery keep separate keys, so flipping the toggle cannot forget either one.
  const IDEM_STORAGE_KEY = "gt3-of-idem";
  const idem = useIdemKey(IDEM_STORAGE_KEY);
  const idemDelivery = useIdemKey(`${IDEM_STORAGE_KEY}-delivery`);
  const [cardReady, setCardReady] = useState(false);
  // A PAYMENT WHOSE ANSWER NEVER CAME HOLDS ITS ORDER STILL (R8, as the cup checkout has since R7). Back, the code and the
  // Sunday stayed live after a lost answer while the page said "you won't be charged twice": any change was a new key, and
  // the next Pay a second charge and a second pack or delivery. While it is unknown the order holds still on the pay step
  // and the button asks about that payment (the same key, answered from the first request); the customer lets it go only
  // once they've been told it didn't go through.
  const payIdem = mode === "delivery" ? idemDelivery : idem;
  // Whether the tap that is out asks about a held payment ("Checking…") or makes one ("Charging…") — read when it is
  // tapped: the hold opens as the first send leaves, and its label must not turn into "Checking…" mid-charge.
  const [rechecking, setRechecking] = useState(false);

  // ── the toggle: preserve the cart, snap count, route sanely ──
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    haptic("selection");
    const tiers = next === "pickup" ? PICKUP_TIERS : DELIVERY_PACKS;
    const need = mix.rise + mix.flow + mix.dusk + (next === "delivery" ? perf : 0);
    // Keep the count if it's already a valid tier; otherwise snap up to the smallest tier that still
    // holds the built mix (never smaller than what they've picked). Mix + bring-back are untouched.
    let nextCount = count;
    if (count == null || !tiers.includes(count)) {
      nextCount = tiers.find((t) => t >= Math.max(count ?? 0, need)) ?? tiers[tiers.length - 1];
    }
    if (next === "pickup") { setPremiums({}); setRefills(null); setAck(false); }
    setMode(next);
    setCount(nextCount);
    // When embedded off its own route (the Shop "Bottles" aisle passes syncUrl={false}), don't drift
    // the URL to /reserve|/delivery on a mode flip — the page didn't actually navigate there.
    if (syncUrl) { try { window.history.replaceState(null, "", next === "delivery" ? "/delivery" : "/reserve"); } catch { /* ignore */ } }
    // Delivery can't be ordered without a verified zone. If we haven't checked one, land on the zone
    // hero (cart intact). Otherwise show size so the new tiers/pricing are visible with the mix kept.
    if (next === "delivery" && zone !== "in") { setStep("start"); return; }
    setStep((prev) => (prev === "details" || prev === "pay" || prev === "done" || prev === "start" ? "size" : prev));
  };

  // ── cart handlers ──
  // A STEPPER SAYS WHICH WAY IT WENT (2026-10-05, the haptics round): up, down, and at zero a "−" with
  // nowhere to go is the boundary. The count is read from what is on screen, before the update.
  const bump = (k: Flav, d: number) => {
    if (d > 0) haptic("increase"); else if (mix[k] > 0) haptic("decrease"); else haptic("boundary");
    setMix((m) => ({ ...m, [k]: Math.max(0, m[k] + d) }));
  };
  const bumpPremium = (slug: string, d: number) => {
    if (d > 0) haptic("increase"); else if ((premiums[slug] || 0) > 0) haptic("decrease"); else haptic("boundary");
    setPremiums((m) => { const v = Math.max(0, (m[slug] || 0) + d); const n = { ...m, [slug]: v }; if (!v) delete n[slug]; return n; });
  };
  const pickCount = (s: number) => {
    haptic("selection");
    setCount(s);
    // an overfull mix resets when the pack shrinks below it (reference behavior)
    const overfull = mix.rise + mix.flow + mix.dusk + (mode === "delivery" ? perf : 0) > s;
    setMix((m) => (overfull ? { rise: 0, flow: 0, dusk: 0 } : m));
    // Premiums count toward `picked` in delivery mode exactly like mix does, but were never touched
    // here — shrinking the pack after adding premiums left `picked` stuck over the new `count` (a
    // permanent, unexplained negative "Pick -N more" on the Build step), and left the refills stepper
    // showing a count past its own "up to N" cap (quoteDelivery re-clamps the actual CHARGE
    // independently, so money was always right — only the on-screen numbers were stuck/wrong).
    const newPerf = mode === "delivery" && overfull ? 0 : perf;
    if (mode === "delivery" && overfull) setPremiums({});
    setRefills((r) => (r === null ? null : Math.min(maxRefills(s, newPerf), r)));
    // Both modes operate identically: selecting a size highlights it; the "Build your pack" button
    // advances. (Delivery used to auto-jump on tap, which felt different from pickup.)
  };

  const checkZone = () => { if (zipInZone(zip)) { setZone("in"); setStep("size"); } else setZone("out"); };
  const joinWaitlist = async () => {
    const r = await fetch(apiUrl("/api/delivery/waitlist"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zip, email: wlEmail }) });
    if (r.ok) { setWlSent(true); toast("You're on the list"); } else toast("Enter a ZIP and a real email", "error");
  };
  // AND BACK OFF IT AGAIN (0310). Joining was one tap and leaving was impossible: staff-only RLS,
  // rows written server-side, a delete guard, and no interface anywhere in the app. That is the
  // shape a privacy request arrives in, and the fix is a button next to the one that opted them in.
  //
  // leave_waitlist() takes no argument and means "me", so it only ever removes the signed-in
  // caller's own address — nobody can clear somebody else's by typing it. Someone with no account
  // is told who to ask, because pretending otherwise would be worse than saying it.
  const leaveWaitlist = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("leave_waitlist");
    if (error) {
      toast(/sign in/i.test(error.message)
        ? "Sign in with that email to take it off, or email us and we'll do it."
        : failureWords(error), "error");
      return;
    }
    setWlSent(false); setWlEmail("");
    toast(Number(data) > 0 ? "Taken off the list" : "That address wasn't on the list");
  };

  // pickup: change / reload
  const startChange = (p: MyPack) => {
    // A change keeps the pack's day (R7b): the day picker's first day went with the change, and a 6-pack for Saturday paid
    // up to 12 bottles for Thursday. Its own stop, else its day; a day no longer offered can't be changed here. With no
    // stop on the schedule the day is the Saturday cadence's (the server's fallback too), and until the stops are read
    // nothing is said about the day at all (the re-audit of R7b: both read as "not open for changes").
    if (!stopsRead) { toast("One moment — the pickup days are still loading."); return; }
    const fallbackDay = stops.length === 0 && dropDateKey(nextDrop().sat) === p.drop_date;
    const at = fallbackDay ? 0 : stops.findIndex((st) => (p.stop_id ? st.id === p.stop_id : dropDateKey(dropForStop(st.starts_at).sat) === p.drop_date));
    if (at < 0) { toast("This pack's day isn't open for changes any more — cancel it from My packs, or ask the crew."); return; }
    setStopIdx(at);
    setMode("pickup"); setCount(p.size); glassTouched.current = true; setBringBack(p.glass === "return");
    const pm = packMix(p); setMix({ rise: pm.RISE || 0, flow: pm.FLOW || 0, dusk: pm.DUSK || 0 });
    setName(p.name); setPhone(p.phone ?? ""); setReplacing(p); setStep("size"); setErr("");
    scrollToTop();
  };
  const reorderUsual = () => {
    if (!usual) return; haptic("medium");
    setCount(usual.size); glassTouched.current = true; setBringBack(usual.glass === "return");
    const pm = packMix(usual); setMix({ rise: pm.RISE || 0, flow: pm.FLOW || 0, dusk: pm.DUSK || 0 });
    if (!name.trim()) setName(usual.name); if (!phone.trim()) setPhone(usual.phone || "");
    setReplacing(null); setErr(""); toast("Your usual — loaded");
    scrollToTop();
  };

  // ── submit ──
  // `card` is the card send's attempt (payPickupCard); a pay-later send is given this checkout's key
  // with no card.
  const submitPickup = useCallback(async (card: Attempt | null) => {
    if (busy) return; // guard a fast double-tap before the button's disabled attribute takes effect
    setErr("");
    if (!name.trim() || !phone.trim()) { setErr("Name and phone are required."); return; }
    if (!count) return;
    setBusy(true);
    const attempt = card ?? await idem.begin(pickupSig(count, bringBack, mix, dropDateKey(drop.sat), codeState === "ok" ? codeClean : undefined));
    idem.sent(attempt.key, !!attempt.token);   // held open from the send: the order holds still until it is answered
    try {
      const res = await authedFetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: attempt.token ?? undefined, idempotencyKey: attempt.key, expectedCents: payCents, stopId: stop?.id ?? undefined, textOptIn: textYes || undefined, name: name.trim(), phone: phone.trim(), size: count, glass: (bringBack ? "return" : "new") as GlassPath, mix: { RISE: mix.rise, FLOW: mix.flow, DUSK: mix.dusk }, dropDate: dropDateKey(drop.sat), code: codeState === "ok" ? codeClean : undefined }),
      }, { deadlineMs: PAY_DEADLINE_MS });
      const data = await res.json(); setBusy(false);
      idem.settle(attempt.key, res.status, data);
      if (!res.ok) { raisedTotal(data); setErr(failureOr(data.error, "Something went wrong — try again.")); return; }
      haptic("success");
      setDone({ total: typeof data.totalCents === "number" ? data.totalCents : payCents, paid: !!data.paid, ref: (data.id || data.ref || "").toString(), label: dayName(drop.sat) });
      invalidateCustomerKnown();   // the next form starts from this order
      trackFunnel("reserve", "done");
      setStep("done");
      setPacksKey((k) => k + "x");
    } catch {
      setBusy(false);
      // A network exception here can happen AFTER the server already charged the card (the request
      // reached /api/reserve and Square before the connection dropped) — "nothing was charged" would
      // be a real lie in that case. The key and the card token are kept (see `idem` above), so a
      // retry is the same request again: safe either way, so say that instead of asserting something
      // we can't know.
      idem.settle(attempt.key, null, null);
      setErr("Couldn't confirm — safe to try again, you won't be charged twice.");
    }
  }, [busy, name, phone, count, bringBack, mix, drop, stop, textYes, payCents, raisedTotal, codeState, codeClean, idem]);

  // ── a pack changed in place (0388) ──
  // The change as the server reads it: the pack that is changing, what it becomes, the code it is priced with.
  const changeBody = useMemo(() => (mode === "pickup" && replacing && count ? {
    id: replacing.id, name: name.trim(), phone: phone.trim(), size: count, glass: (bringBack ? "return" : "new") as GlassPath,
    mix: { RISE: mix.rise, FLOW: mix.flow, DUSK: mix.dusk }, dropDate: dropDateKey(drop.sat),
    code: codeState === "ok" ? codeClean : undefined,
  } : null), [mode, replacing, count, name, phone, bringBack, mix, drop, codeState, codeClean]);
  // A change keeps its own key and pays on its own step (components/PackChangePay): a new pack's held payment holds
  // nothing there.
  const payHeld = !changeBody && payIdem.isOpen();
  // A pack change's own payment held (components/PackChangePay says so): its Back and the code wait, as a new pack's do.
  const [changeHeld, setChangeHeld] = useState(false);

  const payDelivery = async () => {
    if (busy) return; // guard a fast double-tap before the button's disabled attribute takes effect
    setErr("");
    if (!cardReady || !count || !deliveryQuote) return;
    setBusy(true);
    let sent: string | null = null;
    try {
      // The key for what is in this delivery and what it costs — not the address, which a customer may
      // fix after a lost answer without it becoming a second charge — and the card token already sent
      // under it while the last answer is unknown.
      const attempt = await idemDelivery.begin({ path: "delivery", count, mix, premiums, refills: refillCount, slot: slot.deliveryDateKey }, () => paymentRef.current!.tokenize());
      if (!attempt.token) { setErr("Card details look off — check and retry."); setBusy(false); return; }
      sent = attempt.key;
      idemDelivery.sent(attempt.key, true);   // held open from the send: the order holds still until it is answered
      const res = await authedFetch("/api/delivery/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: attempt.token, idempotencyKey: attempt.key, expectedCents: payCents,
          name, phone, addressStreet: street, addressCity: city, addressZip: zip,
          accessInstructions: access, packSize: count, riseCount: mix.rise, flowCount: mix.flow, duskCount: mix.dusk,
          perfMix: premiums, refillCount, emptiesAck: ack, deliveryDate: slot.deliveryDateKey,
          textOptIn: textYes || undefined,
          retry: attempt.retry === true,
        }),
      }, { deadlineMs: PAY_DEADLINE_MS });
      const data = await res.json(); setBusy(false);
      idemDelivery.settle(attempt.key, res.status, data);
      if (!res.ok) {
        // The Sunday picked closed while the page was open: nothing was charged; show the Sundays on offer now, the
        // coming one picked, and say so (C4).
        if (data.slotClosed && Array.isArray(data.choices) && data.choices.length === 2 && data.choices.every((c: { deliveryDateKey?: unknown }) => typeof c?.deliveryDateKey === "string")) {
          setChoices(data.choices as typeof choices);
          setWhen(0);
        }
        raisedTotal(data);
        setErr(failureOr(data.error, "Payment failed"));
        return;
      }
      haptic("success");
      setDone({ total: data.totalCents ?? deliveryQuote.totalCents, label: data.deliveryLabel, warn: data.warn, paid: true });
      invalidateCustomerKnown();
      trackFunnel("delivery", "done");
      setStep("done");
    } catch {
      setBusy(false);
      // Same reasoning as submitPickup's catch: this can fire after the server already charged the
      // card (response lost after /api/delivery/checkout finished), so "service unavailable" would be
      // misleading. The key and the card token are kept, so a retry is the same request again and
      // Square replays it rather than charging twice. Nothing sent: the card form itself failed.
      if (sent) idemDelivery.settle(sent, null, null);
      setErr(sent ? "Couldn't confirm the payment — safe to try again, you won't be charged twice." : "Card details look off — check and retry.");
    }
  };
  const payPickupCard = async () => {
    if (busy) return; // guard a fast double-tap before the button's disabled attribute takes effect
    setErr("");
    if (!name.trim() || !phone.trim()) { setErr("Name and phone are required."); return; }
    if (!cardReady) return;
    setBusy(true);
    try {
      // This checkout's key, and the card token already sent under it while the last answer is unknown.
      const attempt = await idem.begin(pickupSig(count, bringBack, mix, dropDateKey(drop.sat), codeState === "ok" ? codeClean : undefined), () => paymentRef.current!.tokenize());
      if (!attempt.token) { setErr("Card details look off — check and retry."); setBusy(false); return; }
      await submitPickup(attempt);
    } catch {
      // Reached only if tokenize() itself throws, before submitPickup (and any network call) ever
      // runs — "nothing was charged" is accurate here specifically, unlike the messages above.
      setErr("Payment failed — nothing was charged. Try again.");
      setBusy(false);
    }
  };

  const targetDayKey = () => (mode === "delivery" ? (slot?.deliveryDateKey ?? "") : dropDateKey(drop.sat));
  // The first field still empty, said on the button (R12 — the 10/10 audit, F9), as the cup checkout says "Add a name above".
  const pickupMissing = !name.trim() ? "Add your name above" : !phone.trim() ? "Add your phone above" : null;
  const deliveryMissing = pickupMissing ?? (!street.trim() ? "Add your street address above" : !city.trim() ? "Add your city above" : null);
  const toPayment = async () => {
    const key = targetDayKey();
    if (!supabase || !user || !key || dupOk === key) { setStep("pay"); return; }
    const [dr, de] = await Promise.all([
      supabase.from("drop_orders").select("id, size, paid, payment_status, picked_up").eq("user_id", user.id).eq("drop_date", key).is("canceled_at", null),
      supabase.from("delivery_orders").select("id, pack_size, status").eq("user_id", user.id).eq("delivery_date", key).is("canceled_at", null),
    ]);
    const found: { kind: "pickup" | "delivery"; label: string }[] = [
      ...(((dr.data ?? []) as { id: string; size: number; paid: boolean; payment_status: string | null; picked_up: boolean }[])
        .filter((o) => o.id !== replacing?.id && !o.picked_up)
        .map((o) => ({ kind: "pickup" as const, label: `${o.size}-pack for pickup · ${isSettled(o) ? "paid" : "pay at pickup"}` }))),
      ...(((de.data ?? []) as { id: string; pack_size: number; status: string }[])
        .filter((o) => o.status !== "delivered")
        .map((o) => ({ kind: "delivery" as const, label: `${o.pack_size} bottles by delivery` }))),
    ];
    if (found.length === 0) { setStep("pay"); return; }
    setDupRows(found);
  };

  const resetOrder = () => { setMix({ rise: 0, flow: 0, dusk: 0 }); setPremiums({}); setRefills(null); setAck(false); setErr(""); setDone(null); setStep(mode === "delivery" ? "size" : "size"); };

  // step gating
  const glassReady = mode === "delivery" ? bringBack !== null && !(refillCount > 0 && !ack) : true;

  // back navigation per mode
  const goBack = () => {
    if (mode === "delivery") setStep(step === "size" ? "start" : step === "build" ? "size" : step === "glass" ? "build" : step === "details" ? "glass" : "details");
    else setStep(step === "build" ? "size" : step === "glass" ? "build" : step === "details" ? "glass" : "details");
  };

  // ── segmented toggle (shown through the shopping phase) ──
  const showToggle = step === "start" || step === "size" || step === "build" || step === "glass";
  const Toggle = (
    // A choice of how it reaches you, so a radio group: one Tab stop, arrows along it (R12 — the 10/10 audit, F7).
    <div className="of-seg" role="radiogroup" aria-label="Fulfillment" onKeyDown={(e) => rovingKeys(e, 2, mode === "delivery" ? 1 : 0, (i) => switchMode(i === 1 ? "delivery" : "pickup"))}>
      <button type="button" role="radio" aria-checked={mode === "pickup"} tabIndex={mode === "delivery" ? -1 : 0} className={mode === "pickup" ? "on" : ""} onClick={() => switchMode("pickup")}>
        <b><Icon name="package" /> {t("funnel.toggle_pickup")}</b><span>{t("funnel.toggle_pickup_sub")}</span>
      </button>
      <button type="button" role="radio" aria-checked={mode === "delivery"} tabIndex={mode === "delivery" ? 0 : -1} className={mode === "delivery" ? "on" : ""} onClick={() => switchMode("delivery")}>
        <b><Icon name="truck" /> {t("funnel.toggle_delivery")}</b><span>{t("funnel.toggle_delivery_sub")}</span>
      </button>
    </div>
  );

  // deadline line — pickup's wording is owner-editable (reserve.cutoff), 2026-07-17. Delivery's
  // stays exactly as it was: reserve.cutoff's {cutoff}/{pickup} shape was written for pickup and
  // has no {delivery} token, so improvising it into a second mode would be guessing at a template
  // nobody designed, not the mechanical swap everywhere else got. Trade-off worth flagging: the
  // pickup line loses the bold emphasis on the two dynamic values below, since EditableCopy can only
  // show flat text — the live countdown/pickup-day VALUES are unchanged, just no longer bolded.
  // The discount code, on Pay for a new pack and for a change alike (a change is priced with the code the pack was
  // reserved with unless another is entered here).
  // A held payment for a different order — the page was left, and the order built again otherwise: it says so, and Pay
  // waits on Start over (the order it holds is what "Check on my payment" would ask about).
  const payHeldElsewhere = payHeld && JSON.stringify(payIdem.heldDetails()) !== JSON.stringify(mode === "delivery"
    ? { path: "delivery", count, mix, premiums, refills: refillCount, slot: slot?.deliveryDateKey }
    : pickupSig(count, bringBack, mix, dropDateKey(drop.sat), codeState === "ok" ? codeClean : undefined));
  // Held for THIS order: it holds still — the code, Back and pay-later wait — and the button asks about it. Held for
  // another (the page was left, the order built again otherwise — a code not entered again, say): nothing is locked, so
  // the order it holds can be built again and asked about; only Pay waits.
  const payFrozen = (payHeld && !payHeldElsewhere) || (!!changeBody && changeHeld);
  // The held send was a pay-at-pickup one: it is asked about the same way — no card — so a first send that never reached
  // us is placed as it was chosen, never charged to a card.
  const heldNoCard = payHeld && !payHeldElsewhere && !payIdem.heldCard();
  const codeBox = mode === "pickup" ? (
    <div className="oa-code">
      {!codeOpen && codeState !== "ok" ? (
        <button type="button" className="oa-code-toggle hit-44 disabled:opacity-40" onClick={() => setCodeOpen(true)} disabled={payFrozen}>{t("funnel.have_code")}</button>
      ) : codeState === "ok" && codeBenefit ? (
        <div className="oa-code-ok">
          <Said as="span" className="contents"><span className="oa-code-tag">{codeClean}</span>
          <span className="oa-code-lbl">{codeDiscountCents > 0 ? `${money(codeDiscountCents)} off applied` : codeBenefit.label}</span></Said>
          <button type="button" className="oa-code-x hit-44 disabled:opacity-40" onClick={clearCode} disabled={payFrozen} aria-label="Remove code"><Icon name="close" /></button>
        </div>
      ) : (
        <div className="oa-code-in">
          <input className="auth-input" value={code} disabled={payFrozen} onChange={(e) => { setCode(e.target.value); if (codeState !== "idle") setCodeState("idle"); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); checkCode(); } }}
            placeholder={t("funnel.code_ph")} aria-label="Discount code" autoCapitalize="characters" />
          <button type="button" className="btn-sec shrink-0" onClick={checkCode} disabled={!codeClean || codeState === "checking" || payFrozen}>{codeState === "checking" ? "…" : t("funnel.code_apply")}</button>
        </div>
      )}
      {codeState === "bad" && <p className="oa-code-bad" role="alert">That code isn&rsquo;t valid — check it and try again.</p>}
      {codeState === "ok" && codeDiscountCents === 0 && <Said as="p" className="oa-code-note">Saved — this one applies to cups at the bar, not this pack.</Said>}
    </div>
  ) : null;

  const pickupCutoffVal = countdown ? `in ${countdown}` : dayName(drop.cutoff);
  const pickupPickupVal = `${dayName(drop.sat)}${stop?.name ? ` · ${stop.name}` : ""}`;
  const deadline = mode === "delivery"
    ? <>Drop closes <b>{slot.cutoffLabel}</b> · delivery <b>{slot.deliveryLabel}</b></>
    : <EditableCopy k="reserve.cutoff" value={t("reserve.cutoff")} displayValue={fillCopy(t("reserve.cutoff"), { cutoff: pickupCutoffVal, pickup: pickupPickupVal })} />;

  return (
    <div className="of" ref={stepRoot}>
      {showToggle && Toggle}

      {mode === "pickup" && step === "size" && (
        <>
          {usual && !replacing && (
            <button type="button" className="oa-usual" onClick={reorderUsual}>
              <span className="oa-usual-k">↺ Your usual</span>
              <span className="oa-usual-v">{usual.size} bottles · {usual.glass === "return" ? "bring-back" : "new glass"}</span>
              <span className="oa-usual-go">Load <Icon name="arrowRight" /></span>
            </button>
          )}
          <MyPacks onChange={startChange} refreshKey={packsKey} collapsible />
          {replacing && (
            <div className="oa-editing">
              Changing your {replacing.size}-pack for {packDayLabel(replacing)}{dropDateKey(drop.sat) !== replacing.drop_date ? `, and moving it to ${dayName(drop.sat)}` : ""} — only the difference is charged or refunded.
              <button type="button" className="hit-44" onClick={() => setReplacing(null)}>Keep it as is</button>
            </div>
          )}
        </>
      )}

      {(step === "build" || step === "glass" || step === "details" || step === "pay") && (
        <div className="dl-deadline">{deadline}</div>
      )}

      {/* ── DELIVERY START: zone check ── */}
      {mode === "delivery" && step === "start" && (
        <div className="dl-step">
          {/* The line, not a card (2026-10-09, round 2): it sat in a 34px headline inside a box of its
              own above the first question, with its last word in the action red. Now the same line as
              every other step's — the question and the ZIP come a screen-third sooner. */}
          <h2 className="dl-h serif"><EditableCopy k="funnel.hero_h1" value={t("funnel.hero_h1")} /> <em><EditableCopy k="funnel.hero_em" value={t("funnel.hero_em")} /></em></h2>

          {/* THE ZIP FIRST, THE OFFICE A LINK (2026-10-09, Ryan: "Office link", approved). Every visitor was asked
              home or office before anything else, as two large cards — and nearly all of them order for home. The
              ZIP is the first question now; an office is one quiet line under it, and a line back. Never blurs a
              home order into an office order: the two are still separate flows. */}
          {audience === "office" ? (
            <div className="aud-office">
              <p className="dl-sub">Fresh cold-extract for the whole team — <b>amber gallon jugs</b>, delivered <b>Monday 5–8&nbsp;AM</b>, empties swapped for full each week. 3-gallon minimum.</p>
              <button type="button" className="btn-pri btn-wide mt-0.5" onClick={() => setOfficeOpen(true)}><span>{t("funnel.office_cta")} <Icon name="arrowRight" /></span></button>
              {officeOpen && <OfficeOrder onClose={() => setOfficeOpen(false)} />}
              <button type="button" className="btn-ter self-start" onClick={() => setAudience("home")}><span aria-hidden="true">‹</span> {t("funnel.home_link")}</button>
            </div>
          ) : (<>
          <EditableCopy k="funnel.zip_lead" value={t("funnel.zip_lead")} as="p" className="dl-sub dl-zlead" />
          <div className="dl-ziprow dl-ziprow-xl">
            <input className="auth-input" inputMode="numeric" maxLength={5} autoComplete="postal-code" placeholder={t("funnel.zip_ph")} value={zip} onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setZone("ask"); }} aria-label="ZIP code" />
            <button type="button" className="btn-pri self-stretch" onClick={checkZone} disabled={zip.length !== 5}><span>{t("funnel.zip_check")}</span></button>
          </div>
          {zone === "out" && (
            <div className="dl-out">
              <p className="dl-sub"><b>{t("funnel.oz_title")}</b> {t("funnel.oz_body")}</p>
              {wlSent ? (
                <p className="dl-sub ok"><Icon name="check" /> {t("funnel.wl_done")}
                  {" "}<button type="button" className="dl-wl-off" onClick={leaveWaitlist}>Take me off</button>
                </p>
              ) : (
                <div className="dl-ziprow">
                  <input className="auth-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={wlEmail} onChange={(e) => setWlEmail(e.target.value)} aria-label="Email" />
                  <button type="button" className="btn-pri btn-wide mt-4.5" onClick={joinWaitlist}><span>{t("funnel.notify")}</span></button>
                </div>
              )}
              <button type="button" className="btn-sec btn-wide mt-3" onClick={() => switchMode("pickup")}>{t("funnel.switch_pickup")} <Icon name="arrowRight" /></button>
            </div>
          )}
          <button type="button" className="btn-ter self-start" onClick={() => { setAudience("office"); void import("./OfficeOrder"); }}>{t("funnel.office_link")} <span aria-hidden="true">›</span></button>
          </>)}
        </div>
      )}

      {/* ── SIZE ── */}
      {step === "size" && (
        <div className="dl-step">
          {/* Pickup h2 is instruction-only (2026-07-30 audit): /reserve's page eyebrow already says
              "Order ahead" — the old h2 opened by repeating it verbatim, two lines apart. */}
          {/* serif (2026-08-01 type-voice pass): the one customer headline that spoke system sans —
              Menu, Craft, and Today's pitch are all Fraunces; Reserve now speaks the same house. */}
          {/* ONE LINE, THEN THE CHOICES (2026-10-09, round 2). Three paragraphs stood between this line and
              the first choice — what the bottles are, which price the tiles showed, and the truck window's
              prices — about 50 words. Each tile now carries both of its prices, and the three paragraphs
              are a sheet ("How it works", under the button), one tap away. The day is said in full. */}
          <h2 className="dl-h serif">{mode === "delivery" ? t("funnel.size_h_delivery") : stops.length > 1 ? t("funnel.size_h_pickup_multi") : fillCopy(t("funnel.size_h_pickup"), { day: weekdayOf(dropDateKey(drop.sat)) })}</h2>
          {mode === "delivery" && <p className="dl-pricemode">{bringBack ? t("funnel.pricemode_del_back") : t("funnel.pricemode_del_new")}</p>}
          {mode === "delivery" ? (
            <>
              <EditableCopy k="funnel.which_sunday" value={t("funnel.which_sunday")} as="div" className="oa-slabel" />
              <div className="dl-days">
                {choices.map((c, i) => (
                  <button key={c.deliveryDateKey} type="button" className={`oa-day${when === i ? " sel" : ""}`} onClick={() => setWhen(i)}>
                    <b>{c.deliveryLabel.replace(", 5–8 AM", "")}</b>
                    <span>{sunLabel(c.deliveryDateKey)} · order by {c.cutoffLabel.replace(", 6:00 PM", " 6 PM")}</span>
                  </button>
                ))}
              </div>
            </>
          ) : !stopsRead ? (
            /* THE SATURDAY PICKER KEEPS ITS PLACE (2026-10-04). With two Saturdays on the road it
               arrived a second after the page and pushed the packs, the note and the button 117px
               down (production layout shift 0.041, gate 0.04). Until the stops are read, its label
               and two chips' worth of shimmer hold the room it usually takes. One stop or none and
               it goes — the less common morning, and a shorter move. */
            <>
              <EditableCopy k="funnel.pickup_day_label" value={t("funnel.pickup_day_label")} as="div" className="oa-slabel" />
              <div className="dl-days" aria-hidden="true">
                <span className="oa-day sk"><b>&nbsp;</b><span>&nbsp;</span></span>
                <span className="oa-day sk"><b>&nbsp;</b><span>&nbsp;</span></span>
              </div>
            </>
          ) : stops.length > 1 ? (
            <>
              <EditableCopy k="funnel.pickup_day_label" value={t("funnel.pickup_day_label")} as="div" className="oa-slabel" />
              <div className="dl-days">
                {stops.map((st, i) => {
                  const d = dropForStop(st.starts_at);
                  return (
                    <button key={st.starts_at} type="button" className={`oa-day${i === stopIdx ? " sel" : ""}`} onClick={() => setStopIdx(i)}>
                      <b>{dayName(d.sat)}</b>{st.name && <span>{st.name}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            /* ONE PICKUP, OR NONE SCHEDULED (2026-10-09). The room held above was given back when there
               was nothing to pick, and the packs, the note and the button jumped 119px up two seconds in
               (production layout shift 0.054, gate 0.04). The room holds the pickup instead: the day,
               where, and when ordering closes — what the next steps only said later. Drawn as the picker's
               chosen chip, since it is the pickup the order goes to; nothing to change, so it doesn't press. */
            <>
              <EditableCopy k="funnel.pickup_one_label" value={t("funnel.pickup_one_label")} as="div" className="oa-slabel" />
              <div className="dl-days">
                {packsPaused ? (
                  <Said as="div" className="oa-day cursor-default active:transform-none">
                    <b>Packs are paused</b>
                    <span>We&apos;re not taking pack orders right now — check back soon.</span>
                  </Said>
                ) : (
                  <div className="oa-day sel cursor-default active:transform-none">
                    <b>{dayName(drop.sat)}</b>
                    <span>{stop?.name ? `${stop.name} · ` : ""}order by {closesAt(drop.cutoff)}</span>
                  </div>
                )}
              </div>
            </>
          )}

          <EditableCopy k="funnel.how_many" value={t("funnel.how_many")} as="div" className="oa-slabel" />
          <div className="oa-tiles">
            {(mode === "delivery" ? DELIVERY_PACKS : PICKUP_TIERS).map((s) => (
              <button key={s} type="button" className={`oa-tile${count === s ? " sel" : ""}`} onClick={() => pickCount(s)}>
                {mode === "delivery" && s >= DELIVERY_PRICING.feeWaivedAt && <span className="oa-tag on">{t("funnel.free_delivery")}</span>}
                {mode === "pickup" && PACK_TAG[s] && <span className="oa-tag">{PACK_TAG[s]}</span>}
                <div className="oa-c">{s}</div><div className="oa-u">{t("funnel.bottles_unit")}</div>
                <div className="oa-p">{mode === "delivery" ? money(quoteDelivery(s, 0, bringBack ? s : 0, "direct").totalCents) : money(packTotal(s, bringBack ? "return" : "new") * 100)}</div>
                {/* The same pack's other price, so the tile says what the menu says ("$42 bring-back"). */}
                {mode === "pickup" && <div className="text-caption2 text-cream-muted whitespace-nowrap mt-1">{bringBack ? `${money(packTotal(s, "new") * 100)} new glass` : `${money(packTotal(s, "return") * 100)} bring-back`}</div>}
              </button>
            ))}
          </div>
          {mode === "delivery"
            ? <EditableCopy k="funnel.delivery_fee_note" value={t("funnel.delivery_fee_note")} displayValue={fillCopy(t("funnel.delivery_fee_note"), { fee: money(DELIVERY_PRICING.feeCents), min: String(DELIVERY_PRICING.feeWaivedAt) })} as="p" className="dl-note" />
            : <div className="dl-note">{count ? <>That&rsquo;s <b>{PACK_HINT[count]}</b></> : null}</div>}
          {count != null && (
            <button type="button" className="btn-pri btn-wide" disabled={!count || (mode === "pickup" && packsPaused)} onClick={() => setStep("build")}>{t("funnel.build_cta")} <Icon name="arrowRight" /></button>
          )}
          {mode === "pickup" && <button type="button" className="btn-ter self-center" onClick={() => setHowOpen(true)}>How it works</button>}
          {howOpen && (
            <Sheet open onClose={() => setHowOpen(false)} label="How it works" className="paper"
              header={<div className="flex items-center"><b className="text-subhead font-semibold">How it works</b><CloseButton onClick={() => setHowOpen(false)} /></div>}>
              <div className="flex flex-col gap-3">
                <EditableCopy k="reserve.fresh" value={t("reserve.fresh")} as="p" className="dl-sub" multiline />
                <EditableCopy k="menu.packs_note" value={t("menu.packs_note")} as="p" className="dl-sub" multiline />
                <EditableCopy k="reserve.window" value={t("reserve.window")} as="p" className="dl-sub" multiline />
              </div>
            </Sheet>
          )}
        </div>
      )}

      {/* ── BUILD (flavors + premium) ── */}
      {step === "build" && count && (
        <div className="dl-step">
          <EditableCopy k="funnel.build_h" value={t("funnel.build_h")} as="h2" className="dl-h" />
          {/* Prefix is editable copy; the live picked/count counter stays dynamic. */}
          <p className="dl-sub"><EditableCopy k="funnel.build_sub" value={t("funnel.build_sub")} /> <b>{picked} / {count}</b> bottles picked.</p>
          {FLAVS.map((k) => (
            <div className="dl-ctr" key={k}>
              <span className="dl-ctr-n">{FLAV_LABEL[k]} <em>{FLAV_DESC[k]}</em></span>
              <div className="dl-ctr-b">
                <button type="button" onClick={() => bump(k, -1)} disabled={mix[k] === 0} aria-label={`Fewer ${k}`}>−</button>
                <b aria-live="polite">{mix[k]}</b>
                <button type="button" onClick={() => bump(k, 1)} disabled={picked >= count} aria-label={`More ${k}`}>+</button>
              </div>
            </div>
          ))}
          {mode === "delivery" && bulkItems.length > 0 && (
            <div className="dl-perf">
              <div className="dl-ctr-n">PREMIUM <em>{money(SALTED_LATTE.price)} / bottle · always fresh</em></div>
              {bulkItems.map((it) => (
                <div className="dl-ctr sm" key={it.slug}>
                  <span className="dl-ctr-n">{it.name}</span>
                  <div className="dl-ctr-b">
                    <button type="button" onClick={() => bumpPremium(it.slug, -1)} disabled={!premiums[it.slug]} aria-label={`Fewer ${it.name}`}>−</button>
                    <b aria-live="polite">{premiums[it.slug] || 0}</b>
                    <button type="button" onClick={() => bumpPremium(it.slug, 1)} disabled={picked >= count} aria-label={`More ${it.name}`}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="btn-pri btn-wide" disabled={picked !== count} onClick={() => setStep("glass")}>
            {picked === count ? <>{t("funnel.build_next")} <Icon name="arrowRight" /></> : fillCopy(t("funnel.build_more"), { n: String(count - picked) })}
          </button>
        </div>
      )}

      {/* ── GLASS / bring-back vs new ── */}
      {step === "glass" && count && (
        <div className="dl-step">
          <EditableCopy k="funnel.glass_h" value={t("funnel.glass_h")} as="h2" className="dl-h" />
          {mode === "delivery" ? (
            <>
              <button type="button" className={`dl-card${bringBack ? " on" : ""}`} onClick={() => { glassTouched.current = true; setBringBack(true); setRefills((r) => (r ? Math.min(refillCap, r) : null)); }}>
                <b>{t("funnel.glass_back_title")}</b>
                <span>{fillCopy(t("funnel.glass_back_del_sub"), { refill: money(DELIVERY_PRICING.refill), fresh: money(DELIVERY_PRICING.fresh) })}</span>
              </button>
              {bringBack && (
                <div className="dl-loop">
                  <label className="dl-sub" htmlFor="of-ref">{t("funnel.empties_q")} <em>(up to {refillCap})</em></label>
                  <div className="dl-ctr-b lone">
                    <button type="button" onClick={() => { if (refillCount > 0) haptic("decrease"); else haptic("boundary"); setRefills(Math.max(0, refillCount - 1)); }} aria-label="Fewer empties">−</button>
                    <b id="of-ref" aria-live="polite">{refillCount}</b>
                    <button type="button" onClick={() => { if (refillCount < refillCap) haptic("increase"); else haptic("boundary"); setRefills(Math.min(refillCap, refillCount + 1)); }} aria-label="More empties">+</button>
                  </div>
                  {refillCount > 0 && (
                    <>
                      <p className="dl-callout">Set your rinsed empties on the porch by <b>5 AM Sunday</b>. No empties out, no swap — you&rsquo;ll pick up at GT3PB instead.</p>
                      <label className="dl-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{t("funnel.empties_ack")}</span></label>
                    </>
                  )}
                </div>
              )}
              <button type="button" className={`dl-card${!bringBack ? " on" : ""}`} onClick={() => { glassTouched.current = true; setBringBack(false); setRefills(null); setAck(false); }}>
                <b>{t("funnel.glass_new_del_title")}</b>
                <span>{fillCopy(t("funnel.glass_new_del_sub"), { fresh: money(DELIVERY_PRICING.fresh) })}</span>
              </button>
              {deliveryQuote && (
                <div className="dl-quote">
                  {deliveryQuote.refillCount > 0 && <span><b>{deliveryQuote.refillCount}</b> refills · {money(deliveryQuote.refillCount * DELIVERY_PRICING.refill)}</span>}
                  {deliveryQuote.newCount > 0 && <span><b>{deliveryQuote.newCount}</b> new · {money(deliveryQuote.newCount * DELIVERY_PRICING.fresh)}</span>}
                  {deliveryQuote.performanceCount > 0 && <span><b>{deliveryQuote.performanceCount}</b> {SALTED_LATTE.label} · {money(deliveryQuote.performanceCount * SALTED_LATTE.price)}</span>}
                  <span>delivery · {deliveryQuote.deliveryFeeCents === 0 ? "on us" : money(deliveryQuote.deliveryFeeCents)}</span>
                  <span className="dl-quote-t">total <b>{money(deliveryQuote.totalCents)}</b></span>
                </div>
              )}
            </>
          ) : (
            <>
              <button type="button" className={`dl-card${bringBack ? " on" : ""}`} onClick={() => { glassTouched.current = true; setBringBack(true); }}>
                <b>{t("funnel.glass_back_title")}</b>
                <span>{fillCopy(t("funnel.glass_back_pickup_sub"), { price: `$${perBottle(count, "return").toFixed(2)}` })}</span>
              </button>
              <button type="button" className={`dl-card${!bringBack ? " on" : ""}`} onClick={() => { glassTouched.current = true; setBringBack(false); }}>
                <b>{t("funnel.glass_new_pickup_title")}</b>
                <span>{fillCopy(t("funnel.glass_new_pickup_sub"), { price: money(1000) })}</span>
              </button>
              <div className="dl-quote">
                <span><b>{count}</b> bottles · {mode === "pickup" && bringBack ? `save ${money(Math.round(saveAmount(count) * 100))}` : "new glass"}</span>
                <span>${perBottle(count, bringBack ? "return" : "new").toFixed(2)} / bottle</span>
                <span className="dl-quote-t">total <b>{money(pickupTotalCents)}</b></span>
              </div>
            </>
          )}
          {/* Passing the glass step is a choice too (R8): a guest who went on with "Need new glass" and signed in at the details
              was moved to bring-back — every bottle a refill, a lower total on Pay, and the server's "confirm your empties" with
              its checkbox two screens back. */}
          <button type="button" className="btn-pri btn-wide" disabled={!glassReady} onClick={() => { glassTouched.current = true; setStep("details"); }}>
            {mode === "delivery" ? <>{t("funnel.glass_next_del")} <Icon name="arrowRight" /></> : <>{t("funnel.glass_next_pickup")} <Icon name="arrowRight" /></>}
          </button>
        </div>
      )}

      {/* ── DETAILS ── */}
      {dupRows && (
        <Sheet open onClose={() => setDupRows(null)} label="Already on the books" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "var(--sans)", fontSize: 15 }}>Already on the books</b><CloseButton onClick={() => setDupRows(null)} /></div>}>
          <p className="dl-sub" style={{ marginTop: 0 }}>You already have {dupRows.length === 1 ? "an order" : `${dupRows.length} orders`} for <b>{mode === "delivery" ? (slot?.deliveryLabel ?? "that day") : dayName(drop.sat)}</b>:</p>
          <div className="dup-list">
            {dupRows.map((r, i) => <div key={i} className="dup-row">{r.kind === "pickup" ? <Icon name="bell" /> : <Icon name="truck" />} {r.label}</div>)}
          </div>
          <button type="button" className="btn-pri btn-wide" onClick={() => { setDupOk(targetDayKey()); setDupRows(null); setStep("pay"); }}>Yes — add this order too <Icon name="arrowRight" /></button>
          <button type="button" className="btn-sec btn-wide mt-2" onClick={() => setDupRows(null)}>Never mind — keep what I have</button>
          <p className="pnl-note" style={{ marginTop: 10 }}>Tip: your packs for one day roll up together under “Your packs” — you can also change a pack instead of adding one.</p>
        </Sheet>
      )}

      {step === "details" && (
        <div className="dl-step">
          <h2 className="dl-h">{mode === "delivery" ? t("funnel.details_h_del") : t("funnel.details_h_pickup")}</h2>
          {!user ? (
            <>
              <EditableCopy k="funnel.signin_prompt" value={t("funnel.signin_prompt")} as="p" className="dl-sub" />
              <SignIn compact />
            </>
          ) : mode === "delivery" ? (
            <>
              {streetKnown && <p className="dl-sub known-note">From your last delivery — change anything that&apos;s different.</p>}
              {/* A label you can see over each field (R12 — the 10/10 audit, F9): these are filled from the last delivery, and a
                  filled field showed no word for what it was. The placeholder's words, now above it. */}
              <label className="fld-l block mt-2.5 mb-[5px]" htmlFor="pk-name">{t("funnel.f_name")}</label>
              <input id="pk-name" className="auth-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              <label className="fld-l block mt-2.5 mb-[5px]" htmlFor="pk-phone">{t("funnel.f_phone_del")}</label>
              <input id="pk-phone" className="auth-input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
              <TextYes phone={phone} checked={textYes} onChange={setTextYes} />
              {/* The street finds itself (components/AddressField): a pick fills the city too, near the ZIP the zone check passed. */}
              <label className="fld-l block mt-2.5 mb-[5px]" htmlFor="pk-street">{t("funnel.f_street")}</label>
              <AddressField id="pk-street" autoComplete="shipping address-line1" className="auth-input" label={t("funnel.f_street")} value={street} onChange={setStreet} near={zip}
                onPick={(a) => { setStreet(a.street); if (a.city) setCity(a.city); setPickedZip(a.zip); }} />
              {pickedZip && zip && pickedZip !== zip && (
                <Said as="p" className="dl-sub">That address is in {pickedZip}. Delivery was checked for {zip}: pick an address in {zip}, or go back and check {pickedZip}.</Said>
              )}
              <div className="dl-ziprow">
                <div className="min-w-0 flex-1">
                  <label className="fld-l block mt-2.5 mb-[5px]" htmlFor="pk-city">{t("funnel.f_city")}</label>
                  <input id="pk-city" className="auth-input" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="shipping address-level2" maxLength={60} />
                </div>
                <div className="flex-[0_0_90px] min-w-0 [&_.auth-input]:w-full">
                  <label className="fld-l block mt-2.5 mb-[5px]" htmlFor="pk-zip">ZIP</label>
                  <input id="pk-zip" className="auth-input dl-zip" value={zip} readOnly aria-describedby="pk-zip-why" />
                  <span id="pk-zip-why" className="sr-only">From your zone check</span>
                </div>
              </div>
              <label className="fld-l block mt-2.5 mb-[5px]" htmlFor="pk-access">{t("funnel.f_access")}</label>
              <input id="pk-access" className="auth-input" value={access} onChange={(e) => setAccess(e.target.value)} maxLength={200} />
              {/* What is missing, on the button (F9): it was "Payment", dimmed, and said nothing of why. */}
              <button type="button" className="btn-pri btn-wide" disabled={!!deliveryMissing} onClick={toPayment}>{deliveryMissing ?? <>{t("funnel.details_pay")} <Icon name="arrowRight" /></>}</button>
            </>
          ) : (
            <>
              <label className="fld-l block mt-2.5 mb-[5px]" htmlFor="pk-name">{t("funnel.f_name")}</label>
              <input id="pk-name" className="auth-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              <label className="fld-l block mt-2.5 mb-[5px]" htmlFor="pk-phone">{t("funnel.f_phone_pickup")}</label>
              <input id="pk-phone" className="auth-input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
              <TextYes phone={phone} checked={textYes} onChange={setTextYes} />
              <div className="dl-quote">
                <span>{count} bottles · {bringBack ? "bring-back" : "new glass"}</span>
                <span>pickup {dayName(drop.sat)}{stop?.name ? ` · ${stop.name}` : ""}</span>
                <span className="dl-quote-t">total <b>{money(pickupTotalCents)}</b></span>
              </div>
              <button type="button" className="btn-pri btn-wide" disabled={!!pickupMissing} onClick={toPayment}>{pickupMissing ?? <>{t("funnel.details_pay")} <Icon name="arrowRight" /></>}</button>
            </>
          )}
        </div>
      )}

      {/* ── PAY: a pack changed in place (0388) — the difference, as the server prices it (components/PackChangePay) ── */}
      {step === "pay" && changeBody && (
        <PackChangePay body={changeBody} bottles={count ?? 0} dayLabel={dayName(drop.sat)} codeBox={codeBox}
          sig={{ ...pickupSig(count, bringBack, mix, changeBody.dropDate, changeBody.code), path: "change", change: changeBody.id }}
          checkoutOff={<EditableCopy k="funnel.checkout_off" value={t("funnel.checkout_off")} as="p" className="dl-sub" />}
          onDone={(d) => {
            setDone({ ...d, label: dayName(drop.sat) });
            invalidateCustomerKnown();
            trackFunnel("reserve", "done");
            setReplacing(null);
            setStep("done");
            setPacksKey((k) => k + "x");
          }}
          onRefresh={(message) => { setPacksKey((k) => k + "x"); setReplacing(null); setStep("size"); toast(message, "error"); }}
          onHeld={setChangeHeld} />
      )}

      {/* ── PAY ── */}
      {step === "pay" && !changeBody && (
        <div className="dl-step">
          <EditableCopy k="funnel.pay_h" value={t("funnel.pay_h")} as="h2" className="dl-h" />
          <div className="dl-quote">
            <span>{count} bottles{mode === "delivery" ? "" : ` · pickup ${dayName(drop.sat)}`}</span>
            <span className="dl-quote-t">{onUs ? <><s className="dl-was">{money(baseTotalCents)}</s> <b>on us</b></> : payCents < baseTotalCents ? <><s className="dl-was">{money(baseTotalCents)}</s> <b>{money(payCents)}</b></> : <>total <b>{money(payCents)}</b></>}</span>
          </div>

          {codeBox}

          {payHeld && !busy && (
            <HeldNotice what={payIdem.heldCard() ? "Your last payment hasn’t been confirmed yet." : "Your last reservation hasn’t been confirmed yet."}
              line={payHeldElsewhere
                ? `It was for a different ${mode === "delivery" ? "delivery — check your email" : "pack — check My packs"} before ${payIdem.heldCard() ? "paying" : "reserving"} again — or build that one again here to check on it.`
                : heldNoCard
                ? "Tap the button below to check on it — it won’t be made twice, and your order stays as it is until it’s answered."
                : "Tap the button below to check on it — you won’t be charged twice, and your order stays as it is until it’s answered."}
              warning={`Only start over if we’ve told you it didn’t go through — otherwise this would be a second ${mode === "delivery" ? "delivery" : "pack"}.`}
              onStartOver={() => { payIdem.forget(); setErr(""); }} />
          )}

          {onUs ? (
            // Nothing to pay (R7b): the perk said by its own name, and one button — no card form for a $0 charge.
            <>
              <p className="dl-sub">{quoted?.perk ? `${quoted.perk} — nothing to pay.` : "This pack is on us — nothing to pay."}</p>
              {err && <p className="dl-err" role="alert">{err}</p>}
              <button type="button" className="btn-pri btn-wide" onClick={() => { setRechecking(payFrozen); void submitPickup(null); }} disabled={busy || payHeldElsewhere}>
                {busy ? (rechecking ? "Checking…" : "Reserving…") : payFrozen ? "Check on my reservation" : "Reserve it — on us"}
              </button>
            </>
          ) : squareClientReady ? (
            <>
              {/* "Pay now, or reserve and pay at pickup" only where that second way is offered (R7b). */}
              {(mode === "delivery" || payLater.on) && <p className="dl-sub">{mode === "delivery" ? t("funnel.pay_sub_del") : t("funnel.pay_sub_pickup")}</p>}
              {!heldNoCard && <PaymentCard ref={paymentRef} className="sq-card" onReady={setCardReady} onError={(m) => setErr(m ?? "")} />}
              {err && <p className="dl-err" role="alert">{err}</p>}
              {heldNoCard ? (
                <button type="button" className="btn-pri btn-wide" onClick={() => { setRechecking(true); void submitPickup(null); }} disabled={busy}>
                  {busy ? "Checking…" : "Check on my reservation"}
                </button>
              ) : (
                <button type="button" className="btn-pri btn-wide" disabled={!cardReady || busy || payHeldElsewhere}
                  onClick={() => { setRechecking(payFrozen); void (mode === "delivery" ? payDelivery : payPickupCard)(); }}>
                  {busy ? (rechecking ? "Checking…" : "Charging…") : payFrozen ? "Check on my payment" : fillCopy(t("funnel.pay_cta"), { total: money(payCents) })}
                </button>
              )}
              {mode === "pickup" && payLater.on && !payHeld && (
                <button type="button" className="oa-paylater" onClick={() => submitPickup(null)} disabled={busy}>
                  {busy ? "Reserving…" : t("funnel.pay_later")}
                </button>
              )}
              <p className="dl-trust">Secured by Square — your card never touches our servers. The charge shows as <b>GT3 Performance Bar</b>.{mode === "pickup" ? ` Change of plans? Cancel from My packs until ${packCloseWords} and a paid pack is refunded.` : ""}</p>
            </>
          ) : mode === "pickup" && payLater.on ? (
            <>
              {err && <p className="dl-err" role="alert">{err}</p>}
              <button type="button" className="btn-pri btn-wide" onClick={() => { setRechecking(payFrozen); void submitPickup(null); }} disabled={busy || payHeldElsewhere}>
                {busy ? (rechecking ? "Checking…" : "Reserving…") : payFrozen ? "Check on my reservation" : fillCopy(t("funnel.reserve_pay_later"), { total: money(payCents) })}
              </button>
              <EditableCopy k="funnel.reserve_window_note" value={t("funnel.reserve_window_note")} as="p" className="dl-sub" />
            </>
          ) : (
            <EditableCopy k="funnel.checkout_off" value={t("funnel.checkout_off")} as="p" className="dl-sub" />
          )}
        </div>
      )}

      {/* ── DONE ── */}
      {step === "done" && done && (
        <OrderConfirm
          title={done.change ? "Pack changed" : done.paid ? t("funnel.done_title_paid") : t("funnel.done_title_reserved")}
          sub={mode === "delivery" ? t("funnel.done_sub_del") : fillCopy(t("funnel.done_sub_pickup"), { day: weekdayOf(dropDateKey(drop.sat)), name: name ? `, ${name.split(" ")[0]}` : "" })}
          // A change's big number is what moved — charged, or on its way back — and the pack's total when nothing did.
          totalCents={done.change ? (done.change.charged || done.change.refunded + done.change.pending || done.total) : done.total}
          totalLabel={done.change?.charged ? "charged" : done.change && done.change.refunded + done.change.pending > 0 ? "back to your card" : done.total === 0 ? "on us" : done.paid ? "paid" : "due at pickup"}
          warn={done.warn}
          // Sourced from the copy system now (reserve.confirm_return / reserve.confirm_new) instead
          // of duplicated here — this text used to be hand-typed and happened to match those keys'
          // stored defaults almost word for word; nobody had actually wired them together (round o's
          // discovery). Not wrapped in EditableCopy for click-to-edit like everywhere else this
          // round: this is the post-purchase confirmation screen, only reachable after finishing a
          // real order, which makes it a much less practical spot to inline-edit from than a page
          // you can just browse to. Still fully owner-editable through Settings › Business › Brand & customer app.
          note={mode === "pickup" ? (bringBack ? fillCopy(t("reserve.confirm_return"), { size: String(count) }) : t("reserve.confirm_new")) : undefined}
          rows={[
            { label: "Pack", value: `${count} bottles` },
            ...(mode === "delivery"
              ? [
                  { label: "Delivery", value: done.label ?? "" },
                  { label: "Address", value: `${street}, ${city} ${zip}` },
                  ...(refillCount > 0 ? [{ label: "Empties", value: `${refillCount} out by 5 AM Sun` }] : []),
                  { label: "Fresh", value: "7 days from delivery" },
                ]
              : [
                  ...(done.ref ? [{ label: "Order", value: `#${done.ref.slice(0, 6).toUpperCase()}` }] : []),
                  { label: "Pickup", value: `${done.label}${stop?.name ? ` · ${stop.name}` : ""}` },
                  ...(done.change?.charged ? [{ label: "Charged", value: money(done.change.charged) }] : []),
                  ...(done.change?.refunded ? [{ label: "Refunded", value: money(done.change.refunded) }] : []),
                  ...(done.change?.pending ? [{ label: "The crew is refunding", value: money(done.change.pending) }] : []),
                  // A pack on us (R7b) says so — not "Pay at pickup $0.00".
                  done.total === 0 && !done.change ? { label: "Price", value: "On us" } : { label: done.change ? (done.paid ? "Pack total" : "Pay at pickup") : done.paid ? "Paid" : "Pay at pickup", value: money(done.total) },
                ]),
          ]}
          ctaLabel={mode === "delivery" ? t("funnel.done_cta_del") : t("funnel.done_cta_pickup")}
          onCta={mode === "delivery" ? () => router.push("/3mpire") : resetOrder}
        />
      )}

      {/* back — hidden on the first shopping step + on done */}
      {step !== "done" && !(mode === "delivery" && step === "start") && !(mode === "pickup" && step === "size") && !(step === "pay" && payFrozen) && (
        <button type="button" className="dl-back" onClick={goBack}>‹ Back</button>
      )}
    </div>
  );
}
