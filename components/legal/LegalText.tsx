import Link from "next/link";
import type { ReactNode } from "react";
import { TEXTS_HELP_EMAIL } from "@/lib/texts";

// THE TERMS AND THE PRIVACY POLICY, ONCE (2026-10-14, R6). Their words were the two pages' own; now the yes to texts at
// checkout links to them (Twilio's campaign review reads the opt-in for its Terms and Privacy links), and a link that
// left checkout for /terms threw the half-filled order away — so the same words open in a sheet over it
// (components/LegalSheet), and the pages read them from here too. No hooks: the pages stay server components.
//
// THE PRIVACY WORDING (approved by Ryan, 2026-10-14): every service that receives a customer's details is named, with its
// job — the audit's R6 ("the privacy page names the AI provider"); the texts paragraph carries the sentence Twilio's
// reviewers look for, word for word; the notifications paragraph says what the account's Notifications screen does.
// "Push notifications and texts are opt-in" — the approved draft said every kind was, and an order-ready email is on
// until it is turned off, so the sentence says which are.

export type LegalDoc = "terms" | "privacy";

/** A link to the other page: a Next link on the pages, a button that swaps the sheet's page inside one. */
function Other({ to, children, onLink }: { to: LegalDoc; children: ReactNode; onLink?: (to: LegalDoc) => void }) {
  if (onLink) return <button type="button" className="legal-link hit-44" onClick={() => onLink(to)}>{children}</button>;
  return <Link className="legal-link hit-44" href={`/${to}`}>{children}</Link>;
}

export function TermsText({ onLink }: { onLink?: (to: LegalDoc) => void }) {
  return (
    <>
      <p className="legal-date">GT3 Performance Bar · effective August 2026 · updated October 2026</p>
      <p><b>Orders.</b> Ordering through this app is an offer to buy; we confirm it when the order shows as accepted. Pre-orders are made fresh for your pickup window — if we can&rsquo;t fill something (a sold-out batch, a truck problem), we&rsquo;ll refund it in full through Square.</p>
      <p><b>Packs and delivery.</b> Pack reservations with bring-back pricing assume the empties come back — bottles stay yours otherwise at the new-glass price shown at checkout. Delivery orders are prepaid; if a porch delivery fails because the address given was wrong, we&rsquo;ll work it out with you like humans, but we can&rsquo;t guarantee a re-run that day.</p>
      <p id="texts"><b>Texts.</b> Tick &ldquo;Text me&rdquo; at checkout or turn on Texts in Notifications on your account, and GT3 Performance Bar texts you about your packs and deliveries: when one is confirmed, a reminder the day before pickup, and if anything changes. Message frequency varies with your orders. Msg &amp; data rates may apply. Reply <b>STOP</b> to stop, <b>HELP</b> for help. Questions: <span className="whitespace-nowrap">{TEXTS_HELP_EMAIL}</span>. Carriers aren&rsquo;t liable for delayed or undelivered messages. Saying yes is never a condition of buying anything. See the <Other to="privacy" onLink={onLink}>Privacy policy</Other> for how we handle your number.</p>
      <p><b>What can change.</b> Prices, hours, and stops can change — the app always shows the current truth. Memberships and founding perks are personal to your account and aren&rsquo;t transferable.</p>
      <p><b>Conduct and liability.</b> Be decent to the crew and other guests; we can refuse service where that fails. Our liability for any order is limited to what you paid for it.</p>
      <p><b>Questions.</b> Refund questions or anything else: reply to your receipt email or talk to us at the window.</p>
      <p className="legal-fine">Plain words on purpose. Not a substitute for legal advice.</p>
    </>
  );
}

export function PrivacyText() {
  return (
    <>
      <p className="legal-date">GT3 Performance Bar · effective August 2026 · updated October 2026</p>
      <p><b>What we collect.</b> What running your order requires and nothing more: your name for pickup, your email if you sign in or want a receipt, your phone if you give it for order updates, and your order history so your usual is one tap. Delivery orders keep the address you enter, for delivering.</p>
      <p><b>Payments never touch our servers.</b> Card details go directly to Square, our payment processor — we see a confirmation and a masked reference, never your card number. Receipts and refunds run through Square too.</p>
      <p><b>Who sees it.</b> We don&rsquo;t sell your information and we don&rsquo;t run ads. We share your details only with the services that make the app work, each for its own job: Square (payments and receipts), Supabase (our database and sign-in), Vercel (runs the app), Resend (email), Twilio (texts you said yes to), your browser&rsquo;s push service (alerts you turn on), Apple (Sign in with Apple, iPhone alerts, address suggestions as you type), Google (a Google Wallet card, if you add one), Apliiq (prints and ships merch), and Anthropic (the Ask us chat).</p>
      <p><b>Ask us.</b> The Ask us chat is answered by Claude, an AI model made by Anthropic. What you type goes to Anthropic to write the answer, and we keep the conversation to check the answers. Don&rsquo;t type card numbers or passwords into it.</p>
      <p id="texts"><b>Texts.</b> If you say yes to texts, we keep your number and when and where you said yes or stop, and use them only to text you about your own orders. We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes. Your mobile number and consent are never shared with third parties or affiliates for marketing or promotional purposes. Reply STOP to stop or HELP for help, or turn texts off in your account.</p>
      <p><b>Notifications.</b> Push notifications and texts are opt-in, and Notifications in your account turns each kind on or off: order updates, pickup reminders, truck live and texts. Receipts, and any change to an order you&rsquo;ve paid for, always come by email.</p>
      <p><b>Signing in.</b> You sign in with a code we email you (the same email carries a link), or with a password if you set one. In the iPhone app you can also sign in with Apple: Apple shares your name and an email address with us, and can hide your real address behind a private relay one; deleting your account ends GT3&rsquo;s access to your Apple ID. A password is kept only as a one-way hash by our sign-in provider — no one at GT3 can read it.</p>
      <p><b>Your data, your call.</b> Delete your account any time: open your account, then Delete account. Your profile, contact details, points and progress are deleted; completed orders and payments stay in our books with your name, phone, email and address taken out, for tax and accounting. For a copy of what we hold, reply to any receipt and we&rsquo;ll send it.</p>
      <p className="legal-fine">This page describes the app&rsquo;s actual behavior in plain words. It is not a substitute for legal advice.</p>
    </>
  );
}

export const LEGAL_TITLE: Record<LegalDoc, string> = { terms: "Terms", privacy: "Privacy policy" };
