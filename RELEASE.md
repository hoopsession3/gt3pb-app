# Shipping a round

The order a change reaches production in, and what each red line means. `npm run release:plan` prints this list for the
tree you are on — what is pending to paste, what is held and until when, which push function it carries, whether the
security snapshot covers it. This page is the why; that command is the what.

## 1 · Before the push

```bash
git am --3way <the round's patch>          # check the tree id it names: git rev-parse --short HEAD^{tree}
npm ci
npm run release                            # verify, then npm's advisories — the same two CI runs
```

`npm run release` is `verify` (tests, the audits — the lint ratchet and the secrets audit among them — the build, the
browser smokes, the iPhone build and its smoke) and then `advisories` (npm's advisory database, asked of what ships).
Green, or nothing is pushed.

## 2 · The push

Push `main`. Vercel builds and deploys it. The **Production** workflow waits for the deploy (up to 15 minutes), then
checks it: `/api/health` reports this commit, the JSON doors, the service worker, the front door, the iPhone app's door,
every public route painted at phone width with axe, and the crew console signed in.

## 3 · The database, after the deploy

If `supabase/APPLY_ALL_PENDING.sql` lists migrations, paste it into the Supabase SQL editor **when service is quiet**.
Each migration is its own transaction: one that stops (a busy table's lock wait ran out) leaves those above it applied —
paste the file again a moment later; one already applied changes nothing the second time. A migration whose header names
its own moment ("deploy the push function before…", "right after the deploy") is listed under its file by
`release:plan`; read it first. Code ships before the migration it waits for: every door that reads something a pending
migration adds says so (`// arrives-with: NNNN`) and works without it.

Then **re-pull the security snapshot** (four steps, a minute — the top of `scripts/security.audit.mjs`) and commit it
with the next round. Production's posture is judged from it; unread for two days, the daily check goes red.

## 4 · The push function

`supabase/functions/push` is deployed by hand (the dashboard, or `supabase functions deploy push`), apart from the push to
`main`. The Production check's `push:` line says whether the deployed one is this tree's (its `PUSH_VERSION`). If it
lags, deploy `index.ts` and `policy.ts` from this tree.

## 5 · Held on purpose

A migration in `supabase/held.json` is not in the paste file. It waits for something outside the database (an iPhone
build on the phones), and is pasted by itself, with its own yes, once that is true.

## 6 · The iPhone app

TestFlight takes `main` only, and only a commit CI passed (`.github/workflows/ios.yml`): Actions → iPhone app → Run
workflow → Upload to TestFlight. The job's summary says which build is which commit; a crash report from a phone carries
the commit too.

## The outside monitor

Whether the site is up is said from outside it, every few minutes, by an uptime service that emails you itself — so it
answers when Vercel, Supabase or GitHub can't. GitHub's **Production** workflow is the deep check (the ledger, the push
function, every route painted); GitHub runs its "half-hourly" schedule every two to six hours, so it is no uptime
check, and the database's watchdog waits six hours for it before it says it stopped (0440).

Set once (Better Stack's free plan as of 2026-10-19: 10 monitors, 3-minute checks, email and Slack alerts — read its
terms as you sign up; UptimeRobot's free plan has been for personal, non-commercial use since October 2024):

1. betterstack.com → sign up with the address that should get the alerts → **Uptime** → **Create monitor**.
2. URL: `https://app.gt3pb.com/api/health`. If it offers a keyword check, alert when the page **doesn't contain**
   `"ok":true`; otherwise when the URL **becomes unavailable** (the route answers 503 when the database doesn't).
3. Every 3 minutes; alert by email (and Slack, if you use it). No header or secret: it doesn't need one, and it feeds
   nothing — the watchdog listens for GitHub's check only.
4. Optional, the guest's front door: a second monitor on `https://app.gt3pb.com/menu`.

Its email means the site or its database isn't answering: Vercel's status page, then Supabase's, then
`CONTINUITY_RUNBOOK.md`.

## Search

The app tells search what it is (R42, `lib/seo.ts`): `robots.txt` lets every crawler read every page, `sitemap.xml`
lists the public pages and every lesson anyone may read, each public page names its own description, address and share
card, every other page says noindex, and the business and the menu are structured data. The Production check's `found:`
lines read all of it from production after each push.

Set once, after the first push with R42:

1. search.google.com/search-console → **Add property** → **Domain** → `gt3pb.com` (one property for the site and the
   app). It gives a TXT record: add it where gt3pb.com's DNS is kept, then **Verify**.
2. **Sitemaps** → `https://app.gt3pb.com/sitemap.xml` → **Submit**.
3. **URL inspection** → `https://app.gt3pb.com/menu` → **Test live URL**: the page Google drew should show the menu.
   Then **Request indexing** for `/menu`, `/truck` and `/primal`.
4. Optional: bing.com/webmasters → **Import from Google Search Console**.

Search Console's own email then says when a page drops out or can't be read.

## What a red Production run means

| Line | Means | Do |
|---|---|---|
| `live: /api/health answers ok` → no answer | The site didn't answer in 20 s | Vercel's status; then the deploy |
| `live: production is this tree` | Not deployed yet, or main moved | Wait for the deploy; on a push run, the deploy failed |
| `live: the scheduled jobs are measured` | 0430 is applied and the database didn't say how the jobs run | Supabase → Integrations → Cron; then `ops_alive`'s grants |
| `current: the ledger holds every migration` | Migrations written and not pasted | §3 — the paste is pending; this is expected right after a push |
| `posture:` | A finding, or a snapshot two days old | Fix the finding, or re-pull the snapshot (§3) |
| `push:` | The deployed push function isn't this tree's | §4 |
| `answers:` / `door:` / `app door:` | A route answered HTML, or the wrong status | The route's log line (`[route-threw]`, with the request's id) |
| `found:` | A page tells search the wrong thing: no description or address, noindex where it shouldn't be, the menu's structured data not its page's | The line names the page; `lib/seo.ts` holds what each should say |
| `painted:` | A public route moved, grew a box, or failed axe on real data | `scripts/design.ratchet.mjs` names the route |

## Rolling back

`CONTINUITY_RUNBOOK.md` §8: Vercel's Instant Rollback for the code (then a revert on `main`), a new migration for the
database (never an edit of an applied one), the last good push function from git, and App Store Connect for a bad
iPhone build.
