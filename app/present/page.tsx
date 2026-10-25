"use client";

import { failureOr } from "@/lib/failureWords";
import "@/components/vision/vision.css";
import { useCallback, useState } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import { supabase } from "@/lib/supabase";
import { readShared, type Vision } from "@/lib/visionRead";
import Present from "@/components/vision/Present";
import dynamic from "next/dynamic";

// "See it all" — the roadmap, the ways in and the store to explore — loads only when it's opened: the story comes first,
// and a link someone opens on a phone downloads the story alone (R53: the explore view was riding the first download).
const Roadmap = dynamic(() => import("@/components/vision/Roadmap"), { ssr: false });
const Plans = dynamic(() => import("@/components/vision/Plans"), { ssr: false });
const StoreDesigner = dynamic(() => import("@/components/vision/StoreDesigner"), { ssr: false });

// A PRIVATE LINK TO THE PLAN (R52, 0447 vision_shared). The token is after the # — never sent to a server, never in a
// log or a referrer — and read here, on the phone. It opens on the story (components/vision/Present); "See it all"
// shows the roadmap and the store to explore, read-only. A link that's off says so, and nothing else.
export default function PresentPage() {
  const [mode, setMode] = useState<"story" | "explore">("story");
  const load = useCallback(async (): Promise<Vision> => {
    const token = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "").trim();
    if (!supabase) throw new Error("This page can't reach the plan right now.");
    if (token.length < 32) throw new Error("This link isn't complete — ask whoever sent it for the whole link.");
    return readShared(supabase, token);
  }, []);
  const state = useAsyncData(load, []);
  const vision = state.data ?? null;
  const err = state.status === "error" ? failureOr(state.error, "This link isn't live.") : null;

  if (err) return <section className="screen" id="s-present"><div className="driver-empty">{err}</div></section>;
  if (!vision) return <section className="screen" id="s-present"><div className="driver-empty">Opening the plan…</div></section>;
  return (
    <section className="screen" id="s-present">
      {mode === "story" ? (
        <Present vision={vision} forWhom={vision.label ?? null} exitLabel="See it all" onExit={() => setMode("explore")} />
      ) : (
        <div className="vz">
          <div className="vz-top">
            <h1 className="vz-h">The plan</h1>
            <button type="button" className="btn-pri" onClick={() => setMode("story")}>▶ The story</button>
          </div>
          <Roadmap programs={vision.programs} asks={vision.asks} layouts={vision.layouts} plans={vision.plans} canEdit={false} showAsks={vision.showAsks} onSaved={() => {}} />
          {vision.plans.length > 0 && <Plans programs={vision.programs} plans={vision.plans} needs={vision.needs} deps={vision.deps} asks={vision.asks} layouts={vision.layouts} ready canEdit={false} onSaved={() => {}} onOpenStore={() => {}} />}
          {vision.layouts.length > 0 && <StoreDesigner layouts={vision.layouts} plans={vision.plans} canEdit={false} onSaved={() => {}} />}
        </div>
      )}
    </section>
  );
}
