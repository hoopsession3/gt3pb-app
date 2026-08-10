"use client";

import { useCallback, useState } from "react";
import { supabase } from "./supabase";
import { useRealtimeTable } from "./realtime";
import { DRINKS, MENU, type DrinkId } from "./menu";

// SITE COPY — owner/admin-editable front-end text. Every editable string has a stable key and a
// DEFAULT (the canonical copy). Overrides live in the `site_copy` table (0122); the front-end reads
// default-or-override, so the site never shows a blank and always works even before anything is
// edited. Add a new editable string = add one entry here and render it with useSiteCopy()'s t(key).
export type CopyMeta = { key: string; group: string; label: string; multiline?: boolean; default: string };

export const COPY_META: CopyMeta[] = [
  // ── Team board · back-office (the crew console) ──
  { key: "board.welcome", group: "Team board", label: "Crew welcome line", multiline: true,
    default: "Precision in every pour — let's make today one worth remembering." },
  // ── Home · signed-out (Arrival) ──
  // 2026-07-16: home.statement / home.principles / home.cta are currently DEAD — no component
  // reads them (confirmed by search; StorefrontStory.tsx, the actual guest arrival block on
  // /reserve and /delivery, uses reserve.order_bar for its button and has no hero-statement or
  // principles-line slot at all). Editing these three does nothing visible. Left in place rather
  // than deleted since they read like an intended arrival hero that never got wired up — flagging
  // here instead of silently dropping them; wiring them up or removing them is a real product call.
  { key: "home.statement", group: "Home · signed-out", label: "Hero statement", multiline: true,
    default: "We draw the coffee cold, blend the hydration from whole coconut, and simmer the broth slow — the long way, on purpose — then make every cup the moment you order it." },
  { key: "home.principles", group: "Home · signed-out", label: "Principles line",
    default: "Drawn cold, made to order, poured into glass" },
  { key: "home.cta", group: "Home · signed-out", label: "Primary button",
    default: "Start your order" },
  { key: "home.cta_sub", group: "Home · signed-out", label: "Button subtext", multiline: true,
    default: "Choose what you'd like and we'll have it waiting at the window." },
  { key: "home.signoff", group: "Home · signed-out", label: "Sign-off",
    default: "Pure Signal, No Noise." },
  // ── Member card (the status card popout) ──
  { key: "card.founding_thanks", group: "Member card", label: "Founding-member thank-you banner", multiline: true,
    default: "✦ Thank you for being a Founding Member — you were here first." },
  // ── Our Craft page (/craft) — every line editable. Ingredient blocks: one per line, "Name — fact". ──
  { key: "craft.eye", group: "Craft page", label: "Eyebrow", default: "Our Craft · The How" },
  { key: "craft.h1_l1", group: "Craft page", label: "Headline line 1", default: "We practice" },
  { key: "craft.h1_em1", group: "Craft page", label: "Headline emphasis 1", default: "art." },
  { key: "craft.h1_l2", group: "Craft page", label: "Headline line 2", default: "And" },
  { key: "craft.h1_em2", group: "Craft page", label: "Headline emphasis 2", default: "chemistry." },
  { key: "craft.lede", group: "Craft page", label: "Lede", multiline: true,
    default: "Every drink on our menu is built from whole, recognizable food — chosen on purpose, for what it does for you. Coffee to switch on, coconut and minerals to carry you, slow-simmered broth to rebuild. We treat each one as a craft, because your body runs on what you give it — and it deserves the good stuff." },
  { key: "craft.mol_cap", group: "Craft page", label: "Molecule caption", default: "Caffeine · three methyls, three 3s" },
  { key: "craft.fuel", group: "Craft page", label: "Philosophy band", multiline: true,
    default: "Your body is built to run on real, whole food — the way a well-made engine runs best on the right fuel. So we don't hedge: here's exactly what's in the cup, and what it does for you." },
  // Pillar 1 — Activation
  { key: "craft.act_label", group: "Craft page", label: "Activation — label", default: "01 · Activation" },
  { key: "craft.act_title", group: "Craft page", label: "Activation — title", default: "Switch on — clean." },
  { key: "craft.act_intro", group: "Craft page", label: "Activation — intro", multiline: true,
    default: "Cold-extracted coffee, drawn slow in cool water so it's smoother and less bitter — a steady, even lift, without the sugar-crash, because there's no refined sugar or syrup in it." },
  { key: "craft.act_items", group: "Craft page", label: "Activation — ingredients (one per line, Name — fact)", multiline: true,
    default: "Cold-extracted coffee — Steeped slow and cold for a smoother cup and an even lift. Caffeine is a well-studied stimulant — real energy, nothing artificial to process.\nOrganic cacao nibs · FLOW — Whole chocolate: theobromine (caffeine's gentler, longer-acting cousin) plus magnesium and cocoa flavanols, for a smoother, steadier focus.\nCeylon cinnamon + cardamom · DUSK — True cinnamon, naturally low in coumarin, with aromatic cardamom — warmth and depth, no sweetener needed.\nA2 goat milk, maple & sea salt · SALTED MAPLE LATTE — Naturally-A2 goat milk (many find it easier to digest), real maple for trace minerals like manganese, a pinch of sea salt. An afternoon treat that still eats clean.\nNitrogen · KING ME — Nothing but gas: micro-bubbles for a velvety, creamy pour — no dairy, no sugar." },
  // Pillar 2 — Hydration
  { key: "craft.hyd_label", group: "Craft page", label: "Hydration — label", default: "02 · Hydration" },
  { key: "craft.hyd_title", group: "Craft page", label: "Hydration — title", default: "Carry it through." },
  { key: "craft.hyd_intro", group: "Craft page", label: "Hydration — intro", multiline: true,
    default: "Real hydration is more than water — it's the minerals that carry it into you. We pour whole-food electrolytes: no powders, no dyes, no concentrate." },
  { key: "craft.hyd_items", group: "Craft page", label: "Hydration — ingredients (one per line, Name — fact)", multiline: true,
    default: "Organic coconut water — Naturally rich in potassium — the electrolyte most people run short on — plus sodium and magnesium. A whole-food electrolyte source.\nYoung Thai coconut meat + local honey · TIDE — Blended to order for real hydration that goes down easy, with a touch of unrefined honey.\nSea salt — Sodium, the body's primary electrolyte for fluid balance — the reason a little salt helps you actually hold your water.\nMineral water base — We build on mineral water, not stripped water, so there's substance behind every pour." },
  // Pillar 3 — Rebuild / Fuel
  { key: "craft.reb_label", group: "Craft page", label: "Rebuild — label", default: "03 · Rebuild / Fuel" },
  { key: "craft.reb_title", group: "Craft page", label: "Rebuild — title", default: "Rebuild after." },
  { key: "craft.reb_intro", group: "Craft page", label: "Rebuild — intro", multiline: true,
    default: "When you've spent yourself, you rebuild with real material — collagen, amino acids and minerals drawn out of bones over hours. No bouillon, no filler, no powder." },
  { key: "craft.reb_items", group: "Craft page", label: "Rebuild — ingredients (one per line, Name — fact)", multiline: true,
    default: "Slow-simmered bone broth · FORGE · HUNT · WILD — Bones and connective tissue simmered for hours into collagen, amino acids like glycine and proline, and minerals — a savory, whole-food source of protein, often ~8–10g a cup.\nPasture-raised beef, bison & ostrich — Cleaner sources, each with a profile: bison leaner with a little more iron and zinc, ostrich lighter still." },
  // The mark + close
  { key: "craft.mark_label", group: "Craft page", label: "The Mark — label", default: "04 · The Mark" },
  { key: "craft.mark_title", group: "Craft page", label: "The Mark — title", default: "Three methyls. Three 3s. GT3." },
  { key: "craft.mark_body", group: "Craft page", label: "The Mark — body", multiline: true,
    default: "Caffeine is one elegant molecule — a purine ring with three methyl groups at its nearest points. Three 3s, written into the chemistry itself. We didn't invent the coincidence; it's the structure. It's on the shirt. It's on the truck. It's the bar. Art meets chemistry, and they were the same thing all along." },
  { key: "craft.close_line", group: "Craft page", label: "Close line", default: "Perfectly design-crafted." },
  { key: "craft.cta_menu", group: "Craft page", label: "CTA — menu", default: "See the menu →" },
  { key: "craft.cta_reserve", group: "Craft page", label: "CTA — reserve", default: "Reserve a drop" },
  { key: "craft.signoff", group: "Craft page", label: "Sign-off", default: "Pure Signal, No Noise." },
  // ── Home · signed-in (Today) ──
  { key: "home.questions", group: "Home · signed-in", label: "Stack-builder intro", multiline: true,
    default: "Five questions and I'll build your stack for the day." },
  { key: "home.dialed_title", group: "Home · signed-in", label: "Stack section — title", default: "Dialed For Today" },
  { key: "home.dialed_sub", group: "Home · signed-in", label: "Stack section — subtitle", default: "your stack, built" },
  // ── Loyalty card (Today home) · the tap-to-open stamp card ── Settings-only, not inline-click-
  // editable: the whole card is ONE tap target (clickable() in lib/a11y — role="button" on the
  // outer <section>, opens the member's status card), so wrapping any of this text in EditableCopy
  // would nest a second interactive control inside that button — the nested-interactive-element
  // problem excluded elsewhere (Craft's CTAs, the truck route rows), except here it's the WHOLE
  // card, not one row, so there's no safe sibling spot to lift text out to either (contrast
  // truck.stop_note, which sits in a detail panel outside its row's button). Reachable only via the
  // Edit pill added to the Today masthead — see app/page.tsx.
  { key: "stamp.kicker", group: "Loyalty card", label: "Small label, top-left of the card", default: "Your card" },
  { key: "stamp.badge_full", group: "Loyalty card", label: "Top-right badge — card just completed", default: "Card full" },
  { key: "stamp.badge_earned_one", group: "Loyalty card", label: "Top-right badge — exactly 1 free drink earned so far (uses {count})", default: "{count} free drink earned" },
  { key: "stamp.badge_earned_other", group: "Loyalty card", label: "Top-right badge — 2+ free drinks earned so far (uses {count})", default: "{count} free drinks earned" },
  { key: "stamp.badge_default", group: "Loyalty card", label: "Top-right badge — no free drinks earned yet", default: "10th is on us" },
  { key: "stamp.foot_full", group: "Loyalty card", label: "Footer line — card just completed", default: "Your 10th is on us — mention it at the window." },
  { key: "stamp.foot_near", group: "Loyalty card", label: "Footer line — 1-2 stamps from a free drink (uses {count})", default: "So close — just {count} more till a free cup." },
  { key: "stamp.foot_progress", group: "Loyalty card", label: "Footer line — default progress, 3+ stamps to go (uses {count})", default: "{count} more drinks till your next free one." },
  { key: "stamp.open_cta", group: "Loyalty card", label: "Footer, right side — opens the member card", default: "Open your card ›" },
  // ── Home · the three pillars (signed-out "What We Make") ──
  { key: "home.pillar1_t", group: "Home · pillars", label: "Pillar 1 — title", default: "Activation" },
  { key: "home.pillar1_d", group: "Home · pillars", label: "Pillar 1 — line", default: "Cold-extracted coffee to start the day clear." },
  { key: "home.pillar2_t", group: "Home · pillars", label: "Pillar 2 — title", default: "Hydration" },
  { key: "home.pillar2_d", group: "Home · pillars", label: "Pillar 2 — line", default: "Whole-coconut water to carry you through it." },
  { key: "home.pillar3_t", group: "Home · pillars", label: "Pillar 3 — title", default: "Fuel" },
  { key: "home.pillar3_d", group: "Home · pillars", label: "Pillar 3 — line", default: "Slow-simmered broth to rebuild after." },
  // ── Reserve card on the home screen ──
  { key: "pitch.kicker", group: "Reserve card", label: "Kicker", default: "Order Ahead" },
  { key: "pitch.headline", group: "Reserve card", label: "Headline", default: "The bottles you love, brewed to order." },
  { key: "pitch.body", group: "Reserve card", label: "Body", multiline: true,
    default: "Reserve a Saturday drop — ready the moment you reach the window. No plan, no commitment." },
  { key: "pitch.cta", group: "Reserve card", label: "Button", default: "Reserve the next drop" },
  { key: "pitch.fine", group: "Reserve card", label: "Fine print", multiline: true,
    default: "Order ahead · pickup at the truck · bring bottles back for the best price." },
  // ── Reserve flow (order-ahead). {cutoff}/{pickup}/{size} are filled in live. ──
  // 2026-07-17: this whole group used to have no render site anywhere in the app — see round o's
  // delivery notes. Now wired into app/reserve/page.tsx + OrderFunnel.tsx. Three of these (kicker,
  // cutoff, confirm_return/confirm_new) turned out to already be live as hand-typed duplicates
  // elsewhere in OrderFunnel.tsx — their defaults below were updated to match that live wording
  // exactly, so wiring them up didn't silently change anything a customer sees. headline and window
  // had no live equivalent at all — genuinely new copy, added in round p.
  { key: "reserve.kicker", group: "Reserve flow", label: "Kicker", default: "Order ahead" },
  { key: "reserve.headline", group: "Reserve flow", label: "Headline", multiline: true, default: "Tell us you're coming, we'll brew it to order." },
  { key: "reserve.cutoff", group: "Reserve flow", label: "Cutoff line (uses {cutoff} and {pickup}; pickup mode only — delivery has its own line)", default: "Drop closes {cutoff} · pickup {pickup}" },
  { key: "reserve.fresh", group: "Reserve flow", label: "Fresh line", multiline: true, default: "Cold-extracted Rise, Flow & Dusk — smooth, low-acid bottles for your week. Reserve now, grab them at the truck." },
  { key: "reserve.window", group: "Reserve flow", label: "Footer / walk-up prices", multiline: true, default: "No commitment, no plan — just this drop.\nAt the window: $10 new · $8 bring-back · single bottle $10" },
  { key: "reserve.confirm_return", group: "Reserve flow", label: "Confirmation — bringing bottles back (uses {size})", multiline: true, default: "Don't forget your empties — rinse and bring all {size}; that's what your pack price is built on. Fresh 7 days from pickup." },
  { key: "reserve.confirm_new", group: "Reserve flow", label: "Confirmation — new glass", multiline: true, default: "Bottles are yours to keep — or bring them back next drop and unlock pack pricing. Fresh 7 days from pickup." },
  // ── Menu header ──
  { key: "menu.statement", group: "Menu", label: "Menu statement", multiline: true,
    default: "Drawn cold, simmered slow, blended from whole ingredients — every cup made the moment you order." },
  { key: "menu.order_line", group: "Menu", label: "Order prompt",
    default: "Order here, and it'll be waiting when you reach the window." },
  // 2026-07-27: system-design pass on where to teach the "why" behind the menu (Ryan asked for a
  // strategic placement audit, not just "put it on Menu") — this is placement #1 of 4. Menu's own
  // categories (Activation/Hydration/…, lib/menu.ts MENU) already ARE Craft's three pillars; this
  // just tells the customer that connection exists. Plain text inside a <button> — same nested-
  // interactive rule as craft.cta_menu/cta_reserve, not inline-click-editable.
  { key: "menu.craft_link", group: "Menu", label: "Craft-page teaser button (sits above the category chips)",
    default: "Grouped by what your body needs — see the full chemistry" },
  // ── Reserve (the signed-out storefront's story page) ──
  { key: "reserve.order_bar", group: "Reserve", label: "Order-from-the-bar button",
    default: "Order from the bar" },
  { key: "menu.integrity", group: "Menu", label: "Integrity line",
    default: "Everything real, poured into glass, made the moment you order" },
  { key: "menu.mto", group: "Menu", label: "Made-to-order line",
    default: "Made to order" },
  { key: "menu.packs_title", group: "Menu", label: "Packs — section title",
    default: "Take it home" },
  { key: "menu.packs_sub", group: "Menu", label: "Packs — section subtitle",
    default: "Saturday packs" },
  { key: "menu.packs_note", group: "Menu", label: "Packs — bring-back note", multiline: true,
    default: "Bring your empties back for pack pricing — or take new glass at $10 a bottle. You choose when you reserve." },
  // Drink sheet, truck-closed state: replaces the old hardcoded "Packs are brewed to order
  // anytime" (2026-07-17 — false: order-ahead has a real cutoff, lib/orderAhead's dropForStop/
  // nextDrop). {cutoff}/{pickup} are filled in live via fillCopy() below — see DrinkSheet.tsx.
  { key: "menu.packs_cutoff", group: "Menu", label: "Packs line when the truck's closed (uses {cutoff} and {pickup})", multiline: true,
    default: "Packs are brewed to order — reserve by {cutoff} for pickup {pickup}." },
  // ── Truck page · the "what's on board" tagline per stop (keyed by the stop's menu tier) ──
  { key: "truck.tier.full", group: "Truck", label: "Tagline — full bar", default: "Full bar on board" },
  { key: "truck.tier.coffee", group: "Truck", label: "Tagline — coffee bar", default: "Coffee bar" },
  { key: "truck.tier.nitro", group: "Truck", label: "Tagline — nitro bar", default: "Nitro bar" },
  { key: "truck.tier.beer", group: "Truck", label: "Tagline — beer & wine", default: "Beer & wine on board" },
  // Dynamic override, not tied to a specific tier: shown instead of whichever tier tagline above
  // would otherwise apply, when live 86 data says most/all of today's active menu is sold out (see
  // FindUs.tsx's descFor) — the truck effectively has nothing to sell, so claiming "full bar on
  // board" would overclaim. A couple of 86'd items doesn't trigger this; near-empty does.
  { key: "truck.tier.limited", group: "Truck", label: "Tagline — most/all items 86'd today", default: "Limited menu today" },
  { key: "truck.stop_note", group: "Truck", label: "Route row — note when a stop has none", multiline: true,
    default: "Full bar on board. Order ahead or save a reminder." },
  // 2026-07-27: placement #3 of the craft-education audit — Find Us is the guest's real "home"
  // (/ redirects here for anyone signed out), but its one job is "where/when," so this stays a
  // single quiet line at the very bottom, not a pitch. Plain text inside a <button>, same
  // nested-interactive rule as "Book the bar for your event" just above it.
  { key: "truck.craft_link", group: "Truck", label: "Craft-page teaser button (sits above the closing beat)",
    default: "What's really in the cup — and why" },
  // ── Shop (/shop) — the merch storefront. Adoption pass 2026-08-10. ──
  { key: "shop.eyebrow", group: "Shop", label: "Masthead eyebrow", default: "The Shop" },
  { key: "shop.tagline", group: "Shop", label: "Storefront tagline", multiline: true,
    default: "Wear the standard. Printed on demand, shipped to you — the same no-shortcuts ethos as the cup." },
  { key: "shop.empty", group: "Shop", label: "Empty state — no products yet",
    default: "New drops are on the way — check back soon." },
  { key: "shop.done_title", group: "Shop", label: "Order-placed — headline", default: "Order" },
  { key: "shop.done_title_em", group: "Shop", label: "Order-placed — headline emphasis", default: "in" },
  { key: "shop.done_lede", group: "Shop", label: "Order-placed — confirmation lede", multiline: true,
    default: "Thanks — we’ve got it. You’ll get an email now, and tracking the moment it ships." },
  { key: "shop.keep", group: "Shop", label: "Order-placed — keep-shopping button", default: "Keep shopping" },
  // ── Primal academy (/primal) — Return to Primal index. ──
  { key: "primal.eyebrow", group: "Primal", label: "Masthead eyebrow", default: "Return to Primal" },
  { key: "primal.hero_eye", group: "Primal", label: "Hero eyebrow", default: "The nutrition system" },
  { key: "primal.hero_h1", group: "Primal", label: "Hero headline", default: "Return to" },
  { key: "primal.hero_h1_em", group: "Primal", label: "Hero headline emphasis", default: "Primal" },
  { key: "primal.hero_lede", group: "Primal", label: "Hero lede", multiline: true,
    default: "Real fuel, explained simply. Five pillars, quick to reference, free to start — and every lesson ends in a stack you can actually order. Educational, never medical." },
  { key: "primal.empty", group: "Primal", label: "Empty state — no lessons yet", multiline: true,
    default: "The academy is being written. Check back soon — the first lessons drop this week." },
  { key: "primal.cta_eye", group: "Primal", label: "Go-deeper block — label", default: "Go deeper" },
  { key: "primal.cta_body", group: "Primal", label: "Go-deeper block — body", multiline: true,
    default: "The full Return to Primal system — every pillar, the Pro modules, and your personal protocol — is coming to a membership. Rookie stays free, always." },
  { key: "primal.cta_link", group: "Primal", label: "Go-deeper block — button", default: "Start with a stack ›" },
  // ── Primal lesson (/primal/l/…) — locked state + the meal-stack rail. ──
  { key: "primal.locked_h1", group: "Primal", label: "Locked lesson — headline", default: "This one’s" },
  { key: "primal.locked_h1_em", group: "Primal", label: "Locked lesson — headline emphasis", default: "Pro" },
  { key: "primal.locked_lede", group: "Primal", label: "Locked lesson — lede", multiline: true,
    default: "This lesson is part of the Pro program, or the link has moved. Rookie lessons are always free — start there, or unlock the full system." },
  { key: "primal.stack_eye", group: "Primal", label: "Lesson stack — label", default: "Your stack" },
  { key: "primal.stack_title", group: "Primal", label: "Lesson stack — title", default: "Order what you just learned" },
  { key: "primal.stack_lede", group: "Primal", label: "Lesson stack — lede", multiline: true,
    default: "The drinks that put this lesson to work — in the order they fit your day." },
  // ── Find Us (/, /truck, /events) — the public front door. This group is distinct from the
  //    "Truck" group above (dynamic tier taglines etc.), which also renders on this page. ──
  { key: "findus.eyebrow_live", group: "Find Us", label: "Masthead eyebrow — truck is live", default: "Live now" },
  { key: "findus.eyebrow_event", group: "Find Us", label: "Masthead eyebrow — next up is an event", default: "Next event" },
  { key: "findus.eyebrow_stop", group: "Find Us", label: "Masthead eyebrow — next up is a stop", default: "Next stop" },
  { key: "findus.no_stops", group: "Find Us", label: "Headline — nothing on the schedule", default: "No stops yet" },
  { key: "findus.cta_preorder", group: "Find Us", label: "Primary CTA — pre-order (inside a button)", default: "PRE-ORDER · SKIP THE LINE" },
  { key: "findus.cta_closed", group: "Find Us", label: "Primary CTA — after online ordering closes", multiline: true,
    default: "Online ordering’s closed for today — come see us at the bar before we pack up." },
  { key: "findus.road_title", group: "Find Us", label: "On The Road — section title", default: "On The Road" },
  { key: "findus.road_note", group: "Find Us", label: "On The Road — annotation", default: "stops & events, in order" },
  { key: "findus.road_empty_title", group: "Find Us", label: "On The Road — empty title", default: "Nothing scheduled yet" },
  { key: "findus.road_empty_sub", group: "Find Us", label: "On The Road — empty subtitle", multiline: true,
    default: "This week’s stops and events post here — check back soon." },
  { key: "findus.circuit_title", group: "Find Us", label: "The Circuit — section title", default: "The Circuit" },
  { key: "findus.circuit_note", group: "Find Us", label: "The Circuit — annotation", default: "tap a stop for directions" },
  { key: "findus.byo_title", group: "Find Us", label: "Bring Us To You — section title", default: "Bring Us To You" },
  { key: "findus.byo_note", group: "Find Us", label: "Bring Us To You — annotation", default: "private events" },
  { key: "findus.byo_pitch", group: "Find Us", label: "Bring Us To You — pitch line", multiline: true,
    default: "Pours, run clubs, launches — we set up anywhere." },
  // ── Book (/book) — the "book the bar" B2B intake. No wiring before this pass. ──
  { key: "book.eyebrow", group: "Book", label: "Masthead eyebrow", default: "Book the bar" },
  { key: "book.eye", group: "Book", label: "Form — eyebrow", default: "Bring GT3PB to your event" },
  { key: "book.title", group: "Book", label: "Form — headline", default: "Book the bar." },
  { key: "book.lede", group: "Book", label: "Form — lede", multiline: true,
    default: "Offsites, run clubs, launches, weddings. We bring the full bar and pour on site. Tell us the basics — we take it from there." },
  { key: "book.done_eye", group: "Book", label: "Success card — eyebrow", default: "Request received" },
  { key: "book.done_title", group: "Book", label: "Success card — headline", default: "We're on it." },
  { key: "book.done_thanks", group: "Book", label: "Success card — thanks line (uses {name})", multiline: true,
    default: "Thanks, {name}. We'll reach out within a day to lock your date and the details." },
  // Book form — field labels + placeholders + SMS consent (adoption pass 2026-08-10). Labels render as
  // plain t() (htmlFor association), so they're editable via Settings rather than inline.
  { key: "book.f_name", group: "Book", label: "Field label — name", default: "Name" },
  { key: "book.ph_name", group: "Book", label: "Placeholder — name", default: "Your name" },
  { key: "book.f_email", group: "Book", label: "Field label — email", default: "Email" },
  { key: "book.ph_email", group: "Book", label: "Placeholder — email", default: "you@email.com" },
  { key: "book.f_phone", group: "Book", label: "Field label — phone", default: "Phone" },
  { key: "book.ph_phone", group: "Book", label: "Placeholder — phone", default: "For a quick call if email doesn't land" },
  { key: "book.consent", group: "Book", label: "SMS consent line", multiline: true,
    default: "Adding your number means GT3 may text you about this request — event texts only, never marketing. Reply STOP anytime." },
  { key: "book.f_date", group: "Book", label: "Field label — event date", default: "Event date" },
  { key: "book.f_headcount", group: "Book", label: "Field label — headcount", default: "Headcount" },
  { key: "book.ph_headcount", group: "Book", label: "Placeholder — headcount", default: "50" },
  { key: "book.f_location", group: "Book", label: "Field label — location", default: "Location" },
  { key: "book.ph_location", group: "Book", label: "Placeholder — location", default: "Your address, venue, or city" },
  { key: "book.f_notes", group: "Book", label: "Field label — notes", default: "Anything else" },
  { key: "book.ph_notes", group: "Book", label: "Placeholder — notes", default: "Vibe, timing, must-haves…" },
  { key: "book.submit", group: "Book", label: "Submit button", default: "Send request" },
  // ── 3MPIRE (/3mpire) — the referral card hero. ──
  { key: "mpire.ref_eye", group: "3MPIRE", label: "Referral card — eyebrow", default: "Grow The 3MPIRE" },
  { key: "mpire.ref_title", group: "3MPIRE", label: "Referral card — headline", default: "Give $5, get $5." },
  { key: "mpire.ref_body", group: "3MPIRE", label: "Referral card — body", multiline: true,
    default: "When a friend joins with your code and makes their first order, you each get $5 credit." },
  // ── Masthead eyebrows (context labels) on pages otherwise covered by their own groups above.
  //    Keys carry a masthead.* prefix but sit in each page's natural group so "View live →" lands
  //    on the exact page. (Shop/Primal/Book/3MPIRE eyebrows live in those groups above.) ──
  { key: "masthead.today", group: "Home · signed-in", label: "Masthead eyebrow (Today)", default: "Today" },
  { key: "masthead.menu", group: "Menu", label: "Masthead eyebrow (The Menu)", default: "The Menu" },
  { key: "masthead.delivery", group: "Delivery", label: "Masthead eyebrow (Order ahead)", default: "Order ahead" },
  // ── Find Us · fact rail + chrome (adoption pass 2026-08-10). The fact LABELS (Where/Day/…) and
  //    the honest fallbacks ("Location TBA"/"Soon"). The third fact label is dynamically selected
  //    (Starts/Hours/Open) so it renders as plain t(), not inline — see FindUs.tsx. ──
  { key: "findus.fact_where", group: "Find Us", label: "Fact label — Where", default: "Where" },
  { key: "findus.fact_day", group: "Find Us", label: "Fact label — Day", default: "Day" },
  { key: "findus.fact_starts", group: "Find Us", label: "Fact label — Starts (events)", default: "Starts" },
  { key: "findus.fact_hours", group: "Find Us", label: "Fact label — Hours (stop with a close time)", default: "Hours" },
  { key: "findus.fact_open", group: "Find Us", label: "Fact label — Open (stop, no close time)", default: "Open" },
  { key: "findus.fact_going", group: "Find Us", label: "Fact label — Going (events)", default: "Going" },
  { key: "findus.loc_tba", group: "Find Us", label: "Where value — no location set yet", default: "Location TBA" },
  { key: "findus.day_tba", group: "Find Us", label: "Day value — no date yet", default: "Soon" },
  { key: "findus.directions", group: "Find Us", label: "Directions chip (also on event rows)", default: "Get directions" },
  { key: "findus.preorder", group: "Find Us", label: "Live-stop row — pre-order chip", default: "Pre-order" },
  { key: "findus.past_events", group: "Find Us", label: "Past-events fold label", default: "Past events" },
  { key: "findus.book_cta", group: "Find Us", label: "Book-the-bar button", default: "Book the bar for your event" },
  { key: "findus.ping_off", group: "Find Us", label: "Live-ping opt-in — off", default: "Ping me when the truck goes live" },
  { key: "findus.ping_on", group: "Find Us", label: "Live-ping opt-in — on", default: "You're on the list — we'll ping you when we're live" },
  // ── Drink sheet (the popout over /menu). Pillar tag + section labels + chrome CTAs. The per-drink
  //    d.has/d.no ingredient lists stay in the menu data (lib/menu.ts), not here. ──
  { key: "sheet.pillar_before", group: "Menu", label: "Drink sheet — Activation pillar tag", default: "Activation · Before the work" },
  { key: "sheet.pillar_during", group: "Menu", label: "Drink sheet — Hydration pillar tag", default: "Hydration · During the work" },
  { key: "sheet.pillar_after", group: "Menu", label: "Drink sheet — Fuel pillar tag", default: "Fuel · After the work" },
  { key: "sheet.in_bottle", group: "Menu", label: "Drink sheet — 'In the bottle' section", default: "In the bottle" },
  { key: "sheet.never", group: "Menu", label: "Drink sheet — 'Never' section", default: "Never" },
  { key: "sheet.when_label", group: "Menu", label: "Drink sheet — When label", default: "When" },
  { key: "sheet.add", group: "Menu", label: "Drink sheet — add button", default: "Add to order" },
  { key: "sheet.remove", group: "Menu", label: "Drink sheet — remove button", default: "Remove from order" },
  { key: "sheet.soldout", group: "Menu", label: "Drink sheet — sold-out button", default: "Sold out today" },
  { key: "sheet.closed_cta", group: "Menu", label: "Drink sheet — truck-closed reserve button", default: "Truck's closed — reserve a pack ›" },
  { key: "sheet.made_moment", group: "Menu", label: "Drink sheet — made-to-order sign-off", default: "Made the moment you order, and you'll taste it." },
  // ── Menu page — nav buttons, tap hint, sold-out badge, reserve link (adoption pass 2026-08-10). ──
  { key: "menu.nav_primal", group: "Menu", label: "Nav button — Return to Primal", default: "Return to Primal" },
  { key: "menu.nav_shop", group: "Menu", label: "Nav button — Shop", default: "Shop" },
  { key: "menu.taphint", group: "Menu", label: "Tap hint under the chips", default: "tap any drink to order it" },
  { key: "menu.sold_out", group: "Menu", label: "Menu row — sold-out badge", default: "SOLD OUT" },
  { key: "menu.reserve_pack", group: "Menu", label: "Packs — reserve link", default: "Reserve your pack ›" },
  // ── Shop — product detail + cart chrome (adoption pass 2026-08-10). ──
  { key: "shop.back", group: "Shop", label: "Back-to-grid button", default: "Shop" },
  { key: "shop.options", group: "Shop", label: "Product — variant select label", default: "Options" },
  { key: "shop.add_cart", group: "Shop", label: "Product — add-to-cart button (price appended live)", default: "Add to cart" },
  // ── Checkout (/shop) — the shipping + payment form (adoption pass 2026-08-10). ──
  { key: "checkout.title", group: "Checkout", label: "Checkout heading (also the cart bar CTA)", default: "Checkout" },
  { key: "checkout.total", group: "Checkout", label: "Order total label", default: "Total" },
  { key: "checkout.ship_to", group: "Checkout", label: "Shipping section label", default: "Ship to" },
  { key: "checkout.ph_name", group: "Checkout", label: "Placeholder — full name", default: "Full name" },
  { key: "checkout.ph_street", group: "Checkout", label: "Placeholder — street", default: "Street address" },
  { key: "checkout.ph_city", group: "Checkout", label: "Placeholder — city", default: "City" },
  { key: "checkout.ph_state", group: "Checkout", label: "Placeholder — state", default: "State" },
  { key: "checkout.ph_zip", group: "Checkout", label: "Placeholder — ZIP", default: "ZIP" },
  { key: "checkout.ph_email", group: "Checkout", label: "Placeholder — email (guests)", default: "Email (for your receipt + tracking)" },
  { key: "checkout.payment", group: "Checkout", label: "Payment section label", default: "Payment" },
  { key: "checkout.pay", group: "Checkout", label: "Pay button (uses {total})", default: "Pay {total}" },
  { key: "checkout.fine", group: "Checkout", label: "Print-on-demand fine print", multiline: true,
    default: "Printed on demand and shipped to you. You’ll get tracking by email when it ships." },
  { key: "checkout.off", group: "Checkout", label: "Card checkout not configured note", default: "Card checkout isn’t switched on yet." },
  // ── Order funnel — pickup + shared steps (renders on /reserve; delivery-only lines live in the
  //    Delivery group so 'View live →' lands on the page each actually renders). ──
  { key: "funnel.toggle_pickup", group: "Reserve flow", label: "Mode toggle — Pickup", default: "Pickup" },
  { key: "funnel.toggle_pickup_sub", group: "Reserve flow", label: "Mode toggle — Pickup sub", default: "Grab it at a truck stop" },
  { key: "funnel.toggle_delivery", group: "Reserve flow", label: "Mode toggle — Delivery", default: "Delivery" },
  { key: "funnel.toggle_delivery_sub", group: "Reserve flow", label: "Mode toggle — Delivery sub", default: "Prepaid, to your door" },
  { key: "funnel.size_h_pickup_multi", group: "Reserve flow", label: "Size step — headline (multiple pickup days)", default: "Pick a day and a size." },
  { key: "funnel.size_h_pickup", group: "Reserve flow", label: "Size step — headline (single day, uses {day})", default: "Pick a size for {day}." },
  { key: "funnel.pricemode_pickup_back", group: "Reserve flow", label: "Size step — price mode, bring-back", default: "Prices with bring-back empties — need new glass? It’s $10 a bottle, picked at the next step." },
  { key: "funnel.pricemode_pickup_new", group: "Reserve flow", label: "Size step — price mode, new glass", default: "New-glass prices — bring your empties back next drop and pay less." },
  { key: "funnel.pickup_day_label", group: "Reserve flow", label: "Size step — pickup-day picker label", default: "Pickup day — your call" },
  { key: "funnel.how_many", group: "Reserve flow", label: "Size step — bottle-count label", default: "How many bottles" },
  { key: "funnel.bottles_unit", group: "Reserve flow", label: "Size tile — unit label", default: "BOTTLES" },
  { key: "funnel.build_cta", group: "Reserve flow", label: "Size step — advance button", default: "Build your pack" },
  { key: "funnel.build_h", group: "Reserve flow", label: "Build step — headline", default: "Build your pack." },
  { key: "funnel.build_sub", group: "Reserve flow", label: "Build step — intro (live count follows)", default: "Rise, Flow, Dusk — mix as you go." },
  { key: "funnel.build_next", group: "Reserve flow", label: "Build step — advance button (full)", default: "Your bottles" },
  { key: "funnel.build_more", group: "Reserve flow", label: "Build step — advance button (uses {n})", default: "Pick {n} more" },
  { key: "funnel.glass_h", group: "Reserve flow", label: "Glass step — headline", default: "Your bottles." },
  { key: "funnel.glass_back_title", group: "Reserve flow", label: "Glass step — bring-back card title (both modes)", default: "Bringing mine back — best price" },
  { key: "funnel.glass_back_pickup_sub", group: "Reserve flow", label: "Glass step — bring-back card body, pickup (uses {price})", default: "Pack pricing. Rinse your empties and bring them Saturday. {price}/bottle." },
  { key: "funnel.glass_new_pickup_title", group: "Reserve flow", label: "Glass step — new-glass card title, pickup", default: "Need new glass" },
  { key: "funnel.glass_new_pickup_sub", group: "Reserve flow", label: "Glass step — new-glass card body, pickup (uses {price})", default: "New sealed bottle, {price}/bottle flat. Bring them back next time to unlock pack pricing." },
  { key: "funnel.glass_next_pickup", group: "Reserve flow", label: "Glass step — advance button, pickup", default: "Who's it for?" },
  { key: "funnel.details_h_pickup", group: "Reserve flow", label: "Details step — headline, pickup", default: "Who's this drop for?" },
  { key: "funnel.signin_prompt", group: "Reserve flow", label: "Details step — signed-out prompt", default: "Sign in so your order is yours to track and manage." },
  { key: "funnel.f_name", group: "Reserve flow", label: "Details — name placeholder (both modes)", default: "Name" },
  { key: "funnel.f_phone_pickup", group: "Reserve flow", label: "Details — phone placeholder, pickup", default: "Phone (for pickup-day text)" },
  { key: "funnel.tel_consent", group: "Reserve flow", label: "Details — SMS consent line (both modes)", multiline: true, default: "Your number gets order texts from GT3 only — never marketing. Reply STOP anytime." },
  { key: "funnel.details_pay", group: "Reserve flow", label: "Details — advance-to-payment button (both modes)", default: "Payment" },
  { key: "funnel.pay_h", group: "Reserve flow", label: "Pay step — headline", default: "Lock it in." },
  { key: "funnel.have_code", group: "Reserve flow", label: "Pay step — 'have a code' toggle", default: "Have a code?" },
  { key: "funnel.code_ph", group: "Reserve flow", label: "Pay step — discount-code placeholder", default: "Discount code" },
  { key: "funnel.code_apply", group: "Reserve flow", label: "Pay step — apply-code button", default: "Apply" },
  { key: "funnel.pay_sub_pickup", group: "Reserve flow", label: "Pay step — sub, pickup", default: "Pay now, or reserve and pay at pickup." },
  { key: "funnel.pay_cta", group: "Reserve flow", label: "Pay button (uses {total}, both modes)", default: "Pay {total}" },
  { key: "funnel.pay_later", group: "Reserve flow", label: "Pay step — reserve-and-pay-later button", default: "or reserve now — pay at pickup" },
  { key: "funnel.reserve_pay_later", group: "Reserve flow", label: "Pay step — reserve button when Square is off (uses {total})", default: "Reserve {total} — pay at pickup" },
  { key: "funnel.reserve_window_note", group: "Reserve flow", label: "Pay step — pay-at-window note", default: "Reserve here and pay at the window on pickup day." },
  { key: "funnel.checkout_off", group: "Reserve flow", label: "Pay step — checkout not configured note", default: "Checkout isn’t switched on yet — card payments arrive with the Square keys." },
  { key: "funnel.done_title_paid", group: "Reserve flow", label: "Done — title, paid", default: "You're in." },
  { key: "funnel.done_title_reserved", group: "Reserve flow", label: "Done — title, reserved", default: "You're reserved." },
  { key: "funnel.done_sub_pickup", group: "Reserve flow", label: "Done — sub, pickup (uses {day} and {name})", default: "See you {day}{name}." },
  { key: "funnel.done_cta_pickup", group: "Reserve flow", label: "Done — CTA, pickup", default: "Reserve another" },
  // ── Order funnel — delivery-mode steps (renders on /delivery). ──
  { key: "funnel.hero_h1", group: "Delivery", label: "Delivery hero — headline line 1", default: "Your week," },
  { key: "funnel.hero_em", group: "Delivery", label: "Delivery hero — headline emphasis", default: "delivered." },
  { key: "funnel.aud_home", group: "Delivery", label: "Audience fork — home", default: "My home" },
  { key: "funnel.aud_home_sub", group: "Delivery", label: "Audience fork — home sub", default: "Sunday packs" },
  { key: "funnel.aud_office", group: "Delivery", label: "Audience fork — office", default: "My office" },
  { key: "funnel.aud_office_sub", group: "Delivery", label: "Audience fork — office sub", default: "Mon · gallons" },
  { key: "funnel.office_cta", group: "Delivery", label: "Office — set-up button", default: "Set up office delivery" },
  { key: "funnel.zip_lead", group: "Delivery", label: "Zone check — lead line", default: "Enter your ZIP — we’ll check your porch." },
  { key: "funnel.zip_ph", group: "Delivery", label: "Zone check — ZIP placeholder", default: "ZIP code" },
  { key: "funnel.zip_check", group: "Delivery", label: "Zone check — button", default: "Check" },
  { key: "funnel.oz_title", group: "Delivery", label: "Out of zone — title", default: "Not in our delivery zone yet." },
  { key: "funnel.oz_body", group: "Delivery", label: "Out of zone — body", default: "Drop your email — or grab it at a truck stop instead." },
  { key: "funnel.wl_done", group: "Delivery", label: "Out of zone — waitlist confirmation", default: "You’re on the list." },
  { key: "funnel.notify", group: "Delivery", label: "Out of zone — notify button", default: "Notify me" },
  { key: "funnel.switch_pickup", group: "Delivery", label: "Out of zone — switch-to-pickup button", default: "Switch to pickup" },
  { key: "funnel.size_h_delivery", group: "Delivery", label: "Size step — headline, delivery", default: "We deliver to you. Pick a Sunday and a size." },
  { key: "funnel.pricemode_del_back", group: "Delivery", label: "Size step — price mode, empties back", default: "Prices with empties back — first delivery? Switch to “need all new” at the next step." },
  { key: "funnel.pricemode_del_new", group: "Delivery", label: "Size step — price mode, new bottles", default: "New-bottle prices — bring your empties back next time and pay less." },
  { key: "funnel.which_sunday", group: "Delivery", label: "Size step — Sunday picker label", default: "Which Sunday" },
  { key: "funnel.free_delivery", group: "Delivery", label: "Size tile — free-delivery tag", default: "FREE DELIVERY" },
  { key: "funnel.delivery_fee_note", group: "Delivery", label: "Size step — delivery fee note (uses {fee} and {min})", default: "Delivery {fee} flat — free at {min}+ bottles." },
  { key: "funnel.glass_back_del_sub", group: "Delivery", label: "Glass step — bring-back card body, delivery (uses {refill}/{fresh})", default: "Rinse your empties, set them out. We swap them for your new order. {refill}/bottle instead of {fresh}." },
  { key: "funnel.empties_q", group: "Delivery", label: "Glass step — empties question (cap follows)", default: "How many empties are you returning?" },
  { key: "funnel.empties_ack", group: "Delivery", label: "Glass step — empties acknowledgement", default: "Got it — empties out by 5 AM Sunday." },
  { key: "funnel.glass_new_del_title", group: "Delivery", label: "Glass step — new-glass card title, delivery", default: "Need all new" },
  { key: "funnel.glass_new_del_sub", group: "Delivery", label: "Glass step — new-glass card body, delivery (uses {fresh})", default: "Sealed bottles delivered fresh. {fresh}/bottle." },
  { key: "funnel.glass_next_del", group: "Delivery", label: "Glass step — advance button, delivery", default: "Delivery details" },
  { key: "funnel.details_h_del", group: "Delivery", label: "Details step — headline, delivery", default: "Where do we bring it?" },
  { key: "funnel.f_phone_del", group: "Delivery", label: "Details — phone placeholder, delivery", default: "Phone — for delivery-morning texts" },
  { key: "funnel.f_street", group: "Delivery", label: "Details — street placeholder", default: "Street address" },
  { key: "funnel.f_city", group: "Delivery", label: "Details — city placeholder", default: "City" },
  { key: "funnel.f_access", group: "Delivery", label: "Details — access-notes placeholder", default: "Gate code / access notes (optional)" },
  { key: "funnel.pay_sub_del", group: "Delivery", label: "Pay step — sub, delivery", default: "One charge now — nothing due at the door." },
  { key: "funnel.done_sub_del", group: "Delivery", label: "Done — sub, delivery", default: "We'll be there before sunrise Sunday." },
  { key: "funnel.done_cta_del", group: "Delivery", label: "Done — CTA, delivery", default: "Track it in your account" },
  // ── Coupon landing (/c/<code>) — the prose around a scanned offer (adoption pass 2026-08-10). ──
  { key: "coupon.checkout_sub", group: "Coupon", label: "Checkout-code — sub", default: "Your code is in — it applies itself at checkout." },
  { key: "coupon.checkout_cta", group: "Coupon", label: "Checkout-code — CTA", default: "Order your bottles →" },
  { key: "coupon.code_label", group: "Coupon", label: "Checkout-code — 'code' prefix", default: "code" },
  { key: "coupon.loop_body", group: "Coupon", label: "Bottle-return card — body", multiline: true, default: "Bring your empty GT3 bottle back to any pop-up or pickup — show this screen, get your pour, and the bottle goes back into the Loop." },
  { key: "coupon.loop_cta", group: "Coupon", label: "Bottle-return card — CTA", default: "See what's pouring →" },
  { key: "coupon.ended_title", group: "Coupon", label: "Expired — title", default: "That offer has wrapped" },
  { key: "coupon.ended_sub", group: "Coupon", label: "Expired — sub", default: "This card's run has ended — but the good stuff hasn't." },
  { key: "coupon.ended_cta", group: "Coupon", label: "Expired — CTA", default: "See the menu →" },
  // ── Marketing splash — the guest takeover's fixed regions (promo headline/sub/CTA stay promo-
  //    driven; these are the always-present GT3 lines). Plain t() — the whole scrim is tap-to-dismiss. ──
  { key: "splash.kicker", group: "Splash", label: "Kicker", default: "Sunday delivery · Greenville" },
  { key: "splash.price_pre", group: "Splash", label: "Price line — before the amount", default: "From" },
  { key: "splash.price_amt", group: "Splash", label: "Price line — amount", default: "$8" },
  { key: "splash.price_suf", group: "Splash", label: "Price line — after the amount", default: "a bottle." },
  { key: "splash.foot", group: "Splash", label: "Footer line", default: "Mix & match · free delivery at 24+" },
  { key: "splash.welcome", group: "Splash", label: "Finale — welcome", default: "Welcome to the bar" },
  { key: "splash.sign_pre", group: "Splash", label: "Finale — signature, before the mark", default: "Grow Your" },
  { key: "splash.sign_suf", group: "Splash", label: "Finale — signature, after the mark", default: "mpire" },
  // ── Storefront story — the guest 'What We Make' close on /reserve + /delivery. ──
  { key: "story.make_label", group: "Story", label: "Section label", default: "What We Make" },
  { key: "story.make_note", group: "Story", label: "Section annotation", default: "three acts" },
  { key: "story.craft_link", group: "Story", label: "Craft-page button", default: "Our craft — the how" },
  // ── Delivery page — the not-live empty state. ──
  { key: "delivery.not_live", group: "Delivery", label: "Empty state — delivery off", default: "Delivery isn't live yet — check back soon." },
  // ── Bottom nav — the five tab labels (guest + member). ──
  { key: "nav.today", group: "Nav", label: "Tab — Today (members)", default: "Today" },
  { key: "nav.find", group: "Nav", label: "Tab — Find Us", default: "Find Us" },
  { key: "nav.menu", group: "Nav", label: "Tab — Menu", default: "Menu" },
  { key: "nav.reserve", group: "Nav", label: "Tab — Reserve", default: "Reserve" },
  { key: "nav.join", group: "Nav", label: "Tab — Join (guests)", default: "Join" },
  // ── 3MPIRE / account page — masthead eyebrow + Your-usual row (Today). ──
  { key: "mpire.eyebrow", group: "3MPIRE", label: "Masthead eyebrow", default: "Your 3MPIRE" },
  { key: "today.usual_lead", group: "Home · signed-in", label: "Your-usual row — lead", default: "Your" },
  { key: "today.usual_leadsub", group: "Home · signed-in", label: "Your-usual row — lead sub", default: "usual" },
  { key: "today.usual_sub", group: "Home · signed-in", label: "Your-usual row — sub", default: "same order, one tap" },
  { key: "today.usual_cta", group: "Home · signed-in", label: "Your-usual row — order-again chip", default: "Order again" },
  // ── Account — the 3MPIRE page's section labels + account rows + referral card chrome. ──
  { key: "account.orders_label", group: "Account", label: "Recent orders — section label", default: "Recent Orders" },
  { key: "account.orders_note", group: "Account", label: "Recent orders — annotation", default: "order again" },
  { key: "account.section_label", group: "Account", label: "Your account — section label", default: "Your Account" },
  { key: "account.section_note", group: "Account", label: "Your account — annotation", default: "manage" },
  { key: "account.academy", group: "Account", label: "Row — GT3 Academy", default: "GT3 Academy" },
  { key: "account.academy_sub", group: "Account", label: "Row — GT3 Academy sub", default: "Training · certifications · cookbook" },
  { key: "account.arch", group: "Account", label: "Row — System architecture (owner)", default: "System architecture" },
  { key: "account.arch_sub", group: "Account", label: "Row — System architecture sub", default: "How the platform is built · owner" },
  { key: "account.book", group: "Account", label: "Row — Book the bar", default: "Book the bar" },
  { key: "account.book_sub", group: "Account", label: "Row — Book the bar sub", default: "Bring GT3PB to your event — B2B" },
  { key: "account.signout", group: "Account", label: "Row — Sign out (sub is the member's email)", default: "Sign out" },
  { key: "account.copy", group: "Account", label: "Referral — copy-code label (idle)", default: "Copy" },
  { key: "account.copied", group: "Account", label: "Referral — copy-code label (copied)", default: "Copied!" },
  { key: "account.share", group: "Account", label: "Referral — share button", default: "Share invite" },
  // ── Menu · sections + every drink. Names, tags, and descriptions are copy — PRICES ARE NOT:
  // the charge is computed server-side from the locked catalog / Square, so px stays in code.
  ...MENU.flatMap((s, i) => [
    { key: `menu.sec.${i}.name`, group: "Menu · sections", label: `${s.name} — title`, default: s.name },
    { key: `menu.sec.${i}.sub`, group: "Menu · sections", label: `${s.name} — subtitle`, default: s.wn },
  ]),
  ...(Object.keys(DRINKS) as DrinkId[]).flatMap((id) => {
    const d = DRINKS[id];
    const out: CopyMeta[] = [
      { key: `menu.${id}.name`, group: `Menu · ${d.n}`, label: "Name", default: d.n },
      { key: `menu.${id}.lines`, group: `Menu · ${d.n}`, label: "What it is (one line per row)", multiline: true, default: d.lines.join("\n") },
      { key: `menu.${id}.why`, group: `Menu · ${d.n}`, label: "Why it exists", multiline: true, default: d.why },
    ];
    if (d.tag) out.push({ key: `menu.${id}.tag`, group: `Menu · ${d.n}`, label: "Tag", default: d.tag });
    return out;
  }),
];

const COPY_DEFAULTS: Record<string, string> = Object.fromEntries(COPY_META.map((m) => [m.key, m.default]));

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
// param the crew console scrolls to. Derived from the group name so a new group never needs a
// second place to register its slug.
export function copyGroupAnchor(group: string): string {
  return "sc-" + group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// group → the live page that actually renders it. Explicit per group (unlike the anchor, a route
// can't be derived from the name); the per-drink "Menu · <name>" groups all fall through to /menu.
// "Home · signed-out" points at /reserve, NOT /, because that's where its live keys actually render
// (guest arrival is StorefrontStory on /reserve + /delivery — see the dead-key note above; / is the
// signed-in member home and shows none of this group).
const COPY_GROUP_ROUTE: Record<string, string> = {
  "Team board": "/crew?s=day",
  "Home · signed-out": "/reserve",
  "Home · signed-in": "/",
  "Home · pillars": "/reserve",
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
  "Story": "/reserve",
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
export function useSiteCopy(): (key: string) => string {
  const [over, setOver] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("site_copy").select("key, value");
    if (data) setOver(Object.fromEntries((data as { key: string; value: string }[]).map((r) => [r.key, r.value])));
  }, []);
  useRealtimeTable("site_copy", load, { loadOnMount: true });
  return (key: string) => over[key] ?? COPY_DEFAULTS[key] ?? "";
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
  return error ? { error: error.message } : {};
}
export async function resetCopy(key: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.from("site_copy").delete().eq("key", key);
  return error ? { error: error.message } : {};
}
