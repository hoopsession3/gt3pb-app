"use client";

import "./vision.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authedFetch";
import { useAppStable } from "@/components/AppProvider";
import { isDue } from "@/lib/visionResearch";
import type { Plan } from "@/lib/visionPlans";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "@/components/AsyncSection";
import { Segmented } from "@/components/controls";
import { readCases, readVision, type Vision } from "@/lib/visionRead";
import Roadmap from "./Roadmap";
import StoreDesigner from "./StoreDesigner";
import Present from "./Present";
import Shares from "./Shares";
import Plans from "./Plans";

// THE VISION (R52) — "What are our plans? What's next?" answered in one place: the roadmap (Now · Next · Later, why each
// program exists, where capital may be needed), the store designer (a plan to scale and the room in 3D, the reason for
// everything in it), Present (the story, full screen, to show someone across a table), and private links for someone who
// isn't. The crew read it; owners and admins change it.
type Tab = "roadmap" | "plans" | "store" | "links";

export default function VisionApp({ canEdit, isOwner = false }: { canEdit: boolean; isOwner?: boolean }) {
  const [tab, setTab] = useState<Tab>("roadmap");
  const [presenting, setPresenting] = useState(false);
  // The room the store opens on: a plan's or a program's "see its room" picks it.
  const [room, setRoom] = useState<string | null>(null);
  const openStore = useCallback((id: string) => { setRoom(id); setTab("store"); }, []);
  const loader = useCallback(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    return readVision(supabase);
  }, []);
  const state = useAsyncData(loader, []);

  return (
    <div className="vz">
      <div className="vz-top">
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="vz-h">The vision</h1>
          {/* The store is drawn on a canvas that wants the screen: the line under the title steps aside there (S1.1). */}
          {tab !== "store" && <p className="vz-sub">What&apos;s running, what&apos;s next, the store we&apos;re building — and why. Built on stillness, light, fuel and movement.</p>}
        </div>
        <button type="button" className="btn-pri" onClick={() => setPresenting(true)} disabled={!state.data}>▶ Present</button>
      </div>
      <Segmented label="The vision" kind="choice" value={tab} onChange={setTab}
        options={[{ key: "roadmap", label: "Roadmap" }, { key: "plans", label: "Plans" }, { key: "store", label: "The store" }, ...(canEdit ? [{ key: "links" as const, label: "Links" }] : [])]} />
      <AsyncSection state={state} isEmpty={() => false} emptyTitle="Nothing yet" loadingLabel="Loading the plan…" errorTitle="Couldn't load the plan" errorSub="This is not an empty plan — we couldn't read it just now.">
        {(v) => (
          <>
            {tab === "roadmap" && <Roadmap programs={v.programs} asks={v.asks} layouts={v.layouts} plans={v.plans} canEdit={canEdit} showAsks onSaved={state.reload} onOpenStore={openStore} onOpenPlans={() => setTab("plans")} />}
            {tab === "plans" && <Plans programs={v.programs} plans={v.plans} needs={v.needs} deps={v.deps} asks={v.asks} layouts={v.layouts} ready={v.plansReady} canEdit={canEdit} isOwner={isOwner} onSaved={state.reload} onOpenStore={openStore} />}
            {tab === "store" && <StoreDesigner key={room ?? "first"} layouts={v.layouts} plans={v.plans} initialId={room} canEdit={canEdit} onSaved={state.reload} />}
            {tab === "links" && canEdit && <Shares canEdit={canEdit} isOwner={isOwner} plans={v.plans} programs={v.programs} layouts={v.layouts} />}
            {canEdit && <DueChecks plans={v.plans} />}
            {presenting && <InTheRoom vision={v} withCases={canEdit} onExit={() => setPresenting(false)} />}
          </>
        )}
      </AsyncSection>
    </div>
  );
}

/** Present in the room: an owner or admin presents each plan's approved case too (R57) — read when the presenter opens;
 *  until it arrives (or for the crew, who don't read the money) the plan shows as before. */
function InTheRoom({ vision, withCases, onExit }: { vision: Vision; withCases: boolean; onExit: () => void }) {
  const load = useCallback(async () => (withCases && supabase ? readCases(supabase) : {}), [withCases]);
  const cases = useAsyncData(load, [withCases]);
  return <Present vision={{ ...vision, cases: cases.data ?? {} }} onExit={onExit} />;
}

/** The scheduled research checks (R60, 0453): when an owner or admin has the vision open, the first plan whose check is
 *  due runs — one a visit, in the background — and says what it found. Nothing runs that isn't due. */
function DueChecks({ plans }: { plans: Plan[] }) {
  const { toast } = useAppStable();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    const due = plans.find((p) => isDue(p));
    if (!due) return;
    started.current = true;
    void (async () => {
      try {
        const r = await authedFetch("/api/vision/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: due.id, scheduled: true }) }, { deadlineMs: 70_000 });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; kept?: number; notDue?: boolean };
        if (j.ok && !j.notDue && (j.kept ?? 0) > 0) toast(`${due.name}: the scheduled research found ${j.kept} new finding${j.kept === 1 ? "" : "s"} to review.`);
      } catch { /* a scheduled check that couldn't run tries again on the next visit — it's still due */ }
    })();
  }, [plans, toast]);
  return null;
}
