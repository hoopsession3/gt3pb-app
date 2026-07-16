"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, roleOf, isStaff } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import Skeleton from "@/components/Skeleton";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import { supabase } from "@/lib/supabase";
import Icon from "@/components/Icon";
import {
  PRODUCTS, CERTS, ROLES, READINESS, PASS_DEFAULT, ACKS, ackByKey, certExpiryDays,
  moduleBySlug, certByKey, pathForRole, certEarned, requiredModules, sectionMeta,
  type Module, type Product, type QuizQ, type Role, type Ack,
} from "@/lib/academy";

type View = { k: "home" } | { k: "module"; slug: string } | { k: "product"; key: string } | { k: "team" } | { k: "ack"; key: string };
interface Assignment { target_type: string; target_key: string; due_at: string | null }
const DAY = 86400000;


// The app's account roles (member/server/admin/owner) map onto Academy roles.
// Event-manager and contractor are Academy-only paths until profiles carry them.
const APP_TO_ACADEMY: Record<string, Role> = {
  owner: "founder", admin: "admin", event_manager: "event_manager",
  operator: "operator", server: "operator", contractor: "contractor", member: "staff",
};
const toAcademyRole = (appRole: string): Role => APP_TO_ACADEMY[appRole] ?? "staff";

export default function AcademyPage() {
  const { ready, enabled, user, profile } = useAuth();
  const { toast } = useApp();
  const role = toAcademyRole(roleOf(profile));
  const [progress, setProgress] = useState<Record<string, { status: string; best_score: number | null }>>({});
  const [certs, setCerts] = useState<Set<string>>(new Set());
  const [certExp, setCertExp] = useState<Record<string, string | null>>({});
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>({ k: "home" });

  const load = useCallback(async () => {
    if (!supabase || !user) return;
    // assignments/acks tables may not exist pre-0031 — queries fail soft to [].
    const [{ data: pr }, { data: ce }, { data: asg }, { data: ak }] = await Promise.all([
      supabase.from("academy_progress").select("module_slug,status,best_score").eq("user_id", user.id),
      supabase.from("academy_certifications").select("cert_key,expires_at").eq("user_id", user.id),
      supabase.from("academy_assignments").select("target_type,target_key,due_at").eq("user_id", user.id),
      supabase.from("academy_acknowledgements").select("doc_key").eq("user_id", user.id),
    ]);
    const p: Record<string, { status: string; best_score: number | null }> = {};
    (pr ?? []).forEach((r: { module_slug: string; status: string; best_score: number | null }) => { p[r.module_slug] = { status: r.status, best_score: r.best_score }; });
    setProgress(p);
    setCerts(new Set((ce ?? []).map((r: { cert_key: string }) => r.cert_key)));
    setCertExp(Object.fromEntries((ce ?? []).map((r: { cert_key: string; expires_at: string | null }) => [r.cert_key, r.expires_at])));
    setAssignments((asg ?? []) as Assignment[]);
    setAcks(new Set((ak ?? []).map((r: { doc_key: string }) => r.doc_key)));
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const completed = useMemo(() => new Set(Object.entries(progress).filter(([, v]) => v.status === "complete").map(([k]) => k)), [progress]);
  // earned = persisted certs ∪ certs derivable from completed modules
  const earned = useMemo(() => {
    const s = new Set(certs);
    CERTS.forEach((c) => { if (certEarned(c, completed)) s.add(c.key); });
    return s;
  }, [certs, completed]);

  const signAck = useCallback(async (key: string, name: string) => {
    if (!supabase || !user) return;
    await supabase.from("academy_acknowledgements").upsert({ user_id: user.id, doc_key: key, signed_name: name, signed_at: new Date().toISOString() }, { onConflict: "user_id,doc_key" });
    toast("Signed — thank you");
    await load();
    setView({ k: "home" });
  }, [user, load, toast]);

  const completeModule = useCallback(async (slug: string, score: number | null) => {
    if (!supabase || !user) return;
    const prevBest = progress[slug]?.best_score ?? 0;
    const best = score == null ? null : Math.max(score, prevBest);
    await supabase.from("academy_progress").upsert(
      { user_id: user.id, module_slug: slug, status: "complete", score, best_score: best, completed_at: new Date().toISOString() },
      { onConflict: "user_id,module_slug" }
    );
    const nowComplete = new Set(completed); nowComplete.add(slug);
    const newly = CERTS.filter((c) => certEarned(c, nowComplete) && !earned.has(c.key));
    if (newly.length) {
      const rows = newly.map((c) => {
        const days = certExpiryDays(c.key);
        return { user_id: user.id, cert_key: c.key, awarded_at: new Date().toISOString(), expires_at: days > 0 ? new Date(Date.now() + days * DAY).toISOString() : null };
      });
      await supabase.from("academy_certifications").upsert(rows, { onConflict: "user_id,cert_key" });
      toast(`Certified — ${newly.map((c) => c.title).join(", ")}`);
    } else {
      toast("Module complete");
    }
    await load();
    setView({ k: "home" });
  }, [user, progress, completed, earned, load, toast]);

  // a cert's live status from earned + expiry
  const certStatus = useCallback((key: string): "none" | "active" | "expiring" | "expired" => {
    if (!earned.has(key)) return "none";
    const exp = certExp[key];
    if (!exp) return "active";
    const t = new Date(exp).getTime(); const now = Date.now();
    if (t < now) return "expired";
    if (t - now < 30 * DAY) return "expiring";
    return "active";
  }, [earned, certExp]);
  const certOk = useCallback((key: string) => { const s = certStatus(key); return s === "active" || s === "expiring"; }, [certStatus]);

  if (!enabled) return <section className="screen"><Masthead eyebrow="GT3 Academy" /><h1 className="k-title">Academy</h1><p className="k-sub">The live backend isn&apos;t configured here.</p></section>;
  if (!ready) return <section className="screen academy"><Skeleton variant="row" count={5} /></section>;
  if (!user) return <SignIn />;
  // Academy is the EMPLOYEE training + certification system — it carries internal ops, procedures,
  // and the founder's "why" (founderInsight). A plain customer is signed in but not staff; the old
  // `member → "staff"` role fallback handed them the full staff curriculum. Gate on isStaff() so
  // only employees reach it; everyone else gets a friendly wall, not internal content.
  if (!isStaff(profile)) return (
    <section className="screen">
      <div className="h-title">GT3 Academy</div>
      <div className="h-sub">This is our crew training space — for GT3 team members. If you&apos;re on the crew and seeing this, ask an admin to set your role.</div>
      <Link className="btn" href="/">← Back to GT3</Link>
    </section>
  );

  const path = pathForRole(role);
  const required = requiredModules(role);
  const reqDone = required.filter((m) => completed.has(m.slug)).length;
  const pct = required.length ? Math.round((reqDone / required.length) * 100) : 0;
  const roleLabel = ROLES.find((r) => r.key === role)?.label ?? "Staff";
  const isAdmin = role === "admin" || role === "founder";

  if (view.k === "module") {
    const m = moduleBySlug(view.slug);
    if (!m) return null;
    return <ModuleReader m={m} done={completed.has(m.slug)} onBack={() => setView({ k: "home" })} onComplete={(score) => completeModule(m.slug, score)} />;
  }
  if (view.k === "product") {
    const p = PRODUCTS.find((x) => x.key === view.key);
    if (!p) return null;
    return <ProductDetail p={p} onBack={() => setView({ k: "home" })} />;
  }
  if (view.k === "team") return <TeamBoard onBack={() => setView({ k: "home" })} />;
  if (view.k === "ack") {
    const a = ackByKey(view.key);
    if (!a) return null;
    return <AckView a={a} defaultName={profile?.display_name ?? ""} signed={acks.has(a.key)} onBack={() => setView({ k: "home" })} onSign={(name) => signAck(a.key, name)} />;
  }

  const pendingAcks = ACKS.filter((a) => a.required && !acks.has(a.key));
  const assignDone = (a: Assignment): boolean =>
    a.target_type === "module" ? completed.has(a.target_key)
      : a.target_type === "cert" ? certOk(a.target_key)
        : required.every((m) => completed.has(m.slug));
  const openAssignments = assignments.filter((a) => !assignDone(a));
  // Every assignment card is tappable — resolve each to a concrete module so cert/path
  // taps aren't dead: route to the first incomplete required module (fall back to the first).
  const assignTarget = (a: Assignment): string | null =>
    a.target_type === "module" ? a.target_key
      : a.target_type === "cert" ? (() => { const ms = certByKey(a.target_key)?.modules ?? []; return ms.find((s) => !completed.has(s)) ?? ms[0] ?? null; })()
        : (required.find((m) => !completed.has(m.slug)) ?? required[0])?.slug ?? null;

  return (
    <section className="screen academy">
      <Masthead eyebrow="GT3 Academy" right={<Link className="pf" href="/3mpire" aria-label="Exit">‹</Link>} />
      <h1 className="h-title">Your <em className="it">path.</em></h1>
      <div className="subm" style={{ marginTop: 10 }}>{roleLabel} track · {reqDone}/{required.length} modules</div>

      {/* progress + certifications */}
      <div className="ac-top">
        <Ring pct={pct} />
        <div className="ac-certs">
          {path.map((k) => {
            const c = certByKey(k)!;
            const st = certStatus(k);
            const tag = st === "expired" ? " expired" : st === "expiring" ? " soon" : st === "none" ? "" : " on";
            return <span key={k} className={`ac-cert${tag}`}><i className="ac-cdot" />{c.title.replace(" Certified", "")}{st === "expired" ? " · expired" : st === "expiring" ? " · renew" : ""}</span>;
          })}
        </div>
      </div>

      {/* required acknowledgements (food safety e-sign) */}
      {pendingAcks.map((a) => (
        <button key={a.key} className="ac-ackcard" onClick={() => setView({ k: "ack", key: a.key })}>
          <span className="ac-ack-x">!</span>
          <span className="ac-ack-main"><b>{a.title}</b><span>Required before serving — read &amp; sign</span></span>
          <span className="ev-chev">›</span>
        </button>
      ))}

      {/* assigned to you (admin-set, with due dates) */}
      {openAssignments.length > 0 && (
        <>
          <SectionHeader label="Assigned to you" />
          <div className="ac-mods">
            {openAssignments.map((a, i) => {
              const overdue = a.due_at != null && new Date(a.due_at).getTime() < Date.now();
              const label = a.target_type === "module" ? (moduleBySlug(a.target_key)?.title ?? a.target_key)
                : a.target_type === "cert" ? (certByKey(a.target_key)?.title ?? a.target_key) : "Full role path";
              return (
                <button key={i} className={`ac-mod${overdue ? " overdue" : ""}`} onClick={() => { const slug = assignTarget(a); if (slug) setView({ k: "module", slug }); }}>
                  <span className="ac-mod-tick"><Icon name="clock" /></span>
                  <span className="ac-mod-main">
                    <span className="ac-mod-sec">{a.due_at ? (overdue ? "Overdue · " : "Due · ") + new Date(a.due_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "Assigned"}</span>
                    <span className="ac-mod-t">{label}</span>
                  </span>
                  <span className="ev-chev">›</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* operational readiness */}
      <SectionHeader label="Operational readiness" />
      <div className="ac-ready">
        {READINESS.map((r) => {
          const ok = r.need.every((k) => certOk(k)) && (!r.ack || acks.has(r.ack));
          return <div key={r.q} className={`ac-rrow${ok ? " ok" : ""}`}><span className="ac-rmark">{ok ? <Icon name="check" /> : "—"}</span>{r.q}</div>;
        })}
      </div>

      {isAdmin && (
        <button className="ac-team-btn" onClick={() => setView({ k: "team" })}>Team readiness board ›</button>
      )}

      {/* learning path modules */}
      <SectionHeader label="Your modules" />
      <div className="ac-mods">
        {required.map((m) => {
          const done = completed.has(m.slug);
          const best = progress[m.slug]?.best_score;
          return (
            <button key={m.slug} className={`ac-mod${done ? " done" : ""}`} onClick={() => setView({ k: "module", slug: m.slug })}>
              <span className="ac-mod-tick">{done ? <Icon name="check" /> : <Icon name="dotOutline" />}</span>
              <span className="ac-mod-main">
                <span className="ac-mod-sec">{sectionMeta(m.section).label} · {m.estMin} min</span>
                <span className="ac-mod-t">{m.title}</span>
              </span>
              {done && best != null && <span className="ac-mod-score">{best}%</span>}
              <span className="ev-chev">›</span>
            </button>
          );
        })}
      </div>

      {/* product education library */}
      <SectionHeader label="Product education" />
      <div className="ac-prods">
        {PRODUCTS.map((p) => (
          <button key={p.key} className="ac-prod" onClick={() => setView({ k: "product", key: p.key })}>
            <span className="ac-prod-line">{p.line}{p.price && p.price !== "—" ? ` · ${p.price}` : ""}</span>
            <span className="ac-prod-name">{p.name}</span>
            <span className="ac-prod-what">{p.what}</span>
          </button>
        ))}
      </div>
      <ClosingBeat />
    </section>
  );
}

// ── progress ring ──
function Ring({ pct }: { pct: number }) {
  const r = 30, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <div className="ac-ring">
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(245,241,232,.12)" strokeWidth="6" />
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--gold2)" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 38 38)" />
      </svg>
      <span className="ac-ring-v">{pct}<small>%</small></span>
    </div>
  );
}

// ── module reader + quiz ──
function ModuleReader({ m, done, onBack, onComplete }: { m: Module; done: boolean; onBack: () => void; onComplete: (score: number | null) => void }) {
  const [quiz, setQuiz] = useState(false);
  return (
    <section className="screen academy">
      <div className="toprow"><button className="ac-back" onClick={onBack}>‹ Academy</button><div className="eyb">{sectionMeta(m.section).label}</div></div>
      {!quiz ? (
        <>
          <h1 className="h-title" style={{ fontSize: 28 }}>{m.title}</h1>
          <div className="subm" style={{ marginTop: 8 }}>{m.estMin} min{done ? " · completed" : ""}</div>
          {m.whyItMatters && <div className="ac-why"><span className="ac-why-k">Why it matters</span><p>{m.whyItMatters}</p></div>}
          {m.objectives && m.objectives.length > 0 && (
            <div className="ac-obj"><div className="ac-bh">By the end, you can…</div><ul>{m.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></div>
          )}
          <div className="ac-body">
            {m.body.map((s, i) => (
              <div key={i} className="ac-bsec">
                <div className="ac-bh">{s.h}</div>
                <p className="ac-bp">{s.p}</p>
              </div>
            ))}
          </div>
          {m.mistakes && m.mistakes.length > 0 && (
            <div className="ac-mistakes"><div className="ac-bh"><Icon name="warning" /> Common mistakes</div><ul>{m.mistakes.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          )}
          {m.scenarios && m.scenarios.length > 0 && (
            <div className="ac-scn"><div className="ac-bh">In the moment</div>{m.scenarios.map((s, i) => (
              <div key={i} className="ac-scn-row"><div className="ac-scn-s">{s.situation}</div><div className="ac-scn-d"><Icon name="arrowRight" /> {s.doThis}</div></div>
            ))}</div>
          )}
          {m.founderInsight && <div className="ac-founder"><span className="ac-founder-k">Founder’s note</span><p>“{m.founderInsight}”</p></div>}
          {m.quiz && m.quiz.length > 0 ? (
            <button className="handle" onClick={() => setQuiz(true)}>{done ? "Retake knowledge check" : "Take the knowledge check"}</button>
          ) : (
            <button className="handle" onClick={() => onComplete(null)}>{done ? "Reviewed" : "Mark complete"}</button>
          )}
        </>
      ) : (
        <Quiz qs={m.quiz!} pass={m.pass ?? PASS_DEFAULT} onPass={(score) => onComplete(score)} onCancel={() => setQuiz(false)} />
      )}
    </section>
  );
}

function Quiz({ qs, pass, onPass, onCancel }: { qs: QuizQ[]; pass: number; onPass: (score: number) => void; onCancel: () => void }) {
  const [ans, setAns] = useState<Record<number, number>>({});
  const [graded, setGraded] = useState(false);
  const answered = Object.keys(ans).length === qs.length;
  const correct = qs.filter((q, i) => ans[i] === q.correct).length;
  const score = Math.round((correct / qs.length) * 100);
  const passed = score >= pass;
  return (
    <div className="ac-quiz">
      <h1 className="h-title" style={{ fontSize: 24 }}>Knowledge check</h1>
      <div className="subm" style={{ marginTop: 8 }}>{qs.length} questions · {pass}% to pass</div>
      {qs.map((q, i) => (
        <div key={i} className="ac-q">
          <div className="ac-qh">{i + 1}. {q.q}</div>
          {q.options.map((o, j) => {
            const sel = ans[i] === j;
            const showRight = graded && j === q.correct;
            const showWrong = graded && sel && j !== q.correct;
            return (
              <button key={j} className={`ac-opt${sel ? " sel" : ""}${showRight ? " right" : ""}${showWrong ? " wrong" : ""}`}
                disabled={graded} onClick={() => setAns((a) => ({ ...a, [i]: j }))}>{o}</button>
            );
          })}
          {graded && q.why && ans[i] !== q.correct && <div className="ac-qwhy">{q.why}</div>}
        </div>
      ))}
      {!graded ? (
        <>
          <button className="handle" disabled={!answered} onClick={() => setGraded(true)}>{answered ? "Submit" : "Answer all to submit"}</button>
          <button className="ac-back" style={{ marginTop: 10 }} onClick={onCancel}>‹ Back to lesson</button>
        </>
      ) : (
        <div className={`ac-result${passed ? " pass" : " fail"}`}>
          <b>{score}%</b>
          <span>{passed ? "Passed — nicely done." : `Not yet — ${pass}% to pass. Review and retry.`}</span>
          {passed ? (
            <button className="handle" onClick={() => onPass(score)}>Complete module</button>
          ) : (
            <button className="handle" onClick={() => { setGraded(false); setAns({}); }}>Try again</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── acknowledgement (food-safety e-sign) ──
function AckView({ a, defaultName, signed, onBack, onSign }: { a: Ack; defaultName: string; signed: boolean; onBack: () => void; onSign: (name: string) => void }) {
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  return (
    <section className="screen academy">
      <div className="toprow"><button className="ac-back" onClick={onBack}>‹ Academy</button><div className="eyb">Acknowledgement</div></div>
      <h1 className="h-title" style={{ fontSize: 28 }}>{a.title}</h1>
      {signed && <div className="subm" style={{ marginTop: 8, color: "var(--ok)" }}>Already signed — re-sign to re-affirm</div>}
      <div className="ac-body">{a.body.map((p, i) => <div key={i} className="ac-bsec"><p className="ac-bp">{p}</p></div>)}</div>
      <div className="ac-sign">
        <label className="ac-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>{a.statement}</span></label>
        <input className="ev-input" placeholder="Type your full name to sign" value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" />
        <button className="handle" disabled={!agree || name.trim().length < 2} onClick={() => onSign(name.trim())}>{signed ? "Re-sign" : "Sign & acknowledge"}</button>
      </div>
    </section>
  );
}

// ── product detail (education + cookbook) ──
function ProductDetail({ p, onBack }: { p: Product; onBack: () => void }) {
  return (
    <section className="screen academy">
      <div className="toprow"><button className="ac-back" onClick={onBack}>‹ Academy</button><div className="eyb">{p.line}</div></div>
      <h1 className="h-title" style={{ fontSize: 30 }}>{p.name}</h1>
      <p className="ac-what">{p.what}</p>

      <SectionHeader label="Why it exists" />
      <p className="ac-bp">{p.why}</p>

      <div className="ac-grid2">
        <div><div className="ac-mini-h">Ingredients</div><ul className="ac-ul">{p.ingredients.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div><div className="ac-mini-h">Benefits</div><ul className="ac-ul">{p.benefits.map((x) => <li key={x}>{x}</li>)}</ul></div>
      </div>

      <div className="ac-mini-h" style={{ marginTop: 14 }}>Who it&apos;s for</div>
      <p className="ac-bp">{p.customer}</p>

      {p.voices && (
        <>
          <SectionHeader label="Three voices · match the guest" />
          <div className="ac-voices">
            <div className="ac-voice"><span className="ac-voice-tag">Simple</span><p>{p.voices.simple}</p></div>
            <div className="ac-voice"><span className="ac-voice-tag gt3">GT3</span><p>{p.voices.gt3}</p></div>
            <div className="ac-voice"><span className="ac-voice-tag founder">Founder</span><p>{p.voices.founder}</p></div>
          </div>
        </>
      )}

      <SectionHeader label="Talking points" />
      <ul className="ac-ul">{p.talking.map((x) => <li key={x}>{x}</li>)}</ul>

      <SectionHeader label="FAQs" />
      {p.faqs.map((f, i) => <div key={i} className="ac-faq"><b>{f.q}</b><span>{f.a}</span></div>)}

      {p.cookbook && (
        <>
          <SectionHeader label="Cookbook · operating spec" />
          {p.cookbook.batch && <div className="ac-faq"><b>Batch</b><span>{p.cookbook.batch}</span></div>}
          {p.cookbook.brew && <div><div className="ac-mini-h">Procedure</div><ol className="ac-ol">{p.cookbook.brew.map((x) => <li key={x}>{x}</li>)}</ol></div>}
          {p.cookbook.serve && <div><div className="ac-mini-h">Serve</div><ul className="ac-ul">{p.cookbook.serve.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {p.cookbook.storage && <div className="ac-faq"><b>Storage</b><span>{p.cookbook.storage}</span></div>}
          {p.cookbook.quality && <div className="ac-faq"><b>Quality standard</b><span>{p.cookbook.quality}</span></div>}
          {p.cookbook.troubleshoot && <div><div className="ac-mini-h">Troubleshooting</div>{p.cookbook.troubleshoot.map((t, i) => <div key={i} className="ac-faq"><b>{t.issue}</b><span>{t.fix}</span></div>)}</div>}
        </>
      )}
    </section>
  );
}

// ── admin team-readiness board + assignment ──
function TeamBoard({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [rows, setRows] = useState<{ id: string; name: string; role: string; done: number; certs: number; overdue: number }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [target, setTarget] = useState("path");
  const [due, setDue] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const [{ data: profs }, { data: prog }, { data: cs }, { data: asg }] = await Promise.all([
      supabase.from("profiles").select("id,display_name,role"),
      supabase.from("academy_progress").select("user_id,module_slug,status"),
      supabase.from("academy_certifications").select("user_id,cert_key"),
      supabase.from("academy_assignments").select("user_id,target_type,target_key,due_at"),
    ]);
    const doneMods: Record<string, Set<string>> = {};
    (prog ?? []).forEach((r: { user_id: string; module_slug: string; status: string }) => { if (r.status === "complete") (doneMods[r.user_id] ??= new Set()).add(r.module_slug); });
    const certKeys: Record<string, Set<string>> = {};
    (cs ?? []).forEach((r: { user_id: string; cert_key: string }) => { (certKeys[r.user_id] ??= new Set()).add(r.cert_key); });
    const now = Date.now();
    const overdueBy: Record<string, number> = {};
    (asg ?? []).forEach((a: { user_id: string; target_type: string; target_key: string; due_at: string | null }) => {
      if (!a.due_at || new Date(a.due_at).getTime() >= now) return;
      const done = a.target_type === "module" ? doneMods[a.user_id]?.has(a.target_key) : a.target_type === "cert" ? certKeys[a.user_id]?.has(a.target_key) : false;
      if (!done) overdueBy[a.user_id] = (overdueBy[a.user_id] ?? 0) + 1;
    });
    const out = (profs ?? []).map((p: { id: string; display_name: string | null; role: string | null }) => {
      const r = toAcademyRole(p.role ?? "member");
      const need = requiredModules(r).length;
      const done = doneMods[p.id]?.size ?? 0;
      return { id: p.id, name: p.display_name ?? "Member", role: r, done: need ? Math.round((done / need) * 100) : 0, certs: certKeys[p.id]?.size ?? 0, overdue: overdueBy[p.id] ?? 0 };
    }).sort((a, b) => b.overdue - a.overdue || a.done - b.done);
    setRows(out);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    if (!supabase || !user || !memberId) { toast("Pick a member first"); return; }
    const target_type = target === "path" ? "path" : "cert";
    const target_key = target === "path" ? "path" : target;
    const { error } = await supabase.from("academy_assignments").insert({ user_id: memberId, target_type, target_key, due_at: due ? new Date(due).toISOString() : null, assigned_by: user.id });
    if (error) toast(`Error: ${error.message}`); else { toast("Training assigned"); setMemberId(""); setDue(""); load(); }
  };

  return (
    <section className="screen academy">
      <div className="toprow"><button className="ac-back" onClick={onBack}>‹ Academy</button><div className="eyb">Admin</div></div>
      <h1 className="h-title" style={{ fontSize: 28 }}>Team <em className="it">readiness.</em></h1>

      <SectionHeader label="Assign training" />
      <div className="ac-assign">
        <select className="ev-input" value={memberId} onChange={(e) => setMemberId(e.target.value)} aria-label="Member">
          <option value="">Member…</option>
          {rows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="ev-input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="What to assign">
          <option value="path">Full role path</option>
          {CERTS.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
        </select>
        <input className="ev-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <button className="handle" style={{ marginTop: 0 }} onClick={assign}>Assign training</button>
      </div>

      <SectionHeader label="Readiness" />
      <div className="ac-team">
        {rows.map((r) => (
          <div key={r.id} className="ac-trow">
            <div className="ac-tmain"><b>{r.name}{r.overdue > 0 && <span className="ac-overdue">{r.overdue} overdue</span>}</b><span>{ROLES.find((x) => x.key === r.role)?.label ?? r.role} · {r.certs} certs</span></div>
            <div className="ac-tbar"><i style={{ width: `${r.done}%` }} /></div>
            <div className={`ac-tpct${r.done >= 100 ? " ok" : r.done === 0 ? " zero" : ""}`}>{r.done}%</div>
          </div>
        ))}
        {loaded && rows.length === 0 && <div className="h-sub">No team members yet.</div>}
      </div>
    </section>
  );
}
