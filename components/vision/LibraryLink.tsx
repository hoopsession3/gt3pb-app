"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { STATUS_WORD, costWords, toAsset, type Asset } from "@/lib/experienceLibrary";

// WHICH LIBRARY ASSET IT IS (IMS5b, 0461) — in a thing's details: the library's assets placed as this kind (or the one
// it already names), each with where it stands. Naming an asset doesn't make the thing approved: the asset's own status
// is said beside it, and anything short of Approved says so. Owners and admins read the library; the crew see nothing.
export default function LibraryLink({ kind, libraryId, onPick }: { kind: string; libraryId: string | null; onPick: (id: string | null) => void }) {
  const load = useCallback(async (): Promise<Asset[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("std_materials").select("*").or(`studio_kind.eq.${kind}${libraryId ? `,id.eq.${libraryId}` : ""}`).is("archived_at", null).order("name");
    // The crew read no library (its rows are owners' and admins'): nothing to offer. A failure is said.
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(toAsset);
  }, [kind, libraryId]);
  const list = useAsyncData(load, [kind, libraryId]);
  const assets = list.data ?? [];
  const named = assets.find((a) => a.id === libraryId) ?? null;
  if (list.error) return <p className="vz-card-s" role="status">Couldn&apos;t read the library just now — its asset isn&apos;t shown.</p>;
  if (!assets.length && !libraryId) return null;
  return (
    <div className="flex flex-col gap-1">
      {/* The asset's name is said as text, which wraps; the picker only ever shows a short word. An asset's name in the
          picker itself was cut off in a narrow inspector (an iPad on its side: "needs 285px, has 151px"). */}
      <label className="prod-f"><span>Library asset</span>
        {named && <b className="vz-card-t">{named.name}</b>}
        <select value="" onChange={(e) => { const v = e.target.value; if (v) onPick(v === "none" ? null : v); }}>
          <option value="">{libraryId ? "Change…" : "None named"}</option>
          {libraryId && <option value="none">None named</option>}
          {assets.filter((a) => a.id !== libraryId).map((a) => <option key={a.id} value={a.id}>{a.name} — {STATUS_WORD[a.status]}</option>)}
        </select>
      </label>
      {named && <p className="vz-card-s">{STATUS_WORD[named.status]}{named.status === "approved" ? "" : " — not approved for GT3 yet"} · {costWords(named)}</p>}
    </div>
  );
}
