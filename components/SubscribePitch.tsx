"use client";

import { useRouter } from "next/navigation";
import { SUB_PACKS } from "@/lib/square";

// The subscription, told as a story (ritual + savings + the packs) and surfaced on
// the front door — not buried behind sign-in. Routes into the subscribe flow.
export default function SubscribePitch() {
  const router = useRouter();
  return (
    <section className="subpitch">
      <div className="eyb">Subscription</div>
      <h2>Your coffee, always ready.</h2>
      <p>Pick a pack — 6, 12, or 18 cups — and we&apos;ll have it ready for you every two weeks.</p>
      <div className="subpitch-packs">
        {SUB_PACKS.map((p) => (
          <div className="subpitch-pack" key={p.key}>
            <b>{p.size}</b><span>cups</span><em>{p.price}</em>
          </div>
        ))}
      </div>
      <button type="button" className="subpitch-cta" onClick={() => router.push("/3mpire")}>Set it up</button>
      <div className="subpitch-fine">Every two weeks. Pause or cancel anytime.</div>
    </section>
  );
}
