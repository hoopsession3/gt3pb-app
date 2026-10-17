# GT3PB Continuity Runbook
### The "Ryan's phone falls in the river" document · 2026-08-01 · keep this current or it's fiction

**The rule this file exists for: every account below needs a SECOND OWNER (or documented recovery path) and this file names where each one stands. A backup nobody has restored is a hope. An account with one owner is a countdown.**

## 1 · The accounts that ARE the business

| Service | What dies without it | Owner today | Second owner | Recovery path |
|---|---|---|---|---|
| **Vercel** (gt-3-pb / gt3pb-app) | The entire app | Ryan | ☐ ADD | Email recovery on the owner login. ⚠ Upgrade Hobby → Pro (commercial use). |
| **Supabase** (project `hmpxgomiiyjjxxxyzzbg`) | All data, auth, functions | Ryan | ☐ ADD (Org member, Owner role) | Org invite; Pro plan — daily backups + PITR. |
| **Square** (GT3PB Production) | Taking money | Ryan | ☐ ADD (Team member, full access) | Square account recovery; bank link lives here. |
| **GitHub** (hoopsession3/gt3pb-app) | The code | Ryan (personal) | ☐ ADD collaborator → move to org | ⚠ Personal account — move repo to a company org (IP cleanliness, see blind-spot #10). |
| **Domain** (gt3pb.com) | The address | Ryan | ☐ verify registrar + AUTO-RENEW ON | Registrar recovery email must be a reachable inbox. |
| **Twilio** (SMS) | Order texts | Ryan | ☐ ADD | STOP replies are carrier/Twilio-handled automatically; consent copy lives at every phone field. |
| **Resend** (email) | Alert + customer email | Ryan | ☐ ADD | Key in Vercel env `RESEND_API_KEY`. |
| **Apple/Google accounts on the truck phone(s)** | The PWA install, push | Ryan / Kayla | — | PWA reinstalls from app.gt3pb.com in one minute; sign-in is email-link. |

*Checklist convention: tick ☐ items in this file when done, commit the change — the runbook's git history is its audit trail.*

## 2 · Secrets — where they live, when they rotate

- **All server secrets live in Vercel env vars** (Square token, Supabase service key, Twilio, Resend, VAPID, MS/Outlook). None live in the repo. Rotation drill (performed live 2026-07-30 on the Square token): mint new in the provider → paste in Vercel → redeploy → revoke old. Rotate anything that ever touches a screen-share.
- **Supabase service key**: Settings → API. Rotating it requires updating Vercel env `SUPABASE_SERVICE_ROLE*` and the Edge Function secrets.

## 3 · The database restore drill (run it once a quarter)

1. Supabase Dashboard → Backups → confirm last daily backup timestamp.
2. **Restore to a NEW project** (never over prod): Backups → Restore → new project.
   **Then, before anything else, silence the copy** (R14, 2026-10-17 — the 10/10 audit, F19). The copy carries
   production's scheduled jobs and the triggers that hand an alert to the push function — and that function's address
   is PRODUCTION's (0157 wrote it in). Left running, the drill's watchdogs and reminders push to real phones. In the
   drill project's SQL editor (never production's):
   ```sql
   -- every scheduled job off
   select cron.unschedule(jobid) from cron.job;
   -- every trigger that calls out over HTTP off (0157's, 0373's, 0394's, 0399's and the dashboard's webhooks alike)
   do $$ declare r record; begin
     for r in select t.tgrelid::regclass as tbl, t.tgname
                from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
               where not t.tgisinternal and n.nspname = 'supabase_functions' and p.proname = 'http_request'
     loop execute format('alter table %s disable trigger %I', r.tbl, r.tgname); end loop;
   end $$;
   ```
3. Point a local checkout at the restored project (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` in `.env.local`), `npm run dev`, sign in, confirm orders/customers/calendar render.
4. Delete the drill project. Log the drill in Settings → Audit & maintenance.
   ☐ First drill performed: ____ (date, by)

## 4 · The phone-loss drill

Lost/stolen owner phone: (1) from any browser, Supabase → Auth → revoke the user's sessions; (2) Square Dashboard → Devices → sign out device; (3) the PWA holds no secrets — sign-in is email-link, so securing the EMAIL account is the real perimeter. Turn on 2FA for the email account above all else. ☐ Email 2FA on (Ryan) ☐ (Kayla)

## 5 · If the app is down on a truck day

- **What tells you, and how fast** (corrected R14, 2026-10-17 — this line used to promise a critical alert within 10
  minutes; nothing does that):
  - **GitHub Actions › Production** checks `/api/health` every 30 minutes and goes red when the app does not answer.
    GitHub sends a red scheduled run as a notification (Settings → Notifications → Actions — make sure email is on).
    That is the only check from outside today; GitHub can delay or skip a scheduled run under load.
  - If that check itself stops (GitHub pauses schedules after 60 days without a push), the database raises **"The
    uptime check went quiet"** after 90 minutes — *important*, so it pushes to the crew's phones and does not email.
  - A route that throws files itself and a new kind of error raises an alert — while the database is up.
  - Nothing pages a person. An outside monitor that calls or texts is one of the owner's open decisions.
- **What to look at first:** `https://app.gt3pb.com/api/health` (which build, and whether the database answers) — then
  status.vercel.com · status.supabase.com · issquareup.com (Square).
- Square's own Point of Sale app on the phone takes cards independently of our app — the register survives our outage. ☐ Square POS installed on truck phone as fallback
- Menu QR fallback: print the menu (one page, prices) and keep it in the truck bin. ☐ printed
- **Square is down:** a card checkout says so on its own screen. Pay at pickup (crew → Settings → Payments & checkout)
  keeps orders coming in, to be paid in person.
- **Pushes are not arriving:** every alert is still in the console's bell (/crew) — the push is only the doorbell. A
  critical's email goes out through the same push function, so it is down with it: open /crew. The function is
  deployed by hand from `supabase/functions/push` (its file says how); Supabase → Edge Functions → push → Logs says why.

## 6 · If a batch is suspect (recall, 0261)

1. Production log → identify the batch. 2. SQL (or ask the assistant): `select name, phone, drop_date from drop_orders where batch_id = '<id>'` — every customer who received it. 3. Text/call each (order-update texts are consented). 4. Log the incident in Audit & maintenance. Batches are stamped onto packs at pack-out (DropOps "batch?" picker) — **the picker only works if the crew uses it; make it part of pack-out training.**

## 7 · Who to call

Developer of record: this assistant, via Ryan's Claude session (the repo's commit trail is the handbook). Accountant: ____ · Insurance broker: ____ · Counsel: ____ ← fill these in; blind-spot audit #7–#10 explains why each exists.

## 8 · Roll back a bad deploy (R14, 2026-10-17 — the 10/10 audit, F23)

1. **Vercel → gt3pb-app → Deployments → the last good Production deployment → ⋯ → Instant Rollback.** Seconds, no
   rebuild. On the Hobby plan Vercel can roll back only to the deployment just before the current one; Pro can go
   further back. Open tabs reload onto the build that is serving (the app asks `/api/health?from=app-build` which
   build it is).
2. **Then undo the commit on `main`** (a `git revert`, through the same Edits session that pushes), so the next push
   does not ship it again. Check that the fixed push really became production (Deployments → *Current*); if Vercel
   held it after the rollback, promote it (⋯ → Promote).
3. **The database does not roll back with the code.** Look at what was pasted since the good deploy (`/api/migrations`
   lists the applied numbers). Most migrations only add, and the older code runs on them; one that takes a grant away or
   tightens a row rule can break it — then the way back is a new migration, written, reviewed and pasted like any
   other, never an edit of an applied file.
4. **The iPhone app** is its own build: a web rollback changes the API under it, not its screens. A bad build is
   stopped in App Store Connect (pause the phased release, or expire the TestFlight build).
5. **The push function** is deployed by hand: redeploy the last good `supabase/functions/push` from git history.
6. Write down what happened (date, what broke, what rolled back) in Settings → Audit & maintenance.
