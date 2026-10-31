"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import Said from "@/components/Said";
import { Segmented } from "@/components/controls";
import { failureWords } from "@/lib/failureWords";
import { uploadToBucket } from "@/lib/uploads";
import { CATEGORIES, type Category } from "@/lib/experienceLibrary";
import { reviewOrder, safeRest, factWords, imageFor, type Fact } from "@/lib/libraryReview";

// ASK → RESEARCH → POPULATE → REVIEW EXCEPTIONS → SAVE CANDIDATE (IMS6 A3). The way an asset comes in: paste its link,
// describe what's needed, or upload its spec sheet or a photo — GT3 researches it (POST /api/library/intake) and shows a
// draft card: the product's picture when a source carried one (labelled with where it came from), the key specifications
// each with its source, what's still missing (fields, and the Standard's mandatory evidence for the category), and the
// exceptions to decide first. Typing it all in is the Advanced way, not the first one. Nothing here approves anything:
// accepting a fact makes it the specification (std_accept_facts); qualifying and approving stay the Standard's gate.

type Mode = "url" | "describe" | "upload";
type Result = {
  ok: boolean; status: string; intake: string | null; material: string | null; reason?: string; error?: string;
  matches: { id: string; kind: string; why: string }[]; missing: { fields: string[]; evidence: string[] }; unread: string[]; notes: string[];
  dropped: { field: string; why: string }[]; plan: { depth: string; worstCents: number } | null; charged_cents: number | null;
};

export function Ask({ onDone, onManual }: { onDone: (material: string | null) => void; onManual: () => void }) {
  const { toast } = useAppStable();
  const [mode, setMode] = useState<Mode>("url");
  const [text, setText] = useState(""), [file, setFile] = useState<File | null>(null), [cat, setCat] = useState<Category | "">("");
  const [busy, setBusy] = useState(false), [res, setRes] = useState<Result | null>(null);
  const go = async () => {
    setBusy(true); setRes(null);
    try {
      let file_path: string | null = null;
      if (mode === "upload") {
        if (!file || !supabase) return;
        const { data: me } = await supabase.auth.getUser();
        const { data: prof, error: pe } = await supabase.from("profiles").select("tenant_id").eq("id", me.user?.id ?? "").maybeSingle();
        if (pe || !prof?.tenant_id) { toast(failureWords(pe, "Couldn't tell which business this is for"), "error"); return; }
        const up = await uploadToBucket({ bucket: "library-intake", file, prefix: `${prof.tenant_id}/uploads` });
        if ("error" in up) { toast(up.error, "error"); return; }
        file_path = up.path;
      }
      const r = await authedFetch("/api/library/intake", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: mode, input: mode === "upload" ? null : text, file_path, category: cat || null }) }, { deadlineMs: 70_000 });
      const j = (await r.json().catch(() => ({ ok: false, error: `The research answered ${r.status}.` }))) as Result;
      setRes(j);
      if (j.material && (j.status === "ready" || j.status === "duplicate")) onDone(j.material);
    } catch (e) { setRes({ ok: false, status: "failed", error: (e as Error).message } as Result); }
    finally { setBusy(false); }
  };
  const ready = mode === "upload" ? !!file : mode === "url" ? /^https:\/\//.test(text.trim()) : text.trim().length >= 3;
  return (
    <div className="mpanel p-3 flex flex-col gap-3" aria-label="Add an asset">
      <Segmented label="How it comes in" kind="choice" value={mode} onChange={(m) => { setMode(m); setRes(null); }}
        options={[{ key: "url", label: "Paste a link" }, { key: "describe", label: "Find it for me" }, { key: "upload", label: "Upload" }]} />
      {mode === "url" && <label className="prod-f"><span>The product&apos;s page</span><input type="url" inputMode="url" value={text} placeholder="https://…" onChange={(e) => setText(e.target.value)} /></label>}
      {mode === "describe" && <label className="prod-f"><span>What you&apos;re looking for</span><textarea rows={3} maxLength={2000} value={text} placeholder="An eight-foot solid wood community table with documented low-emission finishes" onChange={(e) => setText(e.target.value)} /></label>}
      {mode === "upload" && <label className="prod-f"><span>A spec sheet (PDF) or a photo</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
      <label className="prod-f"><span>Category (helps it look in the right places)</span><select value={cat} onChange={(e) => setCat(e.target.value as Category | "")}><option value="">Let it work out</option>{CATEGORIES.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></label>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn-pri btn-sm" disabled={!ready || busy} onClick={() => void go()}>{busy ? "Researching…" : "Research it"}</button>
        <button type="button" className="btn-ter btn-sm" onClick={onManual}>Advanced: enter it by hand</button>
        {busy && <Said as="span" className="vz-card-s">Searching and reading its sources — up to a minute.</Said>}
      </div>
      <p className="vz-card-s">GT3 records what sources say, each with its source; what no source says stays missing. It researches within its budget and never approves anything.</p>
      {res && <Outcome r={res} />}
    </div>
  );
}

function Outcome({ r }: { r: Result }) {
  if (r.status === "duplicate") return <p className="vz-card-s" role="status">Asked already today — opening that one.</p>;
  if (!r.ok || r.status !== "ready") return <p className="xl-warn" role="alert">{r.reason ?? r.error ?? "The research didn't finish."}{r.charged_cents != null ? ` (${r.charged_cents.toFixed(2)}¢ used.)` : ""}</p>;
  return (
    <div className="flex flex-col gap-1" role="status">
      {r.matches[0] && <span className="vz-card-s">{r.matches[0].kind === "same" ? "Already in the library — what's new is shown as differences to review." : r.matches[0].kind === "variant" ? "A variant of an asset already in the library — kept as its own record." : `Possibly already in the library: ${r.matches[0].why}.`}</span>}
      {r.unread.length > 0 && <span className="vz-card-s">Couldn&apos;t read: {r.unread.join(", ")}.</span>}
      {r.notes.map((n) => <span key={n} className="xl-warn">{n}</span>)}
      {r.plan && <span className="vz-card-s">Researched {r.plan.depth === "standard" ? "at standard depth" : `${r.plan.depth}ly`} · {r.charged_cents != null ? `${r.charged_cents.toFixed(2)}¢` : "cost not reported (charged in full)"}.</span>}
    </div>
  );
}

/** The draft card for an asset with facts to decide: its picture (sourced) or an honest placeholder, key specs each
 *  with a source chip, the exceptions first, then "Accept the safe rest", and what's still missing. */
export function DraftCard({ material, name, category, missingEvidence, onChanged }: { material: string; name: string; category: string; missingEvidence: string[]; onChanged: () => void }) {
  const { toast } = useAppStable();
  const load = useCallback(async () => {
    if (!supabase) return { facts: [] as Fact[], conflicts: new Set<string>() };
    const [f, c] = await Promise.all([
      supabase.from("std_asset_facts").select("id, field, value, unit, source_class, source_kind, source_ref, source_title, source_locator, method, confidence, risk, review, retrieved_at").eq("material_id", material).in("review", ["pending", "accepted", "corrected"]).order("retrieved_at"),
      supabase.from("std_fact_conflicts").select("field").eq("material_id", material),
    ]);
    const err = f.error ?? c.error;
    if (err) throw new Error(err.message);
    return { facts: (f.data ?? []) as Fact[], conflicts: new Set(((c.data ?? []) as { field: string }[]).map((x) => x.field)) };
  }, [material]);
  const st = useAsyncData(load, [material]);
  const [fix, setFix] = useState<Record<string, string>>({});
  const pending = useMemo(() => (st.data?.facts ?? []).filter((x) => x.review === "pending"), [st.data]);
  const order = useMemo(() => reviewOrder(pending, st.data?.conflicts ?? new Set()), [pending, st.data]);
  const safe = useMemo(() => safeRest(pending, st.data?.conflicts ?? new Set()), [pending, st.data]);
  const img = imageFor(st.data?.facts ?? []);
  const call = async (fn: "std_accept_facts" | "std_reject_facts", args: Record<string, unknown>, said: string) => {
    if (!supabase) return;
    const { error } = await supabase.rpc(fn, args as never);
    if (error) { toast(failureWords(error, "Couldn't record that"), "error"); return; }
    toast(said); st.reload(); onChanged();
  };
  if (st.error) return <p className="xl-warn" role="alert">Couldn&apos;t read its findings just now.</p>;
  if (!st.data) return <p className="vz-card-s">Reading its findings…</p>;
  const accepted = st.data.facts.filter((x) => x.review !== "pending");
  return (
    <div className="xl-draft flex flex-col gap-3">
      <figure className="xl-hero">
        {/* eslint-disable-next-line @next/next/no-img-element -- the source's own picture on any host (CSP img-src https:), lazy */}
        {img ? <img src={img.url} alt={`${name}, as shown by ${img.from}`} loading="lazy" decoding="async" /> : <div className="xl-ph" aria-hidden="true"><span>{category.slice(0, 2).toUpperCase()}</span></div>}
        <figcaption className="vz-card-s">{img ? `Image from ${img.from} — the source's picture, not verified as this exact product.` : "No source image yet — a placeholder, not the product."}</figcaption>
      </figure>
      {order.length > 0 && (
        <section aria-label="To decide" className="flex flex-col gap-2">
          <b className="font-sans">To decide · {order.length}</b>
          <ul className="xl-facts">
            {order.map(({ f, why }) => (
              <li key={f.id} className={why.length ? "xl-exc" : ""}>
                <div className="flex flex-col gap-1 min-w-0">
                  <span><b className="font-sans">{factWords(f).label}</b> {factWords(f).value}</span>
                  <span className="vz-card-s">{factWords(f).source}{why.length ? ` · ${why.join(" · ")}` : ""}</span>
                  {f.id in fix && <label className="prod-f"><span>The right value</span><input autoFocus value={fix[f.id]} placeholder="As it should read" onChange={(e) => setFix({ ...fix, [f.id]: e.target.value })} /></label>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-sec btn-sm" onClick={() => void call("std_accept_facts", { p_ids: [f.id], p_corrections: fix[f.id]?.trim() ? { [f.id]: ["w_in", "d_in", "h_in", "cost_cents"].includes(f.field) ? Number(fix[f.id]) : fix[f.id].trim() } : {}, p_bulk: false }, fix[f.id]?.trim() ? "Corrected and accepted." : "Accepted.")} aria-label={`Accept ${factWords(f).label}`}>Accept</button>
                  {!(f.id in fix) && <button type="button" className="btn-ter btn-sm" onClick={() => setFix({ ...fix, [f.id]: "" })} aria-label={`Correct ${factWords(f).label}`}>Correct</button>}
                  <button type="button" className="btn-ter btn-sm" onClick={() => void call("std_reject_facts", { p_ids: [f.id], p_note: null }, "Rejected — kept on the record.")} aria-label={`Reject ${factWords(f).label}`}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
          {safe.length > 0 && <button type="button" className="btn-pri btn-sm self-start" onClick={() => void call("std_accept_facts", { p_ids: safe.map((x) => x.id), p_corrections: {}, p_bulk: true }, `${safe.length} accepted.`)}>Accept the safe rest ({safe.length})</button>}
          <p className="vz-card-s">“The safe rest” is only sourced, low-risk facts with no disagreement. Health and safety facts, inferences and conflicts are decided one at a time.</p>
        </section>
      )}
      {accepted.length > 0 && (
        <details><summary className="font-sans font-bold cursor-pointer py-2">Its specification · {accepted.length}</summary>
          <ul className="xl-hist">{accepted.map((f) => <li key={f.id}>{factWords(f).label}: {factWords(f).value} <span className="vz-card-s">— {factWords(f).source}</span></li>)}</ul>
        </details>
      )}
      {missingEvidence.length > 0 && <p className="vz-card-s">Still needed for the Standard: {missingEvidence.join(" ")}</p>}
      <p className="vz-card-s">It stays a candidate. Qualifying it needs the Standard&apos;s judgement complete; approving it is an owner&apos;s.</p>
    </div>
  );
}
