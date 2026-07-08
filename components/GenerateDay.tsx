"use client";

import { useState } from "react";
import { useApp } from "./AppProvider";
import { DRINKS, type DrinkId } from "@/lib/menu";

// ─── answer types ─────────────────────────────────────────────────────────────
type Sleep    = "great" | "good" | "rough" | "wrecked";
type Body     = "fresh" | "normal" | "sore" | "beaten";
type Workload = "deep" | "meetings" | "mixed" | "light";
type Training = "heavy" | "light" | "none";
type Energy   = "high" | "mid" | "low" | "empty";
type Flag     = "gut" | "dehydrated" | "joints" | "stress" | "fatigue" | "sick";

interface Complete {
  sleep: Sleep; body: Body; workload: Workload; training: Training; energy: Energy;
  flags: Set<Flag>;
}

interface RecDrink { id: DrinkId; timing: string; science: string; role: string }
interface Rec { state: string; sub: string; drinks: RecDrink[]; straight: string; story: string }

// each drink's job in the day's arc — the anticipatory "what this is for" a guest wants to see
const ROLE: Record<DrinkId, string> = {
  rise: "Open the day clear", flow: "Carry the deep work", dusk: "Ease into the day",
  kingme: "The same lift, nitro-smooth", maple: "A clean afternoon treat",
  tide: "Hydrate through it", aide: "Hydrate through it",
  forge: "Rebuild after", hunt: "Rebuild after", wild: "Rebuild after",
};

// ─── recommendation engine ────────────────────────────────────────────────────
function buildRec(a: Complete): Rec {
  // ── S1: which Activate drink ──
  let rise = 0, flow = 0, dusk = 0;
  if (a.sleep === "wrecked" || a.sleep === "rough") dusk += 4;
  if (a.sleep === "great") { rise += 2; flow += 2; }
  if (a.sleep === "good")  { rise += 1; flow += 1; }
  if (a.workload === "deep")     flow += 4;
  if (a.workload === "meetings") { dusk += 2; flow += 1; }
  if (a.workload === "light")    rise += 3;
  if (a.workload === "mixed")    { rise += 2; flow += 1; }
  if (a.energy === "empty" || a.energy === "low") dusk += 3;
  if (a.energy === "high") { rise += 1; flow += 1; }
  if (a.flags.has("stress")) dusk += 3;
  if (a.flags.has("sick"))   dusk += 2;
  if (a.training === "heavy") flow += 1;
  const s1: DrinkId = dusk >= flow && dusk >= rise ? "dusk" : flow >= rise ? "flow" : "rise";

  // ── S2: TIDE when physical demand exists ──
  const needsTide = a.training !== "none"
    || a.flags.has("dehydrated")
    || a.body === "sore" || a.body === "beaten";
  const s2: DrinkId | null = needsTide ? "tide" : null;

  // ── S3: which Rebuild drink ──
  let forge = 0, hunt = 0, wild = 0;
  if (a.training === "heavy") { forge += 3; hunt += 2; }
  if (a.training === "light") { forge += 1; wild += 1; }
  if (a.flags.has("joints"))  forge += 4;
  if (a.flags.has("gut"))     wild  += 4;
  if (a.flags.has("sick"))    forge += 3;
  if (a.flags.has("fatigue")) hunt  += 4;
  if (a.body === "beaten")    { forge += 2; hunt += 2; }
  if (a.body === "sore")      forge += 3;
  if (a.workload === "light" && a.training === "none") wild += 2;
  const s3: DrinkId = forge >= hunt && forge >= wild ? "forge" : hunt >= wild ? "hunt" : "wild";

  // ── Hero copy ──
  const drained = a.sleep === "wrecked" || a.sleep === "rough" || a.energy === "empty";
  const primed  = (a.sleep === "great" || a.sleep === "good") && (a.energy === "high" || a.energy === "mid");
  const lifting = a.training === "heavy" || a.training === "light";

  let state: string, sub: string;
  if (drained && lifting) {
    state = "Grind carefully.";
    sub   = "Low reserves and you're training — the stack is about protecting you, not breaking records. Earn it back with the rebuild.";
  } else if (drained) {
    state = "Hold the standard.";
    sub   = "Not your best day, and that's data. Your stack manages energy without borrowing from tomorrow.";
  } else if (primed && lifting) {
    state = "Build today.";
    sub   = "Full reserves and a training session. Your stack front-loads the energy and closes with a real rebuild window.";
  } else if (primed) {
    state = "Drive today.";
    sub   = "You've got the recovery capital — put it into the hard thing first, then refuel on the way out.";
  } else if (lifting) {
    state = "Earn it today.";
    sub   = "Training day. The stack sets you up, keeps you moving, and brings you back after.";
  } else {
    state = "Maintain your standard.";
    sub   = "Steady day. The stack keeps you level — no borrowing from tomorrow, no energy debt.";
  }

  // ── What it is · why it fits (ingredient- and process-led; never a health/medical claim) ──
  const sci: Record<DrinkId, string> = {
    rise:  "Single-origin coffee, cold-extracted ~18 hours, finished with organic coconut water. A clean, even lift to open the day — rounder and less bitter than hot. Same caffeine as Flow and Dusk (~210 mg/10 oz, estimated until lab-verified).",
    flow:  "The same cold-extraction base, infused with organic cacao nibs. Reads richer and steadier for heads-down work — no added sugar, same caffeine as the rest of the line.",
    dusk:  "Ceylon cinnamon and green cardamom over the same cold-extraction base. Warm and spiced for the back half of the day — same caffeine as Rise and Flow, not a wind-down.",
    kingme: "Our FLOW brew served on nitrogen — a velvety, naturally creamy, subtly sweet texture from microbubbles, nothing added. Same clean cold-extraction base.",
    maple: "Organic A2 grass-fed goat milk with organic maple and a pinch of sea salt. Rich, naturally sweet and smooth — a treat that still names every ingredient.",
    tide:  "Whole-food hydration — young coconut water blended with young organic Thai coconut meat and a touch of organic local honey (we always name it). Blended to order, never a powder or concentrate.",
    aide:  "Coconut water and mineral water with organic maple and a pinch of sea salt. Light, clean hydration for the middle of the work — real ingredients, not a powder.",
    forge: "Slow-simmered beef bone broth, pasture-raised. Deep, rich and mineral-forward — real food for the rebuild after training, not a supplement.",
    hunt:  "Slow-simmered bison bone broth, pasture-raised. Leaner than beef with a little more iron and zinc — savory fuel for the window after a session.",
    wild:  "Slow-simmered ostrich bone broth, pasture-raised. Our lightest, leanest broth — easy to sit with when your gut is sensitive.",
  };

  const timing: Record<DrinkId, string> = {
    rise:  "30 min before first task",
    flow:  "30 min before deep work or training",
    dusk:  "Morning or mid-morning window",
    kingme: "30 min before deep work or training",
    maple: "Morning or afternoon treat",
    tide:  "During work or training",
    aide:  "During work or training",
    forge: "Post-training · within 60 min",
    hunt:  "Post-training · within 60 min",
    wild:  "Post-training or evening",
  };

  const drinks: RecDrink[] = [
    { id: s1, timing: timing[s1], science: sci[s1], role: ROLE[s1] },
    ...(s2 ? [{ id: s2 as DrinkId, timing: timing[s2], science: sci[s2], role: ROLE[s2] }] : []),
    { id: s3, timing: timing[s3], science: sci[s3], role: ROLE[s3] },
  ];

  // The user story — the day, sequenced forward, so the guest can picture how it plays out.
  const nm = (id: DrinkId) => DRINKS[id].n;
  const story = s2
    ? `Here's how the day flows: ${nm(s1)} to open, ${nm(s2)} to carry you through the work, then ${nm(s3)} to rebuild after. One sequence — start, sustain, recover.`
    : `Here's how the day flows: ${nm(s1)} to open the work, then ${nm(s3)} to rebuild after. Start, then recover — skip what you don't need.`;

  // ── Straight talk: plain, honest guidance — flavor + timing, never a physiological claim ──
  const bits: string[] = [];
  if (drained)
    bits.push("On rough sleep, Dusk is the pick — same lift as the others, but the warm cinnamon and cardamom make it an easier cup to sit with.");
  if (s1 === "flow")
    bits.push("Flow is the deep-work pour — the cacao gives it a richer, steadier feel than a straight cup, with no added sugar.");
  if (s3 === "forge" && lifting)
    bits.push("After a lift, Forge is the rebuild — slow-simmered beef bone broth, pasture-raised and mineral-rich. Best within the hour while you're winding down.");
  if (a.flags.has("gut"))
    bits.push("Gut-sensitive day? Wild is the lightest broth we make — slow-simmered ostrich, leaner and easier to sit with than beef or bison.");
  if (a.flags.has("fatigue"))
    bits.push("Run down? Hunt's bison broth leans a little richer in iron and zinc than beef — a savory way to refuel after the work.");
  if (!s2 && !a.flags.has("dehydrated"))
    bits.push("Tide didn't make your stack — your inputs don't flag hydration. On a low-movement day it's optional; add it if you're training or the afternoon drags.");

  const straight = bits.slice(0, 2).join(" ") ||
    "The idea is sequence: something to start the work, something to carry you through it, something to rebuild after. Pick the ones that match the day — skip what you don't need.";

  return { state, sub, drinks, straight, story };
}

// ─── component ────────────────────────────────────────────────────────────────
export default function GenerateDay() {
  const { bump, isInCart, toast } = useApp();

  const [sleep,    setSleep]    = useState<Sleep | null>(null);
  const [body,     setBody]     = useState<Body | null>(null);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [training, setTraining] = useState<Training | null>(null);
  const [energy,   setEnergy]   = useState<Energy | null>(null);
  const [flags,    setFlags]    = useState<Set<Flag>>(new Set());
  const [rec,      setRec]      = useState<Rec | null>(null);
  const [openSci,  setOpenSci]  = useState<string | null>(null); // one card's science open at a time
  const [busy,     setBusy]     = useState(false);

  const toggleFlag = (f: Flag) =>
    setFlags((prev) => { const next = new Set(prev); next.has(f) ? next.delete(f) : next.add(f); return next; });

  const ready = sleep && body && workload && training && energy;

  const generate = () => {
    if (!sleep || !body || !workload || !training || !energy) return;
    setBusy(true);
    setTimeout(() => {
      setRec(buildRec({ sleep, body, workload, training, energy, flags }));
      setBusy(false);
    }, 850);
  };

  const addStack = () => {
    if (!rec) return;
    rec.drinks.forEach((d) => { if (!isInCart(d.id)) bump(d.id); });
    toast(`Stack added — ${rec.drinks.map((d) => DRINKS[d.id].n).join(", ")}`);
  };

  // ── results ──
  if (rec) {
    return (
      <>
        <div className="hero"><div className="hin">
          <div className="hero-top"><div className="hero-eye">Today&apos;s read</div></div>
          <div className="hero-state">{rec.state}</div>
          <div className="hero-sub">{rec.sub}</div>
        </div></div>

        <div className="sec">Your day, in order</div>
        <div className="gen-day">
          {rec.drinks.map((d, i) => (
            <div key={d.id} className={`step s-${i === 0 ? "sun" : i === rec.drinks.length - 1 ? "broth" : "cup"}`}>
              <div className="ic">{i + 1}</div>
              <div className="sx"><b>{DRINKS[d.id].n}</b><span>{d.role}</span></div>
              <div className="tm">{d.timing}</div>
            </div>
          ))}
        </div>
        <div className="sec">Your stack · what&apos;s in it</div>

        {rec.drinks.map((d) => {
          const dk = DRINKS[d.id];
          return (
            <div key={d.id} className="gen-card" style={{ borderLeft: `3px solid ${dk.dot}` }}>
              <button type="button" className="gen-card-top" onClick={() => setOpenSci(openSci === d.id ? null : d.id)} aria-expanded={openSci === d.id}>
                <div className="gen-swatch" style={{ color: dk.dot, borderColor: dk.dot }}>{dk.n.charAt(0)}</div>
                <div className="gen-card-meta">
                  <div className="gen-card-name">{dk.n}</div>
                </div>
                <div className="gen-badge">{dk.when}</div>
                <span className={`gen-sci-caret${openSci === d.id ? " open" : ""}`} aria-hidden>›</span>
              </button>
              {openSci === d.id && <p className="gen-science">{d.science}</p>}
            </div>
          );
        })}

        <div className="honest"><b>Straight talk:</b> {rec.straight}</div>

        <button className="handle" onClick={addStack} style={{ marginTop: 18 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12l5 5L20 7" /></svg>
          <span>Add my stack</span>
        </button>

        <button
          className="auth-link"
          onClick={() => setRec(null)}
          style={{ marginTop: 14, display: "block", textAlign: "center", width: "100%" }}
        >
          ← Regenerate
        </button>

        <div className="signoff">Your standard. Built for today.</div>
      </>
    );
  }

  // ── form ──
  return (
    <>
      <div className="gen-q">
        <div className="gen-ql">Sleep last night</div>
        <div className="gen-opts">
          {([ ["great","Great  8h+"], ["good","Good  6–8h"], ["rough","Rough  4–6h"], ["wrecked","Wrecked  <4h"] ] as [Sleep,string][]).map(([v,l]) => (
            <button key={v} className={`gen-opt${sleep === v ? " sel" : ""}`} onClick={() => setSleep(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="gen-q">
        <div className="gen-ql">Body feels</div>
        <div className="gen-opts">
          {([ ["fresh","Fresh"], ["normal","Normal"], ["sore","Sore"], ["beaten","Beat up"] ] as [Body,string][]).map(([v,l]) => (
            <button key={v} className={`gen-opt${body === v ? " sel" : ""}`} onClick={() => setBody(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="gen-q">
        <div className="gen-ql">Workload today</div>
        <div className="gen-opts">
          {([ ["deep","Deep work"], ["meetings","Meetings heavy"], ["mixed","Mixed"], ["light","Light day"] ] as [Workload,string][]).map(([v,l]) => (
            <button key={v} className={`gen-opt${workload === v ? " sel" : ""}`} onClick={() => setWorkload(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="gen-q">
        <div className="gen-ql">Training today</div>
        <div className="gen-opts">
          {([ ["heavy","Lifting · heavy"], ["light","Lifting · light"], ["none","No session"] ] as [Training,string][]).map(([v,l]) => (
            <button key={v} className={`gen-opt${training === v ? " sel" : ""}`} onClick={() => setTraining(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="gen-q">
        <div className="gen-ql">Energy right now</div>
        <div className="gen-opts">
          {([ ["high","High"], ["mid","Mid"], ["low","Low"], ["empty","Running on empty"] ] as [Energy,string][]).map(([v,l]) => (
            <button key={v} className={`gen-opt${energy === v ? " sel" : ""}`} onClick={() => setEnergy(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="gen-q">
        <div className="gen-ql">
          Anything else?&nbsp;<span style={{ fontWeight: 400, opacity: 0.45, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>optional</span>
        </div>
        <div className="chips">
          {([ ["gut","Gut sensitive"], ["dehydrated","Dehydrated"], ["joints","Joint soreness"], ["stress","High stress"], ["fatigue","Low iron / fatigue"], ["sick","Under the weather"] ] as [Flag,string][]).map(([f,l]) => (
            <button key={f} className={`chip${flags.has(f) ? " sel" : ""}`} onClick={() => toggleFlag(f)}>{l}</button>
          ))}
        </div>
      </div>

      <button
        className="handle"
        disabled={!ready || busy}
        onClick={generate}
        style={{ marginTop: 22 }}
      >
        <span>{busy ? "Reading your inputs…" : "Generate my stack"}</span>
      </button>
    </>
  );
}
