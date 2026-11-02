"use client";
// THE PROPOSITION (IMS8 P12): its own chunk, loaded only when the slide is shown — it carries the money model.
import { useMemo } from "react";
import { shortMoney } from "@/lib/vision";
import type { Vision } from "@/lib/visionRead";
import { propositionOf } from "@/lib/proposition";
import More from "./More";

// THE PROPOSITION (IMS8 P12): the four questions an investor asks, each answered only from what the link holds (lib/proposition)
// — what's funded, how much and for what, the terms modeled in the approved case (not an offer), what's still to happen.
export default function Proposition({ vision }: { vision: Vision }) {
  const pr = useMemo(() => propositionOf(vision), [vision]);
  const t = pr.soughtTotal;
  return (
    <>
      <p className="vp-eyebrow">The proposition</p>
      <h2 className="vp-title">What it&apos;s for, and what it needs.</h2>
      <div className="vp-qs grid grid-cols-1 min-[860px]:grid-cols-2 gap-x-8 gap-y-5">
        <section className="vp-q" aria-label="What is being funded">
          <h3>What&apos;s being funded</h3>
          {pr.funded.map((f) => <p key={f.program} className="vp-lede"><b>{f.program}</b>{f.plans.length ? ` — ${f.plans.join(", ")}` : ""}</p>)}
        </section>
        {pr.has.sought && (
          <section className="vp-q" aria-label="How much is sought">
            <h3>How much is sought</h3>
            <p className="vp-lede">{t.specified > 0 ? `${shortMoney(t.specified)} specified` : "No amount specified yet"}{t.beingPriced ? ` · ${t.beingPriced} being priced` : ""}{t.noneNeeded ? ` · ${t.noneNeeded} need${t.noneNeeded === 1 ? "s" : ""} none` : ""}</p>
            <More items={pr.sought} first={6} word="asks" render={(a, i) => <div key={i} className="vp-ask"><span>{a.label}</span><b>{a.amount}</b><span>{a.state}{a.program ? ` · ${a.program}` : ""}</span></div>} />
          </section>
        )}
        {pr.has.uses && (
          <section className="vp-q" aria-label="How it would be used">
            <h3>How it would be used</h3>
            {pr.uses.map((u) => (
              <div key={u.plan} className="flex flex-col">
                <p className="vp-q-s">{u.plan} · from its approved money case · {shortMoney(u.total)}{u.unpriced ? ` priced, plus ${u.unpriced} line${u.unpriced === 1 ? "" : "s"} not yet priced` : ""}</p>
                {u.lines.map((l) => <div key={l.category} className="vp-ask"><span>{l.word}</span><b>{l.cents ? shortMoney(l.cents) : "Being priced"}</b><span>{l.lines} line{l.lines === 1 ? "" : "s"}{l.unpriced ? ` · ${l.unpriced} not yet priced` : ""}</span></div>)}
              </div>
            ))}
          </section>
        )}
        {pr.has.terms && (
          <section className="vp-q" aria-label="Terms modeled">
            <h3>Terms modeled</h3>
            {pr.terms.map((x) => <p key={x.plan} className="vp-lede"><b>{x.plan}:</b> {x.says}.</p>)}
            <p className="vp-q-s">As modeled in each plan&apos;s approved money case{pr.terms.length === 1 && pr.terms[0].version ? ` (version ${pr.terms[0].version}${pr.terms[0].approved ? `, approved ${pr.terms[0].approved}` : ""})` : ""} — a plan, not an offer. Terms are agreed separately.</p>
          </section>
        )}
        {pr.has.milestones && (
          <section className="vp-q" aria-label="What still has to happen">
            <h3>What still has to happen</h3>
            {pr.milestones.map((m) => (
              <div key={m.plan} className="flex flex-col gap-1">
                <p className="vp-q-s"><b>{m.plan}</b>{m.gate ? ` · goes when: ${m.gate}` : ""}{m.waitsOn.length ? ` · waits on ${m.waitsOn.join(", ")}` : ""}</p>
                {m.needs.length > 0 && <ul className="vp-next"><More items={m.needs} first={4} word={m.needs.length - 4 === 1 ? "step" : "steps"} render={(n, i) => <li key={i}><span>{n.label}</span>{n.due && <b>by {n.due}</b>}</li>} /></ul>}
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
