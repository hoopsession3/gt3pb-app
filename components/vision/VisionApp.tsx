"use client";

import "./vision.css";
import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "@/components/AsyncSection";
import { Segmented } from "@/components/controls";
import { readVision } from "@/lib/visionRead";
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
          <p className="vz-sub">What&apos;s running, what&apos;s next, the store we&apos;re building — and why. Built on stillness, light, fuel and movement.</p>
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
            {tab === "links" && canEdit && <Shares canEdit={canEdit} />}
            {presenting && <Present vision={v} onExit={() => setPresenting(false)} />}
          </>
        )}
      </AsyncSection>
    </div>
  );
}
