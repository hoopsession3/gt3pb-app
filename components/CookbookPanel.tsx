"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import Skeleton from "@/components/Skeleton";
import { SectionHeader } from "@/components/kit";
import CookEnforcement from "@/components/CookEnforcement";
import Button from "@/components/Button";
import { useAsyncData } from "@/lib/useAsyncData";
import { authedFetch } from "@/lib/authedFetch";
import { failureWords } from "@/lib/failureWords";
import type { Cookbook } from "@/lib/academy";
import { CURRENT, resolveRecipe, canPublishRecipes, type RecipeBody, type RecipeSource } from "@/lib/recipeEdit";

// THE ACADEMY'S COOKBOOK PANEL (0476), split from app/academy/page.tsx so the page doesn't carry it: it loads when a
// product is opened, and the recipe sheet behind its buttons loads only when one is tapped (the /academy weight ceiling).
const RecipeEditor = dynamic(() => import("@/components/RecipeEditor"), { ssr: false });

type CookbookBook = { cookbook: Record<string, Cookbook & { amounts?: unknown[]; fill?: string }>; sources: Record<string, RecipeSource> };
let cookbookCache: CookbookBook | null = null;
async function loadCookbook(): Promise<CookbookBook> {
  if (cookbookCache) return cookbookCache;
  const r = await authedFetch("/api/academy/cookbook");
  if (r.status === 401) throw new Error("The cookbook is for the team — sign in with a staff account to read it.");
  const j = (await r.json().catch(() => null)) as ({ ok?: boolean } & Partial<CookbookBook>) | null;
  if (!r.ok || !j?.ok || !j.cookbook) throw new Error("Couldn't read the cookbook just now.");
  cookbookCache = { cookbook: j.cookbook, sources: j.sources ?? {} };
  return cookbookCache;
}
export default function CookbookPanel({ productKey, productName }: { productKey: string; productName: string }) {
  // 0476: the published version (the one Ask GT3 answers from), its version line, and the door to correct it.
  const [nonce, setNonce] = useState(0);
  const state = useAsyncData(loadCookbook, [nonce]);
  const [editing, setEditing] = useState<"read" | "edit" | null>(null);
  const { profile } = useAuth();
  const close = () => { setEditing(null); cookbookCache = null; setNonce((n) => n + 1); };
  if (state.status === "error") return <><SectionHeader label="Cookbook · operating spec" /><p className="load-failed">{failureWords(state.error as Error, "Couldn't read the cookbook")}</p></>;
  if (!state.data) return <><SectionHeader label="Cookbook · operating spec" /><Skeleton variant="row" count={3} /></>;
  const raw = state.data.cookbook[productKey];
  if (!raw) return null;
  const cb = resolveRecipe(raw as RecipeBody);   // the batch line and the build written from the amounts
  return (
    <>
        <>
          <SectionHeader label="Cookbook · operating spec" />
          <div className="rx-ver" data-testid="cookbook-version">{CURRENT}</div>
          {cb.batch && <div className="ac-faq"><b>Batch</b><span>{cb.batch}</span></div>}
          {cb.fill && <div className="ac-faq"><b>Bottle fill</b><span>{cb.fill}</span></div>}
          {cb.brew && (
            <div>
              <div className="ac-mini-h">Procedure</div>
              {/* 2026-10-01. A new operator is joining who will be cooking, and the Cookbook is
                  where he reads the method. Driven by the cookbook's `weighs` FLAG, never by
                  searching these sentences for the word "weigh" — see the note on that field in
                  lib/academy.ts. It appears on the procedures that weigh and nowhere else, for the
                  same reason BrewSteps only shows it on weighed lines. */}
              {cb.weighs && (
                <CookEnforcement label="Scale">
                  Anything weighed here goes on a scale on a <b>hard, flat, level surface</b> — a
                  counter, not a cutting board, towel, tray, or the lip of a sink. Empty container
                  on, <b>TARE / ZERO</b> to <b>0</b>, then add until the display matches.{" "}
                  <b>Re-zero for every ingredient.</b> This ratio is weight to weight, so a tilted
                  scale — or one zeroed with something already on it — carries into the whole batch.
                </CookEnforcement>
              )}
              <ol className="ac-ol">{cb.brew.map((x) => <li key={x}>{x}</li>)}</ol>
            </div>
          )}
          {cb.serve && <div><div className="ac-mini-h">Serve</div><ul className="ac-ul">{cb.serve.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {cb.storage && <div className="ac-faq"><b>Storage</b><span>{cb.storage}</span></div>}
          {cb.quality && <div className="ac-faq"><b>Quality standard</b><span>{cb.quality}</span></div>}
          {cb.troubleshoot && <div><div className="ac-mini-h">Troubleshooting</div>{cb.troubleshoot.map((t, i) => <div key={i} className="ac-faq"><b>{t.issue}</b><span>{t.fix}</span></div>)}</div>}
          <div className="rx-row">
            <Button kind="secondary" compact onClick={() => setEditing("edit")}>{canPublishRecipes(profile) ? "Edit recipe" : "Suggest a correction"}</Button>
            <Button kind="quiet" onClick={() => setEditing("read")}>Versions</Button>
          </div>
        </>
        {editing && <RecipeEditor productKey={productKey} productName={productName} start={editing} onClose={close} />}
    </>
  );
}

