"use client";

import "@/components/nutrition/nutrition.css";
import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import Icon from "@/components/Icon";
import { haptic } from "@/lib/haptics";
import { lessonHref } from "@/lib/native";
import { STACK_KEY, parseAnswers } from "@/lib/dailyStack";
import { courseOrder, dayNumber, todayPick, type LessonLite, type ModuleLite, type PillarLite, type StackDay } from "@/lib/nutrition";

// GT3 NUTRITION ON TODAY (R44) — one lesson matched to the day the reader told the Daily Stack (Training → Power Carbs,
// Deep work → Steady Energy, Easy → Ruminant Red Meat), or, with no day told, one of the course's own key points as the
// day's tip, turning over at midnight. Words are the lessons' own — nothing here writes a nutrition claim. The day is
// read from the phone (lib/dailyStack, never sent anywhere) when the card mounts and again whenever the stack's sheet
// closes (`stamp` changes). A card that cannot load says nothing rather than a broken tip.

type Tree = { order: LessonLite[]; done: Set<string> };

const noSubscribe = () => () => {};
const readStack = (): string | null => { try { return localStorage.getItem(STACK_KEY); } catch { return null; } };

export default function NutritionToday({ stamp }: { stamp: unknown }) {
  const { user } = useAuth();
  // The phone's answer, read as a store: its raw string is the snapshot (stable while it is unchanged), so a render after
  // the stack's sheet closes reads the day just picked. `stamp` changing is that render. Null on the server.
  void stamp;
  const raw = useSyncExternalStore(noSubscribe, readStack, () => null);
  const day: StackDay | null = parseAnswers(raw)?.day ?? null;

  const loader = useCallback(async (): Promise<Tree> => {
    if (!supabase) return { order: [], done: new Set() };
    const [pil, mod, les] = await Promise.all([
      supabase.from("primal_pillars").select("id, slug, title, sort").order("sort"),
      supabase.from("primal_modules").select("id, pillar_id, title, sort").order("sort"),
      supabase.from("primal_lessons").select("id, module_id, slug, title, tier, sort, key_points, summary, est_minutes").order("sort"),
    ]);
    if (les.error) throw new Error(les.error.message);
    const lessons = ((les.data as LessonLite[]) ?? []).map((l) => ({ ...l, key_points: Array.isArray(l.key_points) ? l.key_points : [] }));
    const order = courseOrder((pil.data as PillarLite[]) ?? [], (mod.data as ModuleLite[]) ?? [], lessons);
    const done = new Set<string>();
    if (user) {
      const { data: cust } = await supabase.from("customers").select("id").eq("user_id", user.id).maybeSingle();
      const cid = (cust as { id?: string } | null)?.id;
      if (cid) {
        const { data: prog } = await supabase.from("primal_progress").select("lesson_id").eq("customer_id", cid).eq("status", "completed");
        for (const r of (prog as { lesson_id: string }[]) ?? []) done.add(r.lesson_id);
      }
    }
    return { order, done };
  }, [user]);
  const board = useAsyncData<Tree>(loader, [user?.id ?? "anon"]);
  const t = board.data;
  if (!t) return null;
  const pick = todayPick(day, t.order, t.done, dayNumber(new Date()));
  if (pick.kind === "none") return null;
  const lesson = pick.lesson;
  const isDone = t.done.has(lesson.id);
  const point = pick.point;
  return (
    <Link href={lessonHref(lesson.slug)} className="nu-today fx-glow fx-rise" onClick={() => haptic("light")}
      aria-label={`GT3 Nutrition: ${pick.kind === "tip" ? "today's tip, from" : ""} ${lesson.title}. Read the lesson.`}>
      <span className="nu-today-top">
        <span className="nu-today-n">GT3 Nutrition</span>
        <span className="nu-today-k">{pick.kind === "lesson" ? pick.kicker : "Today's tip"}</span>
      </span>
      <span className="nu-today-t">{pick.kind === "tip" ? point : lesson.title}</span>
      {pick.kind === "lesson" && lesson.summary && <span className="text-subhead leading-snug text-cream-muted">{lesson.summary}</span>}
      {pick.kind === "lesson" && point && (
        <span className="nu-today-p"><Icon name="sparkles" size={15} /> <span>{point}</span></span>
      )}
      <span className="nu-today-foot">
        <span className="nu-today-meta">{pick.kind === "tip" ? `From ${lesson.title}` : "Return to Primal"}{lesson.est_minutes ? ` · ${lesson.est_minutes} min` : ""}{isDone ? " · read" : ""}</span>
        <span className="nu-today-go">{pick.kind === "tip" ? "Read why" : isDone ? "Read again" : "Read"} <Icon name="arrowRight" size={14} /></span>
      </span>
    </Link>
  );
}
