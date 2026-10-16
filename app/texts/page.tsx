// TEXTS FROM GT3 (2026-10-14, R6) — the public page the carriers' reviewers read for the texting program (Twilio's A2P
// 10DLC campaign: "if the form is behind a login, provide a publicly accessible link to screenshots of the form and of the
// post-submission state"). The yes is given at checkout and on the account, both signed in, so this page shows them:
// the box itself (components/TextYes TextYesBox — the same one checkout draws, live), the account's switch, the text that
// confirms a yes, and captures of each from the app. What is sent, how often, what it costs, STOP, HELP and the help
// contact are said here in the Terms' words. Static, and readable without signing in.
import Link from "next/link";
import { TEXTS_HELP_EMAIL, TEXT_YES_CONFIRMATION } from "@/lib/texts";
import TextsOptInDemo from "@/components/TextsOptInDemo";

export const metadata = { title: "Texts", description: "What GT3 Performance Bar texts, how you say yes, and how you stop." };

export default function TextsPage() {
  return (
    <section className="screen legal">
      <div className="legal-wrap">
        <h1 data-large-title>Texts from GT3</h1>
        <p className="legal-date">GT3 Performance Bar · app.gt3pb.com · October 2026</p>
        <p><b>What we text.</b> Only your own orders: when a pack or a delivery is confirmed, a reminder the evening before you pick up a pack, when your bottles are on the porch, and if anything changes — a pickup day moved, a stop called off, a refund. Never marketing. Message frequency varies with your orders. Msg &amp; data rates may apply.</p>
        <p><b>How you say yes.</b> Two places, both off until you turn them on: the box under your phone number at pack or delivery checkout — your order goes through either way — and Texts in Notifications on your account. Saying yes is never a condition of buying anything.</p>
        <TextsOptInDemo />
        <p><b>The text that confirms it.</b> The moment you say yes, we send one text, and nothing else until there is news about your order:</p>
        <div className="mb-4.5 max-w-80" role="img" aria-label={`A text from GT3: ${TEXT_YES_CONFIRMATION}`}><span className="block rounded-[20px_20px_20px_8px] bg-char2 px-3.5 py-2.5 text-subhead leading-snug text-cream">{TEXT_YES_CONFIRMATION}</span></div>
        <p><b>How you stop.</b> Reply <b>STOP</b> to any text — or STOPALL, UNSUBSCRIBE, CANCEL, END or QUIT — or turn Texts off in Notifications. We confirm it once and send nothing more. Reply <b>START</b> to sign up again.</p>
        <p><b>Help.</b> Reply <b>HELP</b>, or email <span className="whitespace-nowrap">{TEXTS_HELP_EMAIL}</span>. Carriers aren&rsquo;t liable for delayed or undelivered messages.</p>
        <figure className="mb-4.5 mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a capture in public/texts; next/image cannot export */}
          <img className="h-auto w-full rounded-xl border border-line" src="/texts/checkout.webp" width={780} height={1688} loading="lazy" decoding="async" alt="Pack checkout in the GT3 app: the phone number, and under it the unticked box to say yes to texts, with Terms and Privacy." />
          {/* eslint-disable-next-line @next/next/no-img-element -- a capture in public/texts; next/image cannot export */}
          <img className="h-auto w-full rounded-xl border border-line" src="/texts/confirmed.webp" width={780} height={1688} loading="lazy" decoding="async" alt="The same checkout once the number has said yes: texts are on for it, with where to turn them off and how to reply STOP." />
          {/* eslint-disable-next-line @next/next/no-img-element -- a capture in public/texts; next/image cannot export */}
          <img className="h-auto w-full rounded-xl border border-line" src="/texts/notifications.webp" width={780} height={1688} loading="lazy" decoding="async" alt="Notifications on a GT3 account: order updates, pickup reminders, truck live, and Texts with its terms under the switch." />
          <figcaption className="col-span-full text-caption text-cream-muted">From the app: pack checkout before and after a yes, and Notifications on the account.</figcaption>
        </figure>
        <p>The <Link className="legal-link hit-44" href="/terms#texts">Terms</Link> and the <Link className="legal-link hit-44" href="/privacy#texts">Privacy policy</Link> say the rest: what we keep when you say yes, and that your number and your yes are never shared for marketing.</p>
      </div>
    </section>
  );
}
