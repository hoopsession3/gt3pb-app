"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Icon from "@/components/Icon";
import { Masthead, ClosingBeat } from "@/components/kit";

// A single Return to Primal lesson (round 0273). Systematic + referenceable: the key points sit up top
// as scannable chips, the body reads clean, and the MEAL-STACK rail turns the teaching into an order —
// primal_menu_for_lesson() hands back the drink stack already ordered BEFORE -> DURING -> AFTER off the
// live menu, with price and whether it's currently pourable. A signed-in reader can mark it complete
// (progress rides the customer spine). A pro lesson the reader hasn't unlocked never loads its body —
// RLS returns nothing, and we show the unlock path instead of a dead end.

type StackItem = { product_slug: string; name: string | null; line: string | null; timing: string | null; price_cents: number | null; accent: string | null; rationale: string | null; orderable: boolean };
type Sibling = { slug: string; title: string; sort: number };
type LessonView = {
  found: boolean;
  lesson?: { id: string; title: string; subtitle: string | null; tier: "rookie" | "pro"; est_minutes: number | null; summary: string | null; key_points: string[]; body: string | null; hero_image_url: string | null; module_id: string };
  pillar?: { slug: string; title: string; accent: string | null } | null;
  module?: { slug: string; title: string } | null;
  stack: StackItem[];
  siblings: Sibling[];
  customerId: string | null;
  done: boolean;
};

const TIMING_LABEL: Record<string, string> = { BEFORE: "Before you move", DURING: "During", AFTER: "After · the rebuild" };
const money = (c: number | null) => (c == null ? "" : `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`);

export default function PrimalLesson({ slug }: { slug: string }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [justDone, setJustDone] = useState(false);

  const loader = useCallback(async (): Promise<LessonView> => {
    const empty: LessonView = { found: false, stack: [], siblings: [], customerId: null, done: false };
    if (!supabase) return empty;
    const { data: lraw } = await supabase
      .from("primal_lessons")
      .select("id, title, subtitle, tier, est_minutes, summary, key_points, body, hero_image_url, module_id")
      .eq("slug", slug).is("archived_at", null).maybeSingle();
    if (!lraw) return empty; // unpublished, gated pro, or missing — the view shows the unlock/not-found state
    const lesson = { ...(lraw as LessonView["lesson"]) } as NonNullable<LessonView["lesson"]>;
    lesson.key_points = Array.isArray(lesson.key_points) ? lesson.key_points : [];

    const [{ data: mod }, { data: stackRows }, { data: sibs }] = await Promise.all([
      supabase.from("primal_modules").select("slug, title, pillar_id").eq("id", lesson.module_id).maybeSingle(),
      supabase.rpc("primal_menu_for_lesson", { _lesson_id: lesson.id }),
      supabase.from("primal_lessons").select("slug, title, sort").eq("module_id", lesson.module_id).is("archived_at", null).order("sort"),
    ]);
    let pillar: LessonView["pillar"] = null;
    if (mod && (mod as { pillar_id?: string }).pillar_id) {
      const { data: pil } = await supabase.from("primal_pillars").select("slug, title, accent").eq("id", (mod as { pillar_id: string }).pillar_id).maybeSingle();
      pillar = (pil as LessonView["pillar"]) ?? null;
    }

    let customerId: string | null = null, done = false;
    if (user) {
      const { data: cust } = await supabase.from("customers").select("id").eq("user_id", user.id).maybeSingle();
      customerId = (cust as { id?: string } | null)?.id ?? null;
      if (customerId) {
        const { data: pr } = await supabase.from("primal_progress").select("status").eq("customer_id", customerId).eq("lesson_id", lesson.id).maybeSingle();
        done = (pr as { status?: string } | null)?.status === "completed";
      }
    }
    return {
      found: true, lesson, pillar, module: mod ? { slug: (mod as { slug: string }).slug, title: (mod as { title: string }).title } : null,
      stack: (stackRows as StackItem[]) ?? [], siblings: (sibs as Sibling[]) ?? [], customerId, done,
    };
  }, [slug, user]);

  const board = useAsyncData<LessonView>(loader, [slug, user?.id ?? "anon"]);
  const v = board.data;

  const markComplete = async () => {
    if (!supabase || !v?.lesson) return;
    if (!v.customerId) return; // not signed in — CTA routes to join instead
    setSaving(true);
    const { error } = await supabase.from("primal_progress").upsert(
      { customer_id: v.customerId, lesson_id: v.lesson.id, status: "completed", completed_at: new Date().toISOString() },
      { onConflict: "customer_id,lesson_id" }
    );
    setSaving(false);
    if (!error) { setJustDone(true); board.reload(); }
  };

  if (board.status === "loading") return <section className="screen primal"><Masthead eyebrow="Return to Primal" right={<AccountPill />} /><div className="pr-note">Loading…</div></section>;

  if (!v || !v.found) {
    // Either a Pro lesson the reader hasn't unlocked, or a bad link — offer the path forward, never a dead end.
    return (
      <section className="screen primal" id="s-primal-locked">
        <Watermark variant="landing" />
        <Masthead eyebrow="Return to Primal" right={<AccountPill />} />
        <div className="pr-locked">
          <span className="pr-locked-ic"><Icon name="lock" /></span>
          <h1 className="pr-h1">This one’s <i>Pro</i></h1>
          <p className="pr-lede">This lesson is part of the Pro program, or the link has moved. Rookie lessons are always free — start there, or unlock the full system.</p>
          <div className="pr-locked-cta">
            <Link href="/primal" className="btn-sec">Browse free lessons</Link>
            {!user && <span className="pr-locked-note">Already a member? <AccountPill /></span>}
          </div>
        </div>
        <ClosingBeat />
      </section>
    );
  }

  const lesson = v.lesson!; // found === true guarantees it (RLS-visible row loaded above)
  const { pillar, module, stack, siblings } = v;
  const accent = pillar?.accent || "var(--gold2)";
  const idx = siblings.findIndex((s) => s.title === lesson.title);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const isDone = v.done || justDone;
  const paras = (lesson.body || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  // group the stack by timing in the order the RPC already returned (BEFORE -> DURING -> AFTER)
  const timings: string[] = [];
  for (const it of stack) { const key = (it.timing || "").toUpperCase(); if (!timings.includes(key)) timings.push(key); }

  return (
    <section className="screen primal" id="s-primal-lesson" style={{ "--accent": accent } as React.CSSProperties}>
      <Watermark variant="share" />
      <Masthead eyebrow="Return to Primal" right={<AccountPill />} />

      <nav className="pr-crumb" aria-label="Breadcrumb">
        <Link href="/primal">Academy</Link>
        {pillar && <><Icon name="chevronRight" size={12} /><Link href={`/primal#pillar-${pillar.slug}`}>{pillar.title}</Link></>}
        {module && <><Icon name="chevronRight" size={12} /><span>{module.title}</span></>}
      </nav>

      <header className="pr-lhero">
        <span className="pr-tier2">{lesson.tier === "pro" ? "Pro lesson" : "Free lesson"}{lesson.est_minutes ? ` · ${lesson.est_minutes} min read` : ""}</span>
        <h1 className="pr-lh1">{lesson.title}</h1>
        {lesson.subtitle && <p className="pr-lsub">{lesson.subtitle}</p>}
      </header>

      {lesson.key_points.length > 0 && (
        <div className="pr-keys" aria-label="Key points">
          <div className="pr-keys-n">The quick version</div>
          <ul>
            {lesson.key_points.map((k, i) => (
              <li key={i}><span className="pr-key-dot" aria-hidden /><span>{k}</span></li>
            ))}
          </ul>
        </div>
      )}

      <div className="pr-body">
        {paras.length ? paras.map((p, i) => <p key={i}>{p}</p>) : <p className="pr-body-empty">This lesson’s full write-up is coming soon.</p>}
      </div>

      {stack.length > 0 && (
        <section className="pr-stack">
          <div className="pr-stack-h">
            <div>
              <div className="pr-stack-n">Your stack</div>
              <h2 className="pr-stack-t">Order what you just learned</h2>
            </div>
            <Icon name="coffee" />
          </div>
          <p className="pr-stack-lede">The drinks that put this lesson to work — in the order they fit your day.</p>
          {timings.map((tk) => (
            <div className="pr-stack-group" key={tk || "none"}>
              {TIMING_LABEL[tk] && <div className="pr-stack-when">{TIMING_LABEL[tk]}</div>}
              {stack.filter((s) => (s.timing || "").toUpperCase() === tk).map((s) => (
                <div className={`pr-drink${s.orderable ? "" : " off"}`} key={s.product_slug}>
                  <span className="pr-drink-dot" style={{ background: s.accent || accent }} aria-hidden />
                  <div className="pr-drink-x">
                    <div className="pr-drink-top">
                      <span className="pr-drink-name">{s.name || s.product_slug}</span>
                      {s.orderable ? <span className="pr-drink-px">{money(s.price_cents)}</span> : <span className="pr-drink-off">seasonal</span>}
                    </div>
                    {s.rationale && <span className="pr-drink-why">{s.rationale}</span>}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <Link href="/menu" className="mpack-cta pr-stack-cta">Order your stack ›</Link>
        </section>
      )}

      <div className="pr-actions">
        {isDone ? (
          <div className="pr-done-badge"><Icon name="check" size={16} /> Completed — nice work</div>
        ) : v.customerId ? (
          <button type="button" className="btn-pri" onClick={markComplete} disabled={saving}>{saving ? "Saving…" : "Mark complete"}</button>
        ) : (
          <div className="pr-signin-row">
            <span>Track your progress —</span> <AccountPill />
          </div>
        )}
      </div>

      <nav className="pr-nav" aria-label="Lesson navigation">
        {prev ? <Link href={`/primal/l/${prev.slug}`} className="pr-nav-b prev"><Icon name="arrowRight" size={14} /><span><em>Previous</em>{prev.title}</span></Link> : <span />}
        {next ? <Link href={`/primal/l/${next.slug}`} className="pr-nav-b next"><span><em>Next</em>{next.title}</span><Icon name="arrowRight" size={14} /></Link> : <span />}
      </nav>

      <ClosingBeat />
    </section>
  );
}
