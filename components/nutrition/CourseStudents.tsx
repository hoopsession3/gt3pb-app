"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAuth } from "@/components/AuthProvider";
import { useAppStable } from "@/components/AppProvider";
import { useRecord } from "@/components/RecordSheet";
import { canOf } from "@/lib/roles";
import { failureWords } from "@/lib/failureWords";
import { downloadCsv } from "@/lib/csv";
import { money } from "@/lib/money";
import AsyncSection from "@/components/AsyncSection";
import { InfoRow } from "@/components/kit";
import { Segmented } from "@/components/controls";
import Icon from "@/components/Icon";
import { courseKpis, filterStudents, howWord, isLive, progressWords, rookieEarned, studentsCsv, type Student } from "@/lib/courseStudents";

// GT3 NUTRITION · STUDENTS (R47 — Ryan: "how can i see the users, etc, industry standard things"). What every course
// platform gives its owner: the numbers first (students, sold, revenue, how far they get, the badge), where people stop
// (each lesson: how many finished it), everyone who has or had the course — searchable, by how they got it — each opening
// their customer record (where the course is given and taken back), Give the course by email, and the list as a CSV.

type Lesson = { id: string; title: string; sort: number };
type Data = { rows: Student[]; lessons: Lesson[]; finished: Record<string, number> };
type How = "all" | "bought" | "given" | "back";

export default function CourseStudents() {
  const { profile } = useAuth();
  const canGive = canOf(profile).admin;
  const { toast } = useAppStable();
  const { openRecord } = useRecord();
  const [q, setQ] = useState("");
  const [how, setHow] = useState<How>("all");
  const [email, setEmail] = useState("");
  const [giving, setGiving] = useState(false);

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { rows: [], lessons: [], finished: {} };
    const [st, ls, pr] = await Promise.all([
      supabase.rpc("course_students"),
      supabase.from("primal_lessons").select("id, title, sort").not("published_at", "is", null).is("archived_at", null).order("sort"),
      supabase.from("primal_progress").select("lesson_id").eq("status", "completed").limit(5000),
    ]);
    if (st.error) throw new Error(st.error.message);
    if (ls.error) throw new Error(ls.error.message);
    if (pr.error) throw new Error(pr.error.message);
    const finished: Record<string, number> = {};
    for (const r of (pr.data as { lesson_id: string }[]) ?? []) finished[r.lesson_id] = (finished[r.lesson_id] ?? 0) + 1;
    return { rows: (st.data as Student[] | null) ?? [], lessons: (ls.data as Lesson[] | null) ?? [], finished };
  }, []);
  const board = useAsyncData<Data>(loader, []);
  const rows = useMemo(() => board.data?.rows ?? [], [board.data]);
  const k = courseKpis(rows);
  const shown = filterStudents(rows, q, how);

  const give = async () => {
    if (!supabase || giving) return;
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { toast("Type their email", "error"); return; }
    setGiving(true);
    const { data: found, error } = await supabase.from("customers").select("id").ilike("email", e).limit(2);
    if (error) { setGiving(false); toast(failureWords(error, "Couldn't look them up"), "error"); return; }
    const hits = (found as { id: string }[] | null) ?? [];
    if (hits.length !== 1) { setGiving(false); toast(hits.length ? "Two customers have that email — open the right one in Customers and give it there" : "No customer with that email yet — they need an account or an order first", "error"); return; }
    const { error: gErr } = await supabase.rpc("course_give", { p_customer: hits[0].id, p_note: "Given from the students list" });
    setGiving(false);
    if (gErr) { toast(failureWords(gErr, "Couldn't give the course"), "error"); return; }
    toast("GT3 Nutrition given — it's open on their account"); setEmail(""); void board.reload();
  };

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the students" emptyTitle="" loadingLabel="Loading students…">
      {(d) => (
        <div className="adm-sec">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <InfoRow name={String(k.students)} sub={`students · ${k.bought} bought, ${k.given} given`} />
            <InfoRow name={money(k.revenueCents)} sub={`revenue · ${money(k.revenue30Cents)} in 30 days (${k.sold30} sold)`} />
            <InfoRow name={`${k.avgPct}%`} sub={`average progress · ${k.started} started, ${k.finished} finished`} />
            <InfoRow name={String(k.badge)} sub="Rookie badges earned" />
          </div>

          {d.lessons.length > 0 && (
            <details className="mb-3">
              <summary className="crm-tier-l cursor-pointer">Where people stop — each lesson, how many finished it</summary>
              {d.lessons.map((l, i) => (
                <InfoRow key={l.id} lead={String(i + 1)} name={l.title} trailing={<span className="k-tag">{d.finished[l.id] ?? 0}</span>} />
              ))}
            </details>
          )}

          {canGive && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input aria-label="Give the course — their email" placeholder="Give the course — their email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1 min-w-0" />
              <button type="button" className="btn-sec btn-sm" onClick={give} disabled={giving}>{giving ? "Giving…" : "Give"}</button>
            </div>
          )}

          <Segmented label="Which students" kind="choice" size="sm" value={how} onChange={setHow}
            options={[{ key: "all", label: "Everyone" }, { key: "bought", label: "Bought" }, { key: "given", label: "Given" }, { key: "back", label: "Taken back" }]} />
          <div className="flex items-center gap-2 mt-2 mb-2">
            <input aria-label="Search students" className="crm-search flex-1 min-w-0" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => downloadCsv("gt3-nutrition-students.csv", studentsCsv(shown))}>Export CSV</button>
          </div>

          {shown.length === 0 ? (
            <div className="crm-note">{rows.length ? "Nobody matches." : "No students yet — they appear the moment someone buys GT3 Nutrition or you give it."}</div>
          ) : shown.map((s) => (
            <InfoRow key={s.customer_id} onClick={() => openRecord("customer", s.customer_id)}
              name={s.name?.trim() || s.email || "No name yet"}
              nameExtra={isLive(s) && rookieEarned(s) ? <span className="k-tag gold"><Icon name="star" size={11} /> Rookie</span> : undefined}
              sub={`${howWord(s)} ${new Date(s.granted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}${s.paid_cents != null && s.source === "purchase" ? ` · ${money(s.paid_cents)}` : ""} · ${progressWords(s)}`}
              trailing={<span className="ev-chev" aria-hidden="true">›</span>} />
          ))}
        </div>
      )}
    </AsyncSection>
  );
}
