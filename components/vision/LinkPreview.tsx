"use client";

import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { NEVER_SENT, notChosen, previewOf, sendsSentence } from "@/lib/sharePreview";

// WHAT IT SENDS (IMS7-0467) — before a link goes out, and for any live link: the categories the person holding it will
// receive, how many of each, and every word typed into them. Read from the database's own answer for that link
// (vision_share_preview: for a link, its published revision behind the live gates — 0472, the same answer its door
// gives; for a draft, vision_share_payload), so what's shown here is what's sent. Owners and admins. IMS8 P6 adds the
// inspector's other half: one sentence counted from the response, what it doesn't send, and the response itself.
export type Draft = { label: string; program_ids: string[]; layout_ids: string[]; plan_ids: string[]; need_plans: string[]; money_plans?: string[]; research_plans?: string[]; show_asks: boolean };

/** `payload`: a response already in hand (the studio's review — IMS8 P7), shown as it is, with no second read. */
export default function LinkPreview({ share, draft, payload }: { share?: string; draft?: Draft; payload?: unknown }) {
  const key = payload !== undefined ? `payload:${JSON.stringify(payload).length}` : share ?? JSON.stringify(draft);
  const p = useAsyncData(async () => {
    if (payload !== undefined) return { ...previewOf(payload), raw: payload, says: sendsSentence(payload), left: notChosen(payload) };
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("vision_share_preview", { p_share: share ?? null, p_draft: share ? null : draft ?? null });
    if (error) throw new Error(error.message);
    return { ...previewOf(data), raw: data as unknown, says: sendsSentence(data), left: notChosen(data) };
  }, [key]);
  if (p.error) return <p className="vz-card-s" role="status">Couldn&apos;t read what it sends just now.</p>;
  if (!p.data) return <p className="vz-card-s" role="status">Reading what it sends…</p>;
  const { sections, other, raw, says, left } = p.data;
  return (
    <div className="flex flex-col gap-1" aria-label="What this link sends">
      <b className="font-sans text-subhead">What it sends</b>
      <p className="vz-card-s">{says}</p>
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
      {/* IMS8 P6 — the field inspector's other half: what it leaves out, and the response itself, on asking. */}
      <details>
        <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">What it doesn&apos;t send</b></summary>
        <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{[...left, ...NEVER_SENT].map((t, i) => <li key={i}>{t}</li>)}</ul>
      </details>
      <details>
        <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">The response, exactly</b></summary>
        <pre className="vz-card-s max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </div>
  );
}
