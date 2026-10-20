"use client";

import "@/components/nutrition/nutrition.css";
import { useState } from "react";
import Icon from "@/components/Icon";
import { authedFetch } from "@/lib/authedFetch";
import { apiUrl } from "@/lib/native";
import { saveFile } from "@/lib/deviceActions";
import { haptic } from "@/lib/haptics";
import { MAPS, mapHref, sizeLabel, type NutritionMap } from "@/lib/nutrition";

// THE LIBRARY (R44) — every map the course was built from, as a static file to zoom, keep and search, the way the
// owner's Rookie board always offered them ("Download for easy reference to better zoom, negate and search!"). Rookie
// maps are anyone's; the Engine and pillar maps are Pro (lib/nutrition MAPS) and open only for a member or the crew —
// for anyone else the row says Pro and points at what unlocks it. A search on the page narrows this list too.

/** A Pro map is asked for with the reader's sign-in (a plain link carries none), then saved the house's one way —
 *  lib/deviceActions: a download on the web, the share sheet in the iPhone app. */
async function downloadPro(m: NutritionMap): Promise<string | null> {
  const r = await authedFetch(mapHref(m));
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    return j?.error || "That map didn't download. Try again in a moment.";
  }
  const out = await saveFile(`GT3 Nutrition - ${m.title}.pdf`, await r.blob());
  return out === "done" || out === "cancelled" ? null : "That map didn't save. Try again in a moment.";
}

export default function MapLibrary({ query, isPro }: { query: string; isPro: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = MAPS.filter((m) => !q || `${m.title} ${m.blurb} ${m.level}`.toLowerCase().includes(q));
  if (!shown.length) return null;
  const row = (m: NutritionMap, i: number) => {
    const locked = m.tier === "pro" && !isPro;
    const size = sizeLabel(m.bytes);
    const inner = (
      <>
        <span className="nu-lib-ic" aria-hidden="true"><Icon name={locked ? "lock" : "download"} size={16} /></span>
        <span className="nu-lib-x">
          <span className="nu-lib-t">{m.title}</span>
          <span className="nu-lib-s">{m.blurb}</span>
        </span>
        <span className="nu-lib-go">{locked ? "Pro" : `PDF${size ? ` · ${size}` : ""}`}</span>
      </>
    );
    return locked ? (
      <a key={m.slug} href="#nu-pro" className="nu-lib-row pro fx-glow fx-rise" style={{ "--i": i } as React.CSSProperties} onClick={() => haptic("light")}
        aria-label={`${m.title} — a Pro map. See what Pro unlocks.`}>{inner}</a>
    ) : m.tier === "pro" ? (
      <button key={m.slug} type="button" className="nu-lib-row pro fx-glow fx-rise" style={{ "--i": i } as React.CSSProperties} disabled={busy === m.slug}
        aria-label={`Download ${m.title}${size ? `, ${size}` : ""}`}
        onClick={async () => {
          haptic("light"); setBusy(m.slug); setErr(null);
          const e = await downloadPro(m).catch(() => "That map didn't download. Try again in a moment.");
          setBusy(null);
          if (e) { haptic("error"); setErr(e); } else haptic("success");
        }}>{inner}</button>
    ) : (
      <a key={m.slug} href={apiUrl(mapHref(m))} download className="nu-lib-row fx-glow fx-rise" style={{ "--i": i } as React.CSSProperties}
        onClick={() => haptic("light")} aria-label={`Download ${m.title}${size ? `, ${size}` : ""}`}>{inner}</a>
    );
  };
  return (
    <div className="nu-lib">
      {shown.map(row)}
      {err && <p className="pr-note pr-note-err my-1!" role="alert">{err}</p>}
    </div>
  );
}
