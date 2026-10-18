"use client";

import type { ReactNode } from "react";
import EmptyState from "./EmptyState";
import PourFill from "./PourFill";
import Said from "./Said";
import type { AsyncData } from "@/lib/useAsyncData";
import { failureWords } from "@/lib/failureWords";

// Renders the three states of a useAsyncData() result as three VISIBLY DIFFERENT things — the
// whole point (Wave 2, 2026-07-15). Loading and error and empty must never look the same, or a
// broken fetch reads as "you're all caught up." Loading uses the brand's own PourFill mark (2026-
// 07-16 fix — it used to render EmptyState with a "Loading…" title, the identical box as empty/
// error, defeating the "never look the same" rule this comment already promised). Error gets a
// real Retry, wired to the hook's reload.
export function AsyncSection<T>({
  state, isEmpty, emptyTitle, emptySub, emptyAction, loadingLabel, errorTitle, errorSub, children,
}: {
  state: AsyncData<T>;
  /** default: array → length===0, otherwise falsy. Pass your own check for a scalar/object load. */
  isEmpty?: (data: T) => boolean;
  emptyTitle: string;
  emptySub?: string;
  emptyAction?: ReactNode;
  loadingLabel?: string;
  errorTitle?: string;
  /**
   * The sentence under an error, when the raw Postgres message is not the useful thing to say.
   *
   * Added 0320. The error state could carry a TITLE but not a line explaining what the failure does
   * and does not mean, so callers whose empty state is genuinely reassuring — "nothing overdue" —
   * had no way to say "this is not the same as nothing being overdue; we could not read it." That
   * distinction is the entire subject of scripts/falseempty.audit.mjs, and the shared component
   * could not express it. Defaults to the failure in plain words (R34 — UX11-11: it was the driver's raw message —
   * "JWT expired", "Failed to fetch", a table's name — under every section that failed to load).
   */
  errorSub?: string;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") {
    return <PourFill label={loadingLabel ?? "Loading…"} />;
  }
  if (state.status === "error") {
    return (
      <EmptyState
        role="alert"
        title={errorTitle ?? "Couldn't load this"}
        sub={errorSub ?? failureWords(state.error)}
        action={<button type="button" className="btn-ter" onClick={state.reload}>Try again</button>}
      />
    );
  }
  const data = state.data as T;
  // R33 (FE11-04): what is drawn says what it is. Another key's answer while this one's comes (another month, another
  // day): dimmed, busy, and "Loading…" said. A refresh of this key that failed: what we had, with why and a Try again —
  // never the old answer as if it were fresh.
  // Said through components/Said (a region that arrives holding its words is skipped by VoiceOver — spoken.audit); the
  // note's layout is utilities (the house stylesheet only goes down — css.audit).
  const NOTE = "flex flex-wrap items-center gap-x-2.5 gap-y-1 mb-2.5 text-subhead text-cream-muted";
  const note = state.stale
    ? <div className={NOTE}><Said as="span">{loadingLabel ?? "Loading…"}</Said></div>
    : state.status === "ready" && state.error && !state.refreshing
      ? <div className={NOTE}><Said as="span" assertive>Couldn&apos;t refresh — showing what we had.</Said> <button type="button" className="btn-ter" onClick={state.reload}>Try again</button></div>
      : null;
  const empty = isEmpty ? isEmpty(data) : Array.isArray(data) ? data.length === 0 : !data;
  if (empty) {
    return state.stale ? <PourFill label={loadingLabel ?? "Loading…"} /> : <>{note}<EmptyState role="status" title={emptyTitle} sub={emptySub} action={emptyAction} /></>;
  }
  if (!note) return <>{children(data)}</>;
  return <>{note}<div className={state.stale ? "opacity-50 transition-opacity motion-reduce:transition-none" : undefined} aria-busy={state.stale || undefined}>{children(data)}</div></>;
}

export default AsyncSection;
