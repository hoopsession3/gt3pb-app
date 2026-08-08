"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Icon from "@/components/Icon";
import { Masthead, ClosingBeat } from "@/components/kit";

// RETURN TO PRIMAL — the native nutrition academy index (round 0273). Reads the published primal_*
// tree through RLS (rookie lessons open to all, pro only to entitled/staff), lays it out systematically
// pillar -> module -> lesson, and makes it referenceable in one glance: a live search filters every
// lesson by title/summary/key-point, and a customer's own progress shows as a check on each card.
// Content lives in the DB (crew-editable in the Lessons manager); this file is pure presentation.

type Pillar = { id: string; slug: string; title: string; blurb: string | null; accent: string | null; icon: string | null; sort: number };
type Module = { id: string; pillar_id: string; slug: string; title: string; blurb: string | null; sort: number };
type Lesson = {
  id: string; module_id: string; slug: string; title: string; subtitle: string | null; tier: "rookie" | "pro";
  est_minutes: number | null; summary: string | null; key_points: string[]; sort: number;
};
type Tree = { pillars: Pillar[]; modules: Module[]; lessons: Lesson[]; done: Set<string>; total: number };

const ICON: Record<string, Parameters<typeof Icon>[0]["name"]> = {
  flame: "coffee", activity: "target", moon: "clock", sun: "sparkles", droplet: "jar",
};

export default function PrimalAcademy() {
  const { user } = useAuth();
  const [q, setQ] = useState("");

  const loader = useCallback(async (): Promise<Tree> => {
    if (!supabase) return { pillars: [], modules: [], lessons: [], done: new Set(), total: 0 };
    const [pil, mod, les] = await Promise.all([
      supabase.from("primal_pillars").select("id, slug, title, blurb, accent, icon, sort").order("sort"),
      supabase.from("primal_modules").select("id, pillar_id, slug, title, blurb, sort").order("sort"),
      supabase.from("primal_lessons").select("id, module_id, slug, title, subtitle, tier, est_minutes, summary, key_points, sort").order("sort"),
    ]);
    if (pil.error) throw new Error(pil.error.message);
    const lessons = ((les.data as Lesson[]) ?? []).map((l) => ({ ...l, key_points: Array.isArray(l.key_points) ? l.key_points : [] }));
    // progress is keyed by the customer spine — resolve our own customer row, then load completions.
    const done = new Set<string>();
    if (user) {
      const { data: cust } = await supabase.from("customers").select("id").eq("user_id", user.id).maybeSingle();
      const cid = (cust as { id?: string } | null)?.id;
      if (cid) {
        const { data: prog } = await supabase.from("primal_progress").select("lesson_id, status").eq("customer_id", cid).eq("status", "completed");
        for (const r of (prog as { lesson_id: string }[]) ?? []) done.add(r.lesson_id);
      }
    }
    return { pillars: (pil.data as Pillar[]) ?? [], modules: (mod.data as Module[]) ?? [], lessons, done, total: lessons.length };
  }, [user]);

  const board = useAsyncData<Tree>(loader, [user?.id ?? "anon"]);
  const t = board.data;

  // live quick-reference search across title + summary + subtitle + key points
  const match = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !t) return null;
    const hit = new Set<string>();
    for (const l of t.lessons) {
      const hay = [l.title, l.subtitle, l.summary, ...(l.key_points || [])].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(needle)) hit.add(l.id);
    }
    return hit;
  }, [q, t]);

  const doneCount = t ? t.lessons.filter((l) => t.done.has(l.id)).length : 0;

  return (
    <section className="screen primal" id="s-primal">
      <Watermark variant="landing" />
      <Masthead eyebrow="Return to Primal" right={<AccountPill />} />

      <header className="pr-hero">
        <div className="pr-eye">The nutrition system</div>
        <h1 className="pr-h1">Return to <i>Primal</i></h1>
        <p className="pr-lede">
          Real fuel, explained simply. Five pillars, quick to reference, free to start — and every lesson
          ends in a stack you can actually order. Educational, never medical.
        </p>
        {t && t.total > 0 && (
          <div className="pr-progress" aria-label={`${doneCount} of ${t.total} lessons complete`}>
            <div className="pr-bar"><span style={{ width: `${Math.round((doneCount / Math.max(1, t.total)) * 100)}%` }} /></div>
            <span className="pr-progress-n">{doneCount}/{t.total} complete</span>
          </div>
        )}
      </header>

      <div className="pr-search">
        <Icon name="search" size={16} />
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search lessons — carbs, hydration, iron…" aria-label="Search lessons"
        />
        {q && <button type="button" className="pr-search-x" onClick={() => setQ("")} aria-label="Clear search"><Icon name="close" size={14} /></button>}
      </div>

      {board.status === "loading" && <div className="pr-note">Loading the academy…</div>}
      {board.status === "error" && <div className="pr-note pr-note-err">Couldn’t load lessons. Pull to refresh, or try again in a moment.</div>}
      {t && t.total === 0 && board.status === "ready" && (
        <div className="pr-note">The academy is being written. Check back soon — the first lessons drop this week.</div>
      )}

      {t && t.pillars.map((p) => {
        const mods = t.modules.filter((m) => m.pillar_id === p.id);
        // pillar is visible if it has any lesson that passes the current search
        const pillarLessons = t.lessons.filter((l) => mods.some((m) => m.id === l.module_id));
        const shown = pillarLessons.filter((l) => !match || match.has(l.id));
        if (match && shown.length === 0) return null;
        const accent = p.accent || "var(--gold2)";
        return (
          <section className="pr-pillar" key={p.id} id={`pillar-${p.slug}`}>
            <div className="pr-pillar-head">
              <span className="pr-pillar-ic" style={{ color: accent }}><Icon name={ICON[p.icon || ""] || "sparkles"} /></span>
              <div>
                <div className="pr-pillar-n" style={{ color: accent }}>Pillar</div>
                <h2 className="pr-pillar-t">{p.title}</h2>
              </div>
            </div>
            {p.blurb && <p className="pr-pillar-blurb">{p.blurb}</p>}

            {mods.map((m) => {
              const lessons = t.lessons.filter((l) => l.module_id === m.id && (!match || match.has(l.id)));
              if (lessons.length === 0) return null;
              return (
                <div className="pr-module" key={m.id}>
                  <div className="pr-module-h">
                    <span className="pr-module-n">{m.title}</span>
                    {m.blurb && <span className="pr-module-b">{m.blurb}</span>}
                  </div>
                  <div className="pr-lessons">
                    {lessons.map((l) => {
                      const isDone = t.done.has(l.id);
                      return (
                        <Link href={`/primal/l/${l.slug}`} key={l.id} className={`pr-card${isDone ? " done" : ""}`} style={{ "--accent": accent } as React.CSSProperties}>
                          <div className="pr-card-top">
                            <span className="pr-card-t">{l.title}</span>
                            {l.tier === "pro" ? <span className="pr-tier pro"><Icon name="lock" size={11} /> Pro</span> : <span className="pr-tier">Free</span>}
                          </div>
                          {l.summary && <span className="pr-card-s">{l.summary}</span>}
                          <div className="pr-card-foot">
                            {l.est_minutes ? <span className="pr-min"><Icon name="clock" size={12} /> {l.est_minutes} min</span> : <span />}
                            {isDone ? <span className="pr-check"><Icon name="check" size={13} /> Done</span> : <span className="pr-go">Read <Icon name="arrowRight" size={13} /></span>}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {t && t.total > 0 && (
        <div className="pr-cta-block">
          <div className="pr-cta-n">Go deeper</div>
          <p className="pr-cta-body">The full Return to Primal system — every pillar, the Pro modules, and your personal protocol — is coming to a membership. Rookie stays free, always.</p>
          <Link href="/reserve" className="mpack-cta pr-cta">Start with a stack ›</Link>
        </div>
      )}

      <ClosingBeat />
    </section>
  );
}
