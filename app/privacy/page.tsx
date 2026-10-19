// PRIVACY — plain-language, right-sized for a one-truck business (2026-08-01 enterprise round P5).
// Static server component; no client JS. NOTE FOR THE OWNER: review with counsel before treating
// this as legal advice — it describes what the app actually does today, in honest words.
// 2026-10-10 (round 2): "we never store a password" stopped being true when password sign-in arrived;
// each paragraph now leads with what it is about, and deleting your account is the app's own button.
// 2026-10-14 (R6): "Privacy policy", as the carriers' review looks for it; every service that receives a customer's
// details named (the AI provider among them); texts and notifications said as they now work. The words live in
// components/legal/LegalText, so the yes to texts at checkout opens them in a sheet over the order.
import { PrivacyText } from "@/components/legal/LegalText";
import { pageMeta } from "@/lib/seo";

// Its name, and what search and a share card say about it (R42, lib/seo): its own description, canonical address and card.
export const metadata = { title: "Privacy policy", ...pageMeta("/privacy") };

export default function PrivacyPage() {
  return (
    <section className="screen legal">
      <div className="legal-wrap">
        <h1 data-large-title>Privacy policy</h1>
        <PrivacyText />
      </div>
    </section>
  );
}
