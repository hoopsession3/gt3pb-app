"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useOptions } from "./useOptions";
import { relativeDay } from "@/lib/dates";
import AsyncSection from "./AsyncSection";
import { InfoRow, SectionHeader } from "@/components/kit";
import Field from "./Field";

// FILED — the other half of Smart Intake.
//
// ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────────────────────────
// 0088 built the intake bucket and public.documents: drop a permit, a certificate of insurance, a
// contract, a receipt or an equipment manual, the agent reads it, proposes where it belongs, and
// paperwork is filed into documents. That write has worked since 0088. NOTHING IN THE APPLICATION
// HAS EVER READ THAT TABLE — one grep, one hit, and it is the insert in app/api/agents/intake.
//
// So the product's honest description of the feature was: upload a permit, watch it say "Filed",
// and never see it again. The file is in a PRIVATE bucket, so it is not recoverable by knowing a
// URL either. The only reader was the SQL editor.
//
// That is the same shape as the readiness view with no consumer and the five setter RPCs with no
// caller: a write path finished, a read path never built. This is the read path, and nothing more —
// no new table, no new kind, no new concept.
//
// ── WHAT IT SHOWS TODAY: NOTHING ───────────────────────────────────────────────────────────────
// Measured against production on 2026-09-09: public.documents has ZERO rows, and zero with a file.
// So this ships showing its empty state, and that is worth stating plainly rather than dressing up.
// It is also the reason the missing reader went unnoticed for 230 migrations — nobody has filed a
// document yet, so nobody has yet gone looking for one.
//
// It is still the right thing to ship BEFORE there is data rather than after. The alternative is
// that the first permit somebody files is invisible, they conclude the feature does not work, and
// they stop using it — which is how a table stays at zero rows forever.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
// It does not link a document to a compliance rule. v_obligations knows six permit rules are due a
// re-check, and a PDF filed here under kind='permit' is plausibly the evidence for one of them —
// but WHICH document proves WHICH rule is a decision with a real consequence (a rule marked
// confirmed is a rule that stops asking), and nobody has stated that rule. Guessing it by matching
// on a title would be inventing compliance logic, so it is left undone and named here instead.
//
// It also does not upload, rename, retag or delete. Filing is Smart Intake's job, directly above
// this on the same screen; two places to file one document is exactly the duplication this codebase
// keeps paying for.
//
// ── SIGNED URLS, ON DEMAND ─────────────────────────────────────────────────────────────────────
// The bucket is private, so a row is not a link — a link has to be minted. VipQueue signs its whole
// list up front for eight hours because a queue is worked through end to end during a shift. A
// filing cabinet is not: somebody opens one document out of forty. Signing forty URLs to serve one
// is waste, and an eight-hour URL for a contract is a longer-lived secret than it needs to be. So
// each is signed when it is asked for, for ten minutes, the same as the note attachments in the
// crew console.

type Doc = {
  id: string; title: string; kind: string; summary: string | null;
  storage_path: string | null; file_name: string | null; mime: string | null;
  tags: string[] | null; created_at: string;
};

const SHOW = 8;

export default function DocsFiled() {
  const kinds = useOptions("doc_kind");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Doc[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("documents")
      .select("id, title, kind, summary, storage_path, file_name, mime, tags, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data as Doc[]) ?? [];
  }, []);
  const state = useAsyncData<Doc[]>(loader, []);

  // The word for a kind comes from option_sets, the same list the filing form offers — so a kind
  // renamed there is renamed here, and this screen never invents an eleventh vocabulary for the
  // same column. An unrecognised kind shows its raw value rather than nothing.
  const kindLabel = useMemo(() => {
    const m: Record<string, string> = {};
    kinds.forEach((o) => { m[o.value] = o.label; });
    return (v: string) => m[v] ?? v;
  }, [kinds]);

  const openDoc = async (d: Doc) => {
    if (!supabase || !d.storage_path || opening) return;
    setErr(null); setOpening(d.id);
    const { data, error } = await supabase.storage.from("intake").createSignedUrl(d.storage_path, 600);
    setOpening(null);
    // Say which one failed and why. "Couldn't open" on a list of forty is not an error message.
    if (error || !data?.signedUrl) { setErr(`Couldn't open ${d.title} — ${error?.message ?? "no link came back"}.`); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <AsyncSection
      state={state}
      isEmpty={(rows) => rows.length === 0}
      emptyTitle="Nothing filed yet"
      emptySub="Drop a permit, a certificate of insurance, a contract, a receipt or a manual into Smart Intake above and it lands here."
      loadingLabel="Reading the cabinet…"
      errorTitle="Couldn't read what's on file"
      errorSub="This is not the same as nothing being filed — we could not read it just now."
    >
      {(rows) => {
        const present = [...new Set(rows.map((r) => r.kind))].sort();
        const ql = q.trim().toLowerCase();
        const shown = rows.filter((d) =>
          (!kind || d.kind === kind) &&
          (!ql
            || d.title.toLowerCase().includes(ql)
            || (d.summary ?? "").toLowerCase().includes(ql)
            || (d.file_name ?? "").toLowerCase().includes(ql)
            || (d.tags ?? []).some((t) => t.toLowerCase().includes(ql))));
        const list = open ? shown : shown.slice(0, SHOW);

        return (
          <div className="adm-sec">
            <SectionHeader label="Filed" annotation={`${rows.length} document${rows.length === 1 ? "" : "s"}`} />
            <div className="h-sub">
              Everything Smart Intake has filed as paperwork. The files themselves stay in the private
              bucket — opening one mints a link that expires in ten minutes.
            </div>

            <Field label="Search filed documents" kind="text" value={q} onChange={setQ}
                   placeholder="Title, summary, file name or tag" />

            {/* Kinds come from the rows on file, not from a hard-coded list — a filter offering
                "Certificate of insurance" when none is on file is a dead end dressed as a choice. */}
            {present.length > 1 && (
              <div className="prod-actions" style={{ marginTop: 8 }}>
                <button type="button" className={kind === "" ? "k-chip" : "k-chip k-chip-sec"} onClick={() => setKind("")}>
                  All
                </button>
                {present.map((k) => (
                  <button key={k} type="button" className={kind === k ? "k-chip" : "k-chip k-chip-sec"}
                          onClick={() => setKind(kind === k ? "" : k)} aria-pressed={kind === k}>
                    {kindLabel(k)}
                  </button>
                ))}
              </div>
            )}

            {err && <p className="cp-line" role="alert" style={{ color: "var(--red)" }}>{err}</p>}

            {/* A filter that matches nothing is not the same as an empty cabinet, and must not
                borrow the empty state above — that would tell somebody they have no documents when
                what they have is a typo. */}
            {shown.length === 0 ? (
              <p className="cp-line dim">
                Nothing matches {ql ? `“${q.trim()}”` : "that filter"}
                {kind ? ` in ${kindLabel(kind)}` : ""}. {rows.length} document{rows.length === 1 ? " is" : "s are"} on file.
              </p>
            ) : (
              list.map((d) => (
                <InfoRow
                  key={d.id}
                  lead={kindLabel(d.kind)}
                  name={d.title}
                  sub={d.summary ?? undefined}
                  meta={
                    <>
                      {relativeDay(d.created_at)}
                      {d.file_name ? ` · ${d.file_name}` : ""}
                      {(d.tags ?? []).length > 0 ? ` · ${(d.tags ?? []).join(", ")}` : ""}
                    </>
                  }
                  trailing={
                    d.storage_path ? (
                      <button type="button" className="cp-inline-act" disabled={opening === d.id}
                              onClick={() => openDoc(d)}
                              aria-label={`Open ${d.title}`}>
                        {opening === d.id ? "Opening…" : "Open"}
                      </button>
                    ) : (
                      // A row with no file is a record of a decision, not a broken link. Say so
                      // rather than rendering a button that cannot work.
                      <span className="dim" style={{ fontSize: 11 }}>No file</span>
                    )
                  }
                />
              ))
            )}

            {shown.length > list.length && (
              <button type="button" className="owed-more" onClick={() => setOpen(true)}>
                Show the other {shown.length - list.length} <span aria-hidden="true">›</span>
              </button>
            )}
            {open && shown.length > SHOW && (
              <button type="button" className="owed-more" onClick={() => setOpen(false)}>Show fewer</button>
            )}
          </div>
        );
      }}
    </AsyncSection>
  );
}
