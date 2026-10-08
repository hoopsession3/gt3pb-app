"use client";

// START HERE — the crew's first day, inside the Guide (2026-10-08).
//
// Ryan, with the screenshot of the steps he texted Niño on his first day (sign out and back in, the
// profile picture, Crew Mode, the ✦, Ask GT3): "Welcome letter plus onboarding doc that helps with
// stuff like this." This is that doc, in the app, where it stays true to the screens it describes:
// the Guide's first tab, opened by the welcome letter's link (/crew?guide=start) and, once, the
// first time someone reaches the crew side on a phone. The words are lib/crewStart's — the same ones
// the letter and Ask GT3 use — and every step that can be done carries the one tap that does it,
// instead of the directions to it.
//
// Loaded with the Guide (a dynamic() import there), so the console's own script does not carry it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { authedFetch } from "@/lib/authedFetch";
import { useAsyncData } from "@/lib/useAsyncData";
import { startSteps, whoToAsk, type StartFacts, type StartStep, type StartGo } from "@/lib/crewStart";
import { isNativeApp } from "@/lib/native";
import { haptic } from "@/lib/haptics";
import Icon from "./Icon";

type Facts = Pick<StartFacts, "city" | "leadsCity" | "cityLead" | "owners" | "track">;

/** Running from the Home Screen (a PWA) or as the iPhone app. Client only — the Guide opens after a tap. */
function installedNow(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

export default function CrewStart({ onSection, onClose }: {
  /** Open a crew section — and an anchor inside it — the way the Guide's own "Go to" does. */
  onSection: (section: "day" | "settings", anchor?: string) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const router = useRouter();
  // Who leads their city and who owns GT3: a crew member cannot read anyone else's profile, so the
  // welcome letter's route answers it for the reader alone (GET /api/team/welcome). Until it answers
  // the step says the general thing; if it cannot, it says that it could not, not "nobody".
  const who = useAsyncData<Facts>(async () => {
    const r = await authedFetch("/api/team/welcome");
    const j = (await r.json()) as { ok?: boolean; error?: string } & Facts;
    if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return { city: j.city, leadsCity: j.leadsCity, cityLead: j.cityLead, owners: j.owners, track: j.track };
  }, [user?.id]);
  const facts = who.data;
  const factsFailed = who.status === "error";
  const [installed] = useState(installedNow);

  const steps = startSteps({ ...(facts ?? {}), onCrewSide: true, installed });
  const firstOpen = steps.find((s) => !s.done)?.key ?? steps[0].key;
  const [open, setOpen] = useState<string>(firstOpen);

  const go = (g: StartGo) => {
    haptic("selection");
    if (g.kind === "ask") { onClose(); window.dispatchEvent(new Event("gt3-quick-ask")); return; }
    if (g.kind === "href") { onClose(); router.push(g.href); return; }
    onSection(g.section, g.anchor);
    onClose();
  };

  // The "who" step's words once the facts are in; a failed read says so.
  const whoText = (s: StartStep) => {
    if (s.key !== "who") return s.how;
    if (factsFailed) return "Couldn't load who leads your city just now — ask the owner who brought you on, and the ✦ for anything about the craft.";
    if (!facts) return "Finding who leads your city…";
    return whoToAsk({ ...facts }) ?? s.how;
  };

  return (
    <div className="guide-list">
      {steps.map((s, i) => {
        const isOpen = open === s.key;
        return (
          <div key={s.key} className={`guide-row${isOpen ? " open" : ""}${s.done ? " here" : ""}`}>
            <button type="button" className="guide-row-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : s.key)}>
              <span className="guide-num">{s.done ? <Icon name="check" size={14} /> : i + 1}</span>
              <span className="guide-row-tt">
                <span className="guide-row-t text-[16px]">{s.title}</span>
                {s.done && <span className="guide-row-sub">Done</span>}
              </span>
              <span className={`guide-chev ev-chev${isOpen ? " open" : ""}`} aria-hidden>›</span>
            </button>
            {isOpen && (
              <div className="guide-body">
                <p className="guide-more">{whoText(s)}</p>
                {s.go && !(s.key === "crew" && s.done) && (
                  <button type="button" className="guide-go" onClick={() => go(s.go!)}>{s.go.label} ›</button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="guide-lede text-center mt-1">What each section is for is under Every section, above. Anything else — the ✦, then Ask GT3.</p>
    </div>
  );
}
