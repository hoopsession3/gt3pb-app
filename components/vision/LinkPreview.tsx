"use client";

import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { NEVER_SENT, derivedOf, notChosen, previewOf, sendsSentence, textFields } from "@/lib/sharePreview";

// WHAT IT SENDS (IMS7-0467) — before a link goes out, and for any live link: the categories the person holding it will
// receive, how many of each, and every word typed into them. Read from the database's own answer for that link
// (vision_share_preview: for a link, its published revision behind the live gates — 0472, the same answer its door
// gives; for a draft, vision_share_payload), so what's shown here is what's sent. Owners and admins. IMS8 P6 adds the
// inspector's other half: one sentence counted from the response, what it doesn't send, and the response itself.
export type Draft = { label: string; program_ids: string[]; layout_ids: string[]; plan_ids: string[]; need_plans: string[]; money_plans?: string[]; research_plans?: string[]; show_asks: boolean };

/** `payload`: a response already in hand (the studio's review — IMS8 P7), shown as it is, with no second read. `diag`: the
 *  review's own fingerprint and when it was checked — diagnostics, kept here with the response (IMS8 P11). */
export default function LinkPreview({ share, draft, payload, diag }: { share?: string; draft?: Draft; payload?: unknown; diag?: { fingerprint: string; checkedAt: Date | null } }) {
  const key = payload !== undefined ? `payload:${JSON.stringify(payload).length}` : share ?? JSON.stringify(draft);
  const p = useAsyncData(async () => {
    const read = (data: unknown) => ({ ...previewOf(data), raw: data, says: sendsSentence(data), left: notChosen(data), fields: textFields(data), derived: derivedOf(data) });
    if (payload !== undefined) return read(payload);
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("vision_share_preview", { p_share: share ?? null, p_draft: share ? null : draft ?? null });
    if (error) throw new Error(error.message);
    return read(data as unknown);
  }, [key]);
  if (p.error) return <p className="vz-card-s" role="status">Couldn&apos;t read what it sends just now.</p>;
  if (!p.data) return <p className="vz-card-s" role="status">Reading what it sends…</p>;
  const { sections, other, raw, says, left, fields, derived } = p.data;
  return (
    <div className="flex flex-col gap-1" aria-label="What this link sends">
      <b className="font-sans text-subhead">What it sends</b>
      <p className="vz-card-s">{says}</p>
      {fields.examples.length > 0 && <p className="vz-card-s">For example: {fields.examples.map((e, i) => <span key={i}>{i ? "; " : ""}{e.title.toLowerCase()} — “{e.text}”</span>)}.</p>}
      {/* INCLUDED: every text field it sends, by category, word for word. */}
      <b className="font-sans mt-1">Included</b>
      {sections.filter((s) => s.key !== "link").map((s) => (
        <details key={s.key}>
          <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">{s.title}</b> · {s.count}{s.texts.length ? ` · ${s.texts.length} text field${s.texts.length === 1 ? "" : "s"}` : ""}</summary>
          {s.texts.length ? <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{s.texts.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="vz-card-s">Numbers only — no text.</p>}
        </details>
      ))}
      {other.length > 0 && (
        <details open>
          <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">Anything else</b> · {other.length}</summary>
          <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{other.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </details>
      )}
      {/* DERIVED: worked out on their screen from what's sent — not sent as text. */}
      {derived.length > 0 && (
        <details>
          <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">Worked out on their screen</b> · not sent as text</summary>
          <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{derived.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </details>
      )}
      {/* EXCLUDED: what this one could have carried and doesn't, and what no link carries. */}
      <details>
        <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">Not included</b></summary>
        <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{[...left, ...NEVER_SENT].map((t, i) => <li key={i}>{t}</li>)}</ul>
      </details>
      <details>
        <summary className="vz-card-s cursor-pointer py-1"><b className="font-sans">Diagnostics</b> · the response, exactly</summary>
        {diag && <p className="vz-card-s">The same response the link will send · checked {diag.checkedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) ?? "just now"} · fingerprint {diag.fingerprint.slice(0, 12)}</p>}
        <pre className="vz-card-s max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </div>
  );
}
