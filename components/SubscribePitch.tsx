"use client";

import { useRouter } from "next/navigation";
import { SUB_PACKS, SUB_CADENCE } from "@/lib/square";

// The subscription, told as a story (ritual + savings + the packs) and surfaced on
// the front door — not buried behind sign-in. Routes into the subscribe flow.
export default function SubscribePitch() {
  const router = useRouter();
  return (
    <section className="subpitch">
      <div className="eyb">The subscription</div>
      <h2>Your coffee, every two weeks.</h2>
      <p>Cold-extracted RISE, FLOW or DUSK — packed and waiting. Skip the line, never run out, and save up to 30% a cup.</p>
      <div className="subpitch-packs">
        {SUB_PACKS.map((p) => (
          <div className="subpitch-pack" key={p.key}>
            <b>{p.size}</b><span>cups</span><em>{p.price}</em>
          </div>
        ))}
      </div>
      <button type="button" className="subpitch-cta" onClick={() => router.push("/3mpire")}>Start your subscription</button>
      <div className="subpitch-fine">Pause or cancel anytime · billed {SUB_CADENCE}</div>
    </section>
  );
}
