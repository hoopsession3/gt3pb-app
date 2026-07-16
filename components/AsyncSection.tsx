"use client";

import type { ReactNode } from "react";
import EmptyState from "./EmptyState";
import type { AsyncData } from "@/lib/useAsyncData";

// Renders the three states of a useAsyncData() result as three VISIBLY DIFFERENT things — the
// whole point (Wave 2, 2026-07-15). Loading and error and empty must never look the same, or a
// broken fetch reads as "you're all caught up." Error gets a real Retry, wired to the hook's reload.
export function AsyncSection<T>({
  state, isEmpty, emptyTitle, emptySub, emptyAction, loadingLabel, errorTitle, children,
}: {
  state: AsyncData<T>;
  /** default: array → length===0, otherwise falsy. Pass your own check for a scalar/object load. */
  isEmpty?: (data: T) => boolean;
  emptyTitle: string;
  emptySub?: string;
  emptyAction?: ReactNode;
  loadingLabel?: string;
  errorTitle?: string;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") {
    return <EmptyState title={loadingLabel ?? "Loading…"} />;
  }
  if (state.status === "error") {
    return (
      <EmptyState
        title={errorTitle ?? "Couldn't load this"}
        sub={state.error?.message || "Something went wrong on that request."}
        action={<button type="button" className="btn-ter" onClick={state.reload}>Try again</button>}
      />
    );
  }
  const data = state.data as T;
  const empty = isEmpty ? isEmpty(data) : Array.isArray(data) ? data.length === 0 : !data;
  if (empty) {
    return <EmptyState title={emptyTitle} sub={emptySub} action={emptyAction} />;
  }
  return <>{children(data)}</>;
}

export default AsyncSection;
