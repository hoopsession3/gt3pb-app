"use client";

import { useCallback } from "react";
import { supabase } from "./supabase";
import { sharedStore } from "./shared";
import { sameJson } from "./sharedCore";
import { LINE_SUB, lineSubKey } from "./drinks";
import { STAMP_GOAL } from "./loyalty";

// SITE COPY — owner/admin-editable front-end text. Every editable string has a stable key and a
// DEFAULT (the canonical copy). Overrides live in the `site_copy` table (0122); the front-end reads
// default-or-override, so the site never shows a blank and always works even before anything is
// edited. Add a new editable string = add one entry here and render it with useSiteCopy()'s t(key).

// THE SHELL CARRIES THE WORDS, NOT THE EDITOR'S NAMES FOR THEM (R34, 2026-10-19 — the fresh audit's PERF11-02). Every screen
// reads this file for t(key); it held each string's Settings label and group as well — 39% of its download, read only by
// the copy editor — on every route, for every guest. The labels and groups are lib/copyFields', which the editor alone
// imports; here is each key and its default (the canonical copy), in the editor's order, with the table's own notes.
const COPY_DEFAULT_LIST: { key: string; default: string }[] = [
  // ── Retired 2026-10-04: four fields Settings offered to edit that showed nowhere ──
  // board.welcome was the crew motto under My Day's greeting; both left the screen when Ryan asked
  // what was unnecessary. home.statement / home.principles / home.cta had been flagged DEAD since
  // 2026-07-16 — no component ever read them — and an editor field that changes nothing is the
  // same unnecessary information, one screen deeper. An override row left in site_copy is inert.
  // ── Home · signed-out and Home · pillars, Story, Reserve: retired 2026-10-09 with the guest story that
  //    closed /shop, /reserve and /delivery (components/StorefrontStory) — the Menu tab's three acts again,
  //    under the order. The menu is one tap away. An override row left in site_copy is inert. ──
  // ── Member card (the status card popout) ──
  { key: "card.founding_thanks", default: "✦ Thank you for being a Founding Member — you were here first." },
  // ── Our Craft page (/craft) — every line editable. Ingredient blocks: one per line, "Name — fact". ──
  { key: "craft.eye", default: "Our Craft · The How" },
  { key: "craft.h1_l1", default: "We practice" },
  { key: "craft.h1_em1", default: "art." },
  { key: "craft.h1_l2", default: "And" },
  { key: "craft.h1_em2", default: "chemistry." },
  { key: "craft.lede", default: "Every drink on our menu is built from whole, recognizable food — chosen on purpose, for what it does for you. Coffee to switch on, coconut and minerals to carry you, bone broth to rebuild. We treat each one as a craft, because your body runs on what you give it — and it deserves the good stuff." },
  { key: "craft.mol_cap", default: "Caffeine · three methyls, three 3s" },
  // craft.fuel, the philosophy band, retired 2026-10-09: it said the lede again (round 2, "Craft lines").
  // Pillar 1 — Activation
  { key: "craft.act_label", default: "01 · Activation" },
  { key: "craft.act_title", default: "Switch on — clean." },
  { key: "craft.act_intro", default: "Cold-extracted coffee, drawn slow in cool water so it's smoother and less bitter — a steady, even lift, without the sugar-crash, because there's no refined sugar or syrup in it." },
  { key: "craft.act_items", default: "Cold-extracted coffee — Steeped slow and cold for a smoother cup and an even lift. Caffeine is a well-studied stimulant — real energy, nothing artificial to process.\nOrganic cacao nibs · FLOW — Whole chocolate: theobromine (caffeine's gentler, longer-acting cousin) plus magnesium and cocoa flavanols, for a smoother, steadier focus.\nCeylon cinnamon + cardamom · DUSK — True cinnamon, naturally low in coumarin, with aromatic cardamom — warmth and depth, no sweetener needed.\nA2 goat milk, maple & sea salt · SALTED MAPLE LATTE — Naturally-A2 goat milk (many find it easier to digest), real maple for trace minerals like manganese, a pinch of sea salt. An afternoon treat that still eats clean.\nNitrogen · KING ME — Nothing but gas: micro-bubbles for a velvety, creamy pour — no dairy, no sugar." },
  // Pillar 2 — Hydration
  { key: "craft.hyd_label", default: "02 · Hydration" },
  { key: "craft.hyd_title", default: "Carry it through." },
  { key: "craft.hyd_intro", default: "Real hydration is more than water — it's the minerals that carry it into you. We pour whole-food electrolytes: no powders, no dyes, no concentrate." },
  { key: "craft.hyd_items", default: "Organic coconut water — Naturally rich in potassium — the electrolyte most people run short on — plus sodium and magnesium. A whole-food electrolyte source.\nYoung Thai coconut meat + local honey · TIDE — Blended to order for real hydration that goes down easy, with a touch of unrefined honey.\nSea salt — Sodium, the body's primary electrolyte for fluid balance — the reason a little salt helps you actually hold your water.\nOrganic lime juice · NATURE'S AIDE — A squeeze of organic lime with organic maple and a pinch of sea salt: light, bright hydration, never from a powder." },
  // Pillar 3 — Rebuild / Fuel
  { key: "craft.reb_label", default: "03 · Rebuild / Fuel" },
  { key: "craft.reb_title", default: "Rebuild after." },
  { key: "craft.reb_intro", default: "When you've spent yourself, you rebuild with real material — collagen, amino acids and minerals drawn out of bones over hours. No bouillon, no filler, no powder." },
  { key: "craft.reb_items", default: "Bone broth · FORGE · HUNT · WILD — Bones and connective tissue cooked down for hours into collagen, amino acids like glycine and proline, and minerals — a savory, whole-food source of protein, often ~8–10g a cup.\nPasture-raised beef, bison & ostrich — Cleaner sources, each with a profile: bison leaner with a little more iron and zinc, ostrich lighter still." },
  // The mark + close
  { key: "craft.mark_label", default: "04 · The Mark" },
  { key: "craft.mark_title", default: "Three methyls. Three 3s. GT3." },
  { key: "craft.mark_body", default: "Caffeine is one elegant molecule — a purine ring with three methyl groups at its nearest points. Three 3s, written into the chemistry itself. We didn't invent the coincidence; it's the structure. It's on the shirt. It's on the truck. It's the bar. Art meets chemistry, and they were the same thing all along." },
  { key: "craft.close_line", default: "Perfectly design-crafted." },
  { key: "craft.cta_menu", default: "See the menu →" },
  { key: "craft.cta_reserve", default: "Reserve a drop" },
  { key: "craft.signoff", default: "Pure Signal, No Noise." },
  // ── Home · signed-in (Today) ──
  // R4 (Daily Stack 2): two questions, not five — a new key, so an edit of the five-question line is not shown over it.
  { key: "stack.intro", default: "Two questions, and we'll build your stack for the day." },
  { key: "home.dialed_title", default: "Dialed For Today" },
  { key: "home.dialed_sub", default: "your stack, built" },
  // ── Loyalty card (Today home) · the tap-to-open stamp card ── Settings-only, not inline-click-
  // editable: the whole card is ONE tap target (clickable() in lib/a11y — role="button" on the
  // outer <section>, opens the member's status card), so wrapping any of this text in EditableCopy
  // would nest a second interactive control inside that button — the nested-interactive-element
  // problem excluded elsewhere (Craft's CTAs, the truck route rows), except here it's the WHOLE
  // card, not one row, so there's no safe sibling spot to lift text out to either (contrast
  // truck.stop_note, which sits in a detail panel outside its row's button). Reachable only via the
  // Edit pill added to the Today masthead — see app/page.tsx.
  { key: "stamp.kicker", default: "Your card" },
  { key: "stamp.badge_earned_one", default: "{count} free cup ready" },
  { key: "stamp.badge_earned_other", default: "{count} free cups ready" },
  { key: "stamp.badge_default", default: `Free cup at ${STAMP_GOAL}` },
  { key: "stamp.foot_full", default: "A free cup is ready — show your card at the window." },
  { key: "stamp.foot_near", default: "So close — {count} more to a free cup" },
  { key: "stamp.foot_progress", default: "{count} more to a free cup" },
  { key: "stamp.open_cta", default: "Open your card ›" },
  // ── Reserve card on the home screen ──
  { key: "pitch.kicker", default: "Order Ahead" },
  { key: "pitch.headline", default: "The bottles you love, brewed to order." },
  { key: "pitch.body", default: "Reserve a pack for the next drop — ready the moment you reach the window. No plan, no commitment." },
  { key: "pitch.cta", default: "Reserve the next drop" },
  { key: "pitch.fine", default: "Order ahead · pickup at the truck · bring bottles back for the best price." },
  // ── Reserve flow (order-ahead). {cutoff}/{pickup}/{size} are filled in live. ──
  // 2026-07-17: this whole group used to have no render site anywhere in the app — see round o's
  // delivery notes. Now wired into app/reserve/page.tsx + OrderFunnel.tsx. Three of these (kicker,
  // cutoff, confirm_return/confirm_new) turned out to already be live as hand-typed duplicates
  // elsewhere in OrderFunnel.tsx — their defaults below were updated to match that live wording
  // exactly, so wiring them up didn't silently change anything a customer sees. headline and window
  // had no live equivalent at all — genuinely new copy, added in round p.
  { key: "reserve.kicker", default: "Order ahead" },
  { key: "reserve.headline", default: "Tell us you're coming, we'll brew it to order." },
  { key: "reserve.cutoff", default: "Drop closes {cutoff} · pickup {pickup}" },
  { key: "reserve.fresh", default: "Cold-extracted Rise, Flow & Dusk — smooth, low-acid bottles for your week. Reserve now, grab them at the truck." },
  { key: "reserve.window", default: "No commitment, no plan — just this drop.\nAt the window: $10 new · $8 bring-back · single bottle $10" },
  { key: "reserve.confirm_return", default: "Don't forget your empties — rinse and bring all {size}; that's what your pack price is built on. Fresh 7 days from pickup." },
  { key: "reserve.confirm_new", default: "Bottles are yours to keep — or bring them back next drop and unlock pack pricing. Fresh 7 days from pickup." },
  // ── Menu header ──
  { key: "menu.order_line", default: "Order here, and it'll be waiting when you reach the window." },
  // 2026-07-27: system-design pass on where to teach the "why" behind the menu (Ryan asked for a
  // strategic placement audit, not just "put it on Menu") — this is placement #1 of 4. Menu's own
  // categories (Activation/Hydration/…, lib/menu.ts MENU) already ARE Craft's three pillars; this
  // just tells the customer that connection exists. Plain text inside a <button> — same nested-
  // interactive rule as craft.cta_menu/cta_reserve, not inline-click-editable.
  { key: "menu.craft_link", default: "Grouped by what your body needs — see the full chemistry" },
  { key: "menu.integrity", default: "Everything real, poured into glass, made the moment you order" },
  { key: "menu.mto", default: "Made to order" },
  { key: "menu.packs_title", default: "Take it home" },
  { key: "menu.packs_sub", default: "Packs for the next drop" },
  { key: "menu.packs_note", default: "Bring your empties back for pack pricing — or take new glass at $10 a bottle. You choose when you reserve." },
  // Drink sheet, truck-closed state: replaces the old hardcoded "Packs are brewed to order
  // anytime" (2026-07-17 — false: order-ahead has a real cutoff, lib/orderAhead's dropForStop/
  // nextDrop). {cutoff}/{pickup} are filled in live via fillCopy() below — see DrinkSheet.tsx.
  { key: "menu.packs_cutoff", default: "Packs are brewed to order — reserve by {cutoff} for pickup {pickup}." },
  // ── Truck page · the "what's on board" tagline per stop (keyed by the stop's menu tier) ──
  { key: "truck.tier.full", default: "Full bar on board" },
  { key: "truck.tier.coffee", default: "Coffee bar" },
  { key: "truck.tier.nitro", default: "Nitro bar" },
  { key: "truck.tier.beer", default: "Beer & wine on board" },
  // Dynamic override, not tied to a specific tier: shown instead of whichever tier tagline above
  // would otherwise apply, when live 86 data says most/all of today's active menu is sold out (see
  // FindUs.tsx's descFor) — the truck effectively has nothing to sell, so claiming "full bar on
  // board" would overclaim. A couple of 86'd items doesn't trigger this; near-empty does.
  { key: "truck.tier.limited", default: "Limited menu today" },
  { key: "truck.stop_note", default: "Full bar on board. Order ahead or save a reminder." },
  // ── Shop (/shop) — the merch storefront. Adoption pass 2026-08-10. ──
  { key: "shop.sec_bottles", default: "Bottles" },
  { key: "shop.sec_merch", default: "Merch" },
  { key: "shop.tagline", default: "Wear the standard. Printed on demand, shipped to you — the same no-shortcuts ethos as the cup." },
  { key: "shop.empty", default: "New drops are on the way — check back soon." },
  { key: "shop.done_title", default: "Order" },
  { key: "shop.done_title_em", default: "in" },
  { key: "shop.done_lede", default: "Thanks — we’ve got it. You’ll get an email now, and tracking the moment it ships." },
  { key: "shop.keep", default: "Keep shopping" },
  // ── GT3 Nutrition (/primal) — the brand; Return to Primal is its course (R44, the owner's call). ──
  { key: "primal.eyebrow", default: "GT3 Nutrition" },
  { key: "primal.hero_eye", default: "GT3 Nutrition · the course" },
  { key: "primal.hero_h1", default: "Return to" },
  { key: "primal.hero_h1_em", default: "Primal" },
  { key: "primal.hero_lede", default: "Real fuel, explained simply. A systematic path, quick to reference — the pillar maps free to keep, the course yours when you buy it — and every lesson ends in a stack you can actually order. Educational, never medical." },
  { key: "primal.empty", default: "The academy is being written. Check back soon — the first lessons drop this week." },
  { key: "primal.cta_eye", default: "Go deeper" },
  { key: "primal.cta_body", default: "The full Return to Primal course — Rookie first, then every pillar — opens with one GT3 Nutrition purchase: every lesson, its key points and its stack, and every map to keep. The four pillar maps are free, above." },
  { key: "primal.cta_link", default: "Start with a stack ›" },
  // ── Primal lesson (/primal/l/…) — locked state + the meal-stack rail. ──
  { key: "primal.locked_h1", default: "This one’s" },
  { key: "primal.locked_h1_em", default: "moved" },
  { key: "primal.locked_lede", default: "This lesson is part of GT3 Nutrition. One purchase opens the whole course — every lesson, its key points and its stack." },
  { key: "primal.stack_eye", default: "Your stack" },
  { key: "primal.stack_title", default: "Order what you just learned" },
  { key: "primal.stack_lede", default: "The drinks that put this lesson to work — in the order they fit your day." },
  // ── Find Us (/, /truck, /events) — the public front door. This group is distinct from the
  //    "Truck" group above (dynamic tier taglines etc.), which also renders on this page. ──
  { key: "findus.eyebrow_live", default: "Live now" },
  { key: "findus.eyebrow_event", default: "Next event" },
  { key: "findus.eyebrow_stop", default: "Next stop" },
  { key: "findus.no_stops", default: "No stops yet" },
  { key: "findus.cta_preorder", default: "Pre-order · skip the line" },
  // 2026-10-04: with nothing to pre-order (no stop, or the next one's window not open yet) the red
  // button still went to the menu and still said PRE-ORDER. It says what it does now; the line under
  // it says when cup orders open (lib/ordering).
  { key: "findus.cta_menu", default: "See the menu" },
  { key: "findus.cta_closed", default: "Online ordering’s closed for today — come see us at the bar before we pack up." },
  { key: "findus.road_title", default: "On The Road" },
  { key: "findus.road_note", default: "stops & events, in order" },
  { key: "findus.road_empty_title", default: "Nothing scheduled yet" },
  { key: "findus.road_empty_sub", default: "This week’s stops and events post here — check back soon." },
  { key: "findus.byo_title", default: "Bring Us To You" },
  { key: "findus.byo_note", default: "private events" },
  { key: "findus.byo_pitch", default: "Pours, run clubs, launches — we set up anywhere." },
  // ── Book (/book) — the "book the bar" B2B intake. No wiring before this pass. ──
  { key: "book.eyebrow", default: "Book the bar" },
  { key: "book.eye", default: "Bring GT3PB to your event" },
  { key: "book.title", default: "Book the bar." },
  { key: "book.lede", default: "Offsites, run clubs, launches, weddings. We bring the full bar and pour on site. Tell us the basics — we take it from there." },
  { key: "book.done_eye", default: "Request received" },
  { key: "book.done_title", default: "We're on it." },
  { key: "book.done_thanks", default: "Thanks, {name}. We'll reach out within a day to lock your date and the details." },
  // Book form — field labels + placeholders + SMS consent (adoption pass 2026-08-10). Labels render as
  // plain t() (htmlFor association), so they're editable via Settings rather than inline.
  { key: "book.f_name", default: "Name" },
  { key: "book.ph_name", default: "Your name" },
  { key: "book.f_email", default: "Email" },
  { key: "book.ph_email", default: "you@email.com" },
  { key: "book.f_phone", default: "Phone" },
  { key: "book.ph_phone", default: "For a quick call if email doesn't land" },
  { key: "book.consent", default: "Your number is only for a call about this request if email doesn't reach you — never marketing, never shared." },
  { key: "book.f_date", default: "Event date" },
  { key: "book.f_headcount", default: "Headcount" },
  { key: "book.ph_headcount", default: "50" },
  { key: "book.f_location", default: "Location" },
  { key: "book.ph_location", default: "Your address, venue, or city" },
  { key: "book.f_notes", default: "Anything else" },
  { key: "book.ph_notes", default: "Vibe, timing, must-haves…" },
  { key: "book.submit", default: "Send request" },
  // ── 3MPIRE (/3mpire) — the referral card hero. ──
  { key: "mpire.ref_eye", default: "Grow The 3MPIRE" },
  { key: "mpire.ref_title", default: "Give $5, get $5." },
  { key: "mpire.ref_body", default: "When a friend joins with your code and makes their first order, you each get $5 credit." },
  // ── Masthead eyebrows (context labels) on pages otherwise covered by their own groups above.
  //    Keys carry a masthead.* prefix but sit in each page's natural group so "View live →" lands
  //    on the exact page. (Shop/Primal/Book/3MPIRE eyebrows live in those groups above.) ──
  { key: "masthead.delivery", default: "Order ahead" },
  // ── Find Us · the facts + chrome (adoption pass 2026-08-10; two rows since Find Us 10, 2026-10-10: Where, and When
  //    with the day and the hours on one line). The honest fallbacks ("Location TBA"/"Soon"). ──
  { key: "findus.fact_where", default: "Where" },
  { key: "findus.fact_when", default: "When" },
  { key: "findus.fact_going", default: "Going" },
  { key: "findus.loc_tba", default: "Location TBA" },
  { key: "findus.day_tba", default: "Soon" },
  { key: "findus.directions", default: "Get directions" },
  { key: "findus.preorder", default: "Pre-order" },
  { key: "findus.book_cta", default: "Book the bar for your event" },
  { key: "findus.ping_off", default: "Ping me when live" },
  { key: "findus.ping_on", default: "On the list — we'll ping you" },
  // ── Drink sheet (the popout over /menu). Section labels + chrome CTAs. A drink's own words — name, what it is, why,
  //    what's in it, caffeine, contains — are the Catalog's (lib/drinks, R2 2026-10-13), edited on its Catalog page;
  //    the sheet's pillar line is the drink's section and that section's subtitle (menu.line.<name>.sub, below). ──
  { key: "sheet.caffeine_label", default: "Caffeine" },
  { key: "sheet.caffeine_yes", default: "Yes" },
  { key: "sheet.caffeine_no", default: "None" },
  { key: "sheet.contains_label", default: "Contains" },
  { key: "sheet.not_here", default: "Not at this stop" },
  { key: "sheet.in_bottle", default: "In the bottle" },
  { key: "sheet.never", default: "Never" },
  { key: "sheet.when_label", default: "When" },
  { key: "sheet.add", default: "Add to order" },
  { key: "sheet.remove", default: "Remove from order" },
  { key: "sheet.soldout", default: "Sold out today" },
  { key: "sheet.closed_cta", default: "Truck's closed — reserve a pack ›" },
  // The last hour of a stop: still pouring for the line, no longer online — "Truck's closed" was wrong.
  { key: "sheet.closing_cta", default: "Reserve a pack for the next drop ›" },
  { key: "sheet.made_moment", default: "Made the moment you order, and you'll taste it." },
  // ── Menu page — the Primal link, sold-out badge, reserve link (adoption pass 2026-08-10). ──
  { key: "menu.nav_primal", default: "GT3 Nutrition" },
  { key: "menu.sold_out", default: "SOLD OUT" },
  { key: "menu.not_here", default: "NOT AT THIS STOP" },
  { key: "menu.empty", default: "Nothing's on the menu right now — check back soon." },
  { key: "menu.caffeine", default: "Caffeine" },
  { key: "menu.no_caffeine", default: "No caffeine" },
  { key: "menu.reserve_pack", default: "Reserve your pack ›" },
  // ── Shop — product detail + cart chrome (adoption pass 2026-08-10). ──
  { key: "shop.back", default: "Shop" },
  { key: "shop.options", default: "Options" },
  { key: "shop.add_cart", default: "Add to cart" },
  // ── Checkout (/shop) — the shipping + payment form (adoption pass 2026-08-10). ──
  { key: "checkout.title", default: "Checkout" },
  { key: "checkout.total", default: "Total" },
  { key: "checkout.ship_to", default: "Ship to" },
  { key: "checkout.ph_name", default: "Full name" },
  { key: "checkout.ph_street", default: "Street address" },
  { key: "checkout.ph_city", default: "City" },
  { key: "checkout.ph_state", default: "State" },
  { key: "checkout.ph_zip", default: "ZIP" },
  { key: "checkout.ph_email", default: "Email (for your receipt + tracking)" },
  { key: "checkout.payment", default: "Payment" },
  { key: "checkout.pay", default: "Pay {total}" },
  { key: "checkout.fine", default: "Printed on demand and shipped to you. You’ll get tracking by email when it ships." },
  { key: "checkout.off", default: "Card checkout isn’t switched on yet." },
  // ── Order funnel — pickup + shared steps (renders on /reserve; delivery-only lines live in the
  //    Delivery group so 'View live →' lands on the page each actually renders). ──
  { key: "funnel.toggle_pickup", default: "Pickup" },
  { key: "funnel.toggle_pickup_sub", default: "Grab it at a truck stop" },
  { key: "funnel.toggle_delivery", default: "Delivery" },
  { key: "funnel.toggle_delivery_sub", default: "Prepaid, to your door" },
  { key: "funnel.size_h_pickup_multi", default: "Pick a day and a size." },
  { key: "funnel.size_h_pickup", default: "Pick a size for {day}." },
  { key: "funnel.pickup_day_label", default: "Pickup day — your call" },
  { key: "funnel.pickup_one_label", default: "Pickup" },
  { key: "funnel.how_many", default: "How many bottles" },
  { key: "funnel.bottles_unit", default: "BOTTLES" },
  { key: "funnel.build_cta", default: "Build your pack" },
  { key: "funnel.build_h", default: "Build your pack." },
  { key: "funnel.build_sub", default: "Rise, Flow, Dusk — mix as you go." },
  { key: "funnel.build_next", default: "Your bottles" },
  { key: "funnel.build_more", default: "Pick {n} more" },
  { key: "funnel.glass_h", default: "Your bottles." },
  { key: "funnel.glass_back_title", default: "Bringing mine back — best price" },
  { key: "funnel.glass_back_pickup_sub", default: "Pack pricing. Rinse your empties and bring them to your pickup. {price}/bottle." },
  { key: "funnel.glass_new_pickup_title", default: "Need new glass" },
  { key: "funnel.glass_new_pickup_sub", default: "New sealed bottle, {price}/bottle flat. Bring them back next time to unlock pack pricing." },
  { key: "funnel.glass_next_pickup", default: "Who's it for?" },
  { key: "funnel.details_h_pickup", default: "Who's this drop for?" },
  { key: "funnel.signin_prompt", default: "Sign in so your order is yours to track and manage." },
  { key: "funnel.f_name", default: "Name" },
  // R5 (0398): a number is texted only after its yes (the box below it), so the field no longer promises a text.
  { key: "funnel.f_phone_pickup", default: "Phone (in case we need to reach you)" },
  { key: "funnel.tel_consent", default: "We use your number only about this order — never marketing." },
  // R5 (2026-10-14, 0398): the yes to texts, beside an unticked box, once texts are switched on (components/TextYes).
  { key: "funnel.text_yes", default: "Text me about my packs and deliveries — when one is confirmed, and if anything changes. Msg frequency varies. Msg & data rates may apply. Reply STOP to stop, HELP for help." },
  { key: "funnel.details_pay", default: "Payment" },
  { key: "funnel.pay_h", default: "Lock it in." },
  { key: "funnel.have_code", default: "Have a code?" },
  { key: "funnel.code_ph", default: "Discount code" },
  { key: "funnel.code_apply", default: "Apply" },
  { key: "funnel.pay_sub_pickup", default: "Pay now, or reserve and pay at pickup." },
  { key: "funnel.pay_cta", default: "Pay {total}" },
  { key: "funnel.pay_later", default: "or reserve now — pay at pickup" },
  { key: "funnel.reserve_pay_later", default: "Reserve {total} — pay at pickup" },
  { key: "funnel.reserve_window_note", default: "Reserve here and pay at the window on pickup day." },
  { key: "funnel.checkout_off", default: "Checkout isn’t switched on yet — card payments arrive with the Square keys." },
  { key: "funnel.done_title_paid", default: "You're in." },
  { key: "funnel.done_title_reserved", default: "You're reserved." },
  { key: "funnel.done_sub_pickup", default: "See you {day}{name}." },
  { key: "funnel.done_cta_pickup", default: "Reserve another" },
  // ── Order funnel — delivery-mode steps (renders on /delivery). ──
  { key: "funnel.hero_h1", default: "Your week," },
  { key: "funnel.hero_em", default: "delivered." },
  // The home-or-office cards went 2026-10-09 (the ZIP is the first question; an office is a link under it).
  { key: "funnel.office_link", default: "Ordering for an office?" },
  { key: "funnel.home_link", default: "Home delivery instead" },
  { key: "funnel.office_cta", default: "Set up office delivery" },
  { key: "funnel.zip_lead", default: "Enter your ZIP — we’ll check your porch." },
  { key: "funnel.zip_ph", default: "ZIP code" },
  { key: "funnel.zip_check", default: "Check" },
  { key: "funnel.oz_title", default: "Not in our delivery zone yet." },
  { key: "funnel.oz_body", default: "Drop your email — or grab it at a truck stop instead." },
  { key: "funnel.wl_done", default: "You’re on the list." },
  { key: "funnel.notify", default: "Notify me" },
  { key: "funnel.switch_pickup", default: "Switch to pickup" },
  { key: "funnel.size_h_delivery", default: "We deliver to you. Pick a Sunday and a size." },
  { key: "funnel.pricemode_del_back", default: "Prices with empties back — first delivery? Switch to “need all new” at the next step." },
  { key: "funnel.pricemode_del_new", default: "New-bottle prices — bring your empties back next time and pay less." },
  { key: "funnel.which_sunday", default: "Which Sunday" },
  { key: "funnel.free_delivery", default: "FREE DELIVERY" },
  { key: "funnel.delivery_fee_note", default: "Delivery {fee} flat — free at {min}+ bottles." },
  { key: "funnel.glass_back_del_sub", default: "Rinse your empties, set them out. We swap them for your new order. {refill}/bottle instead of {fresh}." },
  { key: "funnel.empties_q", default: "How many empties are you returning?" },
  { key: "funnel.empties_ack", default: "Got it — empties out by 5 AM Sunday." },
  { key: "funnel.glass_new_del_title", default: "Need all new" },
  { key: "funnel.glass_new_del_sub", default: "Sealed bottles delivered fresh. {fresh}/bottle." },
  { key: "funnel.glass_next_del", default: "Delivery details" },
  { key: "funnel.details_h_del", default: "Where do we bring it?" },
  { key: "funnel.f_phone_del", default: "Phone (in case we need to reach you)" },
  { key: "funnel.f_street", default: "Street address" },
  { key: "funnel.f_city", default: "City" },
  { key: "funnel.f_access", default: "Gate code / access notes (optional)" },
  { key: "funnel.pay_sub_del", default: "One charge now — nothing due at the door." },
  { key: "funnel.done_sub_del", default: "We'll be there before sunrise Sunday." },
  { key: "funnel.done_cta_del", default: "Track it in your account" },
  // ── Coupon landing (/c/<code>) — the prose around a scanned offer (adoption pass 2026-08-10). ──
  { key: "coupon.checkout_sub", default: "Your code is in — it applies itself at checkout." },
  { key: "coupon.checkout_cta", default: "Order your bottles →" },
  { key: "coupon.code_label", default: "code" },
  { key: "coupon.loop_body", default: "Bring your empty GT3 bottle back to any pop-up or pickup — show this screen, get your pour, and the bottle goes back into the Loop." },
  { key: "coupon.loop_cta", default: "See what's pouring →" },
  { key: "coupon.ended_title", default: "That offer has wrapped" },
  { key: "coupon.ended_sub", default: "This card's run has ended — but the good stuff hasn't." },
  { key: "coupon.ended_cta", default: "See the menu →" },
  // ── Marketing splash — the guest takeover's fixed regions (promo headline/sub/CTA stay promo-
  //    driven; these are the always-present GT3 lines). Plain t() — the whole scrim is tap-to-dismiss. ──
  { key: "splash.kicker", default: "Sunday delivery · Greenville" },
  { key: "splash.price_pre", default: "From" },
  { key: "splash.price_amt", default: "$8" },
  { key: "splash.price_suf", default: "a bottle." },
  { key: "splash.foot", default: "Mix & match · free delivery at 24+" },
  { key: "splash.welcome", default: "Welcome to the bar" },
  { key: "splash.sign_pre", default: "Grow Your" },
  { key: "splash.sign_suf", default: "mpire" },
  // ── Delivery page — the not-live empty state. ──
  { key: "delivery.not_live", default: "Delivery isn't live yet — check back soon." },
  // ── Bottom nav — the five tab labels (guest + member). ──
  { key: "nav.today", default: "Today" },
  { key: "nav.find", default: "Find Us" },
  { key: "nav.menu", default: "Menu" },
  { key: "nav.reserve", default: "Reserve" },
  { key: "nav.shop", default: "Shop" },
  { key: "nav.join", default: "Join" },
  // ── 3MPIRE / account page — masthead eyebrow + Your-usual row (Today). ──
  { key: "mpire.eyebrow", default: "Your 3MPIRE" },
  { key: "today.usual_lead", default: "Your" },
  { key: "today.usual_leadsub", default: "usual" },
  { key: "today.usual_sub", default: "same order, one tap" },
  { key: "today.usual_cta", default: "Order again" },
  // ── Today, by state (2026-10-13, R3: the page leads with what is true now — components/today/TodayHome). ──
  { key: "today.again", default: "Order again" },
  { key: "today.usual_label", default: "Your usual" },
  { key: "today.again_now", default: "ready in about 8 minutes" },
  { key: "today.usual_then", default: "Your usual is one tap then." },
  { key: "today.change", default: "Change it" },
  { key: "today.free_at_window", default: "{ready} — on us at the window when you show your card. It isn't taken off this price." },
  { key: "today.first_cta", default: "Order your first cup" },
  { key: "today.first_sub", default: `Order here and it's waiting at the window. Every cup earns a stamp — buy ${STAMP_GOAL}, the next is on us.` },
  { key: "today.usual_out", default: "Your usual isn't on today's menu — pick something new." },
  { key: "today.see_menu", default: "See the menu" },
  { key: "today.find_us", default: "Find us" },
  { key: "today.directions", default: "Directions" },
  { key: "today.remind", default: "Remind me at {time}" },
  { key: "today.remind_set", default: "Reminder set · {time}" },
  { key: "today.remind_said", default: "We'll ping you at {time}, when cup orders open." },
  { key: "today.remind_off", default: "Reminder off." },
  { key: "today.remind_blocked", default: "Your phone said no to notifications — allow them for GT3 in Settings, then try again." },
  { key: "today.off_eyebrow", default: "Truck's off · next stop" },
  { key: "today.none_eyebrow", default: "Truck's off" },
  { key: "today.none_title", default: "No stop on the calendar yet" },
  { key: "today.card_empty", default: "Every cup earns a stamp" },
  { key: "today.packs_lead", default: "Packs" },
  { key: "today.packs_name", default: "The next drop" },
  { key: "today.packs_sub", default: "Bottles brewed to order" },
  { key: "today.packs_cta", default: "Reserve" },
  { key: "today.stack_lead", default: "Stack" },
  { key: "today.stack_first", default: "Not sure what to get?" },
  { key: "today.stack_first_sub", default: "Two questions, and we'll suggest your stack" },
  // ── Account — the 3MPIRE page's section labels + account rows + referral card chrome. ──
  { key: "account.orders_label", default: "Recent Orders" },
  { key: "account.orders_note", default: "order again" },
  { key: "account.section_label", default: "Your Account" },
  { key: "account.section_note", default: "manage" },
  { key: "account.academy", default: "GT3 Academy" },
  { key: "account.academy_sub", default: "Training · certifications · cookbook" },
  { key: "account.arch", default: "System architecture" },
  { key: "account.arch_sub", default: "How the platform is built · owner" },
  { key: "account.book", default: "Book the bar" },
  { key: "account.book_sub", default: "Bring GT3PB to your event — B2B" },
  { key: "account.notifications", default: "Notifications" },
  { key: "account.notifications_sub", default: "Order updates, pickup reminders, truck live, texts" },
  { key: "account.signout", default: "Sign out" },
  { key: "account.copy", default: "Copy" },
  { key: "account.copied", default: "Copied!" },
  { key: "account.share", default: "Share invite" },
  // ── Menu · sections. THE DRINKS ARE THE CATALOG'S (2026-10-13, R2 of the customer audit): a drink's name, what it
  // is, why, its tag and its section are its Catalog row's, edited on its Catalog page — they were copy here (menu.<drink>.*),
  // so the Catalog said one thing and the menu another; 0393 moved the owner's edits into the rows. A section's name is
  // its drinks' line; its subtitle is copy keyed by that name, so it follows the section wherever the Catalog puts it.
  ...Object.entries(LINE_SUB).map(([line, sub]) => ({ key: lineSubKey(line), default: sub })),
];

export const COPY_DEFAULTS: Record<string, string> = Object.fromEntries(COPY_DEFAULT_LIST.map((m) => [m.key, m.default]));

// Fill a copy string's {placeholder} tokens from a value map — the one substitution helper every
// templated key (menu.packs_cutoff, reserve.cutoff, reserve.confirm_return/new, …) should go
// through, so "how do placeholders get filled" only has one answer app-wide. Unknown {tokens} are
// left as-is rather than silently blanked, so a typo in a key or an owner-edited override that
// drops a token is obvious instead of quietly eating text.
export function fillCopy(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? vars[name] : whole));
}

// ── The live-copy edit bridge (2026-07-16) ──────────────────────────────────────────────────────
// Two one-tap jumps between where copy is EDITED (SiteCopyEditor, /crew Settings) and where it's
// SEEN (the live storefront): "View live →" in the editor, and an owner-only Edit pill on the live
// page. Both directions key off the same CopyMeta.group string, so they can't drift apart from
// each other — only one has to independently track where a group actually renders.

// group → a stable DOM id, used as BOTH the SiteCopyEditor group's anchor id AND the "a=" deep-link
// param the crew console scrolls to. Its home is lib/copyAnchor (2026-10-06): Settings has to know a
// copy group's anchor to open the row that holds the editor, and lib/settingsLayout, which every
// jump reads, must not pull this file's whole copy table into the bundle to learn a prefix.
export { copyGroupAnchor } from "./copyAnchor";

// group → the live page that actually renders it. Explicit per group (unlike the anchor, a route
// can't be derived from the name); the per-drink "Menu · <name>" groups all fall through to /menu.
const COPY_GROUP_ROUTE: Record<string, string> = {
  "Home · signed-in": "/",
  "Loyalty card": "/",
  "Member card": "/",
  "Craft page": "/craft",
  "Reserve card": "/",
  "Reserve flow": "/reserve",
  "Menu": "/menu",
  "Menu · sections": "/menu",
  "Truck": "/truck",
  "Shop": "/shop",
  "Primal": "/primal",
  "Find Us": "/",
  "Book": "/book",
  "3MPIRE": "/3mpire",
  "Delivery": "/delivery",
  "Checkout": "/shop",
  "Coupon": "/menu",
  "Splash": "/",
  "Nav": "/",
  "Account": "/3mpire",
};
export function copyGroupRoute(group: string): string {
  if (COPY_GROUP_ROUTE[group]) return COPY_GROUP_ROUTE[group];
  if (group.startsWith("Menu")) return "/menu"; // per-drink groups, e.g. "Menu · Cold Brew"
  return "/";
}

// Client hook: load overrides, resolve default-or-override, and stay live. Realtime (not a
// one-time fetch) so a save from EITHER editor — the SiteCopyEditor form or an inline EditableCopy
// on the live page itself — lands in every open t() consumer, including a "View live" tab someone
// left open, without a manual reload. Falls back to defaults if Supabase isn't configured.
//
// ONE COPY OF THE WORDS FOR EVERY SCREEN (R13 — the 10/10 audit's performance pass, F5): the nav, the drink sheet, the
// splash and the page each read site_copy for themselves and kept a channel of their own — four reads and four channels
// on a guest's first /menu. One store now (lib/shared): one read, one channel, the same words everywhere. A failed read
// keeps the words already here (the defaults, before any read has landed).
const siteCopy = sharedStore<Record<string, string>>({
  initial: {},
  tables: () => "site_copy",
  read: async () => {
    if (!supabase) return undefined;
    const { data } = await supabase.from("site_copy").select("key, value");
    return data ? Object.fromEntries((data as { key: string; value: string }[]).map((r) => [r.key, r.value])) : undefined;
  },
  equal: sameJson,
});
export function useSiteCopy(): (key: string) => string {
  const over = siteCopy.use("all");
  return useCallback((key: string) => over[key] ?? COPY_DEFAULTS[key] ?? "", [over]);
}

// Shared write path for BOTH copy editors (SiteCopyEditor's form, EditableCopy's inline popover) —
// one place that knows the site_copy row shape, so the two UIs can't drift into saving slightly
// different things. save() rejects empty values (Reset is the intended way back to the default,
// not an empty override that'd show blank copy on the live site).
export async function saveCopy(key: string, value: string, userId?: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const trimmed = value.trim();
  if (!trimmed) return { error: "Copy can't be empty — use Reset to go back to the default" };
  const { error } = await supabase.from("site_copy").upsert({ key, value: trimmed, updated_by: userId ?? null, updated_at: new Date().toISOString() });
  if (!error) void siteCopy.reload("all");   // every screen showing it, at once — realtime says it again a moment later
  return error ? { error: error.message } : {};
}
export async function resetCopy(key: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.from("site_copy").delete().eq("key", key);
  if (!error) void siteCopy.reload("all");
  return error ? { error: error.message } : {};
}
