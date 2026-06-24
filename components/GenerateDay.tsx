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

interface RecDrink { id: DrinkId; timing: string; science: string }
interface Rec { state: string; sub: string; drinks: RecDrink[]; straight: string }

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

  // ── Science copy ──
  const sci: Record<DrinkId, string> = {
    rise:  "Caffeine + coconut MCTs: MCTs bypass first-pass metabolism and cross the blood-brain barrier ~30 min post-intake, providing ketone-adjacent fuel independent of blood glucose. Clean cortical activation without the glycemic spike.",
    flow:  "Caffeine + theobromine from cacao: theobromine is a PDE inhibitor that extends cAMP signaling in neurons — giving you a longer, calmer focus arc than caffeine alone, plus mild vasodilation for increased cerebral blood flow during sustained work.",
    dusk:  "Cinnamon and cardamom give Dusk a warm, settling flavor for the back half of the day. Same single-origin cold extraction and caffeine as Rise and Flow — the difference is in the cup, not the lift.",
    tide:  "A whole-food hydration base: young coconut water and blended coconut meat for potassium, magnesium and sodium, finished with a touch of raw honey for fast-burning carbohydrate. Not a powder, concentrate, or isolate.",
    forge: "Glycine 8–10g/bottle + proline + hydroxyproline → the three amino acids required for type I & II collagen synthesis. Glycine is also rate-limiting for glutathione production (master antioxidant) and directly modulates NMDA receptors for CNS calm post-effort.",
    hunt:  "Bison broth runs ~2× the iron and zinc of beef with a leaner fat profile and higher CLA content. CLA reduces muscle catabolism and upregulates innate immune pathways — critical if you're overreaching or flagging. Iron + B12 restore erythrocyte function faster than supplementation alone.",
    wild:  "Ostrich is one of the leanest high-protein sources — very low saturated fat, high in lysine and arginine (tissue repair and vasodilation), rare amino acid branching profile. The rebuild without the digestive load when your gut is sensitive.",
  };

  const timing: Record<DrinkId, string> = {
    rise:  "30 min before first task",
    flow:  "30 min before deep work or training",
    dusk:  "Morning or mid-morning window",
    tide:  "During work or training",
    forge: "Post-training · within 60 min",
    hunt:  "Post-training · within 60 min",
    wild:  "Post-training or evening",
  };

  const drinks: RecDrink[] = [
    { id: s1, timing: timing[s1], science: sci[s1] },
    ...(s2 ? [{ id: s2 as DrinkId, timing: timing[s2], science: sci[s2] }] : []),
    { id: s3, timing: timing[s3], science: sci[s3] },
  ];

  // ── Straight talk: most relevant biochem insight ──
  const bits: string[] = [];
  if (drained)
    bits.push("On rough sleep, Dusk is the pick for its warm cinnamon-and-cardamom profile — the gentler-tasting way to take your coffee. It's the same lift as the others; the spice just makes it an easier cup to sit with.");
  if (s1 === "flow")
    bits.push("Theobromine isn't a caffeine sidekick. It's a PDE inhibitor that keeps cAMP elevated in neurons longer — that's the mechanism behind the calmer focus arc without the cortisol hit of a double shot.");
  if (s3 === "forge" && lifting)
    bits.push("Post-lift collagen synthesis peaks in the 30–60 min window. Glycine is the rate-limiting amino acid for collagen production — so the timing on FORGE isn't advisory, it's the biology.");
  if (a.flags.has("gut"))
    bits.push("Gut-sensitive days call for WILD. Beef and bison broths are excellent but their fat load increases bile demand. Ostrich's near-zero fat profile adds zero additional digestive burden.");
  if (a.flags.has("fatigue"))
    bits.push("When iron and zinc are taxed from overtraining or illness, HUNT's bison profile is meaningfully different — ~2× the iron and zinc of beef, plus CLA to support immune function, not just muscle.");
  if (!s2 && !a.flags.has("dehydrated"))
    bits.push("TIDE didn't make your stack — your inputs don't flag hydration stress. On a sedentary day it's not mandatory. But if the 2pm drag hits, that's often sub-clinical dehydration before thirst even kicks in.");

  const straight = bits.slice(0, 2).join(" ") ||
    "Sequencing is the unlock: S1 primes your nervous system, S2 sustains performance and fluid balance, S3 starts cellular repair. Skip a step and the debt shows up as 'a rough day' 48 hours later.";

  return { state, sub, drinks, straight };
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

        <div className="sec">Your stack · built</div>

        {rec.drinks.map((d) => {
          const dk = DRINKS[d.id];
          return (
            <div key={d.id} className="gen-card" style={{ borderLeft: `3px solid ${dk.dot}` }}>
              <div className="gen-card-top">
                <div className="gen-swatch" style={{ color: dk.dot, borderColor: dk.dot }}>{dk.n.charAt(0)}</div>
                <div className="gen-card-meta">
                  <div className="gen-card-name">{dk.n}</div>
                  <div className="gen-card-time">{d.timing}</div>
                </div>
                <div className="gen-badge">{dk.when}</div>
              </div>
              <p className="gen-science">{d.science}</p>
            </div>
          );
        })}

        <div className="honest"><b>Straight talk:</b> {rec.straight}</div>

        <button className="handle" onClick={addStack} style={{ marginTop: 18 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12l5 5L20 7" /></svg>
          <span>Add my stack<span className="sm">{rec.drinks.map((d) => DRINKS[d.id].n).join(" · ")}</span></span>
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
