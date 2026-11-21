"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
// The recipe sheet opens on a tap: its code and its styles load then, not with the page (0476 weight, R-weight ceilings).
const RecipeEditor = dynamic(() => import("./RecipeEditor"), { ssr: false });
import { authedFetch } from "@/lib/authedFetch";
import { useAsyncData } from "@/lib/useAsyncData";
import { CURRENT, type RecipeSource } from "@/lib/recipeEdit";
import { failureWords } from "@/lib/failureWords";
import Said from "./Said";

// THE DRINKS, UNDER RECIPES (0476, 2026-11-20). The Brew screen's Recipes listed the cold-brew batches only, so a crew
// member looking for how a drink is made had nowhere to find it but the Academy. Each drink in the published book is a
// row here — its name and its version line — that opens the recipe sheet (read, suggest a correction, review, history).
type List = { names: Record<string, string>; sources: Record<string, RecipeSource> };

async function loadList(): Promise<List> {
  const r = await authedFetch("/api/academy/cookbook");
  const j = (await r.json().catch(() => null)) as ({ ok?: boolean } & Partial<List>) | null;
  if (!r.ok || !j?.ok) throw new Error("Couldn't read the drink recipes just now.");
  return { names: j.names ?? {}, sources: j.sources ?? {} };
}

export default function DrinkRecipes() {
  const [n, setN] = useState(0);
  const state = useAsyncData(loadList, [n]);
  const [open, setOpen] = useState<{ key: string | null; name: string | null } | null>(null);
  if (state.error) return <><div className="brew-sched-h mt-4.5">Drink recipes</div><p className="load-failed"><Said as="span" assertive>{failureWords(state.error, "Couldn't read the drink recipes")}</Said></p></>;
  if (!state.data) return null;   // still reading: the cold-brew list above stands meanwhile
  const rows = Object.entries(state.data.names).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <>
      <div className="brew-sched-h mt-4.5">Drink recipes</div>
      <div className="brew-list" data-testid="drink-recipes">
        {rows.map(([key, name]) => (
          <button key={key} type="button" className="brew-recipe" onClick={() => setOpen({ key, name })}>
            <span className="brew-recipe-main"><b>{name}</b><span>{CURRENT}</span></span>
            <span className="brew-recipe-go">Open ›</span>
          </button>
        ))}
        <button type="button" className="brew-recipe" onClick={() => setOpen({ key: null, name: null })}>
          <span className="brew-recipe-main"><b>New drink recipe</b><span>Start a draft for a drink that isn&apos;t on file</span></span>
          <span className="brew-recipe-go">Start ›</span>
        </button>
      </div>
      {open && <RecipeEditor productKey={open.key} productName={open.name} onClose={() => { setOpen(null); setN((x) => x + 1); }} />}
    </>
  );
}
