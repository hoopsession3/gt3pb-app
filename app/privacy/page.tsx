// PRIVACY — plain-language, right-sized for a one-truck business (2026-08-01 enterprise round P5).
// Static server component; no client JS. NOTE FOR THE OWNER: review with counsel before treating
// this as legal advice — it describes what the app actually does today, in honest words.
// 2026-10-10 (round 2): "we never store a password" stopped being true when password sign-in arrived;
// each paragraph now leads with what it is about, and deleting your account is the app's own button.
export const metadata = { title: "Privacy — GT3 Performance Bar" };

export default function PrivacyPage() {
  return (
    <section className="screen legal">
      <div className="legal-wrap">
        <h1 data-large-title>Privacy</h1>
        <p className="legal-date">GT3 Performance Bar · effective August 2026 · updated October 2026</p>
        <p><b>What we collect.</b> What running your order requires and nothing more: your name for pickup, your email if you sign in or want a receipt, your phone if you give it for order updates, and your order history so your usual is one tap. Delivery orders keep the address you enter, for delivering.</p>
        <p><b>Payments never touch our servers.</b> Card details go directly to Square, our payment processor — we see a confirmation and a masked reference, never your card number. Receipts and refunds run through Square too.</p>
        <p><b>Who sees it.</b> We don&rsquo;t sell your information, we don&rsquo;t run ads, and we don&rsquo;t share your details with anyone except the services that make the app work: Square (payments), our database host, and our email/push providers for messages you asked for — order confirmations, go-live pings you opted into, and account sign-in links.</p>
        <p><b>Notifications and sign-in.</b> Push notifications are opt-in, and each kind can be turned off where you turned it on. You sign in with a link we email you, or with a password if you set one. A password is kept only as a one-way hash by our sign-in provider — no one at GT3 can read it.</p>
        <p><b>Your data, your call.</b> Delete your account any time: open your account, then Delete account. Your profile, contact details, points and progress are deleted; completed orders and payments stay in our books with your name, phone, email and address taken out, for tax and accounting. For a copy of what we hold, reply to any receipt and we&rsquo;ll send it.</p>
        <p className="legal-fine">This page describes the app&rsquo;s actual behavior in plain words. It is not a substitute for legal advice.</p>
      </div>
    </section>
  );
}
