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
3. Point a local checkout at the restored project (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` in `.env.local`), `npm run dev`, sign in, confirm orders/customers/calendar render.
4. Delete the drill project. Log the drill in Settings → Audit & maintenance.
   ☐ First drill performed: ____ (date, by)

## 4 · The phone-loss drill

Lost/stolen owner phone: (1) from any browser, Supabase → Auth → revoke the user's sessions; (2) Square Dashboard → Devices → sign out device; (3) the PWA holds no secrets — sign-in is email-link, so securing the EMAIL account is the real perimeter. Turn on 2FA for the email account above all else. ☐ Email 2FA on (Ryan) ☐ (Kayla)

## 5 · If the app is down on a truck day

- The app self-reports server errors and the watchdog raises a critical alert within 10 minutes (round 30k). Check email/Teams.
- Square's own Point of Sale app on the phone takes cards independently of our app — the register survives our outage. ☐ Square POS installed on truck phone as fallback
- Menu QR fallback: print the menu (one page, prices) and keep it in the truck bin. ☐ printed
- Vercel/Supabase status pages: status.vercel.com · status.supabase.com.

## 6 · If a batch is suspect (recall, 0261)

1. Production log → identify the batch. 2. SQL (or ask the assistant): `select name, phone, drop_date from drop_orders where batch_id = '<id>'` — every customer who received it. 3. Text/call each (order-update texts are consented). 4. Log the incident in Audit & maintenance. Batches are stamped onto packs at pack-out (DropOps "batch?" picker) — **the picker only works if the crew uses it; make it part of pack-out training.**

## 7 · Who to call

Developer of record: this assistant, via Ryan's Claude session (the repo's commit trail is the handbook). Accountant: ____ · Insurance broker: ____ · Counsel: ____ ← fill these in; blind-spot audit #7–#10 explains why each exists.
