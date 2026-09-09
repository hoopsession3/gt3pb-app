"use client";

import type { ReactNode } from "react";
import EmptyState from "./EmptyState";
import PourFill from "./PourFill";
import type { AsyncData } from "@/lib/useAsyncData";

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
   * could not express it. Defaults to the driver's message, so nothing that omits it changes.
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
        sub={errorSub ?? state.error?.message ?? "Something went wrong on that request."}
        action={<button type="button" className="btn-ter" onClick={state.reload}>Try again</button>}
      />
    );
  }
  const data = state.data as T;
  const empty = isEmpty ? isEmpty(data) : Array.isArray(data) ? data.length === 0 : !data;
  if (empty) {
    return <EmptyState role="status" title={emptyTitle} sub={emptySub} action={emptyAction} />;
  }
  return <>{children(data)}</>;
}

export default AsyncSection;
