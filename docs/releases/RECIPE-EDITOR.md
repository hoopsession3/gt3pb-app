# Recipe editor (0476): in-app recipe corrections, for review

Status: **local only.** Branch `recipe-editor`. Nothing is pushed. The migration is held in `supabase/held.json`.
Kept separate from the Salted Maple recipe correction (`recipe-salted-maple`), which ships on its own.

## What it does
- **The amounts are the source.** Each recipe's ingredient table holds two separately specified formulas — the single mix
  and the large batch — and the yield of each is added up from it. The batch line, the build step in the method and any
  troubleshooting fix that names a quantity are written FROM the table (`lib/recipeEdit.resolveRecipe`; a step holds
  `{{single}}` / `{{large}}`, or `{{single:Item}}` for one amount). Edit an amount and the table, the yield, the method
  and every answer change together. A component's own preparation (the syrup: its maple syrup and salt) keeps its own
  measurements. The large batch is never checked as a multiple of the single mix — no scaling warning.
- **Crew (staff who submit for review):** recipe → **Suggest a correction** → edit → What changed + who can publish →
  Save draft (said in place, no toast) / **Submit for review** ("Submitted for review", nothing competing with it).
- **Owners and admins (Kayla):** recipe → **Edit recipe** → edit → **Review changes** (what changes, then the recipe as it
  will read, and which version this makes) → **Publish now**. They also see **Waiting for review** (Publish / Decline)
  and the **History** (Restore — the restored version keeps its number).
- Recipe screen, Ask GT3 and every assistant read only the PUBLISHED version (`lib/recipeBook.ts`, then resolved from
  its amounts); drafts and submissions never reach an answer. Recipe editing is separate from "Train the AI".

## Where Kayla finds it
Kayla's role in GT3: **owner** (read from the live Team screen, 2026-11-20; not changed).
- **Recipes:** Production → Brew → **Drink recipes** → the drink. (Also Academy → the drink → Cookbook → Edit recipe / Versions.)
- **Ask GT3:** ✦ (Quick actions) → Ask GT3 → ask about the drink → **View recipe** / **Edit recipe** under the answer
  (a crew member sees **Suggest a correction**). No recipe on file → **Create recipe draft**.

## The phone journey (393 × 852, scripts/journey.recipes.mjs) — 28/28
Test edits only (2.5 and 3 fl oz milk) — the recipe stays 7 / 2 / 1.5 fl oz and 85 / 24 / 18 fl oz. At every step the
ingredient table, the Makes row, the build step and Ask GT3's answer are read off the screen and must agree.
**Crew (operator, no owner access):** Production → Drink recipes → Salted Maple Latte (built-in: table, Makes and build
agree) → Suggest a correction → A2 goat milk single 2 → 2.5 (yield 11 fl oz; the build step and the batch line follow, marked
"From the amounts above"; no warning) → Save draft (in place, no toast) → Submit for review (no competing message) → Ask
GT3 answers from the built-in recipe, the same amounts and build; the submission stays out → Suggest a correction reopens
it → a drink with none on file offers Create recipe draft.
**Kayla (owner):** Production → Drink recipes → Salted Maple Latte → Waiting for review → Publish → v1 (table, Makes, build:
2.5 / 11) → Ask GT3 answers v1 with the same amounts and build → Edit recipe → 2.5 → 3 → Review changes (what changes, as it
will read, "makes this v2") → Publish now → v2 (3 / 11.5), Ask GT3 follows → View recipe → Restore v1 → v1 again (2.5 / 11),
Ask GT3 follows. Database: one published (v1, decided by Kayla), v2 retired.

## The cookbook checked for the same issue (counts only — the cookbook is confidential)
| recipe | quantities structured | lines stating a quantity | a quantity stated in 2+ places |
|---|---|---|---|
| salted_maple | yes | 1 (the syrup's own preparation) | 0 |
| rise | no | 3 | 2 (one coffee:water ratio, in the batch line and step 1) |
| cold_extract | no | 2 | 1 (the same kind: a ratio in the batch line and step 1) |
| nitro | no | 1 | 0 |
| flow, dusk, nature_aid, tide, bone_broth, coconut_shake | no | 0 | 0 |
Nothing else repeats a drink formula. Rise and Cold Extract repeat a weighed brew RATIO, which the fl oz formula table doesn't
model — left as written; structuring ratio/weight recipes is a follow-up (a ratio field, the batch and step 1 written from it).
A smoke check now holds every structured recipe to zero hand-typed repeats.

## Tests
| | |
|---|---|
| `scripts/db.recipes.test.mjs` | 27/27 |
| smoke (incl. `cookbook:` Salted Maple formulas written from the amounts, and the `recipe:` checks) | 3765/3765 |
| `scripts/journey.recipes.mjs` (local, `.next-console`) | 28/28 |
| full `npm test` + audit chain | see the release note; R36 and the security audit's ceiling read 140 > 127 only until this rebases onto main after #136 |

## Migration 0476

- **File:** `supabase/migrations/0476_recipes_are_kept_in_the_app.sql`
- **sha256:** `d47ddf5447a258e627c9e328ea22aa8b1d2e223bb96492a7f51dade33025d7b4`
- **Adds:**
  - a new table, `recipe_versions`, with RLS and four policies plus a restrictive tenant policy;
  - one guard trigger, SECURITY DEFINER with EXECUTE revoked;
  - indexes, including one on the `based_on` foreign key.
- **Leaves alone:** no existing table is altered, and there is no new callable privileged function.
- **Rollback:**
  1. `drop table public.recipe_versions cascade;`
  2. `drop function public.recipe_versions_guard();`
  3. Take 0476 off the ledger.

  The app falls back to the built-in cookbook at once.

## Rollout, each step a separate approval

1. **Ship the app ahead of the migration (code only).**
   - With 0476 held, everything reads the built-in cookbook exactly as today.
   - The editor shows "Recipe editing turns on once the recipe update is applied".
   - Ask GT3 shows View recipe and Suggest a correction, and stops sending recipe corrections to Notes.
2. **Read-only production pre-check.**
   - The ledger high-water is 0475.
   - `recipe_versions` is absent.
   - The callable definer count is 140.
3. **Apply 0476 once,** with the checksum above.
4. **Read-only post-check.**
   - 0476 appears in the ledger once.
   - The table and policies are present.
   - The guard can't be called.
   - The definer count is still 140.
   - The audit is clean.
5. **Kayla's acceptance test on her phone:**
   - Recipes → the drink → Edit recipe → Review changes → Publish now (she is an owner);
   - then Ask GT3 shows the new version line and the same amounts and build as the screen;
   - then Restore.
6. Take 0476 out of `held.json` in the same change that records it as applied.

## Changed

- **New:**
  - `lib/recipeEdit.ts` (pure)
  - `lib/recipeBook.ts` (server, published book)
  - `lib/recipeKnowledge.ts`
  - `components/RecipeEditor.tsx`
  - `components/DrinkRecipes.tsx`
  - `scripts/db.recipes.test.mjs`
  - `scripts/journey.recipes.mjs`
  - `scripts/fixtures/claudeStub.mjs` (journey only)
- **Server:**
  - `/api/academy/cookbook` now returns the published book, sources, names, publishers and `canPublish`.
  - The operator route reads the published book and returns a `recipe` hint for the buttons under the answer. Its instruction now sends recipe corrections to "Suggest a correction" instead of Notes.
  - The resolve, loadout, eventprep, brew and troubleshoot agents read the published knowledge.
- **Fixtures:** `fakebase` gained an opt-in `serviceKey`, a made-up key that lets a journey exercise the server's own reads. The console walk doesn't pass one.
- **Not changed:** `lib/brandVoice.ts` (marketing copy) still reads the built-in knowledge. It has no amounts at stake. Follow-up if wanted.

## "Nino's"

- The live menu (app.gt3pb.com/menu, 2026-11-20) lists Salted Maple Latte and no "Nino's".
- The live Team screen lists a crew member named **Niño** (operator).
- "Nino's" may be what the crew calls his drink, but nothing confirms it is the Salted Maple Latte, so **no alias was added.**
- If it is the same drink, Kayla can add it herself under **Also called** in the editor.

## 2026-11-21 — answer first, plain status, the proof (journey 37/37)
- **Ask GT3 answers an ingredient's amount first, from the table** (the published version, or the built-in one before the
  first publish): "How much goat milk goes in the Salted Maple Latte?" → "2 fl oz for one mix, or 24 fl oz for the large
  batch." — exact, not from the model. The method is behind **View recipe**; the role's action beside it (staff: Suggest
  a correction; owners/admins: Edit recipe).
- **Status copy:** the main screens say "Current recipe"; versions, dates and who published live in **History**. After a
  staff submission: "Submitted for review. The crew will keep seeing the current recipe until your correction is
  published." with the publishers named — one confirmation, no toast.
- **Proof** (`.journey-recipes/answers.json`, a fresh Ask GT3 conversation after each action; 2.5 and 3 fl oz are test
  fixture values only):

  | after | Ask GT3 leads with | History (current) | table / Makes / method |
  |---|---|---|---|
  | saving a draft (2.5 pending) | 2 fl oz for one mix, or 24 fl oz for the large batch. | built-in | 2 · 10.5 fl oz, agree |
  | submitting it | 2 fl oz for one mix, or 24 fl oz for the large batch. | built-in | 2 · 10.5 fl oz, agree |
  | publishing v1 | 2.5 fl oz for one mix, or 24 fl oz for the large batch. | v1 · published by Kayla · current | 2.5 · 11 fl oz, agree |
  | publishing v2 | 3 fl oz for one mix, or 24 fl oz for the large batch. | v2 · published by Kayla · current | 3 · 11.5 fl oz, agree |
  | restoring v1 | 2.5 fl oz for one mix, or 24 fl oz for the large batch. | v1 · published by Kayla · current | 2.5 · 11 fl oz, agree |

- **Kayla's path on her phone:** Production → Brew → Drink recipes → Salted Maple Latte → **Edit recipe** → change the
  amount → **Review changes** → **Publish now**. (Or from an Ask GT3 answer: **Edit recipe** → … the same.)

## 2026-11-23 — in production (0476 and 0477 applied and verified)

- **0476 applied** once, 02:44:12 UTC, in a single guarded transaction (pre-checks and the migration, then `COMMIT`).
  - Post-checks: the ledger reads 476 (0476 once, 0474 absent); RLS is on; 5 policies; 0 rows; the guard is a definer that
    neither `anon` nor `authenticated` can execute; 140 callable definers; the policies match the migration; the trigger
    is enabled, before update, for each row.
  - One finding: `authenticated` also held TRUNCATE, TRIGGER and REFERENCES from the platform's default privileges.
- **0477 applied** once, 14:00:40 UTC, in a single guarded transaction: pre-checks, the revoke, the ledger row, and
  post-checks before `COMMIT` (in-editor sha256 `a70fc3ee…5074`, 3,646 bytes; the migration is byte-identical to main at
  `4a74087`).
- **0477 post-checks** (read-only, once each):

  | check | result |
  |---|---|
  | ledger | high-water 477; 0477 once; 0476 once; 0474 absent |
  | effective privileges | `authenticated` DELETE, INSERT, SELECT, UPDATE; `anon` none |
  | policies | all five identical to the 0476 baseline |
  | guard trigger | `recipe_versions_guard`, enabled (`O`), type 19, not internal |

- **Held list:** 0476 and 0477 come off `supabase/held.json` in this change; 0474 stays held. Nothing is re-applied.
- **Still to come, each its own approval:** Kayla's publish-and-restore test on the live Salted Maple Latte.
