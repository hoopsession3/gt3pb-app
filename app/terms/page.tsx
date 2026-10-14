// TERMS — plain-language, right-sized (2026-08-01 enterprise round P5). Static server component.
// NOTE FOR THE OWNER: review with counsel before treating this as legal advice.
// 2026-10-14 (R6): the words live in components/legal/LegalText, so the yes to texts at checkout opens the same Terms in a
// sheet over the order; the Texts section is the one Twilio's campaign review reads (program, frequency, rates, HELP and
// STOP, the help contact, carriers not liable, a link to the Privacy policy).
import { TermsText } from "@/components/legal/LegalText";

export const metadata = { title: "Terms — GT3 Performance Bar" };

export default function TermsPage() {
  return (
    <section className="screen legal">
      <div className="legal-wrap">
        <h1 data-large-title>Terms</h1>
        <TermsText />
      </div>
    </section>
  );
}
