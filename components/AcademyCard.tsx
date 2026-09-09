"use client";

import { useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { pathProgress, pathHeadline, type PathProgress } from "@/lib/academy";
import Icon from "@/components/Icon";

// GT3 ACADEMY CARD — the crew console's link into the Academy used to be a flat label with no state:
// "GT3 Academy · Training, certifications & the cookbook". Everything around it on that page shows
// live numbers, so the one dead link is the one the eye skips — and the Academy, which is thirty
// modules and twelve certifications, had zero progress rows for anybody in the company.
//
// The role paths that say what each role must complete already existed (lib/academy ROLE_PATHS);
// nothing outside the Academy page had ever read them. So this card is not new information, it is
// information that was already derivable and never shown: where YOU stand, and the next thing to do.
// No new tables — one query against academy_progress and pure functions for the rest.

type Row = { module_slug: string; status: string };

export default function AcademyCard() {
  const loader = useCallback(async (): Promise<PathProgress | null> => {
    if (!supabase) return null;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;

    const [{ data: prof, error: pErr }, { data: prog, error: gErr }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", uid).maybeSingle(),
      supabase.from("academy_progress").select("module_slug,status").eq("user_id", uid),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (gErr) throw new Error(gErr.message);

    const completed = new Set(((prog as Row[]) ?? []).filter((r) => r.status === "complete").map((r) => r.module_slug));
    // An owner is a founder for training purposes; the role keys differ between the two tables.
    const role = (prof as { role?: string } | null)?.role === "owner" ? "admin" : ((prof as { role?: string } | null)?.role ?? "staff");
    return pathProgress(role, completed);
  }, []);

  const state = useAsyncData(loader, []);
  const p = state.data ?? null;

  // The link always renders, even while loading or if the query fails — a training path that cannot
  // be counted is still a path someone should be able to open.
  // NOT a false-empty: the whole progress block below is behind `p ?`, and p is null on a failed
  // read, so a failure renders the bare link and no numbers — never a confident 0%. The comment
  // above is the considered decision, and it holds. scripts/falseempty.audit.mjs flags this file
  // because it never names the error; that is the rule being conservative, not a defect here.
  const pct = p && p.modulesTotal > 0 ? Math.round((p.modulesDone / p.modulesTotal) * 100) : 0;

  return (
    <Link href="/academy" className="opx-link acad-card">
      <span className="acad-top">
        <span className="opx-link-t">GT3 Academy</span>
        {p && (
          <span className={`acad-chip${p.complete ? " done" : p.modulesDone === 0 ? " none" : ""}`}>
            {p.complete ? "Certified" : `${p.certsEarned}/${p.certsTotal}`}
          </span>
        )}
      </span>

      {p ? (
        <>
          <span className="opx-link-s">{pathHeadline(p)}</span>
          <span className="acad-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
          {p.nextModule && (
            <span className="acad-next">
              Next: <b>{p.nextModule.title}</b>
              {p.nextModule.estMin ? ` · ${p.nextModule.estMin} min` : ""}
              {p.nextCert ? ` · toward ${p.nextCert.title}` : ""}
              <Icon name="arrowRight" />
            </span>
          )}
        </>
      ) : (
        <span className="opx-link-s">Training, certifications &amp; the cookbook <Icon name="arrowRight" /></span>
      )}
    </Link>
  );
}
