"use client";

import { useMemo, useState } from "react";
import "./RecipeEditor.css";
import Sheet, { CloseButton } from "./Sheet";
import Button from "./Button";
import Skeleton from "./Skeleton";
import Said from "./Said";
import { useAppStable } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { failureWords } from "@/lib/failureWords";
import { useAsyncData } from "@/lib/useAsyncData";
import type { Json } from "@/lib/database.types";
import {
  UNITS, CURRENT, batchText, changes, flOz, problems, renderText, resolveRecipe, usesAmounts, warnings, yields, amountText,
  type Amount, type AmountUnit, type RecipeBody, type RecipeSource,
} from "@/lib/recipeEdit";

// THE RECIPE, KEPT IN THE APP (0476, 2026-11-20). Ryan: "The goal is for her to maintain recipes from her phone with her
// existing account." One sheet, opened from the Academy's cookbook and from an Ask GT3 answer:
//   · READ — the published version (or the built-in one), with its version line: what Ask GT3 answers from, word for word;
//   · SUGGEST A CORRECTION — any crew member: amounts with what they add up to, the bottle fill kept apart from the yield,
//     the method, the names it's also asked for by; what changed against the published version; save a draft or submit;
//   · WHO CAN PUBLISH — named, so a submitter knows who decides;
//   · REVIEW — an owner or admin publishes or declines a submission, and restores an earlier version from the history.
// Every write is the caller's own, through 0476's policies (lib/supabase is the signed-in session): the database decides
// who may publish, not this screen. Drafts never reach Ask GT3 — lib/recipeBook reads the published version only.

type Version = {
  id: string; status: "draft" | "submitted" | "published" | "retired" | "declined"; body: RecipeBody; note: string | null;
  based_on: string | null; created_by: string; created_at: string; submitted_at: string | null; decided_by: string | null; decided_at: string | null;
  published_at: string | null; version_no: number | null;
};
type Book = { cookbook: Record<string, RecipeBody>; sources: Record<string, RecipeSource>; publishers: string[]; people: Record<string, string>; canPublish: boolean };
type View = "read" | "edit" | "review";

const COLS = "id, status, body, note, based_on, created_by, created_at, submitted_at, decided_by, decided_at, published_at, version_no";
// arrives-with: 0476  — until it is applied every read and write reports notYet(): the sheet says editing turns on with
// the update and shows the built-in recipe; nothing reads as empty.
const table = () => supabase!.from("recipe_versions");
const asJson = (b: RecipeBody) => b as unknown as Json;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
/** The table isn't there yet: 0476 is held, so the app reads the built-in cookbook and editing waits for it. */
const notYet = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /recipe_versions/.test(e.message ?? ""));

async function loadBook(): Promise<Book> {
  const r = await authedFetch("/api/academy/cookbook");
  if (r.status === 401) throw new Error("Recipes are for the team — sign in with your crew account.");
  const j = (await r.json().catch(() => null)) as (Book & { ok?: boolean }) | null;
  if (!r.ok || !j?.ok) throw new Error("Couldn't read the recipes just now.");
  return { cookbook: j.cookbook ?? {}, sources: j.sources ?? {}, publishers: j.publishers ?? [], people: j.people ?? {}, canPublish: !!j.canPublish };
}
/** The book, and this recipe's versions the caller may see (their own drafts; every version, for an owner or admin). */
async function loadAll(productKey: string | null): Promise<{ book: Book; versions: Version[]; held: boolean }> {
  const book = await loadBook();
  if (!supabase || !productKey) return { book, versions: [], held: false };
  const { data, error } = await table().select(COLS).eq("product_key", productKey).order("created_at", { ascending: false });
  if (notYet(error)) return { book, versions: [], held: true };
  if (error) throw error;
  return { book, versions: (data ?? []) as unknown as Version[], held: false };
}

const blankAmount = (): Amount => ({ item: "", single: null, large: null, unit: "fl oz" });
const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export default function RecipeEditor({ productKey, productName, start = "read", onClose }: {
  /** The recipe; null starts a new one (Ask GT3's "Create recipe draft"). */
  productKey: string | null;
  productName?: string | null;
  start?: View;
  onClose: () => void;
}) {
  const { toast } = useAppStable();
  const { user } = useAuth();
  const state = useAsyncData(() => loadAll(productKey), [productKey]);
  const book = state.data?.book ?? null;
  const versions = useMemo(() => state.data?.versions ?? [], [state.data]);
  const [heldNow, setHeld] = useState(false);
  const held = heldNow || !!state.data?.held;
  const err = state.error ? failureWords(state.error, "Couldn't open the recipe") : null;
  const load = state.reload;
  const [view, setView] = useState<View>(productKey ? start : "edit");
  const [key, setKey] = useState(productKey ?? "");
  const [draft, setDraft] = useState<RecipeBody | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);   // "Draft saved" said in place, never as a toast over the next step

  const published = productKey && book ? book.cookbook[productKey] ?? null : null;
  const source = productKey && book ? book.sources[productKey] : undefined;
  const title = productName || published?.name || draft?.name || (productKey ? productKey.replace(/_/g, " ") : "New recipe");

  // Editing starts from the published version — or your own unsent draft or submission of it, if you left one.
  const mine = versions.find((v) => v.created_by === user?.id && (v.status === "draft" || v.status === "submitted")) ?? null;
  const seed = (from: Version | null) => {
    const base: RecipeBody = from?.body ?? published ?? { name: productName ?? "" };
    setDraft({ ...base, amounts: (base.amounts ?? []).map((a) => ({ ...a })), brew: [...(base.brew ?? [])], aliases: [...(base.aliases ?? [])] });
    setDraftId(from?.id ?? null); setNote(from?.note ?? ""); setSent(null); setSavedAt(null);
  };
  const beginEdit = (from: Version | null) => { seed(from); setView("edit"); };
  // Opened straight into editing (Ask GT3's "Suggest a correction"): seeded once the recipe and its versions are read —
  // adjusted while rendering, the way React takes a change from what it read, not in an effect.
  if ((view === "edit" || view === "review") && !draft && !sent && state.data) seed(mine);

  const diff = useMemo(() => (draft ? changes(published, draft) : []), [draft, published]);
  const y = yields(draft?.amounts);
  const blockers = draft ? problems(draft) : [];
  const cautions = draft ? warnings(draft) : [];
  const dirty = (view === "edit" || view === "review") && diff.length > 0 && !sent;
  // Before 0476 is applied there is nowhere to keep a version: the sheet shows the current recipe and says editing
  // arrives with the update — never an edit form that can't be saved (Ask GT3's Edit recipe lands here too).
  const shown: View = held ? "read" : view;
  // Owners and admins EDIT the recipe and publish it themselves after reviewing what changed; everyone else on the crew
  // SUGGESTS a correction and submits it for review. The database decides who may publish (0476); this only words it.
  const isAdmin = !!book?.canPublish;

  const save = async (status: "draft" | "submitted", publishNow = false) => {
    if (!supabase || !draft || !user) return;
    const k = productKey ?? key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
    if (!k) { toast("Give the recipe a name first", "error"); return; }
    if (blockers.length) { toast(blockers[0], "error"); return; }
    setBusy(true);
    const body = { ...draft, name: draft.name || title, amounts: (draft.amounts ?? []).filter((a) => a.item.trim()), brew: (draft.brew ?? []).filter((s) => s.trim()) };
    const basedOn = source?.source === "published" ? source.id : null;
    const res = draftId
      ? await table().update({ body: asJson(body), note: note || null, status }).eq("id", draftId).select("id").single()
      : await table().insert({ product_key: k, body: asJson(body), note: note || null, status, based_on: basedOn }).select("id").single();
    setBusy(false);
    if (notYet(res.error)) { setHeld(true); return; }
    if (res.error) { toast(failureWords(res.error, status === "submitted" ? "Not submitted" : "Not saved"), "error"); return; }
    setDraftId(res.data.id);
    if (status === "submitted" && publishNow) {
      // An owner or admin correcting it themselves: submitted, then published by the same hand — the database stamps
      // them as the decider and retires the version before, exactly as a review would.
      const p = await table().update({ status: "published" }).eq("id", res.data.id);
      if (p.error) { toast(failureWords(p.error, "Saved and submitted, but not published"), "error"); setSent(res.data.id); void load(); return; }
      toast("Published — Ask GT3 answers from it now");
      setDraft(null); setDraftId(null); setView("read"); await load(); return;
    }
    if (status === "submitted") { setSent(res.data.id); setSavedAt(null); }
    else setSavedAt(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    void load();
  };

  // An owner or admin saves the built-in recipe, exactly as it stands, as the first published version: nothing the crew
  // or Ask GT3 reads changes, and History has a v1 to restore to.
  const adoptCurrent = async () => {
    if (!supabase || !published || !productKey) return;
    setBusy(true);
    const ins = await table().insert({ product_key: productKey, body: asJson(published), note: "The current recipe, kept as v1 (unchanged)", status: "submitted" }).select("id").single();
    if (notYet(ins.error)) { setBusy(false); setHeld(true); return; }
    if (ins.error) { setBusy(false); toast(failureWords(ins.error, "Not saved"), "error"); return; }
    const pub = await table().update({ status: "published" }).eq("id", ins.data.id);
    setBusy(false);
    if (pub.error) { toast(failureWords(pub.error, "Saved, but not published"), "error"); void load(); return; }
    toast("Saved as v1 — the recipe the crew reads is unchanged");
    await load();
  };

  const decide = async (v: Version, status: "published" | "declined") => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await table().update({ status }).eq("id", v.id);
    setBusy(false);
    if (error) { toast(failureWords(error, status === "published" ? "Not published" : "Not declined"), "error"); return; }
    toast(status === "published" ? (v.status === "retired" ? `Restored v${v.version_no} — Ask GT3 answers from it now` : "Published — Ask GT3 answers from it now") : "Declined");
    await load();
  };

  const discard = async () => {
    if (!supabase || !draftId) { setDraft(null); setView("read"); return; }
    const { error } = await table().delete().eq("id", draftId);
    if (error) { toast(failureWords(error, "Not discarded"), "error"); return; }
    setDraft(null); setDraftId(null); setView("read"); void load();
  };

  const setAmount = (i: number, patch: Partial<Amount>) => setDraft((d) => d && ({ ...d, amounts: (d.amounts ?? []).map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const setStep = (i: number, text: string) => setDraft((d) => d && ({ ...d, brew: (d.brew ?? []).map((s, j) => (j === i ? text : s)) }));
  const FORMULA_STEP = "Single mix: {{single}}. Large batch: {{large}}.";
  const waiting = versions.filter((v) => v.status === "submitted");
  const history = versions.filter((v) => v.status === "published" || v.status === "retired").sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const whoPublishes = book?.publishers.length ? book.publishers.join(" or ") : "an owner or admin";

  const header = (
    <div className="rx-head">
      <div>
        <b className="text-subhead font-semibold">{shown === "read" ? title : !productKey ? "New recipe draft" : isAdmin ? `Edit: ${title}` : `Correct: ${title}`}</b>
        <div className="rx-ver" data-testid="recipe-version">{productKey ? CURRENT : "Not on file yet"}</div>
      </div>
      <CloseButton onClick={onClose} />
    </div>
  );

  return (
    <Sheet open onClose={onClose} label={shown === "read" ? title : isAdmin ? `Edit ${title}` : `Suggest a correction to ${title}`} header={header} className="rx-sheet" dirty={dirty}>
      <div className="rx">
        {err && <p className="load-failed"><Said as="span" assertive>{err}</Said></p>}
        {!book && !err && <Skeleton variant="row" count={4} />}
        {held && (
          <p className="rx-note"><Said as="span">Recipe editing turns on once the recipe update is applied to the app&apos;s database. Until then this is the built-in recipe, and Ask GT3 answers from it.</Said></p>
        )}

        {book && shown === "read" && (
          <>
            <RecipeRead body={published} />
            {!held && (
              <div className="rx-actions">
                <Button kind="primary" wide onClick={() => beginEdit(mine)}>{mine ? (mine.status === "submitted" ? "Edit your submission" : "Continue your draft") : isAdmin ? "Edit recipe" : "Suggest a correction"}</Button>
              </div>
            )}
            <p className="rx-who">Corrections are published by {whoPublishes}.</p>

            {isAdmin && waiting.length > 0 && (
              <section aria-label="Waiting for review">
                <div className="ac-mini-h">Waiting for review</div>
                {waiting.map((v) => (
                  <div key={v.id} className="k-card rx-card" data-testid="recipe-review">
                    <div className="rx-meta">Submitted {day(v.submitted_at)}{v.note ? ` — “${v.note}”` : ""}</div>
                    <ChangeList items={changes(published, v.body)} />
                    <RecipeRead body={v.body} compact />
                    {warnings(v.body).map((w) => <p key={w} className="rx-warn">{w}</p>)}
                    <div className="rx-row">
                      <Button kind="primary" compact disabled={busy} onClick={() => decide(v, "published")}>Publish</Button>
                      <Button kind="secondary" compact disabled={busy} onClick={() => decide(v, "declined")}>Decline</Button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {history.length === 0 && productKey && !held && (
              <section aria-label="Version history"><div className="ac-mini-h">History</div><p className="rx-note" data-testid="recipe-history-none">The built-in recipe — not edited in the app yet.</p>
                {/* Keep the current recipe as v1, unchanged (2026-11-21): a restore point in History before anyone edits it,
                    so publish and restore can be proven on the live latte without changing a single quantity. */}
                {isAdmin && published && <Button kind="secondary" compact disabled={busy} onClick={adoptCurrent}>Keep the current recipe as v1</Button>}
              </section>
            )}
            {history.length > 0 && (
              <section aria-label="Version history">
                <div className="ac-mini-h">History</div>
                {history.map((v) => (
                  <div key={v.id} className="rx-hist" data-testid="recipe-history">
                    <span>v{v.version_no} · {day(v.published_at)}{v.decided_by && book?.people[v.decided_by] ? ` · published by ${book.people[v.decided_by]}` : ""}{v.status === "published" ? " · current" : ""}</span>
                    {isAdmin && v.status === "retired" && <Button kind="secondary" compact disabled={busy} onClick={() => decide(v, "published")}>Restore</Button>}
                  </div>
                ))}
                {!isAdmin && <p className="rx-who">Only {whoPublishes} can restore an earlier version.</p>}
              </section>
            )}
          </>
        )}

        {book && shown === "edit" && draft && !sent && (
          <>
            {!productKey && (
              <label className="rx-field">Drink name
                <input className="ev-input" value={draft.name ?? ""} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setKey(e.target.value); }} placeholder="e.g. Pumpkin Cold Foam" />
              </label>
            )}

            <div className="ac-mini-h">Amounts</div>
            <div className="rx-amts" role="table" aria-label="Amounts">
              <div className="rx-amt rx-amt-h" role="row"><span role="columnheader">Ingredient</span><span role="columnheader">Single</span><span role="columnheader">Large</span><span role="columnheader">Unit</span><span /></div>
              {(draft.amounts ?? []).map((a, i) => (
                <div className="rx-amt" role="row" key={i}>
                  <input className="ev-input" aria-label={`Ingredient ${i + 1}`} value={a.item} onChange={(e) => setAmount(i, { item: e.target.value })} />
                  <input className="ev-input" aria-label={`${a.item || "Ingredient"} single mix`} inputMode="decimal" value={a.single ?? ""} onChange={(e) => setAmount(i, { single: num(e.target.value) })} />
                  <input className="ev-input" aria-label={`${a.item || "Ingredient"} large batch`} inputMode="decimal" value={a.large ?? ""} onChange={(e) => setAmount(i, { large: num(e.target.value) })} />
                  <select className="ev-input" aria-label={`${a.item || "Ingredient"} unit`} value={a.unit} onChange={(e) => setAmount(i, { unit: e.target.value as AmountUnit })}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button type="button" className="rx-x" aria-label={`Remove ${a.item || "this line"}`} onClick={() => setDraft({ ...draft, amounts: (draft.amounts ?? []).filter((_, j) => j !== i) })}>×</button>
                </div>
              ))}
              <Button kind="quiet" onClick={() => setDraft({ ...draft, amounts: [...(draft.amounts ?? []), blankAmount()] })}>Add an ingredient</Button>
            </div>
            <div className="k-card rx-yield" data-testid="recipe-yield" aria-live="polite">
              <span>Makes <b>{flOz(y.single)}</b> single mix</span><span><b>{flOz(y.large)}</b> large batch</span>
            </div>
            <label className="rx-field">Bottle fill (separate from the yield)
              <input className="ev-input" value={draft.fill ?? ""} onChange={(e) => setDraft({ ...draft, fill: e.target.value })} placeholder="e.g. bottles filled to a set line" />
            </label>
            {draft.amounts?.length ? (
              <>
                <div className="rx-field">Batch line — written from the amounts
                  <p className="k-card rx-from" data-testid="recipe-batch">{batchText(draft)}</p>
                </div>
                <label className="rx-field">Batch note (said after it)
                  <input className="ev-input" value={draft.batchNote ?? ""} onChange={(e) => setDraft({ ...draft, batchNote: e.target.value })} />
                </label>
              </>
            ) : (
              <label className="rx-field">Batch line (what the crew reads)
                <textarea className="ev-input" rows={4} value={draft.batch ?? ""} onChange={(e) => setDraft({ ...draft, batch: e.target.value })} />
              </label>
            )}

            <div className="ac-mini-h">Method</div>
            <ol className="rx-steps">
              {(draft.brew ?? []).map((s, i) => (
                <li key={i}>
                  {usesAmounts(s) ? (
                    // A step written from the amounts: change the table and it follows. Shown as it will read.
                    <div className="k-card rx-from" data-testid="recipe-step-from-amounts" aria-label={`Step ${i + 1}, from the amounts`}>
                      {renderText(s, draft.amounts)}
                      <span className="rx-from-tag">From the amounts above</span>
                    </div>
                  ) : (
                    <div className="rx-step">
                      <textarea className="ev-input" rows={2} aria-label={`Step ${i + 1}`} value={s} onChange={(e) => setStep(i, e.target.value)} />
                      {draft.amounts?.some((a) => a.item.trim() && s.toLowerCase().includes(a.item.trim().toLowerCase())) && /\d\s*(fl\s*oz|tbsp|tsp|cup)/i.test(s) && (
                        <Button kind="quiet" onClick={() => setStep(i, FORMULA_STEP)}>Fill from amounts</Button>
                      )}
                    </div>
                  )}
                  <button type="button" className="rx-x" aria-label={`Remove step ${i + 1}`} onClick={() => setDraft({ ...draft, brew: (draft.brew ?? []).filter((_, j) => j !== i) })}>×</button>
                </li>
              ))}
            </ol>
            <Button kind="quiet" onClick={() => setDraft({ ...draft, brew: [...(draft.brew ?? []), ""] })}>Add a step</Button>

            <label className="rx-field">Also called (comma between names)
              <input className="ev-input" value={(draft.aliases ?? []).join(", ")} onChange={(e) => setDraft({ ...draft, aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </label>
            {!isAdmin && <label className="rx-field">What was wrong (for the reviewer)
              <textarea className="ev-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. the card in the kitchen says a different amount" />
            </label>}

            {!isAdmin && <>
              <div className="ac-mini-h">What changed</div>
              {diff.length ? <ChangeList items={diff} /> : <p className="rx-note">Nothing yet — this matches the {productKey ? "current recipe" : "empty recipe"}.</p>}
            </>}
            {cautions.map((w) => <p key={w} className="rx-warn">{w}</p>)}
            {blockers.map((w) => <p key={w} className="rx-warn" role="alert">{w}</p>)}

            {isAdmin ? (
              <div className="rx-actions">
                <Button kind="primary" wide disabled={busy || !diff.length || blockers.length > 0} onClick={() => setView("review")}>Review changes</Button>
                <Button kind="secondary" wide disabled={busy || !diff.length} onClick={() => save("draft")}>Save draft</Button>
                <Button kind="quiet" disabled={busy} onClick={discard}>{draftId ? "Discard draft" : "Cancel"}</Button>
              </div>
            ) : (
              <>
                <p className="rx-who" data-testid="recipe-publishers">Who can publish it: <b>{whoPublishes}</b>. The crew keeps seeing the current recipe until it&apos;s published.</p>
                <div className="rx-actions">
                  <Button kind="primary" wide disabled={busy || !diff.length || blockers.length > 0} onClick={() => save("submitted")}>Submit for review</Button>
                  <Button kind="secondary" wide disabled={busy || !diff.length} onClick={() => save("draft")}>Save draft</Button>
                  <Button kind="quiet" disabled={busy} onClick={discard}>{draftId ? "Discard draft" : "Cancel"}</Button>
                </div>
              </>
            )}
            {savedAt && <p className="rx-note" data-testid="recipe-saved"><Said as="span">Draft saved at {savedAt} — only you and the owners can see it.</Said></p>}
          </>
        )}

        {book && shown === "review" && draft && !sent && (
          // An owner's or admin's own edit: what changes, then the recipe as it will read — and only then Publish now.
          <>
            <div className="ac-mini-h">What changes</div>
            <ChangeList items={diff} />
            {cautions.map((w) => <p key={w} className="rx-warn">{w}</p>)}
            <div className="ac-mini-h">As it will read</div>
            <RecipeRead body={draft} compact />
            <p className="rx-who" data-testid="recipe-publish-note">Publishing makes this the current recipe for the crew and Ask GT3. {source?.source === "published" ? "The one it replaces stays in History and can be restored." : "The built-in recipe stays in the app as the fallback."}</p>
            <div className="rx-actions">
              <Button kind="primary" wide disabled={busy || !diff.length || blockers.length > 0} onClick={() => save("submitted", true)}>Publish now</Button>
              <Button kind="secondary" wide disabled={busy} onClick={() => setView("edit")}>Back to editing</Button>
            </div>
          </>
        )}

        {sent && (
          <div className="rx-done" data-testid="recipe-submitted">
            <Said as="p">Submitted for review. The crew will keep seeing the current recipe until your correction is published.</Said>
            <p className="rx-who">{whoPublishes} can publish it.</p>
            <Button kind="secondary" wide onClick={() => { setSent(null); setDraft(null); setView("read"); }}>Back to the recipe</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ChangeList({ items }: { items: { field: string; before: string; after: string }[] }) {
  if (!items.length) return <p className="rx-note">No changes.</p>;
  return (
    <ul className="rx-diff" data-testid="recipe-changes">
      {items.map((c, i) => (
        <li key={i}><b>{c.field}</b>{c.before && <s>{c.before}</s>}{c.after ? <ins>{c.after}</ins> : <em>removed</em>}</li>
      ))}
    </ul>
  );
}

/** The recipe as the crew reads it: amounts with what they add up to, the fill, the method. */
export function RecipeRead({ body: raw, compact = false }: { body: RecipeBody | null; compact?: boolean }) {
  if (!raw) return <p className="rx-note">No recipe on file yet.</p>;
  // Written from the amounts: the table, the yield, the build step and the batch line can't disagree.
  const body = resolveRecipe(raw);
  const y = yields(body.amounts);
  return (
    <div className={`rx-read${compact ? " rx-compact" : ""}`} data-testid={compact ? undefined : "recipe-read"}>
      {body.amounts?.length ? (
        <div className="rx-amts" role="table" aria-label="Amounts" data-testid={compact ? undefined : "recipe-table"}>
          <div className="rx-amt rx-amt-h rx-amt-ro" role="row"><span role="columnheader">Ingredient</span><span role="columnheader">Single</span><span role="columnheader">Large</span></div>
          {body.amounts.map((a) => (
            <div className="rx-amt rx-amt-ro" role="row" key={a.item}><span role="cell">{a.item}</span><span role="cell">{amountText(a.single, a.unit)}</span><span role="cell">{amountText(a.large, a.unit)}</span></div>
          ))}
          <div className="rx-amt rx-amt-ro rx-amt-t" role="row"><span role="cell">Makes</span><span role="cell">{flOz(y.single)}</span><span role="cell">{flOz(y.large)}</span></div>
        </div>
      ) : body.batch ? <div className="ac-faq"><b>Batch</b><span>{body.batch}</span></div> : null}
      {body.fill && <div className="ac-faq"><b>Bottle fill</b><span>{body.fill}</span></div>}
      {body.brew?.length ? <div><div className="ac-mini-h">Method</div><ol className="ac-ol" data-testid={compact ? undefined : "recipe-method"}>{body.brew.map((x, i) => <li key={i}>{x}</li>)}</ol></div> : null}
      {body.aliases?.length ? <div className="ac-faq"><b>Also called</b><span>{body.aliases.join(", ")}</span></div> : null}
    </div>
  );
}
