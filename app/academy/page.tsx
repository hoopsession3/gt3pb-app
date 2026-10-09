"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { readParam, dropParam } from "@/lib/urlParam";
import SignIn from "@/components/SignIn";
import Skeleton from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import { supabase } from "@/lib/supabase";
import Icon from "@/components/Icon";
import CookEnforcement from "@/components/CookEnforcement";
import {
  PRODUCTS, CERTS, ROLES, READINESS, PASS_DEFAULT, ACKS, ackByKey, certExpiryDays,
  moduleBySlug, certByKey, pathForRole, certEarned, requiredModules, sectionMeta, expectationsFor,
  readinessGap, renewalLeft, assignmentDone, teamMemberRow, toAcademyRole,
  type Module, type Product, type QuizQ, type Role, type Ack, type AssignmentLike,
} from "@/lib/academy";
import { staffAccess } from "@/lib/access";
import { useBackStep } from "@/components/useBack";
import Button from "@/components/Button";

// What a level is held to, as opposed to what it has been taught. Four separate things on purpose:
// what the role owns, the non-negotiables, the rhythm it keeps, and how it is actually judged.
function ExpectationsCard({ role, roleLabel }: { role: Role; roleLabel: string }) {
  const e = expectationsFor(role);
  const [open, setOpen] = useState(false);
  return (
    <div className="ac-exp">
      <button type="button" className="ac-exp-head hit-44" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ac-exp-k">What a {roleLabel} is held to</span>
        <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      <p className="ac-exp-owns">{e.owns}</p>
      {open && (
        <div className="ac-exp-body">
          <div className="ac-exp-grp">
            <div className="ac-exp-t">Non-negotiables</div>
            <ul>{e.standards.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
          <div className="ac-exp-grp">
            <div className="ac-exp-t">Your rhythm</div>
            <ul>{e.cadence.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
          <div className="ac-exp-grp">
            <div className="ac-exp-t">How you&apos;re judged</div>
            <ul>{e.judgedOn.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}

type View = { k: "home" } | { k: "module"; slug: string } | { k: "product"; key: string } | { k: "team" } | { k: "ack"; key: string };
type Assignment = AssignmentLike; // one shape, in lib/academy, shared with the team board
const DAY = 86400000;


// The app's account roles map onto Academy roles — lib/academy (toAcademyRole), its one home since
// the crew welcome letter (2026-10-07) names a new teammate's path from the server too.

export default function AcademyPage() {
  const { ready, enabled, user, profile, profileStatus } = useAuth();
  const { toast } = useApp();
  const role = toAcademyRole(roleOf(profile));
  const [progress, setProgress] = useState<Record<string, { status: string; best_score: number | null; completed_at: string | null }>>({});
  const [certs, setCerts] = useState<Set<string>>(new Set());
  const [certExp, setCertExp] = useState<Record<string, string | null>>({});
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [acks, setAcks] = useState<Set<string>>(new Set());
  // ?assign=<their id> — from a crew member's page ("Assign their Academy path"), or right after
  // bringing someone on: the team board opens with them already chosen in Assign training, which is
  // the only place training is assigned. Read once; removed from the address (lib/urlParam).
  const [assignFor] = useState<string | null>(() => readParam("assign"));
  useEffect(() => { dropParam("assign"); }, []);
  const [view, setView] = useState<View>(() => (assignFor ? { k: "team" } : { k: "home" }));
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !user) return;
    const [pr, ce, asg, ak] = await Promise.all([
      supabase.from("academy_progress").select("module_slug,status,best_score,completed_at").eq("user_id", user.id),
      supabase.from("academy_certifications").select("cert_key,expires_at").eq("user_id", user.id),
      supabase.from("academy_assignments").select("target_type,target_key,due_at").eq("user_id", user.id),
      supabase.from("academy_acknowledgements").select("doc_key").eq("user_id", user.id),
    ]);
    // A FAILED READ IS NOT AN EMPTY LIST (2026-10-04). All four used to "fail soft to []" — a note
    // from before 0031, when two of these tables might not exist yet. They do now, so a refused read
    // is a dropped connection or a policy, and reading it as nothing-done told a trained person they
    // were at 0%, owed the food-safety sign-off, and could serve no one. Keep what was last read.
    const failed = [pr, ce, asg, ak].find((r) => r.error)?.error;
    if (failed) { setLoadErr(failed.message); return; }
    setLoadErr(null);
    const p: Record<string, { status: string; best_score: number | null; completed_at: string | null }> = {};
    (pr.data ?? []).forEach((r: { module_slug: string; status: string; best_score: number | null; completed_at: string | null }) => { p[r.module_slug] = { status: r.status, best_score: r.best_score, completed_at: r.completed_at }; });
    setProgress(p);
    setCerts(new Set((ce.data ?? []).map((r: { cert_key: string }) => r.cert_key)));
    setCertExp(Object.fromEntries((ce.data ?? []).map((r: { cert_key: string; expires_at: string | null }) => [r.cert_key, r.expires_at])));
    setAssignments((asg.data ?? []) as Assignment[]);
    setAcks(new Set((ak.data ?? []).map((r: { doc_key: string }) => r.doc_key)));
    setLoaded(true);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const completed = useMemo(() => new Set(Object.entries(progress).filter(([, v]) => v.status === "complete").map(([k]) => k)), [progress]);
  // earned = persisted certs ∪ certs derivable from completed modules
  const earned = useMemo(() => {
    const s = new Set(certs);
    CERTS.forEach((c) => { if (certEarned(c, completed)) s.add(c.key); });
    return s;
  }, [certs, completed]);

  // A FAILED WRITE IS NOT A SIGNATURE, AND NOT A COMPLETION (2026-10-04). Both of these said "Signed"
  // and "Module complete" whatever the database answered, then went home — so a dropped connection
  // looked exactly like a sign-off that counted toward "Can serve customers". A refused write now
  // says so and stays on the page, so the same button tries again.
  const signAck = useCallback(async (key: string, name: string) => {
    if (!supabase || !user) return;
    const { error } = await supabase.from("academy_acknowledgements").upsert({ user_id: user.id, doc_key: key, signed_name: name, signed_at: new Date().toISOString() }, { onConflict: "user_id,doc_key" });
    if (error) { toast(`Not signed — ${error.message}. Try again.`, "error"); return; }
    toast("Signed — thank you");
    await load();
    setView({ k: "home" });
  }, [user, load, toast]);

  const completeModule = useCallback(async (slug: string, score: number | null) => {
    if (!supabase || !user) return;
    const prevBest = progress[slug]?.best_score ?? 0;
    const best = score == null ? null : Math.max(score, prevBest);
    const { error: progErr } = await supabase.from("academy_progress").upsert(
      { user_id: user.id, module_slug: slug, status: "complete", score, best_score: best, completed_at: new Date().toISOString() },
      { onConflict: "user_id,module_slug" }
    );
    if (progErr) { toast(`Not saved — ${progErr.message}. Try again.`, "error"); return; }
    const nowComplete = new Set(completed); nowComplete.add(slug);
    // Against the RECORDED certs, not the ones the module list implies: a cert whose row never landed
    // (a failed write, or a module added to it later) is written now, where the team board and the
    // deadlines (0320) can see it, instead of being "earned" on this phone only.
    const newly = CERTS.filter((c) => certEarned(c, nowComplete) && !certs.has(c.key));
    // RENEWAL (2026-10-04). An expired cert used to stay expired for ever — only never-earned certs
    // were ever awarded. It renews when every one of its modules has been retaken since it lapsed:
    // the module just finished counts as retaken now. Any lapsed cert, not only this module's, so a
    // renewal whose write failed is picked up by the next module finished.
    const nowMs = Date.now();
    const lapsed = (key: string) => { const e = certExp[key]; return !!e && new Date(e).getTime() < nowMs; };
    const retaken = (m: string, key: string) => m === slug
      || (!!progress[m]?.completed_at && !!certExp[key] && new Date(progress[m]!.completed_at!).getTime() > new Date(certExp[key]!).getTime());
    const renewed = CERTS.filter((c) => certs.has(c.key) && lapsed(c.key) && renewalLeft(c, retaken).length === 0);
    const award = [...newly, ...renewed];
    if (award.length) {
      const rows = award.map((c) => {
        const days = certExpiryDays(c.key);
        return { user_id: user.id, cert_key: c.key, awarded_at: new Date().toISOString(), expires_at: days > 0 ? new Date(Date.now() + days * DAY).toISOString() : null };
      });
      const { error: certErr } = await supabase.from("academy_certifications").upsert(rows, { onConflict: "user_id,cert_key" });
      if (certErr) {
        toast(`Module complete, but ${award.map((c) => c.title).join(", ")} did not record — ${certErr.message}. It records the next time you finish a module.`, "error");
      } else {
        toast([
          newly.length ? `Certified — ${newly.map((c) => c.title).join(", ")}` : "",
          renewed.length ? `Renewed — ${renewed.map((c) => c.title).join(", ")}` : "",
        ].filter(Boolean).join(" · "));
      }
    } else {
      toast("Module complete");
    }
    await load();
    setView({ k: "home" });
  }, [user, progress, completed, certs, certExp, load, toast]);

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
  // An unloaded or failed profile is not a customer — see lib/access.
  const access = staffAccess(!!user, profileStatus, profile);
  if (access === "wait" || access === "failed") return <section className="screen"><h1 className="h-title">GT3 Academy</h1><div className="h-sub">{access === "failed" ? "We couldn't check your access just now — this isn't a refusal." : "Checking your access…"}</div></section>;
  if (access === "deny") return (
    <section className="screen">
      <h1 className="h-title">GT3 Academy</h1>
      <div className="h-sub">This is our crew training space — for GT3 team members. If you&apos;re on the crew and seeing this, ask an admin to set your role.</div>
      <Link className="btn" href="/">← Back to GT3</Link>
    </section>
  );
  // Until the record has been read once, there is nothing true to say about it — the first paint
  // used to be "0/N modules · 0%" for everyone, done or not, until the read came back.
  if (!loaded) return (
    <section className="screen academy">
      <Masthead eyebrow="GT3 Academy" />
      {loadErr ? (
        <EmptyState role="alert" title="Your training record did not load"
          sub={`${loadErr}. Nothing you have done is lost — this was a read that did not answer.`}
          action={<button type="button" className="btn-pri btn-wide mt-4.5" onClick={() => load()}>Try again</button>} />
      ) : <Skeleton variant="row" count={5} />}
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
  // The board is an admin's: arriving with ?assign= is not a way round the button that opens it.
  if (view.k === "team" && isAdmin) return <TeamBoard assignFor={assignFor} onBack={() => setView({ k: "home" })} />;
  if (view.k === "ack") {
    const a = ackByKey(view.key);
    if (!a) return null;
    return <AckView a={a} defaultName={profile?.display_name ?? ""} signed={acks.has(a.key)} onBack={() => setView({ k: "home" })} onSign={(name) => signAck(a.key, name)} />;
  }

  const pendingAcks = ACKS.filter((a) => a.required && !acks.has(a.key));
  // The same answer the team board gives (lib/academy assignmentDone) — the two used to disagree.
  const openAssignments = assignments.filter((a) => !assignmentDone(a, role, completed, certOk));
  // Every assignment card is tappable — resolve each to a concrete module so cert/path
  // taps aren't dead: route to the first incomplete required module (fall back to the first).
  const assignTarget = (a: Assignment): string | null =>
    a.target_type === "module" ? a.target_key
      : a.target_type === "cert" ? (() => { const ms = certByKey(a.target_key)?.modules ?? []; return ms.find((s) => !completed.has(s)) ?? ms[0] ?? null; })()
        : (required.find((m) => !completed.has(m.slug)) ?? required[0])?.slug ?? null;

  return (
    <section className="screen academy">
      <Masthead eyebrow="GT3 Academy" />
      <h1 className="h-title">Your <em className="it">path.</em></h1>
      <div className="subm" style={{ marginTop: 10 }}>{roleLabel} track · {reqDone}/{required.length} modules</div>
      {loadErr && <p className="subm" role="status">Could not refresh your record — {loadErr}. This is what was last read.</p>}

      {/* progress + certifications */}
      <div className="ac-top">
        <Ring pct={pct} />
        <div className="ac-certs">
          {path.map((k) => {
            const c = certByKey(k)!;
            const st = certStatus(k);
            const tone = st === "expired" ? " crit" : st === "expiring" ? " warn" : st === "none" ? "" : " gold";
            return <span key={k} className={`k-tag${tone}`}>{st !== "none" && st !== "expired" && st !== "expiring" && <Icon name="check" />}{c.title.replace(" Certified", "")}{st === "expired" ? " · expired" : st === "expiring" ? " · renew" : ""}</span>;
          })}
        </div>
      </div>

      {/* What this level is HELD TO. The certs above say what you've been taught; this says what the
          job is. A learning path with no standard attached teaches the material and leaves people
          guessing about the work. */}
      <ExpectationsCard role={role} roleLabel={roleLabel} />

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

      {/* operational readiness — each row says what is left and opens the next thing (2026-10-04).
          It was five dashes: not ready, but not why, not how far, and nothing to tap. */}
      <SectionHeader label="Operational readiness" />
      <div className="ac-ready">
        {READINESS.map((r) => {
          const gap = readinessGap(r, {
            certStatus, completed, acked: acks,
            retakenSince: (m, key) => !!progress[m]?.completed_at && !!certExp[key]
              && new Date(progress[m]!.completed_at!).getTime() > new Date(certExp[key]!).getTime(),
          });
          const next = gap.next;
          const open = () => { if (!next) return; setView(next.k === "ack" ? { k: "ack", key: next.key } : { k: "module", slug: next.slug }); };
          return gap.ok || !next ? (
            <div key={r.q} className={`ac-rrow${gap.ok ? " ok" : ""}`}>
              <span className="ac-rmark">{gap.ok ? <Icon name="check" /> : "—"}</span>
              <span className="ac-rtext"><b>{r.q}</b><i>{gap.line}</i></span>
            </div>
          ) : (
            <button type="button" key={r.q} className="ac-rrow go" onClick={open}>
              <span className="ac-rmark">—</span>
              <span className="ac-rtext"><b>{r.q}</b><i>{gap.line}</i></span>
              <span className="ev-chev">›</span>
            </button>
          );
        })}
      </div>

      {isAdmin && (
        <Button kind="secondary" wide className="mt-3.5 justify-between" onClick={() => setView({ k: "team" })}>Team readiness board ›</Button>
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
  useBackStep("Academy", onBack);
  const [quiz, setQuiz] = useState(false);
  return (
    <section className="screen academy">
      <div className="toprow"><div className="eyb">{sectionMeta(m.section).label}</div></div>
      {!quiz ? (
        <>
          <h1 className="h-title" style={{ fontSize: 28 }} data-large-title data-title={m.title}>{m.title}</h1>
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
          {m.founderInsight && <div className="ac-founder"><span className="ac-founder-k">Founders’ note</span><p>“{m.founderInsight}”</p></div>}
          {m.quiz && m.quiz.length > 0 ? (
            <button type="button" className="btn-pri btn-wide mt-4.5" onClick={() => setQuiz(true)}>{done ? "Retake knowledge check" : "Take the knowledge check"}</button>
          ) : (
            <button type="button" className="btn-pri btn-wide mt-4.5" onClick={() => onComplete(null)}>{done ? "Reviewed" : "Mark complete"}</button>
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
      <h1 className="h-title" style={{ fontSize: 22 }}>Knowledge check</h1>
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
          <button type="button" className="btn-pri btn-wide mt-4.5" disabled={!answered} onClick={() => setGraded(true)}>{answered ? "Submit" : "Answer all to submit"}</button>
          <button className="ac-back" style={{ marginTop: 10 }} onClick={onCancel}>‹ Back to lesson</button>
        </>
      ) : (
        <div className={`ac-result${passed ? " pass" : " fail"}`}>
          <b>{score}%</b>
          <span>{passed ? "Passed — nicely done." : `Not yet — ${pass}% to pass. Review and retry.`}</span>
          {passed ? (
            <button type="button" className="btn-pri btn-wide mt-1.5" onClick={() => onPass(score)}>Complete module</button>
          ) : (
            <button type="button" className="btn-pri btn-wide mt-1.5" onClick={() => { setGraded(false); setAns({}); }}>Try again</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── acknowledgement (food-safety e-sign) ──
function AckView({ a, defaultName, signed, onBack, onSign }: { a: Ack; defaultName: string; signed: boolean; onBack: () => void; onSign: (name: string) => void }) {
  useBackStep("Academy", onBack);
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  return (
    <section className="screen academy">
      <div className="toprow"><div className="eyb">Acknowledgement</div></div>
      <h1 className="h-title" style={{ fontSize: 28 }} data-large-title data-title={a.title}>{a.title}</h1>
      {signed && <div className="subm" style={{ marginTop: 8, color: "var(--ok)" }}>Already signed — re-sign to re-affirm</div>}
      <div className="ac-body">{a.body.map((p, i) => <div key={i} className="ac-bsec"><p className="ac-bp">{p}</p></div>)}</div>
      <div className="ac-sign">
        <label className="ac-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>{a.statement}</span></label>
        <input className="ev-input" placeholder="Type your full name to sign" value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" />
        <button type="button" className="btn-pri btn-wide mt-4.5" disabled={!agree || name.trim().length < 2} onClick={() => onSign(name.trim())}>{signed ? "Re-sign" : "Sign & acknowledge"}</button>
      </div>
    </section>
  );
}

// ── product detail (education + cookbook) ──
function ProductDetail({ p, onBack }: { p: Product; onBack: () => void }) {
  useBackStep("Academy", onBack);
  return (
    <section className="screen academy">
      <div className="toprow"><div className="eyb">{p.line}</div></div>
      <h1 className="h-title" style={{ fontSize: 28 }} data-large-title data-title={p.name}>{p.name}</h1>
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
            <div className="ac-voice"><span className="ac-voice-tag founder">Founders</span><p>{p.voices.founder}</p></div>
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
          {p.cookbook.brew && (
            <div>
              <div className="ac-mini-h">Procedure</div>
              {/* 2026-10-01. A new operator is joining who will be cooking, and the Cookbook is
                  where he reads the method. Driven by the cookbook's `weighs` FLAG, never by
                  searching these sentences for the word "weigh" — see the note on that field in
                  lib/academy.ts. It appears on the procedures that weigh and nowhere else, for the
                  same reason BrewSteps only shows it on weighed lines. */}
              {p.cookbook.weighs && (
                <CookEnforcement label="Scale">
                  Anything weighed here goes on a scale on a <b>hard, flat, level surface</b> — a
                  counter, not a cutting board, towel, tray, or the lip of a sink. Empty container
                  on, <b>TARE / ZERO</b> to <b>0</b>, then add until the display matches.{" "}
                  <b>Re-zero for every ingredient.</b> This ratio is weight to weight, so a tilted
                  scale — or one zeroed with something already on it — carries into the whole batch.
                </CookEnforcement>
              )}
              <ol className="ac-ol">{p.cookbook.brew.map((x) => <li key={x}>{x}</li>)}</ol>
            </div>
          )}
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
function TeamBoard({ onBack, assignFor = null }: { onBack: () => void; assignFor?: string | null }) {
  // Each of the Academy's own views is a step (components/useBack): the bar's "‹ Academy", the edge swipe and
  // the browser's Back return to the path — its "‹ Academy" used to be the first thing in the view, and
  // scrolled away with it (2026-10-08, the navigation round).
  useBackStep("Academy", onBack);
  const { user } = useAuth();
  const { toast } = useApp();
  const [rows, setRows] = useState<{ id: string; name: string; role: string; done: number; certs: number; overdue: number }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [memberId, setMemberId] = useState(assignFor ?? "");
  const [target, setTarget] = useState("path");
  const [due, setDue] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const [profs, prog, cs, asg] = await Promise.all([
      supabase.from("profiles").select("id,display_name,role").neq("role", "member"),
      supabase.from("academy_progress").select("user_id,module_slug,status"),
      supabase.from("academy_certifications").select("user_id,cert_key,expires_at"),
      supabase.from("academy_assignments").select("user_id,target_type,target_key,due_at"),
    ]);
    // A FAILED READ IS NOT AN EMPTY TEAM (2026-10-04): any one of these four not answering used to
    // read as "No team members yet", or as everybody at 0%.
    const failed = [profs, prog, cs, asg].find((r) => r.error)?.error;
    if (failed) { setLoadErr(failed.message); setLoaded(true); return; }
    setLoadErr(null);
    const doneMods: Record<string, Set<string>> = {};
    (prog.data ?? []).forEach((r: { user_id: string; module_slug: string; status: string }) => { if (r.status === "complete") (doneMods[r.user_id] ??= new Set()).add(r.module_slug); });
    const certExp: Record<string, Record<string, string | null>> = {};
    (cs.data ?? []).forEach((r: { user_id: string; cert_key: string; expires_at: string | null }) => { (certExp[r.user_id] ??= {})[r.cert_key] = r.expires_at; });
    const asgBy: Record<string, AssignmentLike[]> = {};
    (asg.data ?? []).forEach((a: AssignmentLike & { user_id: string }) => { (asgBy[a.user_id] ??= []).push(a); });
    // One rule with the person's own page (lib/academy teamMemberRow): required modules only, certs
    // held only while in date, and a whole-path assignment is done when the path is.
    const now = Date.now();
    const out = (profs.data ?? []).map((p: { id: string; display_name: string | null; role: string | null }) => {
      const r = toAcademyRole(p.role ?? "member");
      const row = teamMemberRow({ role: r, completed: doneMods[p.id] ?? new Set(), certExpiry: certExp[p.id] ?? {}, assignments: asgBy[p.id] ?? [] }, now);
      return { id: p.id, name: p.display_name ?? "Member", role: r, done: row.pct, certs: row.held, overdue: row.overdue };
    }).sort((a, b) => b.overdue - a.overdue || a.done - b.done);
    setRows(out);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Only someone on the board can be chosen: an id from a link that is not on it (not on the crew)
  // must not be assigned under a select that shows "Member…".
  const chosen = rows.some((r) => r.id === memberId) ? memberId : "";
  const assign = async () => {
    if (!supabase || !user || !chosen) { toast("Pick a member first"); return; }
    const target_type = target === "path" ? "path" : "cert";
    const target_key = target === "path" ? "path" : target;
    const { error } = await supabase.from("academy_assignments").insert({ user_id: chosen, target_type, target_key, due_at: due ? new Date(due).toISOString() : null, assigned_by: user.id });
    if (error) toast(`Not assigned — ${error.message}`, "error"); else { toast("Training assigned"); setMemberId(""); setDue(""); load(); }
  };

  return (
    <section className="screen academy">
      <div className="toprow"><div className="eyb">Admin</div></div>
      <h1 className="h-title" style={{ fontSize: 28 }} data-large-title data-title="Team readiness">Team <em className="it">readiness.</em></h1>

      <SectionHeader label="Assign training" />
      <div className="ac-assign">
        <select className="ev-input" value={chosen} onChange={(e) => setMemberId(e.target.value)} aria-label="Member">
          <option value="">Member…</option>
          {rows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="ev-input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="What to assign">
          <option value="path">Full role path</option>
          {CERTS.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
        </select>
        <input className="ev-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <button type="button" className="btn-pri btn-wide" onClick={assign}>Assign training</button>
      </div>

      <SectionHeader label="Readiness" />
      <div className="ac-team">
        {rows.map((r) => (
          <div key={r.id} className="ac-trow">
            <div className="ac-tmain"><b>{r.name}{r.overdue > 0 && <span className="ac-overdue">{r.overdue} overdue</span>}</b><span>{ROLES.find((x) => x.key === r.role)?.label ?? r.role} · {r.certs} {r.certs === 1 ? "cert" : "certs"} held</span></div>
            <div className="ac-tbar"><i style={{ width: `${r.done}%` }} /></div>
            <div className={`ac-tpct${r.done >= 100 ? " ok" : r.done === 0 ? " zero" : ""}`}>{r.done}%</div>
          </div>
        ))}
        {loaded && loadErr && (
          <EmptyState role="alert" title="The team's training records did not load"
            sub={`${loadErr}. Nobody's training is lost — this was a read that did not answer.`}
            action={<button type="button" className="btn-pri btn-wide mt-4.5" onClick={() => load()}>Try again</button>} />
        )}
        {loaded && !loadErr && rows.length === 0 && <div className="h-sub">No team members yet.</div>}
      </div>
    </section>
  );
}
