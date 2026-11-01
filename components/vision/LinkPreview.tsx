"use client";

import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { previewOf } from "@/lib/sharePreview";

// WHAT IT SENDS (IMS7-0467) — before a link goes out, and for any live link: the categories the person holding it will
// receive, how many of each, and every word typed into them. Read from the database's own answer for that link
// (vision_share_preview → vision_share_payload, the same function the link's door uses), so what's shown here is what's
// sent. Owners and admins.
export type Draft = { label: string; program_ids: string[]; layout_ids: string[]; plan_ids: string[]; need_plans: string[]; money_plans?: string[]; research_plans?: string[]; show_asks: boolean };

export default function LinkPreview({ share, draft }: { share?: string; draft?: Draft }) {
  const key = share ?? JSON.stringify(draft);
  const p = useAsyncData(async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("vision_share_preview", { p_share: share ?? null, p_draft: share ? null : draft ?? null });
    if (error) throw new Error(error.message);
    return previewOf(data);
  }, [key]);
  if (p.error) return <p className="vz-card-s" role="status">Couldn&apos;t read what it sends just now.</p>;
  if (!p.data) return <p className="vz-card-s" role="status">Reading what it sends…</p>;
  const { sections, other } = p.data;
  return (
    <div className="flex flex-col gap-1" aria-label="What this link sends">
      <b className="font-sans text-subhead">What it sends</b>
      {sections.length <= 1 && !other.length ? <p className="vz-card-s">Nothing of the plan yet — only who it&apos;s for.</p> : null}
      {sections.filter((s) => s.key !== "link").map((s) => (
        <details key={s.key}>
          <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">{s.title}</b> · {s.count}{s.texts.length ? ` · ${s.texts.length} written` : ""}</summary>
          {s.texts.length ? <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{s.texts.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="vz-card-s">Numbers only — nothing written.</p>}
        </details>
      ))}
      {other.length > 0 && (
        <details open>
          <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">Anything else</b> · {other.length}</summary>
          <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{other.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
