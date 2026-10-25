"use client";

import { failureOr } from "@/lib/failureWords";
import "@/components/vision/vision.css";
import { useCallback, useState } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import { supabase } from "@/lib/supabase";
import { readShared, type Vision } from "@/lib/visionRead";
import Present from "@/components/vision/Present";
import Roadmap from "@/components/vision/Roadmap";
import StoreDesigner from "@/components/vision/StoreDesigner";

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
          <Roadmap programs={vision.programs} asks={vision.asks} layouts={vision.layouts} canEdit={false} showAsks={vision.showAsks} onSaved={() => {}} />
          {vision.layouts.length > 0 && <StoreDesigner layouts={vision.layouts} canEdit={false} onSaved={() => {}} />}
        </div>
      )}
    </section>
  );
}
