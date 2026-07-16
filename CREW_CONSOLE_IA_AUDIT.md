# Crew console redundancy audit — full findings

Triggered by five things you clicked into in about three minutes: the triple-worded prep button, "is it managed there or here," "why is at-a-glance in the middle of event prep and truck locations," and "how do I even edit a goal." All five turned out to be symptoms of the same handful of root causes, not five unrelated bugs. This document is the complete map — six parallel read-only passes across the whole crew console, everything below is cited to a file and line, nothing is a guess. No code has been touched yet.

## The one thing to read first

The crew console has 18 possible screens ("sections"). Where they live is genuinely two different systems layered on top of each other:

- **Today** (My Day / Live Ops / Command) is hardcoded, always first, always the same three screens — `components/OperatorNav.tsx:107`.
- Every other tab is *data-driven* from a `work_streams` database table your tenant can customize — each lane just lists which sections belong to it. As of the latest migration, that's:
  - **Service** → Live Ops, Readiness, Route, Delivery
  - **Events** → Plan, Readiness
  - **Production** → Brew, Assets
  - **Brand** → Studio
  - **Business** → Money, Customers, Pipeline, Team, Goals, Notes

Two screens are deliberately listed in *two* lanes at once — Live Ops (Today **and** Service) and Readiness (Service **and** Events). That's not an accident; `app/crew/page.tsx:5696-5697` says so directly: "a section can live in two lanes... so the tapped tab, tracked as groupId, wins the ambiguity." In principle that's fine — tap one tab, see that lane's subset, no visual double-up.

In practice, two things break it:

**The tab strip and the page title use different words for the same screen.** `app/crew/page.tsx:121` renames Service's own tabs for its internal segmented control: Route → **"Schedule,"** Live Ops → **"Run,"** Readiness → **"Prep."** But the big page header sitting directly above that same strip (`:5416`, `:5684-5686`) still says **"Route," "Live Ops," "Readiness."** So you tap "Schedule," and the screen that opens is titled "Route." You tap "Run," and it's titled "Live Ops." This is almost certainly the single biggest reason today felt like everything was named three different things — because in the Service lane specifically, it is. (Bonus: the comment introducing this renaming scheme, two lines above the code, says the intended reading order is "Plan → Prep → Run → Delivery" — but the code renames Route to "Schedule," not "Plan," and the actual order doesn't match either phrase. The comment describing the fix doesn't match the fix.)

**Readiness is byte-identical no matter which of its two lanes you reach it from.** Confirmed by reading every component it mounts (`app/crew/page.tsx:5764-5776` and everything under it) — none of them read which lane you came from, the data query pulls all open events and stops with no filter either way, and the board's own on-screen copy says "All open prep · one board." It was never built to differ by event-vs-stop scope. So it isn't really "in two places for a reason" — it's one screen occupying two tab slots for no functional benefit, which is exactly the kind of thing that makes an app feel like it has more surface area than it does.

One more nav fact worth knowing: **Settings has no tab at all.** It's not in any lane and not in "More" — the only ways in are the search/command palette or the in-app Guide. And the "Ask" section's code path (`sec === "ask"`) appears to be dead — the real Ask entry point is the floating button in the corner, a completely different component.

## The exact buttons that are duplicates

1. **The stop card** (what you screenshotted first) — `app/crew/page.tsx:2811, 2867-2868`. "Full prep — menu, staffing, run-of-show," "Open prep hub," and "Wrap up in the hub" are three labels; the last two are `onClick={onOpenPrep}` on *both* — the literal same function. Not three options, one option said three times.
2. **Settings' "Checkout, payments & flags" and "Menu, products & pricing" cards** — `app/crew/page.tsx:5833-5844`. Both point at `to: "money"`, no anchor, so both land you at the top of Money and you scroll to find what you actually wanted. The app already has a working jump-to-anchor mechanism (used for alert links) — these two cards just don't use it.

## Copy that actively tells you the wrong thing

This is the category I'd take most seriously — these aren't dev comments nobody reads, several are text *you or your crew see on screen*.

- **The stop-identity split is worse than first found.** The prep hub's own edit form (`app/crew/page.tsx:824-828`) has a comment calling itself "the single place to manage the thing end to end." The Route screen's edit sheet (`components/FieldOpSheet.tsx:10-19`) has a comment calling *itself* "the ONE quick editor... kills the old maze." Both are live. Both are wrong. And your in-app Guide — the actual help text a crew member reads — says flatly "Names, dates & addresses are edited in the prep hub" (`:5448, :5468`), while the fuller edit form is one tap away from Route too. Three different places in the app assert three different things about where you're supposed to fix a stop's name.
- **The Money tab's headline number** — `components/MoneyKpis.tsx:6-12` says in a comment it's "deliberately NOT" the Square-reconciled figure. The code (`:40-66`) actually prefers the reconciled figure first and only falls back otherwise. On a normal day, the number you see *is* the thing the comment insists it isn't.
- **Every new sales opportunity gets a permanently wrong origin note.** `app/crew/page.tsx:3797` bakes "promoted from Plan › Bookings" into the deal's comment thread forever — Bookings hasn't lived under Plan since Pipeline moved to Business. The toast on screen four lines later gets it right; the permanent record doesn't. Two of the six audit passes hit this independently.
- **Two leftover pointers to a section that moved.** `components/InventoryLibrary.tsx:11-13` and `components/CogsCalculator.tsx:143` both still say Brew/Inventory live under "Plan" / "Crew Mode → Prep." They moved to their own Production lane a while back. CogsCalculator's is the sharper one — it's literal on-screen empty-state text ("Add them in Plan → Brew"), not a comment.
- **Garage vs. Assets.** The live app calls this section "Assets" everywhere a person sees it. Your Changelog's own tagging list and your architecture doc both still call it "Garage." Two names for the same section, on two different owner-facing surfaces, with nothing tying them together.
- **The Subscriptions toggle in Payment Settings** still shows a "live" pill when it's on, even though the code sitting right next to it (fixed earlier today, actually) admits flipping it doesn't give a customer any way to actually sign up yet. I softened the toast this session; the status pill itself still overstates it — worth a follow-up.

## Things you can create but can never fix or delete

This turned out to be the same shape as your Goals question, and it's systemic — I had a dedicated pass check every entity-creating panel in the app for its matching edit/delete path. Here's the honest scorecard:

**No edit path after creation (confirmed gaps):**
- **Goals** — no edit of title, target, description, or due date; no delete. (Your original question.)
- **Expenses (Money tab)** — worse than Goals, actually: there's no list of individual expense entries anywhere in the UI at all, so a wrong amount can't even be *found* again, let alone fixed. The database already allows editing and deleting them — the screen to do it was just never built.
- **Discount/promo codes** — mint and pause only. A code with the wrong percentage or product target can only be paused forever; fixing it means minting a second code and leaving the broken one sitting there.
- **Meeting notes** — title, date, summary, and body have no edit path; delete exists but warns it also deletes any follow-up tasks attached to the note.
- **Office (B2B) orders, admin side** — no edit of company name, address, gallons, or date. A typo means canceling and rebooking from scratch.
- **Reviews (admin)** — no direct edit. The only path to changing text is clicking "Simplify" for an AI rewrite, which only touches the body — never the name or star rating.
- **Brew recipes** — no create/edit/delete UI exists anywhere. Only a hand-written database migration can add or fix one, despite the database already being set up to allow it from the app.
- **Pending team invites** — no edit of role or email before someone accepts; revoke and re-invite is the workaround. Lower stakes since these rows don't live long.

**Checked and genuinely fine, for contrast** — Team member roles are fully editable in place. Pipeline opportunities (deal stage, rep, value, next step) are fully editable in place, just no hard delete (moving to "lost" is the closest thing, which reads as a deliberate choice, not an oversight). Menu items, subscription plans, and broadcasts all have complete create/edit/delete. So this isn't "the app never lets you edit anything" — it's specifically the create-and-log-progress-style entities (Goals, expenses, codes, notes, reviews) that got a create form and nothing after it.

## Same thing, two screens, two different answers

- **"Stop" means two unrelated things**, and even where it means one of them, it's not called that consistently. Your truck's own service location is a "stop" on the Route screen. A home-delivery destination — a completely different database table — is called an "order" in one place, a "stop" in another, and a "porch" in a third, across three connected screens (`components/DeliveryOps.tsx`, `DriverDash.tsx`, `DriverRun.tsx`). Bouncing from the Live Ops delivery card to the Driver tab, the same customer drop-off is three different nouns within two taps — and one of those nouns is the same word already in use for truck locations.
- **Route and Readiness disagree about whether a stop is still "upcoming."** Route auto-files anything more than 8 hours past its start time into a collapsed "Past visits" drawer. Readiness has no such cutoff — a stop stays in the live "Truck locations" list indefinitely until someone manually marks it done. A stop from nine hours ago can be simultaneously "past" on one screen and "current work" on another.
- **Your own task-writing code says this kind of drift can't happen, and it happens anyway.** `lib/tasks.ts` positions itself as "the one place... so table routing can never drift per-surface again." Four different components (PrepBoard, AssignTaskSheet, CompanyCalendar, Goals) bypass it with direct database writes for reassigning or completing tasks in at least one spot each. This one's more of a maintainability note than something you'd notice day to day, but it's the mechanical reason the same kind of inconsistency keeps showing up in new places — the safeguard meant to prevent it isn't being used consistently either.

## Smaller and lower-confidence items

- A contractor account can't reach Pipeline through normal navigation, but a saved link or bookmark to it isn't blocked by the same rule the tab bar uses — worth five minutes to confirm the database's own access rule (separate from the app's) actually backs this up, since I didn't verify that side.
- The default tab bar for you/an admin pins Today, Service, Brand, and Business — Events and Production only exist behind "More." Not wrong, just worth knowing that's why Plan, Brew, and Assets never show up on the main bar unless someone taps into More first.
- Two small label dictionaries have drifted on one entry each (what "Ask" is called; what order Service's screens load in before the database responds, which can very occasionally change which screen "Service" opens to based on network timing).

## Where this leaves us

Nothing above has been changed. Roughly, the findings split into three kinds of work: quick deletions (the duplicate buttons, the stale copy pointing at moved sections), copy/label reconciliation (picking ONE name per screen and making the tab strip, the header, the Guide, and the architecture doc all agree — this is most of what made today confusing), and real product decisions (does Readiness need to occupy two tabs if it's identical either way; which of the create-only entities are worth building real edit screens for, and in what order).
