"use client";

import { useRouter } from "next/navigation";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Gt3Mark from "@/components/Gt3Mark";

// OUR CRAFT — the process story. The owner's mandate: "explaining our process is important, the how
// we do it, perfectly design-crafted." Coffee and cocoa are powerful plants that reward care; the
// brand's edge is the care most don't practice. Every claim here lives in the ONE defensible
// register — process + materials truth (what we source, test, and touch it with) — never a
// body-outcome promise. Retired from this page on purpose: "detox," "toxin-free," "low-acid,"
// "mold-free," and any "gene expression" claim. The caffeine molecule is a factual chemical
// diagram (allowed), not the brand mark.
export default function CraftScreen() {
  const router = useRouter();
  return (
    <section className="screen craft" id="s-craft">
      <Watermark variant="landing" />
      <div className="toprow">
        <div className="mast-brand mast-dark">
          <Gt3Mark tone="cream" />
          <span className="pb">Performance Bar</span>
        </div>
        <AccountPill />
      </div>

      {/* HERO — art & chemistry, the molecule */}
      <header className="craft-hero">
        <span className="craft-eye">Our Craft · The How</span>
        <h1 className="craft-h1">We practice <i>art.</i><br />And <i>chemistry.</i></h1>
        <p className="craft-lede">
          Coffee and cocoa are powerful plants. Rushed, they carry what plants carry. Treated as a
          craft — sourced by origin, drawn cold, poured into glass — they give you the good and
          little else. That care is an art most don&rsquo;t practice. We built the bar around it.
        </p>
        <div className="craft-mol">
          <img src="/brand/caffeine-gt3.svg" alt="The caffeine molecule — a purine ring with three methyl groups, the three 3s of GT3" />
          <span className="craft-mol-cap">Caffeine · three methyls, three 3s</span>
        </div>
      </header>

      {/* 01 — THE STANDARD (animal-based-informed) */}
      <div className="craft-sec">
        <span className="craft-sec-n">01 · The Standard</span>
        <h2 className="craft-sec-h">Keep the good. Introduce nothing.</h2>
        <p className="craft-body">
          In the animal-based world, coffee and cocoa sit on the <i>be-careful</i> list — they&rsquo;re
          plants, and plants carry plant-defense compounds. We don&rsquo;t pretend that away. We do the
          work that earns them a place in your day: careful origin sourcing, testing, low-heat
          extraction, and materials that add nothing. Care, not shortcuts. The concerns are real —
          so is the craft that answers them.
        </p>
      </div>

      {/* 02 — THE PROCESS (a real sequence → numbered) */}
      <div className="craft-sec">
        <span className="craft-sec-n">02 · The Process</span>
        <h2 className="craft-sec-h">The how, step by step.</h2>
        <ol className="craft-steps">
          <li className="craft-step">
            <span className="craft-step-n">1</span>
            <div className="craft-step-x">
              <b>Sourced by origin.</b>
              <p>A plant draws what its soil and drying give it — so origin is the first lever. We
              choose careful producers and test to keep the cup clean and well within accepted
              limits. Not a promise of zero; a promise of <i>watched</i>.</p>
            </div>
          </li>
          <li className="craft-step">
            <span className="craft-step-n">2</span>
            <div className="craft-step-x">
              <b>Drawn cold.</b>
              <p>Cold-extracted — steeped slow in cool water for hours, never rushed with heat. The
              result is smoother and less bitter: the coffee, unhurried, giving its best character
              instead of its harshest.</p>
            </div>
          </li>
          <li className="craft-step">
            <span className="craft-step-n">3</span>
            <div className="craft-step-x">
              <b>Poured into glass.</b>
              <p>Glass and food-grade stainless at every point the coffee touches — inert by nature,
              so nothing migrates in: no BPA, no BPS, no plastic plasticizers. We control what&rsquo;s
              <i>in</i> the bottle by controlling what it <i>touches</i>.</p>
            </div>
          </li>
          <li className="craft-step">
            <span className="craft-step-n">4</span>
            <div className="craft-step-x">
              <b>Made the moment you order.</b>
              <p>Nothing sits, nothing&rsquo;s preserved into shelf-life. It&rsquo;s fresh because it&rsquo;s
              built in front of you — the last, unfakeable step of the craft.</p>
            </div>
          </li>
        </ol>
      </div>

      {/* 03 — EVERY CONTACT POINT (materials, incl. the honest closures nuance) */}
      <div className="craft-sec">
        <span className="craft-sec-n">03 · Every Contact Point</span>
        <h2 className="craft-sec-h">Every point it touches, questioned.</h2>
        <p className="craft-body">
          Glass earns its place because it&rsquo;s inert — it doesn&rsquo;t shed the plasticizers or
          microplastics associated with plastic contact surfaces. But we don&rsquo;t stop at the bottle.
          The cap, the seal, every surface between the coffee and your hand gets the same single
          question: <i>does this introduce anything?</i> If it does, it&rsquo;s out. Glass earns the
          win — the closures have to earn it too. That&rsquo;s the whole discipline: chosen materials,
          not hoped-for outcomes.
        </p>
        <div className="craft-mats">
          <span className="craft-mat">Glass</span>
          <span className="craft-mat">Food-grade stainless</span>
          <span className="craft-mat">Inert closures</span>
          <span className="craft-mat">No plastic contact</span>
        </div>
      </div>

      {/* 04 — THE MARK (the molecule = GT3) */}
      <div className="craft-sec">
        <span className="craft-sec-n">04 · The Mark</span>
        <h2 className="craft-sec-h">Three methyls. Three 3s. GT3.</h2>
        <p className="craft-body">
          Caffeine is one elegant molecule — a purine ring with three methyl groups at its nearest
          points. Three 3s, written into the chemistry itself. We didn&rsquo;t invent the coincidence;
          it&rsquo;s the structure. It&rsquo;s on the shirt. It&rsquo;s on the truck. It&rsquo;s the bar. Art meets
          chemistry, and they were the same thing all along.
        </p>
      </div>

      {/* CLOSE */}
      <div className="craft-close">
        <p className="craft-close-line">Perfectly design-crafted.</p>
        <div className="craft-cta">
          <button className="craft-cta-b" onClick={() => router.push("/menu")}>See the menu →</button>
          <button className="craft-cta-b ghost" onClick={() => router.push("/reserve")}>Reserve a drop</button>
        </div>
      </div>

      <div className="signoff">Pure Signal, No Noise.</div>
    </section>
  );
}
