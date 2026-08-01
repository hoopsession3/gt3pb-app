// PRIVACY — plain-language, right-sized for a one-truck business (2026-08-01 enterprise round P5).
// Static server component; no client JS. NOTE FOR THE OWNER: review with counsel before treating
// this as legal advice — it describes what the app actually does today, in honest words.
export const metadata = { title: "Privacy — GT3 Performance Bar" };

export default function PrivacyPage() {
  return (
    <section className="screen legal">
      <div className="legal-wrap">
        <h1>Privacy</h1>
        <p className="legal-date">GT3 Performance Bar · effective August 2026</p>
        <p>We collect what running your order requires and nothing more: your name for pickup, your email if you sign in or want a receipt, your phone if you give it for order updates, and your order history so your usual is one tap. Delivery orders keep the address you enter, for delivering.</p>
        <p><b>Payments never touch our servers.</b> Card details go directly to Square, our payment processor — we see a confirmation and a masked reference, never your card number. Receipts and refunds run through Square too.</p>
        <p>We don&rsquo;t sell your information, we don&rsquo;t run ads, and we don&rsquo;t share your details with anyone except the services that make the app work: Square (payments), our database host, and our email/push providers for messages you asked for — order confirmations, go-live pings you opted into, and account sign-in links.</p>
        <p>Push notifications are opt-in and every category can be turned off where you turned it on. Sign-in uses email links — we never store a password.</p>
        <p>Want your data or want it gone? Email us at the address on your receipt and we&rsquo;ll export or delete your customer record. Some records we must keep (completed payment records, for tax and accounting law).</p>
        <p className="legal-fine">This page describes the app&rsquo;s actual behavior in plain words. It is not a substitute for legal advice.</p>
      </div>
    </section>
  );
}
